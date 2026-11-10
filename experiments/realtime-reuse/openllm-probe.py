"""Inspect actual pinned Open-LLM modules; never run a model or the full backend."""
import argparse
import hashlib
import json
from pathlib import Path
import resource
import subprocess
import sys
import time

REVISION = '992309c0aa19845960228f880013d4685fde93b5'
MODULES = ['src/open_llm_vtuber/agent/agents/agent_interface.py',
           'src/open_llm_vtuber/agent/input_types.py',
           'src/open_llm_vtuber/agent/output_types.py',
           'src/open_llm_vtuber/mcpp/json_detector.py']


def pinned_source(source):
    actual = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != REVISION:
        raise ValueError('Expected the documented upstream revision')
    subprocess.run(['git', '-C', str(source), 'diff', '--exit-code', 'HEAD', '--', *MODULES],
                   check=True, capture_output=True)
    return {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in MODULES}


def inspect_modules(source):
    hashes = pinned_source(source)
    sys.path.insert(0, str(source / 'src'))
    started = time.perf_counter()
    from loguru import logger
    from open_llm_vtuber.agent.agents.agent_interface import AgentInterface
    from open_llm_vtuber.agent.input_types import BatchInput
    from open_llm_vtuber.agent.output_types import SentenceOutput
    from open_llm_vtuber.mcpp.json_detector import StreamJSONDetector
    import_ms = (time.perf_counter() - started) * 1000
    assert all([AgentInterface, BatchInput, SentenceOutput])
    warnings = []
    logger.remove()
    sink = logger.add(lambda message: warnings.append(str(message)), level='WARNING')
    detector = StreamJSONDetector()
    assert detector.process_chunk('{"public":') == []
    assert detector.process_chunk('true}') == [{'public': True}]
    detector.reset()
    text = {'text': 'PUBLIC_CANARY } brace in a JSON string'}
    quoted = detector.process_chunk(json.dumps(text))
    detector.reset()
    for _ in range(16):
        detector.process_chunk('x' * 1024)
    retained = len(detector.buffer)
    logger.remove(sink)
    try:
        from open_llm_vtuber.agent.agents.basic_memory_agent import BasicMemoryAgent
        concrete = 'imported only; NOT executed'
    except ImportError as error:
        concrete = 'not run; missing dependency: ' + str(error).split("'")[1]
    return {'revision': REVISION, 'upstreamFiles': hashes, 'upstreamModifiedLines': 0,
            'actualModulesImported': MODULES, 'fragmentedSimpleJSON': True,
            'validQuotedBraceJSONParsed': quoted == [text], 'plainTextBytesRetained': retained,
            'warningContainsPublicInputExcerpt': any('PUBLIC_CANARY' in message for message in warnings),
            'componentVerdict': 'FAIL direct strict tool-parser reuse; not a verdict on the whole project',
            'basicMemoryAgent': concrete, 'fullBackendRuntime': None,
            'importMs': import_ms, 'parentMaxRSSKB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'realModelCalls': 0, 'mediaCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = inspect_modules(args.source.resolve())
    serialized = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.write_text(serialized)
    print(serialized)


if __name__ == '__main__':
    main()
