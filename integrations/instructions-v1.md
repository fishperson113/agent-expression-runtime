# Agent expression instructions · version 1.1.0

Use `express` to select a short, sparse expression alongside your normal answer. The expression is chosen behavior, not a statement about internal emotions. Your host owns the credential, session, epoch and sequence. Do not request, print or manage those values.

Body shapes: `sphere`, `wall`, `pin`, `screw`, `pyramid`, `wave`, `cloud`. Motion fields: `orbit`, `turbulence`, `pulse`. Coordinates are normalized; strength, brightness and dispersion are 0–1; pointSize is 0–8 CSS pixels. Durations are integer milliseconds, 0–10,000. Easing is `linear` or `smoothstep`.

Nodes:

- `shapeQuality`: absolute `rise`/`advance` targets −1…1, `spread`/`grow` scales 0.25…2, required durationMs. Negative rise/advance mean sink/retreat; scales below 1 mean enclose/shrink. Optional `path` is spoke or arc. `effort: {time,weight,flow}` has 0…1 values: sustained→sudden timing, bounded inertia, bound→free micro-motion. Repetition does not accumulate displacement or scale. These are POC transfer functions, not fixed emotion labels.

- `morph`: `{ "type":"morph", "target":"wall", "durationMs":900 }`
- `flow`: `{ "type":"flow", "field":"orbit", "strength":0.35, "durationMs":1800 }`
- `style`: optional color (`#RRGGBB`), brightness, pointSize, dispersion; required durationMs.
- `sequence` / `parallel`: `children` array. Parallel branches must not write the same property during overlapping time ranges.
- `wait`: durationMs; the renderer keeps moving.
- `call`: name, explicit revision and typed args. Define using `kind:"define"` with body `{name,revision,params,body}`; param references are `{type:"param",name}`. Revisions are immutable, session scoped, at most 32. No recursion.

Example tool arguments:

```json
{"body":{"type":"parallel","children":[{"type":"morph","target":"wall","durationMs":900},{"type":"flow","field":"orbit","strength":0.35,"durationMs":1800}]},"policy":"replace"}
```

Use `replace` for a new intent; it smoothly replaces the active body program. Use `append` only for deliberate ordered choreography; the queue is limited to eight. State (`kind:"state"`) patches baseline brightness, pointSize or dispersion. Programs temporarily own their properties and blend back to baseline afterward.

Keep programs small: input ≤128 nodes, depth ≤16, expanded ≤512, program ≤10 seconds, ≤10 records/second. Do not send per-particle positions, per-frame commands, code, shaders, network operations or filesystem requests.

An accepted ACK means validation and admission succeeded, not that rendering completed. Completion feedback uses a separate channel and must not block your answer. If rejected, continue content; optionally adjust a future expression. Do not synchronously retry in a loop. A normal tool-calling host may serialize tool calls and pause text; only a host with independent dispatch can offer concurrent expression/content delivery. The host must actually include these instructions in agent context; publishing a resource alone does not guarantee discovery.
