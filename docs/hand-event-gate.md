# Temporal primary-hand events

`HandEventGate` is a pure primary-hand geometry extractor. The Live composition
connects it to new perception samples, one face/hand source sequence, the bounded
reactive scheduler and existing versioned wire/recorder contracts. Hand-only input
can trigger an optional observer decision without a face event. No gesture class
selects an effect; model output still passes causal validation and the DSL boundary.

The gate uses stable primary track IDs, injected monotonic milliseconds for
velocity/debounce, and observation wall timestamps for event metadata. Appearance
needs three samples and 150 ms; loss needs 300 ms. A primary-role switch resets
motion safely; it never reports a former primary that is still visible as lost. Motion starts with >=0.04 normalized-image
displacement over >=150 ms and >=0.12 normalized-image units/s; stopping needs <=0.008 and
<=0.04 normalized-image units/s for another 300 ms. These are dev thresholds requiring calibration,
not measured perception accuracy. Handedness confidence is never a detection gate.
History is bounded to 16 samples/250 ms and decimated to at most 50 Hz; these
coordinate units are not physical distance. Source changes, invalid/unavailable input,
clock rewind or >300 ms sampling gaps reset state without fabricating hand loss.

Outputs carry `eventVersion:1`, track ID, current/evidence-start observation
sequence, wall time, source generation and semantic state revision. They deliberately
have no event ID: the composition must allocate face/hand event IDs from one source
sequence when wired. Same continuing-motion frames do not change revision. Primary
visibility changes revision immediately, before appearance/loss debounce; the live
absence prerequisite compares it so a returned hand invalidates a lost-hand
reaction before its next appearance event. The extractor alone grants no authority.

The helper advertises hand-event contract version 1 via `configureReactive`.
Unknown/omitted versions keep the hand producer off while legacy face windows
remain compatible. Hand production also requires provider availability and the
existing reaction opt-in; polling the same version does not reset evidence.
Only perception samples advance the gate. Turn-only updates allocate source IDs
without becoming fake hand evidence. Source resets revoke obsolete hand candidates.

Requests containing hand events capture `handReadSet`; authorization, admission
and execution compare its revision, source generation and primary role. A lost-hand
candidate is eligible only while the primary is null. Handover to another hand
supersedes the global hand-presence candidate, preserving the old event in the
trace without bundling a false absence prerequisite. Continuing same-track motion
frames remain compatible. Semantic boundaries still revoke conservatively; the
five-second deadline, cooldown and rolling quota are unchanged. This is a primary
role read-set, not general per-field semantic inference or identity recognition.

Cloud fixtures expose `hand-only` (valid hand tracking without a face) and
`hand-lost` (valid tracking result with no hand), separately from unavailable
camera/error fixtures. These are synthetic no-inference inputs, not physical
camera or gesture-quality evidence.
