# Live observation ingress pacing

The gateway still admits observation packets at least 60 ms apart. A packet that
arrives early now waits outside the gateway mutex instead of being silently
discarded. The connection retains that exact packet and does not read its
successor while waiting: there is no new application queue, merge, retry, or event
replay. Existing authentication, size, session, sequence, timestamp, and schema
validation still run unchanged before admission. The existing single-connection
semaphore remains held throughout pacing and cleanup; overlapping connections
remain rejected with HTTP 409. Latest accepted observations
advance in sequence; old events are not relabeled with a newer snapshot.

Bunched traffic can add up to 60 ms of pacing delay for each packet. Sustained
excess traffic meets socket/TCP backpressure; stale queued measurements fail the
existing timestamp validation and close the connection. This affects the Native
context/diagnostic mirror. The local reflex and browser-to-Node reactive candidate
path do not wait for this mirror. The browser's existing latest-16 pending-event
bound and gateway's 64-event context retention remain separate limitations.

Paused-clock regression tests retain exact metadata for source 528/529/530 at
arrival times 0/40/100 ms and prove admission times 0/60/120 ms. A deterministic
counterexample records how the former discard policy could omit 529 while gateway
IDs stayed contiguous. This proves the mechanism, not the historical cause of the
single gap observed during the earlier 20-minute study; that source coverage
remains incomplete.
