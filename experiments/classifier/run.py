"""Run pinned original Laya locally on structured synthetic states, never actions."""
import argparse
import hashlib
import json
import os
import pathlib
import platform
import sys
import time

MODEL_ID = 'convaiinnovations/laya'
REVISION = '55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851'
LABELS = ['observe', 'attend', 'acknowledge', 'playful', 'abstain']
EXPECTED_FILES = {'rl_agent_api.py': 'be3b46819c9999c3ef88e0f2ecf6d3ab1cdfed1d9a8b466fc89811e34d44031b', 'rl_common.py': '8d83611d480c971d640a7b7d3aa2f2219c5e8455e9cc2329fd073681bd8be23e', 'rl_agent_config.json': 'ae287b56bbcf5f8c4f4541ae9dfd00c914c4c48b940b8398c3058af37ba92bbd', 'encoder/config.json': 'bf3ab80598fdccf414855a2ce80f22859e4492d06ca8a62ddd1cfb63972f8979', 'tokenizer/tokenizer.json': '6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30', 'tokenizer/tokenizer_config.json': '50044de60daaa73df97d262e15a40d4faf0160e7d742df64b377877a1320dd12', 'model.safetensors': '891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c'}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=pathlib.Path, required=True)
    parser.add_argument('--dataset', type=pathlib.Path, required=True)
    parser.add_argument('--prompt', type=pathlib.Path, required=True)
    parser.add_argument('--output-dir', type=pathlib.Path, required=True)
    parser.add_argument('--reverse-options', action='store_true')
    return parser.parse_args()


def load_runtime(model_dir):
    os.environ.update({'USE_TF': '0', 'HF_HUB_OFFLINE': '1',
                       'TRANSFORMERS_OFFLINE': '1', 'TOKENIZERS_PARALLELISM': 'false'})
    import numpy as np
    import torch
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    np.random.seed(0)
    sys.path.insert(0, str(model_dir.resolve()))
    from rl_agent_api import RLAgent
    started = time.perf_counter()
    agent = RLAgent(str(model_dir.resolve()), device='cpu')
    return agent, (time.perf_counter() - started) * 1000, torch.__version__, np.__version__


def verify_model(model_dir):
    expected = EXPECTED_FILES
    for name, wanted in expected.items():
        actual = digest(model_dir / name)
        if actual != wanted:
            raise ValueError('Pinned model/source mismatch: ' + name)
    return expected


def preflight(agent, rows, questions):
    from rl_common import build_sequence, render_options, serialize_state
    q = agent._to_internal(questions['reaction'])
    tok, cfg = agent.tok, agent.cfg
    instruction = len(tok('choice question: ' + q['ins'], add_special_tokens=False)['input_ids'])
    options = sum(1 + len(tok(' ' + v, add_special_tokens=False)['input_ids'])
                  for v in render_options(q))
    if instruction + options > cfg['head_max_len']:
        raise ValueError('Question would truncate')
    results = []
    for row in rows:
        state = json.dumps(row['state'], separators=(',', ':'), ensure_ascii=False)
        sequence, markers = build_sequence(tok, state, q, cfg['max_len'], cfg['head_max_len'])
        head = 3 + instruction + options
        state_tokens = len(tok(serialize_state(state), add_special_tokens=False)['input_ids'])
        if state_tokens > cfg['max_len'] - head - 1 or len(markers) != 5:
            raise ValueError('State/options would truncate: ' + row['id'])
        results.append({'id': row['id'], 'stateTokens': state_tokens, 'tokens': len(sequence)})
    return {'instructionTokens': instruction, 'optionTokens': options, 'rows': results}


def predict(agent, row, questions):
    state = json.dumps(row['state'], separators=(',', ':'), ensure_ascii=False)
    start = time.perf_counter()
    raw = agent.system_one(state, questions)
    elapsed = (time.perf_counter() - start) * 1000
    probabilities = raw['answers']['reaction']['probabilities']
    total = sum(probabilities.values())
    return {'id': row['id'], 'modelId': MODEL_ID, 'modelRevision': REVISION,
            'scores': {key: value / total for key, value in probabilities.items()},
            'label': raw['answers']['reaction']['choice'], 'raw': raw, 'elapsedMs': elapsed}


def write_predictions(agent, rows, questions, path):
    with path.open('x') as stream:
        for row in rows:
            result = predict(agent, row, questions)
            stream.write(json.dumps(result, separators=(',', ':')) + '\n')
            stream.flush()
            print(row['id'], result['label'], round(result['elapsedMs'], 1), flush=True)


def main():
    args = arguments()
    if args.output_dir.exists():
        raise FileExistsError('Refuse existing output directory')
    hashes = verify_model(args.model_dir)
    rows = [json.loads(line) for line in args.dataset.read_text().splitlines()]
    labels = list(reversed(LABELS)) if args.reverse_options else LABELS
    question = {'reaction': {'type': 'choice', 'instructions': args.prompt.read_text().strip(),
                             'criteria': {label: None for label in labels}}}
    agent, load_ms, torch_version, numpy_version = load_runtime(args.model_dir)
    tokens = preflight(agent, rows, question)
    args.output_dir.mkdir(parents=True)
    manifest = {'modelId': MODEL_ID, 'modelRevision': REVISION, 'device': 'cpu',
                'torchThreads': 4, 'seed': 0, 'python': platform.python_version(),
                'torch': torch_version, 'numpy': numpy_version, 'loadMs': load_ms,
                'datasetSha256': digest(args.dataset), 'promptSha256': digest(args.prompt),
                'modelFiles': hashes, 'questions': question, 'remoteProviderCalls': 0,
                'trainedOrCalibrated': False, 'scoreNormalization': 'roundoff sum only'}
    (args.output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (args.output_dir / 'token-preflight.json').write_text(json.dumps(tokens, indent=2) + '\n')
    write_predictions(agent, rows, question, args.output_dir / 'predictions.jsonl')


if __name__ == '__main__':
    main()
