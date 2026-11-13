---
kind: object
universe: live
status: verified
verified_at: 2026-11-13
source_revision: 67d77ef + static-rotation-authoring working tree
---
# Expression - agent input becomes deterministic geometry

## Why this shape
Fisch gives an agent a declarative expressive body, not arbitrary executable code.
Authoring convenience and runtime geometry have separate owners.

## Shape and source
- [compose-expression.mjs](../../../integrations/compose-expression.mjs) owns public
  composition expansion, including shared tracks into per-part trajectories.
  Static ellipsoid rotation accepts radians within +/-4pi at this boundary and
  canonicalizes out-of-runtime-range values modulo2pi. Motion, trajectory and
  raw AST limits are unchanged; no degree conversion is inferred. See
  [static rotation tests](../../../tests/static-rotation-authoring.test.mjs).
  Its tool description and [Live instructions](../../../integrations/live-instructions.md)
  distinguish additive props from intentional whole-body transformation; default
  `base:none` still means replacement; MAIN `base:current_scene` emits an atomic
  host-resolved addition intent, not a model-reconstructed full snapshot. See
  [contextual review](../../contextual-expression-review.md) for model-behavior gates.
- [assembly.schema.json](../../../src/contracts/assembly.schema.json) and
  [geometry types](../../../src/core/geometry/types.ts) describe the runtime data.
- [trajectory.ts](../../../src/core/geometry/trajectory.ts) evaluates trajectory
  transforms; [validation](../../../src/core/geometry/validate.ts) checks input.
- [LiveCompiler](../../../src/core/live/compiler.ts) wraps the shared
  [compiler](../../../src/core/compiler/compiler.ts), outside model inference.

- [ParticleFormation](../../../src/core/geometry/morph.ts) preserves unchanged
  same-ID samples and motion during incremental scene edits through
  [incrementalAssignment](../../../src/core/geometry/incremental.ts). Fixed particle
  budgets can redistribute density; additions do not increase particle count.
  Identical whole-scene reissues replay motion; edits to a shared trajectory group
  reset that group's timing together. Raw assemble remains a full scene snapshot; the MAIN sceneAppend envelope
  requests host-side expansion before compilation.

## Connected to
Owned by the authoring/contract/core boundary. Delivered through [Live body](live-body.md).
A shared track reference is input compression, not another scheduler or model.

## If you change this
Hits: authoring validation, schema limits, compiler/geometry tests and body rendering.
Does not hit: Codex thread startup or chat storage unless their interface changes.

## Surfaces
MCP/HTTP authoring writes; compiler and renderer consume validated geometry.

## See
[Composition guide](../../composable-expression.md);
[composition E2E](../../../tests/expression-composition-e2e.test.mjs),
[trajectory framing test](../../../tests/trajectory-framing.test.ts),
[incremental geometry test](../../../tests/incremental-geometry.test.ts).
