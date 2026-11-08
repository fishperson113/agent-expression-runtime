# Terminal thread selection — 2026-11-08

T0/deadline remain 16:41:03/22:41:03 UTC. Model counter remains 2/120; no new
model calls. Review found LiveOutput permanently pinned to its first thread:
ordinary UI new/resume/fork could leave later answers visually idle. Background
thread notifications must not select the visible conversation.

A failing protocol replay established missing explicit UI selection. The relay
now observes only request method/id in memory; a matching successful response
selects its thread and resets old output. Failed/superseded selections and
background thread-start notifications do not switch it. No text is logged.
Tests cover old deltas, failed resume, superseded responses, fork and the actual
relay callback. Real model streaming remains service-blocked.

This Node host-only correction does not change the stable browser/gateway bundle
at 992d48c running its final synthetic soak. Preserve that exact source label;
do not call the fixture run a model or native integration test. Final clean
regression/CI and docs evidence follow. No additional runtime expansion planned.
