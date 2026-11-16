# Experimental independent user-request visuals (V2)

Status: provenance-only draft, default off. Not approved for product promotion or merge. This preserves the reviewed experiment; it does not establish a successful two-step demo, semantic fidelity, or a streaming-latency improvement.

## Scope

An explicitly enabled `FISCH_USER_REQUEST_VISUAL=1` freeform session may author one visual attempt from a newly observed accepted user message, independently of native Codex. Existing visual model/effort options apply. Ordinary sessions and native requests/tools remain unchanged. The original strict experiment and its artifacts remain preserved separately; this V2 intentionally changes that cancellation policy.

The source clock is first observed acceptance, not user submission. Exact user text and historical context are retained without truncation; the original ten-second user lease is never renewed. An admitted user scene has the fixed attribution `User-request preview`. New turns, rewritten evidence, cancellation/error, manual intent and expiry remain authority boundaries.

Unlike the strict experiment, ordinary assistant text alone does not cancel the user preview. The next already-scheduled validated assistant compose or retain can defer to the assistant and permanently tombstone the captured user authority. Retain is deference, not detected refusal. Missing or late assistant verdicts can leave a temporary mismatch until expiry; this is not a refusal/contradiction detector. No unconditional veto call, keyword router, or model-authored conflict/disposition field is added.

Handoff validates the exact captured version/receipt and existing prepared assistant scope, intent, anchor and deadline. Tombstoning and ordinary admission are synchronous; no reprepare, anchor refresh or lease extension is allowed. Failed known outcomes retire only the exact old receipt. Ambiguous/malformed accepted outcomes remain fail-closed. Expired, never-admitted user authority may retain one non-active lineage solely to avoid vetoing an independently valid assistant candidate. This path requires a strictly null captured receipt, no issued/current user ownership and no prior user admission for that version. Rewrites, cancellation, manual invalidation and new epochs clear the lineage.

Known host/browser asymmetry: the host does not consume its expired deference lineage in the same way as the browser handoff. It is inactive and cannot reemit a user source; the browser tombstone is authoritative. Resolve or explicitly justify this asymmetry before promotion.

## Evidence and limits

- Initial combined focused suites: 113 passed. A missing finite-time fixture warning and a nullable-receipt TypeScript fixture error were preserved, then corrected without relaxing production assertions or deadlines; the ten-case integration retry and build/architecture gates passed.
- Ownerless-expiry proof first failed as expected: five controls passed, while a never-admitted expired capture blocked an otherwise valid assistant scope. The fix passed 27 core cases in exactly two files, followed by a successful build. The original expected-red output remains preserved.
- Current provider policy tests: 11 intended cases passed. The invocation also discovered ten immutable archived cases, so its actual reported total was 21. Subsequent focused core invocation excluded the runtime archive for that command only; product test discovery was not changed.
- Six synthetic actual-browser cases passed, including original-clock ownerless expiry, exact ownership handoff, late-user fencing and attribution lifecycle. No page/cleanup errors or emergency timeout. The screenshot remained face-like cyan particles rather than a readable sphere: this is admission/lifecycle evidence, not geometry-quality evidence.
- Diagnostic loader checks: 18 passed; current source closure was frozen separately from earlier trial archives.
- Earlier live V2 trials returned user retain records and produced zero admissions. The corrective trial submitted both prompts, but the first native reply was interrupted at an unapproved tool request; the second was diagnostic continuation, not a successful two-step flow. An assistant compose drop motivated the deterministic proof, but its actual live cause was not established.
- The latest policy-v2.1 plus ownerless-fix live attempt was blocked by Computer Use browser-URL policy confidence before any prompt. Both trace installation markers appeared; zero native turns, visual-author calls, records or admissions occurred. The existing 180-second named-process watchdog ended it; no bypass or retry was attempted. It provides no model or UX outcome for this bundle.

There is no full-suite pass for this final experimental tree, no current real-UX success, and no causal A/B result. The runtime uses the existing one-active/latest-pending mechanism; the authorized live attempt had a wall-clock bound, not an invented hard model-call cap. Promotion requires a fresh review, full regression/CI gates, and authorized real interaction evidence showing recognizable visuals with correct attribution and meaningful assistant follow-up.
