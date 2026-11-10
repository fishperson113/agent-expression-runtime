# Agent-authored RGB expressions

Agents can choose any 24-bit RGB color using a color-only style node:

```json
{"type":"style","color":"#a237c9","durationMs":500}
```

There is no emotion-to-color palette or gesture-to-color lookup. Black, white,
mixed-case hex and arbitrary intermediate colors are valid. A chosen color is
an expressive proposal; it does not establish actual emotion or user intent.

The terminal planner schema and its manual validator admit this node alongside
geometry and motion. Their duration remains 200–1500 ms. The reactive V2 schema
and host validator admit the same color-only style with the existing 200–1000 ms
duration, one parallel phrase and at most three leaves. This adds no brightness,
code, shader, looping, transport or ownership capability. Conflicting color
writes still fail in the shared compiler. Existing leases, revocation, quota,
stop and motion controls remain in force.

Both paths use the shared compiler and scheduler's linear-light RGB transition.
The browser renderer passes the resulting color to its shader uniform for the
whole particle body, including the default assembled face. The terminal renderer
uses the resulting RGB when drawing pixels and emits truecolor ANSI Braille.
Display brightness, density, exposure and terminal support affect visible color;
this is not a pixel-identical browser/terminal color calibration claim.

Planner, reactive-provider and Native tool instructions explicitly permit free
RGB choice and ask for smooth, bounded transitions without flashing. Temporal
and queue bounds remain independent of hue. This is not a photosensitivity or
hardware safety certification. Deploy the updated provider and host together;
an older V2 host rejects the new style node rather than executing it partially.

Validation uses arbitrary seeded hex values plus black/white boundaries, schema
and host rejection cases, a fake terminal provider through actual rendered RGB
pixels and ANSI output, and a fake reactive provider through the Live browser UI,
causal host and actual ThreeRenderer shader uniform. Browser tests are Cloud
headless software rendering with synthetic observations. No real model turn,
camera, human emotion/perception or native GPU acceptance is claimed.
