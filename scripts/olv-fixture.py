#!/usr/bin/env python3
"""Synthetic provider fixture using actual upstream orchestration + Fisch MCP."""
import argparse
import asyncio
import json
import os
import sys
import tempfile
import types
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'integrations' / 'olv'))
from adapter import ConversationHost, Revoked, instruction_context, loopback_url, mcp_value, verify_upstream


def emit(kind, **values):
    print(json.dumps({'kind': kind, **values}), flush=True)


def load_fixture_runtime(checkout):
    verify_upstream(checkout)
    # Test-only stand-in for eager factories. The orchestration modules are unchanged.
    module = types.ModuleType('open_llm_vtuber.service_context')
    module.ServiceContext = object
    sys.modules[module.__name__] = module
    from loguru import logger
    logger.disable('open_llm_vtuber')
    from open_llm_vtuber.conversations import conversation_handler
    return conversation_handler


class FixtureAgent:
    def __init__(self, tool, request_id, instructions, memory):
        self.tool, self.request_id, self.memory = tool, request_id, memory
        self.ready, self.release = asyncio.Event(), asyncio.Event()
        assert 'aer://' in instructions and 'not application' in instructions

    async def chat(self, batch):
        emit('context', synthetic=True, source=batch.texts[0].source.value, prior_items=len(self.memory))
        self.memory.append({'role': 'user', 'content': batch.texts[0].content})
        del self.memory[:-8]
        program = {'type': 'parallel', 'children': [
            {'type': 'style', 'color': '#37B2E9' if self.request_id.endswith('-1') else '#E78A31', 'durationMs': 200},
            {'type': 'flow', 'field': 'orbit', 'strength': 0.2, 'durationMs': 4000},
        ]}
        receipt = await self.tool('express', {'requestId': self.request_id, 'body': program, 'policy': 'replace'})
        value = mcp_value(receipt)
        if value.get('status') not in ('accepted', 'pending'):
            raise RuntimeError('Fixture expression was rejected')
        emit('express', requestId=self.request_id, result=value)
        status = await self.tool('expression_status', {'requestId': self.request_id})
        emit('status', requestId=self.request_id, result=mcp_value(status))
        from open_llm_vtuber.agent.output_types import SentenceOutput, DisplayText, Actions
        yield SentenceOutput(DisplayText('Synthetic text-only response'), '', Actions())
        self.ready.set()
        await self.release.wait()

    def handle_interrupt(self, heard):
        self.memory.append({'role': 'assistant', 'content': heard})
        del self.memory[:-8]
        emit('backend_interrupt', synthetic=True, heard_chars=len(heard))


class Socket:
    async def send_text(self, text):
        # Do not relay upstream microphone/voice controls, raw prompts or transcripts.
        event = json.loads(text)
        metadata = {'audioIsNull': event.get('audio') is None} if event.get('type') == 'audio' else {}
        emit('upstream_event', type=event.get('type'), ignored=True, **metadata)


def context_factory(contexts):
    memory = []
    def create(instructions, tool):
        agent = FixtureAgent(tool, f'olv-fixture-{len(contexts) + 1}', instructions, memory)
        context = types.SimpleNamespace(agent_engine=agent, history_uid=None, asr_engine=None,
            tts_engine=None, live2d_model=None, translate_engine=None,
            character_config=types.SimpleNamespace(human_name='fixture', character_name='fixture', avatar=None))
        contexts.append(context)
        return context
    return create


class HeldSDKClient:
    """Fixture-only scheduling delay before the actual unchanged upstream MCP call."""
    def __init__(self, client):
        self.client, self.entered, self.release = client, asyncio.Event(), asyncio.Event()
        self.rejection = None

    async def call_tool(self, server, name, arguments):
        held = name == 'express' and arguments.get('requestId') == 'olv-held-before-interrupt'
        if held:
            self.entered.set()
            await self.release.wait()
        result = await self.client.call_tool(server, name, arguments)
        if held:
            item = result.get('content_items', [{}])[0]
            if item.get('type') == 'error':
                self.rejection = json.loads(item['text']).get('code')
        return result


async def release_delayed(bridge, task):
    bridge.release.set()
    try:
        await task
    except Revoked:
        pass
    if bridge.rejection != 'expected_epoch_mismatch':
        raise RuntimeError('Delayed SDK write was not fenced by actual MCP')
    emit('delayed_rpc_fenced', code=bridge.rejection, synthetic_schedule=True)


async def wait_ready(context, task):
    waiter = asyncio.create_task(context.agent_engine.ready.wait())
    done, _ = await asyncio.wait({waiter, task}, timeout=10, return_when=asyncio.FIRST_COMPLETED)
    if waiter not in done:
        waiter.cancel()
        if task.done():
            await task
        raise RuntimeError('Fixture expression did not reach status')


async def trial(client, runtime, hold):
    from open_llm_vtuber.chat_group import ChatGroupManager
    tools = await client.list_tools('fisch')
    if not {'express', 'cancel_expression', 'expression_status'}.issubset({t.name for t in tools}):
        raise RuntimeError('Required expression feedback tool unavailable')
    instructions = await instruction_context(client)
    contexts = []
    bridge = HeldSDKClient(client)
    host = ConversationHost(bridge, runtime, ChatGroupManager(), Socket(), context_factory(contexts), instructions)
    try:
        task = await host.start('synthetic first intent')
        await wait_ready(contexts[-1], task)
        await asyncio.sleep(hold)
        emit('before_interrupt_status', result=mcp_value(await client.call_tool('fisch', 'expression_status', {'requestId': contexts[-1].agent_engine.request_id})))
        delayed = asyncio.create_task(host.tool_callback(host.generation)('express', {
            'requestId': 'olv-held-before-interrupt',
            'body': {'type': 'style', 'color': '#AB39D7', 'durationMs': 200},
        }))
        await bridge.entered.wait()
        emit('interrupt', result=mcp_value(await host.interrupt('Synthetic heard prefix')), generation=host.generation)
        await release_delayed(bridge, delayed)
        emit('after_interrupt_status', result=mcp_value(await client.call_tool('fisch', 'expression_status', {'requestId': contexts[-1].agent_engine.request_id})))
        task = await host.start('synthetic fresh intent')
        await wait_ready(contexts[-1], task)
        assert len(contexts[-1].agent_engine.memory) >= 3
        await asyncio.sleep(hold)
        emit('recovery', contexts=len(contexts), generation=host.generation, synthetic_provider=True)
    finally:
        await host.interrupt()


async def baseline_probe(runtime):
    """Expose upstream's unsafe task replacement without MCP or other side effects."""
    from open_llm_vtuber.chat_group import ChatGroupManager
    class WaitingAgent:
        async def chat(self, batch):
            await asyncio.Event().wait()
            if False:
                yield None
        def handle_interrupt(self, heard):
            pass
    context = context_factory([])('aer://instructions not application', None)
    context.agent_engine = WaitingAgent()
    tasks, groups = {}, ChatGroupManager()
    async def start():
        await runtime.handle_conversation_trigger('text-input', {'text': 'synthetic baseline'},
            'baseline', context, Socket(), {}, {}, groups, {}, tasks, None)
        await asyncio.sleep(0)
        return tasks['baseline']
    first = await start()
    second = await start()
    unsafe = first is not second and not first.done() and not second.done()
    emit('baseline_unsafe_overlap', reproduced=unsafe, tool_calls=0, synthetic=True)
    first.cancel(); second.cancel()
    await asyncio.gather(first, second, return_exceptions=True)
    if not unsafe:
        raise RuntimeError('Pinned upstream overlap baseline changed')


async def main(args):
    runtime = load_fixture_runtime(args.upstream)
    await baseline_probe(runtime)
    from open_llm_vtuber.mcpp.server_registry import ServerRegistry
    from open_llm_vtuber.mcpp.mcp_client import MCPClient
    base = loopback_url(args.base)
    token = os.environ.get('AER_PAIRING_TOKEN')
    if not token:
        raise ValueError('AER_PAIRING_TOKEN environment variable required')
    env = {'AER_BASE_URL': base, 'AER_PAIRING_TOKEN': token}
    config = {'mcp_servers': {'fisch': {'command': 'node',
        'args': [str(Path(args.fisch).resolve() / 'integrations/mcp-server.mjs')], 'env': env, 'cwd': args.fisch}}}
    with tempfile.TemporaryDirectory(prefix='fisch-olv-') as temp:
        path = Path(temp) / 'mcp.json'
        path.write_text(json.dumps(config)); path.chmod(0o600)
        async with MCPClient(ServerRegistry(path)) as client:
            await trial(client, runtime, args.hold)
    emit('complete', paid_model_calls=0, synthetic_provider=True, visible='unknown')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream', required=True)
    parser.add_argument('--fisch', default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('--base', required=True)
    parser.add_argument('--hold', type=float, default=1)
    args = parser.parse_args()
    if not 0 <= args.hold <= 30:
        parser.error('--hold must be between 0 and 30 seconds')
    try:
        asyncio.run(main(args))
    except Exception:
        # Upstream/provider exceptions may contain connection args. Never dump secrets.
        emit('failed', reason='fixture_failed_see_contract_no_secret_details')
        raise SystemExit(1)
