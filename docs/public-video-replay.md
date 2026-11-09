# Verified public-video replay

A real hand-motion clip is available in `tests/fixtures/public-video/hand-rubbing.webm`.
It is **Hand rubbing**, by **Mx. Granger**, dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
[Commons source and license](https://commons.wikimedia.org/wiki/File:Hand_rubbing.webm)
([description revision 1291597398](https://commons.wikimedia.org/w/index.php?title=File:Hand_rubbing.webm&oldid=1291597398)).
The clip is an unmodified original, not footage from the user's camera. Product
code remains MIT; the clip and its compact source manifest are CC0. No model
weights or third-party implementation code are included.

The Commons API reports upload time `2014-08-19T16:42:57Z`, 534,113 bytes,
640×480 dimensions, approximately 2.005 seconds, and SHA-1
`0df6a318f3bb12f4b82f582d5d557882a42e6b58`. The downloaded original matched that
**source-published SHA-1 and size** on 2026-11-09 UTC. Its locally computed SHA-256,
pinned in the manifest for subsequent integrity checks, is
`64d88c3e468f379bdf4b304cee9161f19e75df3b12fd2df9004aa75e8c324c31`.
Commons does not publish a SHA-256 here; the two checksum roles are distinct.

Metadata can be independently fetched with Commons' `action=query`,
`titles=File:Hand rubbing.webm`, `prop=imageinfo|revisions`,
`iiprop=url|sha1|size|extmetadata|timestamp` and `rvprop=ids|timestamp`.
License, author and version were reviewed from this source before committing the
fixture. A manifest's claimed license by itself does not establish rights to a
new clip. Review the source before admitting any additional fixture.

## Decode and play in Cloud

Requires `ffmpeg` and `ffprobe` on PATH, with the libx264 encoder for MP4 output.
No additional npm package or model token is needed. Start from the repo root:

```sh
mkdir -p .runtime/public-video
node scripts/public-video-replay.mjs tests/fixtures/public-video/manifest.json \
  .runtime/public-video/hand-rubbing-replay.mp4 > .runtime/public-video/replay-report.json
```

The MP4 is a playable, silent 640×480/30-fps replay. Output must not already exist;
choose another filename for a second encode. Omit the MP4 argument to verify and
decode without writing a video. Generated replay/report files stay in ignored
`.runtime/`; the small licensed original is tracked and available after clone.
The source contains audio; replay explicitly selects only the video stream and
neither plays nor exports audio. No microphone or real camera is opened.

The decoder verifies SHA-1, SHA-256 and size before launching FFmpeg. It only
accepts local WebM/Matroska input confined to the manifest directory, limits input
to 8 MiB, one video stream, 1920×1080 and 30 seconds, and restricts input protocols
to `file,pipe`. Commands use argument arrays without a shell, one decoder thread,
a 20-second timeout per child and bounded captured output. No URL is downloaded
by the replay command. The explicit Matroska demuxer excludes playlist inputs.

A report includes per-frame hashes from decoded YUV420P pixels after FFmpeg's
`fps=30` normalization, with 1-based frame indices and timestamps starting at 0.
This is virtual-time replay, not real-time inference. Frame hashes should match
for repeated decoding in the same FFmpeg build; different decoder versions need
not have bit-identical conversion results. The lossy H.264 MP4 is a viewing copy;
the hashes describe decoded source frames, not re-decoded MP4 pixels.

## Validation and scope

The actual public clip decodes into **60 frames**, with changing pixel hashes.
Tests cover pinned source/asset integrity, license/version presence, path escape,
metadata limits, discontinuous timestamps, repeat decode determinism, silent MP4
output and overwrite refusal. The integration test runs when FFmpeg/FFprobe are
available; its absence is an explicit skip, not video acceptance. In this Cloud
session FFmpeg 7.1.5 was available and the real decode/encode test passed.

This clip is a licensed video smoke fixture, **not an annotated gesture dataset**.
It has no framewise gesture ground truth and does not establish classifier accuracy,
face/hand landmark quality, runtime reaction quality, native display acceptance or
latency. No model inference is performed by this tool. Use it as real video input
for the next observation/reaction evaluation, with separately declared labels and
metrics if recognition accuracy is claimed. IPN HandS remains separately blocked
on its [source checksum discrepancy](ipn-hands-replay.md).
