# Working on Fisch

Read README.md, docs/architecture.md and docs/validation.md before changing behavior.
Keep the core independent of DOM, Workers, Three.js, Tauri and model providers.
Preserve bounded queues, epoch cancellation, strict declarative input, loopback
authentication and privacy defaults. Do not claim native/GPU acceptance from
headless browser results. Product code is MIT licensed; preserve third-party notices.

Use the deterministic my-harness rules described in docs/my-harness.md. Run
`python3 scripts/check-harness.py` before committing and before finishing; fix
blocking rules rather than disabling them. Keep commits focused and reviewable.
Codex Cloud does not invoke local command hooks: the explicit check and CI are
required there. Never imply R10/R11 transcript verification works in Codex.

Validate relevant changes with `npm run check:architecture`, `npm test` and
`npm run build`. For Rust changes also run the locked cargo check/test commands
in README.md when native prerequisites are available. Report blocked checks.
Keep generated smoke evidence out of tracked docs unless deliberately updating
the validation record. Preserve existing provider hooks and status lines.
