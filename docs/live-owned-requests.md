# Owned user requests on the current Live transport

This is a transport contract, not a wired chat UI or a model test. It uses the
current `LiveReactiveBroker`; the removed `LiveReactivity` is not restored.

`transport.submitUser(params, guard, onDiscard?)` submits `turn/start`.
`transport.interruptUser(params, guard, onDiscard?)` submits `turn/interrupt`.
Both return a promise for the raw correlated RPC response. The caller validates
the response; an interrupt ACK means neither completion nor rollback.

`guard(message)` must return exactly `true`. Check the selected thread,
selection revision and expected active turn where applicable. The guard runs
before `onRequest` and again immediately before writing, after the existing
broker FIFO/browser intent barrier. Parameters are cloned before queuing. A
Native selection attempt invalidates a captured revision even if it later fails.

Owned responses reach the host's `onEvent` exactly once **before** RPC consumption
and promise resolution. Keep `output.accept` before `broker.event` there. This
lets the current output tracker claim an ACK-only `inProgress` turn safely.
Owned RPC replies do not reach the Native client; ordinary user/assistant/turn
notifications still do. Fixture notification routing is not proof that a real
Native terminal displays an externally submitted turn; that acceptance gate is
separate.
An unsent reservation cannot confer ownership: matching replies are ignored
until its command reaches the write boundary.

| Failure | `error.uncertain` | Caller behavior |
| --- | --- | --- |
| Guard/admission rejection or queued timeout before any write | `false` | Known not sent; re-evaluate readiness |
| Write attempt throws, sent timeout, close after write, observation failure | `true` | Outcome unknown; no automatic resend |

Failures expose fixed local error codes. Late owned replies and late broker
rejections cannot resurrect a settled request or leak a private RPC reply into
the Native client. At most eight RPC requests are pending; the existing broker
queue and collision-escape bounds remain in force.
Native requests using this transport's random private RPC prefix are rejected
before host request tracking or FIFO admission, including IDs for future owned
reservations. Native responses to server requests are unaffected. The low-level
client escape helper remains available; it does not grant use of the reserved
namespace at the public Native ingress.
The ten-second RPC cutoff is local to Node's monotonic clock and is checked at
write/observation boundaries as well as by a timer; browser clock values are not
compared to Node uptime.

When the host registers output/broker pending metadata, supply `onDiscard(id)`
to delete only that owned `output.turnRequests`/`broker.pending` entry. Do not
clear active turns or another Native request. A late queue item still cannot
write after its RPC reservation expires. Keep unknown outcomes sticky in the
conversation controller across failed or same-thread selection; transport does
not provide recovery or automatically replay user input.

User text is opaque data, with no topic-specific behavior. A missing send path
is a structural defect; a sent timeout is unknown. Neither establishes that
Vnstock, another library, or the model caused a failure. Domain attribution needs
correlated Native/tool evidence. No private prompt, token, model or media data is
published by these transport tests.
