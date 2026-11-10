"""Private GLiNER trial worker; local verified model, JSONL only on stdout."""
import argparse
import contextlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('fisch_local_gliner', ROOT / 'gliner.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def emit(value):
    print(json.dumps(value, separators=(',', ':'), allow_nan=False), flush=True)


def check_request(line):
    if len(line.encode('utf-8')) > 16384:
        raise ValueError('request_too_large')
    def invalid_constant(text):
        raise ValueError(text)
    value = json.loads(line, parse_constant=invalid_constant)
    if not isinstance(value, dict) or set(value) != {'id', 'state'}:
        raise ValueError('invalid_request_fields')
    if not isinstance(value['id'], str) or not 1 <= len(value['id']) <= 128:
        raise ValueError('invalid_id')
    if not isinstance(value['state'], dict):
        raise ValueError('invalid_state')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, default=ROOT / 'model')
    parser.add_argument('--prompt', type=Path, default=ROOT / 'prompt-policy.txt')
    args = parser.parse_args()
    with contextlib.redirect_stdout(sys.stderr):
        runner.verify_model(args.model_dir)
        model, load_ms = runner.load_model(args.model_dir)
    task = runner.questions(args.prompt.read_text())
    emit({'ready': True, 'modelId': runner.MODEL_ID,
          'modelRevision': runner.REVISION, 'loadMs': load_ms})
    for line in sys.stdin:
        identity = None
        try:
            request = check_request(line)
            identity = request['id']
            runner.preflight(model, request, task)
            with contextlib.redirect_stdout(sys.stderr):
                result = runner.predict(model, request, task)
            emit(result)
        except Exception as error:
            print(type(error).__name__ + ': ' + str(error), file=sys.stderr, flush=True)
            emit({'id': identity, 'error': 'local_classifier_failed'})


if __name__ == '__main__':
    main()
