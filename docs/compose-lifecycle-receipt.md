# Bounded lifecycle evidence for short compositions

`compose_expression` retains its admission receipt and may append `lifecycle`.
The lifecycle snapshot uses this MCP process's existing feedback subscription.
It waits at most 800ms for terminal feedback, outside the mutation queue and
outside the desktop intent lease. Only one waiter exists per MCP process;
concurrent compositions receive the currently retained snapshot immediately.

A timeout may return accepted/pending/applied, not invented completion. Loss,
reset, close or missing evidence stays unknown. Visibility is always unknown:
completed is scheduler/configuration evidence, not proof of pixels or taste.
Explicit `expression_status` remains available when the attached evidence is
insufficient. No request is reconnected or replayed by this wait.

This candidate targets an unnecessary model roundtrip after short scenes, not
first-token or first-frame latency. The mutation reaches the renderer before
waiting begins; tests use controlled feedback and are not a measured model win.
Real A/B evidence is required before claiming user-facing latency improvement.
