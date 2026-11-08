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
