# Admission decisions and definitions

Admission feedback distinguishes an outcome from a transport wait budget. The gateway waits up to 500ms for a definitive renderer decision. If the ACK is delayed, HTTP returns 202 with `status: pending` and `code: admission_pending`; this does not claim rejection or acceptance. The bounded in-flight slot remains occupied until a definitive result or session closure. A stalled renderer can therefore fill four slots and cause `gateway_full`; release/reconnect the controller rather than replaying uncertain commands with fresh IDs.

Retrying the same request ID retrieves the stored receipt. SSE supplies the later decision. A pending command must not be assumed safe to replay under a new ID. This intentionally changes the old timeout-as-rejection behavior. Transport timeout is not evidence that no animation ran.

The render host keeps delayed ACKs outstanding instead of synthesizing a timeout rejection. Epoch cancellation remains a separate priority path. Definitions are compiled against a registry snapshot into bounded drafts. They become visible only after the scheduler reports admission; rejection discards the draft, and epoch change discards outstanding drafts while retaining committed session definitions. New sessions reset the registry.

Shape Quality POC node:

```json
{"type":"shapeQuality","rise":0.4,"advance":-0.3,"spread":1.2,"grow":0.8,"path":"arc","effort":{"time":0.7,"weight":0.4},"durationMs":900}
```

`rise` is absolute normalized Y and `advance` absolute normalized Z, each in [-1, 1]. Negative values implement sink/retreat. `spread` is absolute horizontal scale and `grow` absolute whole-body scale, each in [0.25, 2]. Repetition never adds or multiplies the prior target. Replacement captures displayed origins. `spoke` interpolates directly; `arc` adds a bounded lateral excursion and returns it to zero. Parallel arcs share the lateral property and conflict rather than silently combining.

Effort time [0, 1] warps progression from sustained to sudden. Weight [0, 1] adds bounded transient inertia to transforms, clamped to the declared range and ending at target; on morph/flow/style it biases bounded progress. Flow [0, 1] adds free micro-motion during ownership, then blends back to a bound baseline. All motion primitives support these annotations. These are explicit POC transfer functions, not validated Laban perception or fixed emotion mappings.

Window/worker timestamps are normalized with `performance.timeOrigin`, so transport delay does not restart a worker-side TTL or admission deadline. This follows [the cross-context conversion documented by MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance/timeOrigin). OS sleep and worker restart timing remain part of the unverified native compatibility matrix.
