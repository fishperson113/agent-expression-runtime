# Displayed-particle projection adapter spike

`ThreeRenderer.projectDisplayedParts()` is opt-in inspection, not production caption wiring. It returns `null` before a frame, after loss/disposal, between context restoration and a successful redraw, or while a frame update is invalid. Otherwise it returns frameId, contentFrame, capturedAt, viewport CSS dimensions, and per-part particle counts, frustum-visible count, normalized top-left centroid and bounds. Empty or clipped groups have null centroid/bounds.

The source is the actual position buffer after sampling, swarm movement and scene framing. Projection uses the submitted camera and points model matrix. It does not project raw DSL centers. No GPU readback, caption preset or model call is involved. `frameId` advances on resize redraws while `contentFrame` identifies the latest body-content submission; consumers must use frameId plus their own scene epoch/revision ownership and canvas rectangle. Both are needed to avoid stale anchors.

Bounds cover particle centers, not point-sprite radius, occlusion or pixel-level legibility. `visibleParticles` means inside the clip frustum, not proven unoccluded pixels. CPU tests and a headless browser renderer test verify transformation, resizing and motion. They do not establish a readable native diagram or general semantic quality. Production admission remains unchanged.

The browser regression uses software WebGL and synthetic context lifecycle events, including a failed redraw. It does not certify hardware recovery. The projection scan is opt-in; capturing its clip matrix adds constant per-frame work whose performance cost has not been measured.
