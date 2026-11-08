# Herdr: one command

Keep Codex or Claude running in one pane. In the neighboring free pane, run:

```sh
fisch run
```

Fisch displays the body in that pane and discovers the existing agent. Hook setup is explicit: `fisch hooks install codex` or `fisch hooks install claude`, with `fisch hooks uninstall` to remove it. Launch only inspects settings. The path is:

`actual user message hook → immediate local attention → event-bound model reaction → expression engine → pane`

`working/waiting status → local posture and settling`

The main agent calls no Fisch tool and receives no injected attachment prompt. A separate noninteractive process can invent a face, hand, creature or another free-form composition responding to the user's message. There is no browser or new interactive conversation. Native CLI login is reused; an external API is optional.

Codex requires trusting new hooks in its native `/hooks` interface once. Fisch never bypasses this trust requirement. Claude may require reloading changed settings. The header says `review /hooks` or `waiting` until valid interaction events arrive; `fisch status` exposes `interactionHooks.delivery` and `planner.interactionEvents`. Installing settings is not proof of delivery. See [planner scope, setup and usage](expression-planner.md).

Idle lets intensity fade and runs local presence and prepared performances. If the preceding interaction supplied idle scenes, it can change full form and display a short in-pane caption without new model calls. Without scenes it holds the current form. Scenes are memory-only; a fresh launch uses the fallback until an interaction prepares content. Working keeps its form and uses event-driven gestures; status changes do not force cloud/wall/sphere. A local attentive face is only the bootstrap fallback. The event socket reconnects with bounded backoff, and snapshots reconcile working/waiting status without reading terminal text.

Discovery prefers the same tab and working directory within the same workspace. If several agents match equally, choose explicitly with `fisch run --agent <pane-id>`. The renderer pane is excluded.

Optional diagnostic/manual controls:

```sh
fisch status
fisch capabilities
fisch express '{"type":"morph","target":"wall","durationMs":900}'
fisch cancel
fisch stop
```

`express` accepts an AST or an envelope containing `body`, `kind`, `track`, `policy` and `ttlMs`. `cancel` cancels semantic motion, resets posture and clears prepared performances/scenes without selecting another shape. Manual control pauses inference until the next user message; gentle local presence remains independently controlled by `FISCH_MOTION=normal|reduced|off`. `stop`, q or Ctrl+C closes the body and its private socket, leaving the existing agent running. Explicitly installed hooks stay installed until uninstalled; shell guards skip Node outside Herdr and a missing body is a bounded no-op. The standalone managed runner does not depend on the checkout path. If the agent disappears, Fisch exits. Restarting Fisch starts a fresh engine; definitions must be sent again.

Herdr clients with inline RGB support display projected particles. Otherwise Fisch uses lower-detail Braille with per-cell RGB colors, including red/blue particles with little green. Disabled graphics stays disabled: Fisch never edits Herdr configuration or reloads it. The installed preview uses adaptive Braille: density sampling, smoothed exposure/color, fixed Bayer dithering and hysteresis. Set `FISCH_BRAILLE_STYLE=peak` in the launching shell for the earlier area-peak style; this option is not loaded from `.env`. `fisch status` reports rendering and prepared idle-scene state. No browser fallback opens.

See [runtime requirements](browser-and-hosts.md) and `fisch doctor` for attachment/hook diagnostics.
