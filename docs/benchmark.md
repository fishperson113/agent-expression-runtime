# Acceptance benchmark procedure

No target-machine performance acceptance is claimed by this repository.

Record CPU, GPU, RAM, Windows build, WebView2 version, viewport, DPR and power mode before a run. Use native Tauri on the target Windows machine, 1280×720 viewport, DPR capped at 2, 10,000 particles, 40 text deltas/second, 3 expression records/second and programs of at most 16 nodes. Warm up for two minutes.

Measure separate monotonic durations for record received → validated → compiled → admitted → applied → first submitted frame. Across thread boundaries transmit elapsed durations or calibrate clocks; do not subtract unrelated process timestamps. Submitted frames are not physical display timestamps.

1. Measure frame interval and render CPU time separately for at least five minutes. Target frame-time p95 ≤20ms, no expression-induced pause >100ms.
2. Collect record-to-first-frame and local-cancel-to-old-epoch-stop distributions. Target p95 ≤100ms each.
3. Replay one fixed token trace with expression enabled/disabled. Report p95 delta display delay difference; target ≤10ms. Repeat enough runs to show variance.
4. Burst 100 expression records/second for 30 real seconds while typing and cancelling. Verify compiler/render mailboxes ≤4 and program queue ≤8. Account for every rejected record by code.
5. After warm-up, soak for 20 minutes. Sample retained heap with the same tooling and GC conditions, GPU allocations and queue/cache sizes. Target final retained heap growth ≤20% of stabilized baseline; distinguish collection noise from leaks.
6. Exercise every shape pair, resize/DPR changes, minimize/restore, reduced motion, deliberate compiler/render worker crash and WebGL context loss. Confirm text continues and recovery stops at its budget.
7. Once a provider is chosen, measure TTFT, content tokens/second, completion time, expression tokens and cost with/without DSL in a separate real-provider experiment. The scripted demo cannot establish model overhead.

Current automated coverage uses simulated scheduler time for overload and short headless browser smoke tests. The rolling UI number is **frame interval**, not exclusive render cost. It is informative, not an acceptance report.
