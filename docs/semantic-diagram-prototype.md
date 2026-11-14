# Source-bound semantic diagrams: isolated design probe

This module is not imported by Live, the provider, the native relay or MAIN.
It does not change model settings, inject instructions, or gate text delivery.
This preparation slice has deterministic protocol/compiler tests only; it does not
enable the separate experimental renderer or certify its model/browser results.

## Why change the representation

The mini record mixes auto-framed ellipsoid/curve geometry with screen-space
labels. Shapes have no semantic role IDs or label attachments. Two labels of
24 characters encourage abbreviating propositions and losing modality. Shorter
JSON alone cannot establish visual meaning or fidelity.

`integrations/semantic-diagram.mjs` accepts host-owned public source identity,
revision and a bounded complete proposition, plus author-selected term/predicate
spans and generic nodes/edges. It preserves the whole proposition as an inline
caption, including conditions and counterexamples. Four explicit slots keep
node positions stable; edge endpoints and role labels use one deterministic
projection. The generic representation has no topic-specific templates.

This is a diagram layout IR, NOT an implemented particle renderer extension.
Production integration needs either a shared orthographic transform for particle
geometry and DOM labels, or one atomic diagram surface. Do not feed its normalized
coordinates into the existing auto-framed geometry and claim attachment works.

## Fidelity limits

Exact source spans establish provenance, not entailment. An author can still
select `can` out of a negated sentence, omit a condition from a predicate, or draw
an unsupported causal arrow. The explicit negative test preserves that limitation.
The complete host-issued proposition must remain legible in the same visual,
not hidden in a tooltip. No generated paraphrase or numeric confidence field is
accepted. `exact-source-not-entailment-verified` is an evidence status, not model
confidence. A paragraph boundary is only a syntactic boundary, not proof that a
proposition is complete. If the necessary context exceeds the budget, retain
instead of truncating it. Existing source lease/freshness gates remain mandatory.

The initial renderer should use an undirected relationship unless direction is
explicitly supported; directional output still needs semantic QA. There is no
claim that this prototype automatically proves source support.

## Next bounded integration

1. Build one deterministic renderer with measured label fitting and shared node
   anchors. Reject whole scenes on overlap; never silently hide qualifications.
2. Evaluate source fixtures containing possibility, negation, conditional claims,
   contrasting examples, noncausal association and Unicode. Review diagrams
   without the full chat, then compare their claimed meaning with the source.
3. Compile generic frame/edge paths through existing bounded geometry compiler
   where feasible. Keep artistic scene DSL available independently; a diagram
   is an optional explanatory form, not a replacement for Fisch.
4. Wire one visual-only provider experiment after fixture QA. Host supplies source
   IDs/spans and bounded public units; MAIN receives no additional instructions.

## Timing and admission

Measure source-unit publication, dispatch, first visual token, complete record,
validation, browser admission, first settled frame and source revocation.
Report useful settled dwell, dropped stale records and semantic correctness,
not just scene count. Compare the SAME proposition/scene complexity and model
settings against the mini baseline. Compiler speed is not total model speed.
The previous 5-6 second visual calls cannot fit reliably into a roughly 6-second
section, irrespective of a faster renderer. More semantic structure may reduce
geometry tokens but introduces evidence fields; speed improvement is unproven.
Never delay MAIN text to make the visuals look synchronized. Keep this path
experimental/off by default until real streaming and independent QA pass.

## Isolated geometry adapter spike

`compileDiagramGeometry(plan)` in semantic-diagram-geometry.mjs now expands each
node rectangle into four independent two-point curves (no curved closed-path
corners), each undirected edge into one curve, and each directed edge into three.
Four nodes plus two directed edges compile to 22 parts through the actual
`composeExpression` validator. It returns `{payload, compiled, nodeParts,
edgeParts}`; mappings associate semantic IDs with all generated particle part IDs.
The replacement base is `none`: the 22-part count does NOT include a retained
Fisch avatar. Appending Fisch would require a separate total-budget design.

The plane mapping is `world=[2*x-1,1-2*y,0]`. This is NOT evidence that current
camera/autoframing matches overlay coordinates. Consumers must project actual
final part geometry to anchor labels, or use a shared orthographic transform.
Long predicate fitting/overlap, browser rendering, model generation and streaming
admission are not implemented or validated by this spike. Source/caption remain
separate required evidence. These shape/compiler tests do not prove semantics.
