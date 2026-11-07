# Herdr: one command

Keep Codex or Claude running in one pane. In the neighboring free pane, run:

```sh
fisch run
```

Fisch displays the body in that pane, discovers the existing agent and installs prompt/lifecycle hooks without replacing other configured integrations. The path is:

`actual user message hook → immediate local attention → event-bound model reaction → expression engine → pane`

`working/waiting status → local posture and settling`

The main agent calls no Fisch tool and receives no injected attachment prompt. A separate noninteractive process can invent a face, hand, creature or another free-form composition responding to the user's message. There is no browser or new interactive conversation. Native CLI login is reused; an external API is optional.

Codex requires trusting new hooks in its native `/hooks` interface once. Fisch never bypasses this trust requirement. Claude may require reloading changed settings. The header says `review /hooks` or `waiting` until valid interaction events arrive; `fisch status` exposes `interactionHooks.delivery` and `planner.interactionEvents`. Installing settings is not proof of delivery. See [planner scope, setup and usage](expression-planner.md).

Idle holds the last form, lets intensity fade and adds quiet local breathing. It never requests a new model plan or rotates cached symbols. Working keeps its form and uses event-driven gestures; status changes do not force cloud/wall/sphere. A local attentive face is only the bootstrap fallback. The event socket reconnects with bounded backoff, and snapshots reconcile working/waiting status without reading terminal text.

Discovery prefers the same tab and working directory within the same workspace. If several agents match equally, choose explicitly with `fisch run --agent <pane-id>`. The renderer pane is excluded.

Optional diagnostic/manual controls:

```sh
fisch status
fisch capabilities
fisch express '{"type":"morph","target":"wall","durationMs":900}'
fisch cancel
fisch stop
```

`express` accepts an AST or an envelope containing `body`, `kind`, `track`, `policy` and `ttlMs`. `cancel` cancels motion and resets posture without selecting another shape. Manual control pauses automatic reactions until the next user message. `stop`, q or Ctrl+C closes the body and its private socket, leaving the existing agent running. Hook configuration remains installed but bounded delivery is a no-op without a body. If the agent disappears, Fisch exits. Restarting Fisch starts a fresh engine; definitions must be sent again.

Herdr clients with inline RGB support display projected particles. Otherwise Fisch uses colored Braille with lower detail, using the same geometry and scheduler. The installed preview reports unavailable cell dimensions and uses Braille. No browser fallback opens.

See [runtime requirements](browser-and-hosts.md) and `fisch doctor` for attachment/hook diagnostics.
