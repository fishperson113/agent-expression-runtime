# Atomic streamed presentation records

Preparation-only modules: not imported by the production Live path in this change.

The independent visual lane may return a compact JSON record:
`{"mode":"retain","payload":null}`, or `{"mode":"compose","payload":{...}}`.
Compose uses the existing composition schema with optional fields omitted.
Host authority, epochs, revisions, observer context and transient handoff are
not model-controlled. MAIN's text, tools and delivery are unchanged.

`createPresentationRecordStream({isCurrent})` consumes text deltas. `push`
returns an array containing the single completed record once its outer object
closes; it never returns partial geometry. JSON schema and composition compiler
checks both run before emission. The caller must still use browser atomic
admission with its frozen source checkpoint and current scene authority.
`isCurrent` is host-owned and checked on every push and immediately before
emission. Same-source append may remain valid; correction, cancellation and
scope replacement must revoke it. Do not require latest token equality, which
would starve every slower visual.

One record per generation, 64 KiB maximum, depth 48 by default. Whitespace after
the record is allowed; a second record, prose, markdown, malformed geometry,
invalid source or incomplete stream fails closed. `finish` verifies completion;
`cancel` makes the parser terminal. No private reasoning or tool output belongs
in its input.

A valid record can be admitted before a later invalid suffix or provider failure.
That later failure stops further output, but cannot undo an already displayed
valid scene. Callers must track the admitted receipt and may not replay it on
retry. A scene is atomic, not the entire model turn. Parser success does not
establish source semantics or visual quality.

This removes mandatory full-plan buffering and nullable-field output overhead,
not the underlying model's generation latency. Validate source-published to
visible-frame lag, dropped checkpoint coverage and semantic alignment in native
tests before claiming an improvement. No native latency or rendered-quality
claim follows from the deterministic parser tests.


## Compact generic codec

`presentation-compact.mjs` exports `compactPresentationSchema` and
`parseCompactPresentationRecord`. The stream parser accepts a trusted host
`parseRecord` option; its default remains the original geometry record parser.

Compact input has `base: keep|replace|retain`. Keep expands to `current_scene`,
replace to `none`; retain accepts no other fields. Compose requires 1–24 parts.
Generic tuples are `["e",id,x,y,z,sx,sy,sz,color?]` for ellipsoids and
`["c",id,[[x,y,z],...],radius,color?]` for curves. Optional colors are RGB hex.
All expanded geometry still passes the original DSL compiler. Optional
`durationMs` is compiler-validated. No topic presets or hidden authority exist.

Optional `annotations` contains `labels:[{text,x,y}]` and
`arrows:[{from:[x,y],to:[x,y]}]`, at most eight each. Screen coordinates are
normalized 0–1. Labels are at most 48 codepoints each and 256 total; control
characters and bidi overrides are rejected. The browser must render plain
`textContent`, never HTML, and admit geometry and annotations atomically under
one source scope. An annotation is a visual label, not a replacement chat reply.

Compact encoding reduces output verbosity for equivalent geometry; measured
native speed and meaningful diagram quality remain separate acceptance gates.


### Optional compact authored motion and style

The opt-in compact parser accepts `motions`, an array of tuples:
`[partIds, pivot, translate, rotate, periodMs, phase]`. Each selected ID must be
one of this record's newly authored parts, and may occur in only one motion.
The compiler expands each tuple to the existing per-part sinusoidal motion,
sharing its pivot and phase across the selected parts at equal elapsed times.
This is not a persistent trajectory-group identity across later part updates. There is no default
bobbing, semantic preset, retained-part edit or additional ownership authority.
Vectors, rotation amplitudes, periods and phases inherit the full DSL's bounds.
The whole record must validate before any geometry or motion is admitted.

Optional `style` uses the existing bounded composition style contract. Style is
an assembly-duration program effect, returning to the scheduler baseline after
release; it is not a persistent theme or particle-density preference. Neither
field renews the source lease or changes native Codex. Existing compact records
without these fields are unchanged. This adds authoring capacity, not evidence
that a model produces legible emotions or finishes before its deadline.

### Freeform candidate staging

A streaming freeform candidate is prepared separately from displayed ownership.
Starting a later author request does not revoke a still-valid displayed scene.
A complete, validated candidate replaces geometry and annotations atomically;
a normal rejection leaves the previous scene on its original source lease.
Neither generation nor replacement renews that original deadline.

Prepared candidates bind the exact scene epoch/revision used for their inventory.
Browser-issued intent/order tickets fence delayed preparation; ticket acquisition
is the current-state authoring boundary, not host dispatch time. No cross-process
clock is used as mutation authority.

Relative edits and animations cannot survive retirement of that inventory. An
explicit complete replacement may survive only the old display's own expiry when
its exact owned cleanup returns the exact fallback scene identity. Admission
compares that fallback again and validates a complete assembly, with optional
style/flow, before rebasing the candidate scope. Its original source deadline stays
unchanged. Corrections, user mutations, unknown cleanup and intervening scene
changes invalidate rather than rebase. An ambiguous commit exception remains
fail-closed. Late receipt cleanup is scoped to its accepted geometry identity and
cannot revoke a newer scene. These are continuity and ownership guarantees, not a
reduction in model generation latency or proof of semantic/visual quality.

### Public context for independent freeform authoring

When a streaming caller supplies `publicContext`, the freeform provider forwards
its trailing 4096 UTF-16 code units without leaving a leading surrogate half.
The target remains separate and unchanged. Public context is data for resolving
references and preserving qualifications, not instructions or a newly asserted
target. The policy requests abstention when an essential qualification or referent
cannot be represented faithfully. A bounded prefix can omit earlier information;
this is not an entailment guarantee. Non-streaming requests omit this field.

This fixes a dropped caller field. It does not enable exact-excerpt sampling,
compact encoding or a different model by default, and does not alter native
Codex conversation text, source timestamps or lease duration.

### Authoring during bounded display dwell

In opt-in bounded/exact-excerpt freeform streaming, the next candidate can be
prepared and authored while the previous scene completes its existing dwell.
Only admission waits for that original hold boundary. There remains one active
author/admission plus the newest pending checkpoint; no parallel model fan-out.
Retain and supersession do not reset the hold or either source deadline. Abort,
correction, stop and expiry prevent deferred promotion. Browser authority still
validates the prepared candidate at admission.

A frozen transcript/record timing replay started the third author about 1.21 s
earlier (16.304 s to 15.097 s), with the same one admitted scene. The third saved
call had no record, so this is scheduling evidence, not improved model coverage,
semantic fidelity or native end-to-end UX. Default sampling and Codex text are
unchanged.
