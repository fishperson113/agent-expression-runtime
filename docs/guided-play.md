# Optional guided play-session POC

This is local QA tooling for the proposed co-create -> remix -> three-beat improv
-> correction -> interruption/recovery loop. It provides optional ideas when a
tester runs out of things to try. It does not implement body behavior, call a
model, auto-submit prompts, enable camera/voice, or prove the experience is fun.
The agent authors all geometry and semantic expression through existing tools;
the deck contains no keyword-to-effect mapping.

```sh
node scripts/guided-play.mjs --plan
node scripts/guided-play.mjs --interactive --minutes=20
```

Run alongside an explicitly started Fisch session. Choose `n` for an optional
card, copy it into your normal conversation and use your own ideas. Silence
generates no cards. Mark the current card completed, failed, skipped or uncertain;
use `rate 4 3` for enjoyment/control on a 1–5 scale. `finish`, `abort`, Ctrl+C,
EOF or the elapsed deadline save structured results. Unmarked outcomes remain
uncertain. Ten to twenty minutes are supported, with a monotonic elapsed clock.

Progress overwrites `.runtime/guided-play-session.json` every second and after
choices. It stores card IDs, relative times, outcomes and optional ratings;
never raw input, prompts, images, credentials or conversation. History retains
128 cards plus a discard count. Earlier sessions are overwritten, so preserve
results privately before a new run if needed. Generated files remain ignored.

This is a **guided** protocol. Keep its results separate from blind/uncoached
evaluation and label guided=true. A timer reaching 20 minutes is not a retention
pass. Missing ratings remain null, abandoned cards uncertain, early exits aborted.
The CLI checks session timing and data handling; a human still evaluates visible
relevance and recovery in Fisch. No native performance or real-camera claim is
made. Before shipping a product feature, coordinate with the runtime team on
actual creation continuity, cancellation and fresh-request recovery.

Test-first evidence: the initial targeted run failed with the new module absent.
Tests then cover deadline/early exit, deterministic choices, partial/uncertain
outcomes, bounded history, clock/rating validation and redacted reports.
