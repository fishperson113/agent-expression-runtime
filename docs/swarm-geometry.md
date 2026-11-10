# Reconfigurable particle body

Fisch accepts model-authored geometry through `assemble`, alongside the seven legacy morph targets. Hands, faces, creatures and objects are compositions of geometric parts, not new hard-coded shape names. The same node runs through the compiler, macros, scheduler, worker WebGL renderer and retained terminal reference renderer. The supported interactive launcher is [Fisch Live](fisch-live.md).

```json
{"type":"assemble","durationMs":1200,"parts":[
  {"id":"leftEye","kind":"ellipsoid","center":[-0.35,0.4,0],"scale":[0.08,0.12,0.06]},
  {"id":"rightEye","kind":"ellipsoid","center":[0.35,0.4,0],"scale":[0.08,0.12,0.06]},
  {"id":"mouth","kind":"curve","points":[[-0.6,0,0],[0,-0.45,0],[0.6,0,0]],"radius":0.025}
]}
```

In Live, ask Codex to create geometry through the MCP `express` tool; custom HTTP/MCP hosts use the existing program envelope. The terminal-only `fisch express` CLI and `fisch run` launcher are removed. `fisch capabilities` still prints the base expression contract and wire schema. `assemble` and `morph` both own shape, so they conflict if simultaneous; they can run alongside flow, style and posture. Sequence assemblies to animate poses. Live expressions are agent-authored tool calls; the retired panel planner is not started.

## Building blocks

Coordinates use x right, y up, z depth. Frontal silhouettes close to the XY plane are easiest to read in a pane.

| Kind | Data | Result |
|---|---|---|
| `curve` | 2–12 points, radius 0–0.25 | Catmull–Rom stroke/tube, approximately uniform arc-length samples |
| `ellipsoid` | center, scale, optional Euler rotation | Ellipsoidal shell |
| `patch` | Four perimeter-ordered corners | Bilinear quadrilateral surface |

Each part has a unique ASCII `id` and optional particle `weight` (0.1–10, default 1). Weights allocate existing particles; adding parts does not add particles. Limits: 24 parts per assembly, eight assemblies per expanded program, 32 KiB per record and ten seconds per program. Coordinates are bounded to ±2, ellipsoid scales to 0.02–1.5 and rotations to ±π. The manifest declares geometry budgets. Invalid structures, coordinates and unsupported fields are rejected with AST paths.

## Motion and identity

Optional per-part motion independently applies periodic translation and Euler rotation around a world-space pivot:

```json
{"pivot":[0,-0.7,0],"translate":[0,0.03,0],"rotate":[0,0,0.06],"periodMs":4000,"phase":0}
```

Translation amplitudes are bounded to ±0.4, rotation amplitudes to ±0.6 radians, and periods to 1–10 seconds. Part motion continues after the assemble transition completes. Cancellation freezes it at the current pose. Ordinary status changes do not select fixed shape presets. The retained historical panel planner can prepare idle scenes that replace geometry during idle/done and restore the interaction program afterward; this director does not run in Live.

Keep IDs, kinds, weights and curve point counts stable between consecutive poses. Declaration order is irrelevant. The engine reuses the particle-to-part mapping for that topology. Different topologies receive a deterministic spatial Morton-order assignment. Each particle retains its identity, and interrupted transitions start at its current geometry position. Primitive/assembly transitions share this path after the first assembly.

Both native and WebGL rendering now use target-aware boids after geometry sampling. Attraction to assigned targets dominates; mild separation, alignment and target-relative cohesion add flock motion without pulling a hand or face into a generic flock. Neighbours belong to the same part. A spatial grid limits each particle to 32 candidate checks and eight neighbours; timestep subdivision, damping and a speed cap bound long-frame behaviour. Reduced motion bypasses steering. The retired panel exposed particle count, neighbour checks and mean target error under `swarm`. Current `fisch status` is limited to the explicit Live Herdr adapter and does not report those metrics.

Framing reserves growth headroom: a neutral body has half the maximum framing budget, and `grow: 2` may use the full safe 0.88 projection margin. `grow: 1.3` therefore remains visibly larger on landscape and portrait viewports instead of immediately being cancelled by auto-fit. The tradeoff is a smaller neutral silhouette. Extreme posture/spread combinations still fit within the safe frame.

Spatial assignment is approximate, not globally optimal transport; paths can cross. Separation is visual steering, not guaranteed collision avoidance. There is no contact physics, joint solver, arbitrary mesh loader, shader injection or generated executable code. Connected parts need consistent coordinates and pivots from the model. This is a kinematic composition system inspired by a microbot swarm, not a physical simulation.

## Historical planner and geometry verification

The retained panel planner reference receives a strict assembly schema and the actual triggering interaction event. It can invent coherent geometry rather than merely select named shapes, but relevance to the user and continuity take priority over novelty. It mixes assemblies with flow/posture nodes, preserves IDs between poses and can use independent part motion. Native inference has a 45-second deadline. Rendering and immediate local attention continue while inference runs. Idle never requests model inference. Local presence and model-authored part performances continue; prepared idle scenes may change the full form and later restore the interaction geometry. Without prepared scenes the current form remains. There is no automatic 30-second hard freeze. This is historical panel behavior, not Live launch behavior. See [the planner reference](expression-planner.md) and [current Live controls](fisch-live.md).

`integrations/sculpture-examples.mjs` contains a seven-part peace-sign hand and a six-part bird with articulated wings as fixtures; neither is registered as a built-in shape. Actual WebGL screenshots are in `docs/evidence/composition-peace.png` and `composition-bird.png`. The independent Codex-generated example is `docs/evidence/generated-sculpture.json` and `composition-generated.png`.

Braille still has lower detail than inline pixels or WebGL. Screenshot inspection demonstrates rendered geometry, not human recognition/emotion accuracy. Tests cover validation, macro lowering/conflicts, interrupted continuity, part motion, cancellation, schema agreement and legacy regressions. Local timing observations are not a performance certification.
