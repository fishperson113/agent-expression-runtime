# Temporal hand event gate (inert foundation)

`HandEventGate` is a pure primary-hand geometry extractor. It is not connected to
camera publication, reactive dispatch, Node provider input, Rust events or recorder
records yet. Hand-only observations can therefore still have no automatic model
turn in the current composition. No gesture class selects an effect.

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
visibility changes revision immediately, before appearance/loss debounce; a future
absence prerequisite must compare it so a returned hand invalidates a lost-hand
reaction before its next appearance event. This module alone grants no authority.

Follow-up work must version and validate the event shape across TS, Rust, Node and
recorder; preserve source sequence separately from Rust cursor; add causal absence
prerequisites to request/lease validation; then connect one global allocator and
bounded reactive keys. Existing face events remain compatible; unknown versions
must reject rather than silently losing track or lineage metadata.
