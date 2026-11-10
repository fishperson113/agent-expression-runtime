"""Optional backend-only Open-LLM-VTuber host; Fisch remains an expression capability."""
import asyncio
import importlib.metadata
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

UPSTREAM_SHA = '992309c0aa19845960228f880013d4685fde93b5'
SDK_VERSION = '1.30.0'


class Revoked(RuntimeError):
    """A superseded provider result must not regain expression ownership."""


def verify_upstream(checkout):
    root = Path(checkout).resolve()
    sha = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    if sha != UPSTREAM_SHA:
        raise ValueError('Unexpected Open-LLM-VTuber revision')
    if subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Open-LLM-VTuber checkout must be unmodified')
    if importlib.metadata.version('mcp') != SDK_VERSION:
        raise ValueError('Use the validated MCP SDK pin')
    sys.path[:0] = [str(root / 'src'), str(root)]
    return root


def loopback_url(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', '::1', 'localhost'):
        raise ValueError('Only local HTTP gateway URLs are allowed')
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Gateway URL must contain only the loopback origin')
    return value.rstrip('/')


def mcp_value(result):
    items = result.get('content_items', [])
    if len(items) != 1 or items[0].get('type') != 'text':
        raise ValueError('MCP result unavailable')
    value = json.loads(items[0]['text'])
    if not isinstance(value, dict):
        raise ValueError('Expected structured MCP result')
    return value


async def instruction_context(client):
    tools = await client.list_tools('fisch')
    allowed = [dict(name=t.name, description=t.description, inputSchema=t.inputSchema)
               for t in tools if t.name in ('express', 'expression_status')]
    if {t['name'] for t in allowed} != {'express', 'expression_status'}:
        raise ValueError('Required provider tool schemas unavailable')
    session = client.active_sessions['fisch']
    listed = await session.list_resources()
    wanted = {'aer://instructions/v1', 'aer://workflow/v1', 'aer://capabilities/v1'}
    found = {str(r.uri) for r in listed.resources}
    if not wanted.issubset(found):
        raise ValueError('Fisch discovery contract is unavailable')
    parts = [json.dumps({'providerTools': allowed}, allow_nan=False)]
    for uri in sorted(wanted):
        resource = await session.read_resource(uri)
        parts.extend(c.text for c in resource.contents)
        if sum(len(part.encode('utf8')) for part in parts) > 131072:
            raise ValueError('Discovery context exceeds byte bound')
    return '\n'.join(parts)


class ConversationHost:
    """Wrap unchanged upstream handlers with bounded single-owner lifecycle control.

    Provider contexts receive a generation-bound tool callback and explicit Fisch
    instructions. No input/voice service, prompt-to-effect mapping or emotion table.
    """
    def __init__(self, client, runtime, groups, socket, context_factory, instructions, cancel_timeout=2.0):
        self.client, self.runtime, self.groups, self.socket = client, runtime, groups, socket
        self.context_factory, self.instructions = context_factory, instructions
        self.generation, self.tasks, self.context = 0, {}, None
        self.epoch = None
        self._transition = asyncio.Lock()
        self._cancel_transport = None
        if not 0 < cancel_timeout <= 30:
            raise ValueError('Expected bounded cancellation deadline')
        self.cancel_timeout = cancel_timeout

    def tool_callback(self, generation):
        epoch = self.epoch
        async def call(name, arguments):
            if name not in ('express', 'expression_status'):
                raise ValueError('Provider capability not allowed')
            if generation != self.generation:
                raise Revoked('stale_before_tool')
            if name == 'express':
                if epoch is None:
                    raise Revoked('no_epoch_lease')
                arguments = {**arguments, 'expectedEpoch': epoch}
            result = await self.client.call_tool('fisch', name, arguments)
            if generation != self.generation:
                raise Revoked('stale_after_tool')
            return result
        return call

    async def _cancel_receipt(self):
        if self._cancel_transport is None:
            self._cancel_transport = asyncio.create_task(
                self.client.call_tool('fisch', 'cancel_expression', {}))
        task = self._cancel_transport
        done, _ = await asyncio.wait({task}, timeout=self.cancel_timeout)
        if not done:
            return {'content_items': [{'type': 'error'}]}
        self._cancel_transport = None
        if task.cancelled():
            return {'content_items': [{'type': 'error'}]}
        try:
            return task.result()
        except Exception:
            return {'content_items': [{'type': 'error'}]}

    async def _cancel_previous(self, heard_response=''):
        receipt = await self._cancel_receipt()
        task = self.tasks.get('fisch')
        if self.context is not None and task and not task.done():
            await self.runtime.handle_individual_interrupt('fisch', self.tasks, self.context, heard_response)
        if task and not task.done():
            _, pending = await asyncio.wait({task}, timeout=1)
            if pending:
                raise RuntimeError('Provider did not terminate; new turn blocked')
        try:
            value = mcp_value(receipt)
            if value.get('status') != 'cancelled' or not all(
                isinstance(value.get(key), str) and value[key] for key in ('epoch', 'id')
            ):
                raise ValueError('Unconfirmed cancellation')
        except (ValueError, KeyError, TypeError):
            raise RuntimeError('Cancellation outcome unknown; new turn blocked') from None
        self.epoch = value['epoch']
        return receipt

    async def interrupt(self, heard_response=''):
        if not isinstance(heard_response, str) or len(heard_response) > 2000:
            raise ValueError('Expected bounded heard response')
        self.generation += 1
        async with self._transition:
            return await self._cancel_previous(heard_response)

    async def start(self, text):
        if not isinstance(text, str) or not text.strip() or len(text) > 5000:
            raise ValueError('Expected bounded text input')
        self.generation += 1
        generation = self.generation
        async with self._transition:
            if generation != self.generation:
                raise Revoked('superseded_before_cancel')
            await self._cancel_previous()
            if generation != self.generation:
                raise Revoked('superseded_before_start')
            self.context = self.context_factory(self.instructions, self.tool_callback(generation))
            await self.runtime.handle_conversation_trigger(
                'text-input', {'text': text}, 'fisch', self.context, self.socket,
                {}, {}, self.groups, {}, self.tasks, None,
            )
            return self.tasks['fisch']
