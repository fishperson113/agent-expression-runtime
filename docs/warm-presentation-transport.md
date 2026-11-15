## Opt-in warm visual-author transport prototype

`NativePresentationProvider({ ..., warmTransport: true })` reuses only its private
app-server process, never the primary conversation process or a previous visual
thread. Default is `false`; production launchers do not enable this experiment.
Every job starts a fresh ephemeral thread, checks config isolation and the tool
catalog, and receives only its own thread's notifications. Models, effort,
conversation instructions and visual policy are unchanged.

The provider permits one job at a time. Any abort, timeout, validation failure or
transport failure destroys the process without replay. Successful jobs retain it
for up to 30 seconds idle or 16 jobs, then retire it. `close()` retires an idle or
active process. Retirement waits for process settlement before replacement.
Optional `warmTransport: {idleMs, maxJobs}` configures positive integer bounds.

Mock tests establish lifecycle behavior, not runtime latency or successful model
inference. Build and architecture checks do not establish semantic fidelity.
Before enabling by default, benchmark alternating cold/warm runs using the same
model, effort and source excerpts, recording setup, first delta and complete
record times separately. This may reduce process/initialization overhead; it
does not promise to remove the model's first-token latency. Preserve a cold path
for comparison and investigate resource usage across bounded reused jobs.
