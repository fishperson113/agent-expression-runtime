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
