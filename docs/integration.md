# External agent integration · protocol v1

This is the primary integration mode introduced by SRS v0.3. The desktop runtime never calls a model. Your agent keeps its conversation, model/provider credentials and content stream. It sends only expressions and lifecycle commands to the local runtime.

## Pair a host

For the supported Codex workflow, run **`fisch run`** from the repository root. It starts and pairs the browser renderer and opens Codex with the MCP adapter configured for that invocation. Follow [the one-command guide](browser-and-hosts.md). The protocol examples below are for developers integrating their own hosts; they are not required launcher steps.

Run the Tauri desktop application. The external-agent panel shows its ephemeral `http://127.0.0.1:<port>` address. Click **Show pairing details** and copy the token into your host's environment as `AER_PAIRING_TOKEN`, with the address in `AER_BASE_URL`. The credential is generated on every app launch, kept in memory, never written into a model prompt, URL, replay or application log. Click again to hide it. **Release controller** closes the active session; restarting the app rotates the token.

The server binds IPv4 loopback only. Requests require `Authorization: Bearer <token>`. Origin headers are denied unless explicitly listed in `AER_ALLOWED_ORIGINS` (comma-separated exact origins). There is no wildcard CORS. CORS preflight is supported only for the configured exact Origin, allowed methods and headers; OPTIONS never carries the bearer token. Host headers must be loopback. Remote exposure is unsupported.

## HTTP without a model SDK

```sh
curl "$AER_BASE_URL/v1/capabilities" -H "Authorization: Bearer $AER_PAIRING_TOKEN"
curl "$AER_BASE_URL/v1/sessions" -H "Authorization: Bearer $AER_PAIRING_TOKEN" -H "Content-Type: application/json" -d '{}'
```

Use the returned session ID and epoch in these examples; keep them in host state:

```sh
curl "$AER_BASE_URL/v1/sessions/SESSION_ID/expressions" \
  -H "Authorization: Bearer $AER_PAIRING_TOKEN" -H "Content-Type: application/json" \
  -d '{"epoch":"RUNTIME_EPOCH","requestId":"host-unique-1","body":{"type":"morph","target":"wall","durationMs":900},"policy":"replace"}'

curl -N "$AER_BASE_URL/v1/sessions/SESSION_ID/events" -H "Authorization: Bearer $AER_PAIRING_TOKEN"
```

The snippets use POSIX shell syntax; PowerShell hosts can use `Invoke-RestMethod` with the same header and JSON body. Never place a real token in committed example files.

`POST /v1/sessions/{id}/cancel` takes `{ "epoch":"CURRENT_EPOCH" }` and returns a new epoch. Update host state. This cancels body expressions and does not cancel the external agent. A single controller is allowed; sessions have a 30-minute inactivity lease and can be released in the UI.

Command fields: `epoch`, `requestId`, `body`, optional `kind` (`program`, `state`, `define`), `track` (`body`, programs only), `policy` (`replace`/`append`, programs only), `ttlMs` (0–5000). Epoch/seq are stamped by the adapter; raw model-generated envelope values are not authoritative. [Published schema](../src/contracts/protocol.schema.json) defines normalized records; macro and resource semantics are checked by the core compiler.

At most four admissions are in flight. The initial admission response has a 500ms wait budget and never waits for program queue space or animation completion. HTTP 202 plus `status:"accepted"` means compiled and admitted. Rejection includes a code and, for compiler diagnostics, the failing AST `path`; an unconfirmed result returns `pending`, never a synthetic rejection. A 2-second watchdog closes sessions with unresolved admission decisions to free their slots; worker recovery begins after 1.5 seconds. See [admission semantics](admission.md). `requestId` dedup retains at most 256 receipts for 60 seconds. Reusing an ID returns its existing receipt; an in-flight duplicate receives the existing pending receipt. Reuse with a different payload is still the same request, not a replacement.

SSE feedback distinguishes `accepted`, `applied`, `completed`, `rejected`, `pending`, `cancelled`, `closed`, `snapshot` and `gap`. Submitted frame feedback is not a physical display timestamp. There are at most four SSE consumers and a 64-event broadcast buffer. Reconnect with `Last-Event-ID` reports a gap and current session snapshot rather than replaying old animation. Delivery is not exactly once.

## TypeScript helper

Import `ExpressionClient` from `src/integrations/client.ts` in a TS-capable host. It manages session/epoch, attaches credentials and sends request IDs:

```ts
const client = new ExpressionClient(baseUrl, pairingToken);
await client.connect();
client.dispatch({ body: { type: 'morph', target: 'wall', durationMs: 900 } }, reportCode);
// The normal content stream proceeds independently. Handle expression failures separately.
```

The helper is repository source, not a published npm package. `events(signal, lastEventId?)` is a fetch-based SSE iterator that keeps the credential out of URLs. `express` waits only for admission. `dispatch` returns immediately and reports errors to the supplied callback.

## MCP stdio adapter

Configure your host to run `node <absolute-repo-path>/integrations/mcp-server.mjs` with `AER_BASE_URL` and `AER_PAIRING_TOKEN` in the host environment. It exposes `express`, `cancel_expression`, `aer://instructions/v1` and `aer://schema/v1`. It requires Node 22+ and no model SDK or MCP dependency. The minimal MCP implementation supports initialize, ping, tools/list, tools/call, resources/list and resources/read with newline-delimited stdio JSON-RPC; it is not a general-purpose MCP framework.

The host must actually load [instructions v1.1.0](../integrations/instructions-v1.md) into agent context. Merely exposing the resource cannot guarantee the client reads it. A standard sequential tool host can pause content generation even with fast ACK; only independent host dispatch meets simultaneous streaming intent. The fake-host integration test checks transport/IR equivalence and admission-only ACK, not a production agent-host compatibility matrix.

Direct OpenAI-compatible API mode is optional and is not implemented. No license has been selected for product code; public source visibility is not yet a completed OSS licensing release.
