"""Deterministic adapter tests; fake transport/runtime, no providers or devices."""
import asyncio
import sys
import types
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'integrations' / 'olv'))
from adapter import ConversationHost, Revoked, instruction_context, loopback_url


class Client:
    def __init__(self):
        self.calls, self.started, self.release = [], asyncio.Event(), asyncio.Event()
        self.block = False
        self.fail_cancel = False
        self.cancel_result = None
        self.cancel_hold = None

    async def call_tool(self, server, name, arguments):
        self.calls.append(name)
        if name == 'express' and self.block:
            self.started.set()
            await self.release.wait()
        if name == 'cancel_expression' and self.cancel_hold is not None:
            await self.cancel_hold.wait()
        if name == 'cancel_expression' and self.fail_cancel:
            raise OSError('synthetic unavailable')
        if name == 'cancel_expression' and self.cancel_result is not None:
            return self.cancel_result
        return {'content_items': [{'type': 'text', 'text': '{"id":"session","epoch":"epoch","status":"cancelled"}'}]}


class Runtime:
    def __init__(self, calls):
        self.calls = calls
        self.allow_finish = asyncio.Event()
        self.uncooperative = False

    async def handle_conversation_trigger(self, *args):
        self.calls.append('trigger')
        async def work():
            try:
                await self.allow_finish.wait()
            except asyncio.CancelledError:
                if self.uncooperative:
                    await self.allow_finish.wait()
                else:
                    raise
        args[-2]['fisch'] = asyncio.create_task(work())
        await asyncio.sleep(0)

    async def handle_individual_interrupt(self, uid, tasks, context, heard):
        self.calls.append('backend_interrupt')
        self.heard = heard
        tasks[uid].cancel()


def host():
    client = Client()
    runtime = Runtime(client.calls)
    contexts = []
    def create(instructions, tool):
        context = types.SimpleNamespace(instructions=instructions, tool=tool)
        contexts.append(context)
        return context
    return ConversationHost(client, runtime, None, None, create, 'explicit instructions'), contexts


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_revoked_before_dispatch_never_contacts_transport(self):
        h, _ = host()
        callback = h.tool_callback(0)
        h.generation += 1
        with self.assertRaises(Revoked):
            await callback('express', {})
        self.assertEqual(h.client.calls, [])

    async def test_revocation_during_await_discards_late_receipt(self):
        h, _ = host(); h.client.block = True; h.epoch = 'epoch'
        pending = asyncio.create_task(h.tool_callback(0)('express', {}))
        await h.client.started.wait()
        await h.interrupt()
        h.client.release.set()
        with self.assertRaises(Revoked):
            await pending
        self.assertEqual(h.client.calls, ['express', 'cancel_expression'])

    async def test_new_turn_cancels_before_backend_and_receives_fresh_context(self):
        h, contexts = host()
        first = await h.start('first')
        stale = contexts[0].tool
        second = await h.start('second')
        self.assertTrue(first.cancelled())
        self.assertIsNot(contexts[0], contexts[1])
        self.assertEqual(h.client.calls[:5], ['cancel_expression', 'trigger', 'cancel_expression', 'backend_interrupt', 'trigger'])
        with self.assertRaises(Revoked):
            await stale('express', {})
        await contexts[1].tool('expression_status', {'requestId': 'own'})
        await h.interrupt()
        self.assertTrue(second.cancelled())

    async def test_cancel_uncertainty_blocks_recovery_but_stops_provider(self):
        h, _ = host()
        first = await h.start('first')
        h.client.fail_cancel = True
        with self.assertRaisesRegex(RuntimeError, 'outcome unknown'):
            await h.start('second')
        self.assertTrue(first.cancelled())
        self.assertEqual(h.client.calls.count('trigger'), 1)

    async def test_uncooperative_task_prevents_second_owner(self):
        h, _ = host(); h.runtime.uncooperative = True
        first = await h.start('first')
        with self.assertRaisesRegex(RuntimeError, 'did not terminate'):
            await h.start('second')
        self.assertEqual(h.client.calls.count('trigger'), 1)
        h.runtime.allow_finish.set()
        await first

    async def test_capability_allowlist_and_bounded_text(self):
        h, _ = host()
        with self.assertRaises(ValueError):
            await h.tool_callback(0)('start-mic', {})
        for value in ['', 'x' * 5001, None]:
            with self.assertRaises(ValueError):
                await h.start(value)
        self.assertEqual(h.client.calls, [])

    async def test_malformed_cancel_receipt_blocks_new_context(self):
        for value in [{}, {'content_items': []}, {'content_items': [{'type': 'text', 'text': '{"status":"pending"}'}]}]:
            h, contexts = host(); h.client.cancel_result = value
            with self.assertRaisesRegex(RuntimeError, 'outcome unknown'):
                await h.start('new')
            self.assertEqual(contexts, [])

    async def test_rapid_starts_have_one_owner_and_forward_heard_prefix(self):
        h, contexts = host()
        outcomes = await asyncio.gather(h.start('first'), h.start('second'), return_exceptions=True)
        self.assertEqual(sum(not t.done() for t in h.tasks.values()), 1)
        self.assertEqual(h.context.instructions, 'explicit instructions')
        await h.interrupt('bounded heard prefix')
        self.assertEqual(h.runtime.heard, 'bounded heard prefix')
        self.assertEqual(sum(not t.done() for t in h.tasks.values()), 0)
        self.assertTrue(all(isinstance(x, (asyncio.Task, Revoked)) for x in outcomes))

    async def test_cancel_deadline_stops_provider_and_keeps_one_transport(self):
        h, contexts = host(); h.cancel_timeout = 0.01
        first = await h.start('first')
        h.client.cancel_hold = asyncio.Event()
        with self.assertRaisesRegex(RuntimeError, 'outcome unknown'):
            await h.start('second')
        self.assertTrue(first.cancelled())
        pending = h._cancel_transport
        for _ in range(3):
            with self.assertRaisesRegex(RuntimeError, 'outcome unknown'):
                await h.start('latest')
        self.assertIs(h._cancel_transport, pending)
        self.assertEqual(h.client.calls.count('cancel_expression'), 2)
        self.assertEqual(len(contexts), 1)
        h.client.cancel_hold.set(); await pending
        recovered = await h.start('recovery')
        self.assertEqual(len(contexts), 2)
        await h.interrupt(); self.assertTrue(recovered.cancelled())

    async def test_cancelled_transport_still_interrupts_provider_and_blocks_start(self):
        h, contexts = host()
        first = await h.start('first')
        transport = asyncio.create_task(asyncio.sleep(100))
        transport.cancel()
        await asyncio.gather(transport, return_exceptions=True)
        h._cancel_transport = transport
        with self.assertRaisesRegex(RuntimeError, 'outcome unknown'):
            await h.start('replacement')
        self.assertTrue(first.cancelled())
        self.assertIn('backend_interrupt', h.client.calls)
        self.assertEqual(len(contexts), 1)

    async def test_hundred_queued_starts_only_latest_dispatches_cancel_and_context(self):
        h, contexts = host()
        await h._transition.acquire()
        pending = [asyncio.create_task(h.start(f'intent {i}')) for i in range(100)]
        await asyncio.sleep(0)
        h._transition.release()
        outcomes = await asyncio.gather(*pending, return_exceptions=True)
        self.assertEqual(sum(isinstance(x, Revoked) for x in outcomes), 99)
        self.assertEqual(len(contexts), 1)
        self.assertEqual(h.client.calls, ['cancel_expression', 'trigger'])
        await h.interrupt()

    async def test_instructions_are_explicitly_read_from_listed_resources(self):
        seen = []
        class Session:
            async def list_resources(self):
                return types.SimpleNamespace(resources=[types.SimpleNamespace(uri=x) for x in [
                    'aer://instructions/v1', 'aer://workflow/v1', 'aer://capabilities/v1']])
            async def read_resource(self, uri):
                seen.append(uri)
                return types.SimpleNamespace(contents=[types.SimpleNamespace(text=uri)])
        client = types.SimpleNamespace(active_sessions={'fisch': Session()})
        async def listed(server):
            seen.append('tools/list')
            return [types.SimpleNamespace(name=name, description='actual tool', inputSchema={'type': 'object'})
                    for name in ['express', 'expression_status', 'cancel_expression']]
        client.list_tools = listed
        context = await instruction_context(client)
        self.assertEqual(len(seen), 4)
        self.assertIn('aer://workflow/v1', context)
        self.assertIn('inputSchema', context)
        self.assertIn('expression_status', context)
        self.assertNotIn('cancel_expression', context)

    def test_gateway_rejects_public_and_credential_urls(self):
        for value in ['https://127.0.0.1', 'http://example.com', 'http://u:p@localhost', 'http://localhost/?token=x']:
            with self.assertRaises(ValueError):
                loopback_url(value)
        self.assertEqual(loopback_url('http://127.0.0.1:3456/'), 'http://127.0.0.1:3456')


if __name__ == '__main__':
    unittest.main()
