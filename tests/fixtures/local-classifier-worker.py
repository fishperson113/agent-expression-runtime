"""Protocol fixture only; it runs no classifier model."""
import argparse
import json
import os
import pathlib
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--model-dir')
parser.add_argument('--prompt')
args = parser.parse_args()
mode = pathlib.Path(args.model_dir).name
if mode == 'startup-hang':
    time.sleep(30)
print(json.dumps({'ready': True, 'modelId': 'wrong' if mode == 'bad-ready' else 'fixture/local',
                  'modelRevision': 'revision1', 'loadMs': -1 if mode == 'bad-load' else 7.5}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    state = request['state']
    if state.get('mode') == 'hang':
        time.sleep(30)
    if state.get('mode') == 'oversize':
        print('x' * 70000, end='', flush=True)
        continue
    if state.get('mode') == 'exit':
        sys.exit(2)
    if state.get('mode') == 'error':
        print(json.dumps({'id': request['id'], 'error': 'private traceback must not escape'}), flush=True)
        continue
    if state.get('mode') == 'environment':
        assert not any('KEY' in key or ('TOKEN' in key and key != 'TOKENIZERS_PARALLELISM') or key.startswith('FISCH_') or key == 'PYTHONPATH' for key in os.environ)
    time.sleep(state.get('delay', 0))
    response = {'id': 'late-unknown' if state.get('mode') == 'wrong-id' else request['id'],
                'label': 'observe', 'scores': {'observe': 0.9, 'attend': 0.025,
                                              'acknowledge': 0.025, 'playful': 0.025, 'abstain': 0.025}}
    if state.get('mode') == 'invalid':
        response['scores']['observe'] = 2
    print(json.dumps(response), flush=True)
