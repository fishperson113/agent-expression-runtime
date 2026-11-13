---
kind: object
universe: live
status: verified
verified_at: 2026-11-13
source_revision: 8ad92f2 + incremental-part-preservation working tree
---
# Expression - agent input becomes deterministic geometry

## Why this shape
Fisch gives an agent a declarative expressive body, not arbitrary executable code.
Authoring convenience and runtime geometry have separate owners.

## Shape and source
- [compose-expression.mjs](../../../integrations/compose-expression.mjs) owns public
  composition expansion, including shared tracks into per-part trajectories.
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
  reset that group's timing together. Public input remains a full scene snapshot.

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
