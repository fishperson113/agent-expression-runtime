# Chat stream projection

Codex already emits `item/agentMessage/delta`. LiveConversation accumulates bounded
plaintext by turn/item and publishes snapshots via the existing approximately
100 ms polling bridge. This change does not add streaming, change that cadence,
or execute partial tool arguments/JSON. Tool progress and DSL admission stay on
their existing independent paths.

The browser previously rebuilt every transcript row whenever any text changed.
It now reconciles rows by generation, turn, item and role, edits only the changed
text range, and removes evicted history. Repeated identities are occurrence-scoped
without changing the snapshot contract. Existing generation/revision fencing,
scroll-follow intent, composer controls and data limits remain unchanged. No React,
Markdown/HTML execution, protocol dependency or visual redesign is introduced.

## Reproducible browser fixture

From a prepared checkout, create `.runtime` if absent and run:

```sh
node scripts/measure-chat-projection.mjs .runtime/chat-projection.json
```

The fixture has 40 history rows and 80 incremental text updates spaced by 10 ms,
followed by a final snapshot. It records submit-to-first/final **DOM projection**,
summed projection work, row creation count and history-node identity. It runs three
samples in headless Edge on Windows (Chromium elsewhere), with no model, camera,
microphone or gateway. This is not an end-to-end provider or paint latency benchmark.
The history and sent text are synthetic. Run sequentially without other browser QA.

Initial laptop comparison, baseline `3ec23f2` vs keyed reconciliation:

| Metric | Before | After |
|---|---:|---:|
| Created transcript rows, every run | 3321 | 1 |
| Existing history node retained | no | yes |
| Median summed projection work | 190.5 ms | 116.9 ms |
| Median submit to final DOM | 1070.4 ms | 983.6 ms |
| Median submit to first DOM | 13.8 ms | 24.3 ms |

These three local samples demonstrate removed DOM churn, not a reliable first-text
latency win: first-text timing worsened/noised in this fixture. They do not include
the host publication interval, network or inference. No latency threshold or timing
assertion is added to CI. UI-UX review focused on incremental response and preserving
reading/focus rather than adding a cosmetic typewriter delay.

## Correctness coverage

Browser tests check stable row/text identity across deltas and finalization,
selection in unchanged history, pruning, same item ID on different turns, generation
reset and stale snapshots. Existing tests cover internal scroll, reader gestures,
composer/stop and failed transport. Partial JSON and HTML-looking text remain literal
text; rendering text grants no execution or expression authority. Native model
interaction quality is outside this projection-only claim.
