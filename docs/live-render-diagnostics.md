# Frame signature checkpoint — 2026-11-08

T0 remains 16:41:03 UTC; deadline remains 22:41:03 UTC. Real model test usage
remains 2/120, with all actual holdout turns blocked by Cloud service policy.

Review found the diagnostic sampler stepped by whole particle triples but read
only X. A unit test using the extracted existing algorithm failed on a Y-only
change. The signature now samples all three axes and style. It still retains no
geometry and is explicitly a proxy, not a visual relevance score or GPU readback.

The first long software-rendered synthetic soak keeps running on its original
static f7d91b7 bundle, with no HMR or new browser tests. It will be recorded as a
baseline rather than final-build acceptance. After it ends, rebuild and run a
fresh >=30-minute soak with this diagnostic correction. Do not restart the
deadline, lower frame/vision targets or spend more model turns around the network
denial. The owner PC remains off; all new evidence is Cloud/synthetic-only.

Follow-up before the new final soak: the reserved `body` channel was also applied
as a local transform to an illustration part named `body`, then globally again.
A pure test measured x=0.5 where one 0.2 translation of x=0.1 must yield 0.3.
The reserved channel now applies globally once; other declared part channels
remain independent. No new DSL or anatomy inference is introduced.

A historical source archive temporarily under ignored .runtime was discovered
by Vitest as a second test tree (466 passes plus two historical skips). Move that
archive to /tmp and rerun the current suite cleanly; do not report the doubled
count as current coverage. The historical visual source remains commit 3f7b911.

The clean final regression after relocation and the body-channel correction
passed 247 tests / 48 files, with no skips. TypeScript/Vite build and architecture
passed. Shared gateway Rust test/check passed (16 unique tests). The first
baseline soak completed 1,800.1 seconds with zero page errors, unexpected frames
or browser off-loopback requests and 10.57 MB GC-normalized private growth.
Rolling sample FPS 33.3–57.6 and frame p95 20.9–53.5 ms miss sustained performance
targets; it remains baseline/software-only, not final-build or native acceptance.
Next: capture camera-off before/after, then a fresh final-build 30-minute soak.
