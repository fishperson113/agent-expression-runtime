"""Pinned local GLiNER2.5-Decide shadow classifier; no actions or remote inference."""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys
import time

MODEL_ID = 'fastino/GLiNER2.5-Decide'
REVISION = '9d1bfb848cd16d93ee56ccbc59cd92bf0f284d90'
RUNTIME_SHA = 'acc500efe68209df7620c5810b5ff38a4d6151e8799063e0139ec60220183a60'
LABELS = ['observe', 'attend', 'acknowledge', 'playful', 'abstain']
EXPECTED_FILES = {'config.json': '501c6579278518e72dbba5a1f248b421dd5bfb13600db45d86c94c224368670b', 'encoder_config/config.json': 'bd32f1484ba5a199f7a63df44df3814b839fffcf6e64478323c4689868ef6015', 'special_tokens_map.json': '84ea70143f533d7e99b393d87f20010887a9ac2cba955828ef313886e4e83f4f', 'tokenizer.json': '3ad87d9ffe669147063e70850927dd2da90249e2acc5c8527f1eb65df467bcc8', 'tokenizer_config.json': '323199a4e946039410899f3779f2aa3eaef1500213c512727ad0f623d4f21309', 'model.safetensors': '40a5a23ff860dc3dff426cecd1048cacdd29c648c96db209dad818e9686dc997'}
DESCRIPTIONS = {
    'observe': 'Sufficient measured evidence, but no new reaction is appropriate.',
    'attend': 'Brief attention response to reliable sustained hand movement.',
    'acknowledge': 'Brief acknowledgment of a reliable measured geometric face change.',
    'playful': 'Brief playful response to sustained alternating hand directions in an eligible context.',
    'abstain': 'Insufficient, contradictory or unsupported measured evidence; missing modalities stay unknown.'}


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def verify_model(model_dir):
    for name, expected in EXPECTED_FILES.items():
        if digest(model_dir / name) != expected:
            raise ValueError('pinned model/source mismatch: ' + name)
    return EXPECTED_FILES


def load_model(model_dir):
    os.environ.update({'USE_TF': '0', 'HF_HUB_OFFLINE': '1',
                       'TRANSFORMERS_OFFLINE': '1', 'TOKENIZERS_PARALLELISM': 'false'})
    import torch
    import gliner2.inference.runtime as runtime
    from gliner2 import AutoExtractor
    if importlib.metadata.version('gliner2') != '2.1.0' or digest(runtime.__file__) != RUNTIME_SHA:
        raise ValueError('unreviewed GLiNER runtime')
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    started = time.perf_counter()
    model = AutoExtractor.from_pretrained(str(model_dir), map_location='cpu',
                                         attention_backend='standard', compile=False)
    model.eval()
    return model, (time.perf_counter() - started) * 1000


def questions(prompt, reverse=False):
    labels = list(reversed(LABELS)) if reverse else LABELS
    return {'reaction': {'labels': {key: DESCRIPTIONS[key] for key in labels},
                         'prompt': prompt.strip()}}


def preflight(model, row, task):
    text = json.dumps(row['state'], separators=(',', ':'), ensure_ascii=False)
    schema = model._classification_schema(task)
    record = model.processor.transform_record(text, schema, max_len=None)
    if record.text != text + '.' or len(record.input_ids) > 512:
        raise ValueError('unexpected normalization or excessive context: ' + row['id'])
    return {'id': row['id'], 'tokens': len(record.input_ids), 'originalCharsRetained': True}


def capture_probabilities(model):
    original = model._compute_classification_probabilities
    captures = []

    def capture(*args, **kwargs):
        result = original(*args, **kwargs)
        if result is not None:
            name, config, probs = result
            if name != 'reaction' or config.get('multi_label', False):
                raise ValueError('unexpected classification task')
            captures.append(dict(zip(config['labels'], probs.detach().cpu().tolist())))
        return result

    model._compute_classification_probabilities = capture
    return original, captures


def predict(model, row, task):
    import torch
    original, captures = capture_probabilities(model)
    text = json.dumps(row['state'], separators=(',', ':'), ensure_ascii=False)
    started = time.perf_counter()
    try:
        with torch.inference_mode():
            public = model.classify_text(text, task, include_confidence=True, max_len=None)
    finally:
        model._compute_classification_probabilities = original
    elapsed = (time.perf_counter() - started) * 1000
    if len(captures) != 1:
        raise ValueError('expected exactly one genuine probability vector')
    scores = captures[0]
    answer = public['reaction']
    if set(scores) != set(LABELS) or not all(math.isfinite(v) and 0 <= v <= 1 for v in scores.values()):
        raise ValueError('invalid scores')
    if abs(sum(scores.values()) - 1) > 1e-5:
        raise ValueError('not a softmax probability vector')
    if scores[answer['label']] != max(scores.values()) or abs(answer['confidence'] - scores[answer['label']]) > 1e-6:
        raise ValueError('passive capture differs from public decode')
    return {'id': row['id'], 'modelId': MODEL_ID, 'modelRevision': REVISION,
            'label': answer['label'], 'scores': scores, 'raw': public, 'elapsedMs': elapsed,
            'probabilitySource': 'passive capture of unchanged official single-label softmax'}


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--dataset', type=Path, nargs='+', required=True)
    parser.add_argument('--prompt', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--reverse-options', action='store_true')
    return parser.parse_args()


def run_rows(model, rows, task, output):
    attempted = completed = 0
    with (output / 'predictions.jsonl').open('x') as stream:
        for row in rows:
            attempted += 1
            (output / 'progress.json').write_text(json.dumps({'attempted': attempted, 'completed': completed}))
            result = predict(model, row, task)
            stream.write(json.dumps(result, separators=(',', ':')) + '\n')
            stream.flush()
            completed += 1
            print(row['id'], result['label'], round(result['elapsedMs'], 1), flush=True)
    (output / 'progress.json').write_text(json.dumps({'attempted': attempted, 'completed': completed}))


def main():
    args = arguments()
    if args.output_dir.exists():
        raise FileExistsError('refuse existing output directory')
    hashes = verify_model(args.model_dir)
    rows = [json.loads(line) for path in args.dataset for line in path.read_text().splitlines()]
    task = questions(args.prompt.read_text(), args.reverse_options)
    args.output_dir.mkdir(parents=True)
    model, load_ms = load_model(args.model_dir)
    tokens = [preflight(model, row, task) for row in rows]
    manifest = {'modelId': MODEL_ID, 'modelRevision': REVISION, 'modelFiles': hashes,
                'sdk': 'gliner2==2.1.0', 'runtimeSha256': RUNTIME_SHA, 'device': 'cpu',
                'torchThreads': 4, 'seed': 0, 'loadMs': load_ms,
                'parameterCount': sum(p.numel() for p in model.parameters()),
                'datasetHashes': {str(p): digest(p) for p in args.dataset},
                'promptSha256': digest(args.prompt), 'task': task, 'remoteProviderCalls': 0,
                'trainedOrCalibrated': False, 'exploratoryKnownFixtureSet': True,
                'instrumentation': 'passive returned-softmax capture; public argmax/score asserted'}
    (args.output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (args.output_dir / 'token-preflight.json').write_text(json.dumps(tokens, indent=2) + '\n')
    run_rows(model, rows, task, args.output_dir)
    print('COMPLETE', len(rows), flush=True)


if __name__ == '__main__':
    main()
