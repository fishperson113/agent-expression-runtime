# Reactive opportunity diagnostics

This diagnostic measures the complete synthetic opportunity funnel, including
events that never become requests and decisions that never reach application.
It changes no runtime policy and makes no claim about natural human traffic,
model relevance, enjoyment, native GPU performance or a real-wall 20-minute soak.

Run from a prepared checkout:

```sh
node scripts/reactive-opportunities.mjs --output .runtime/reactive-opportunities
node scripts/reactive-opportunities.mjs --quick --output .runtime/reactive-opportunities-quick
```

The full run contains 77 virtual 20-minute scenarios and two 100 ms polling
controls. Quick mode contains 16 virtual 2-minute scenarios plus two controls;
it is a harness smoke check. No model account, budget file or media device is used.
The CLI writes CSV, metadata JSON and a Markdown report, overwriting that output
prefix. Only explicitly reviewed, synthetic aggregate evidence belongs in Git.

The maintained probe imports actual source through esbuild and removes its
temporary bundle. It does not commit an archived or bundled runtime copy.
Metadata hashes all executed source inputs and compares their bytes against
the original `354d642` reference. A newer source checkout must not be mislabeled
as the old snapshot even when measured counters happen to match.

Current deliberate evidence: [report](reactive-opportunities-results.md),
[all 77 CSV rows](evidence/reactive-opportunities.csv), and
[sanitized provenance plus polling controls](evidence/reactive-opportunities.json).
This generation uses `dc66412`; executed `reactive-session.ts` and `signals.ts`
differ from `354d642` after finite-input hardening. All shared funnel and reason
counters across 77 rows were compared with the original exploratory output and
matched; that is result equivalence for these inputs, not source-byte identity.
To deliberately regenerate the repository evidence:

```sh
node scripts/reactive-opportunities.mjs --output docs/evidence/reactive-opportunities --report docs/reactive-opportunities-results.md
```

The explicit report destination preserves the repository's Markdown-directory rule.

Accounting checks reject inconsistent diagnostic totals, not a particular
reaction rate. A zero-reaction scenario is recorded as evidence, never asserted
as desired product behavior. Private native method wrapping counts revocation
reasons on the isolated diagnostic instance and calls the original unchanged;
future internal API changes may require updating this harness.

The separate [real-wall browser/broker report](reactive-wall-evidence.md) now
covers a full 20-minute synthetic run at source `354d642`, with quiet/active
opportunity cohorts and actual owned frame proxies. This virtual report was
regenerated at `dc66412`; the snapshots must not be conflated. Neither a rolling
60-second recorder nor the virtual matrix substitutes for the wall measurement.
