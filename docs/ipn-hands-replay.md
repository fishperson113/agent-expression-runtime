# Offline IPN HandS replay validation

This branch adds an independent, deterministic **landmark/annotation replay** tool.
It never enables a camera, calls a model, sends observations to the running agent,
or downloads data automatically. The checked-in fixture is invented data dedicated
to the public domain under CC0 1.0; its gesture labels and empty hands intentionally
make no claim about recognition accuracy. No third-party dataset bytes are vendored.

```sh
node scripts/ipn-hands-replay.mjs tests/fixtures/ipn-hands/manifest.json
npx vitest run tests/ipn-hands-replay.test.mjs
```

The report includes `kind`, `benchmark: false`, frame timestamps, ground-truth
class IDs and hand counts. Replay is deterministic virtual time, without wall-clock
sleep. It validates input and label alignment; it does not decode video, run a
classifier, measure inference latency or evaluate the Fisch runtime. HandS dynamic
classes are not interchangeable with the existing MediaPipe static-pose categories.
Do not report synthetic results or label-to-label replay as classifier accuracy.

## Source and license

Use the [official IPN HandS README](https://github.com/GibranBenitez/IPN-hand/blob/master/README_HandS.md).
It licenses annotations and landmarks under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
and requests citation of both Benitez-Garcia et al., *IPN HandS*, Applied Sciences
15(11), 6321 (2025), DOI 10.3390/app15116321, and Benitez-Garcia et al., *IPN Hand*,
ICPR 2020. Preserve attribution and describe subset/extraction changes with any
redistributed data. MediaPipe predictions are separate from manually corrected GT;
z is relative depth and is not manually verified. x/y may be outside [0,1].

The video timeline must be generated from original 640x480 videos using:

```sh
ffmpeg -i '<video>.avi' -vf fps=30 -q:v 2 '<video>_%06d.jpg'
```

Frames start at 1; annotation segment ends are inclusive. Old IPN Hand 320x240
frames had near-duplicates removed and drift from this timeline. Never mix the old
`Annot_List.txt` with HandS landmarks or refined labels. Official splits contain
148 training and 52 test videos; a later benchmark must preserve them and report
its subset selection before tuning. Select a single short video first; no need to
download all 200 videos or all baseline archives to test the infrastructure.

## Manifest contract and admission

Use the synthetic manifest as the schema example. For real data set `kind` to
`ipn-hands`, `license` to `CC-BY-4.0`, `source` to the exact official README URL,
and provide nonempty `attribution`. Add `annotationArchive: {path, sha256}` pointing
to the downloaded ZIP with the **published** checksum below. Each local annotation
and landmark subset asset also needs its own SHA-256. A mismatch exits nonzero.
Paths must remain inside the manifest directory, including after symlink resolution;
subset assets are limited to 32 MiB and 100,000 frames. Annotation segments must
cover every frame contiguously. Landmark files must contain exactly each expected
`<video>_<six-digit-frame>.jpg` key and 0–2 hands of 21 finite xyz coordinates.

The annotation ZIP check establishes archive integrity. Local subset hashes detect
subsequent changes; the tool does not prove the subset was extracted from that ZIP
or that landmarks match an upstream archive. Before real benchmark admission,
independently verify the selected landmark archive's upstream checksum and record
the extraction procedure, actual frame count, split, source version and all hashes.
Do not invent a new expected digest when upstream checksums disagree.

## Access evidence and current blocker (2026-11-09 UTC)

Official README SHA-256 observed via raw GitHub:
`78a29250c05b23f6b8f156c06ec3841473c5d06889e22204eaad7b1018373647`.
It publishes annotation ZIP checksum:
`4686a2ebf70a6036166c261bc6992d050cfba08c3b18edcdd460b3fa9f30ec71`.

The official Drive annotation link (`1HybcqZqnNKZGgJJXCMjj6tLFbpsNP_a1`) was
reachable through its public `uc?export=download&id=...` endpoint. Downloaded size:
82,274 bytes; ZIP structure readable; **observed SHA-256**:
`520dfbf3d52ecab6535d8841bba55e94d6b512596ed1cff4505d2c1345bcbaec`.
This differs from the published digest. The downloaded archive stays outside Git
and is not admitted as verified benchmark data. No real landmark/video subset was
downloaded or evaluated. Resolve the source/checksum discrepancy with the dataset
maintainer, then repeat verification; the infrastructure fixture can run meanwhile.
This is an integrity blocker, not evidence that Drive access is unavailable.

Published reference landmark checksums:

| Archive | SHA-256 |
| --- | --- |
| GT | `493bf53638d5b1477e28f05c41884f0cabdcb7b84f20d68f3d5d94e0b46fad4d` |
| MPHands | `e511bb2b902207b82a296190daadc30a057f3abc16f628579542d2b1274ce598` |
| MPHolistic | `4746db8afa7376ae647c4c61c58cba963aa22fbc3458edbc06fc88775ab972b8` |

A later video/classifier benchmark still needs decode-to-timeline verification,
a licensed verified subset, predicted classes and explicit taxonomy mapping,
segment/boundary metrics, false-trigger rate and latency measurements. This PR
provides the offline validation/replay prerequisite and does not certify those gates.
