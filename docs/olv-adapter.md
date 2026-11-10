# Optional Open-LLM-VTuber conversation adapter

Fisch remains an expression capability for external agents. This optional Python
host reuses actual upstream conversation orchestration and MCP client code; it
does not replace Codex, add a voice platform, or use Live2D emotion mappings.

## Source, dependencies and rights

Clone https://github.com/Open-LLM-VTuber/Open-LLM-VTuber and check out exactly
`992309c0aa19845960228f880013d4685fde93b5` (v1 backend). `verify_upstream` rejects a
different or modified checkout and requires `mcp==1.30.0`. The upstream backend is
MIT, Copyright (c) 2025 Yi-Ting Chiu. Preserve its LICENSE when redistributing code.
No upstream source, frontend, character, model, Live2D asset or weights are vendored
here. Those assets have separate rights and are excluded. Upstream describes v1
as bugfix-focused while a v2 rewrite is planned.

Create a Linux x86_64 Python 3.12 virtual environment and install
`integrations/olv/requirements.txt`. This lock includes the freshly validated
transitive versions for that profile, not a universal Python 3.10–3.12 lock. These are minimal **fixture** dependencies,
not an installation of the complete upstream application. The full external
agent host supplies its configured upstream ServiceContext and provider. No paid
provider, credential creation, model download, webcam or microphone is required
by this fixture. Do not install the full voice/model dependency tree for it.
SDK 1.6.0 failed Fisch protocol negotiation; SDK 2.3.0 failed upstream timedelta
timeout handling in the Cloud trial. Pinning working 1.30.0 avoids both failures.

## Run the actual component fixture

Start the normal local Fisch gateway and renderer separately. Set its existing
pairing token through `AER_PAIRING_TOKEN` (never a command-line argument), then run:

```sh
python scripts/olv-fixture.py --upstream /path/to/Open-LLM-VTuber \
  --fisch /path/to/Fisch --base http://127.0.0.1:PORT --hold 2
```

The Fisch checkout needs installed Node dependencies and `expression_status` in
its MCP tools. JSON lines report `express`, `status`, `before_interrupt_status`,
`interrupt`, `delayed_rpc_fenced`, `after_interrupt_status`, `backend_interrupt`, `recovery`, `complete`
or `failed`. The provider is explicitly scripted: two fixture RGB programs use
style 200ms and orbit 4000ms, with interruption during motion. Fixture colors do
not implement production emotion or natural-language mappings. `complete` means
the fixture ran, never proof of visibility; inspect receipts and independent
renderer evidence. A failed admission must not be reported as a successful demo.

The fixture replaces **only** the eager ServiceContext factory/type import with a
test stand-in and injects a scripted agent plus a non-network websocket sink.
Unchanged upstream code runs handle_conversation_trigger,
handle_individual_interrupt, process_single_conversation, conversation utilities,
typed BatchInput and the TTS task manager's no-audio path. It does not run the
full server, BasicMemoryAgent memory, an LLM or audio services. Every upstream
websocket control is ignored, including start-mic; the fixture cannot enable
capture. Upstream module logging is disabled and history_uid is None, avoiding
raw prompt/transcript logs and persistent chat history.

## Host API and lifecycle

`integrations/olv/adapter.py` exports `ConversationHost(client, runtime, groups,
socket, context_factory, instructions)`. Pass the actual upstream MCPClient,
conversation_handler module and ChatGroupManager. The context factory receives
explicit Fisch discovery instructions and a generation-bound `tool(name,args)`
callback. Providers receive that callback, not an unrestricted MCP client. Supply
an upstream-compatible context with your existing task/conversation state; the
camera observer must not invent that context. Production hosts import and
configure the real upstream context normally; factory substitution is test-only.

Conversation memory belongs to the external host, not the generation view. The
fixture shares at most eight synthetic messages across views and passes a bounded
heard prefix into the real upstream interrupt callback; it does not exercise
BasicMemoryAgent memory or claim actual conversational understanding.

Call `instruction_context(client)` explicitly: upstream's MCP wrapper lists/calls
tools but does not itself put Fisch resources into agent context. The adapter
reads listed instructions, capabilities and workflow resources before dispatch,
plus actual express/status input schemas from tools/list. Total injected context
is bounded to 128 KiB; cancel remains host-owned.
Only express and own-submission expression_status are exposed to the provider;
all RGB/motion choices remain within Fisch's existing declarative schema.

`start(text)` increments generation before awaiting anything, obtains a direct
Fisch cancellation/epoch receipt, interrupts/drains the old upstream task, then
creates the fresh context and starts the real upstream handler. `interrupt(heard_response='')` accepts at most 2,000 characters and forwards the
heard prefix to the active upstream agent through the same cancellation path. Cancellation transport has a two-second admission deadline. An unsettled cancel
retains one transport slot; repeated intents cannot spawn more cancellation
requests until it settles. Unknown cancellation or an old task still alive after
one second blocks a new turn. Superseded queued starts are dropped before cancel
dispatch, so a burst cannot cause a cancellation backlog. Generation is checked before and after
every provider tool await; late results are discarded. Each express call also
carries a host-stamped expectedEpoch that the provider cannot override. MCP
rejects an old fence before session creation and again before HTTP dispatch after
feedback subscription; it strips the fence from the Rust payload. This prevents a
SDK write delayed until after cancellation from rebinding to the new epoch. Existing Fisch epoch
checks remain the downstream protection against an already-dispatched tool.
No automatic retries or replay occur. A cancellation ACK is gateway epoch
invalidation, not evidence of renderer visibility or provider billing cessation.

Raw upstream individual triggers replace the task pointer without cancelling the
old task, and the interrupt handler cancels without awaiting drain. The adapter
must therefore remain in the path. The synthetic baseline probe reproduced that
overlap. The CLI emits baseline_unsafe_overlap using unchanged upstream handlers
and a waiting agent without tool calls, then cancels both baseline tasks before
the real MCP phase. Adapter tests check cancel ordering, late receipts, blocked recovery and
an uncooperative provider. A production UI sink also needs its own generation
guard; this fixture discards all upstream UI controls and never forwards stale UI.

## Evidence boundaries

Run `python3 -m unittest discover -s tests -p olv_adapter_test.py` or the Vitest
wrapper. Deterministic unit tests use fake runtime/transport. Actual component
and renderer evidence is required in the gateway CI job (pinned upstream and
fixture dependencies), including an intentionally delayed real SDK write rejected
with expected_epoch_mismatch. The manual CLI remains optional; camera/live human quality
is not implied. Provider cost in the scripted trial is zero.

A separate AIRI trial pinned `822243de` (MIT) exercised six assertions with no new
dependencies. Its context registry is useful, while append-self remained
unbounded and cancellation cooperative. Its complete private core-agent package
and realtime transport were not exercised. The OLV trial was selected for its
actual MCP/conversation integration path. These different scopes do not support
speed or memory comparisons between products.
