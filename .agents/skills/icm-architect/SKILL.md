---
name: icm-architect
description: Map or restructure Fisch context using ICM. Use for architecture discovery, change impact, repository maps, folder contracts and agent handoffs.
license: MIT
---

# ICM Architect for Fisch

A scoped adaptation of Interpretable Context Methodology, not a replacement for
Fisch's concurrent runtime. Read [provenance](PROVENANCE.md) before updating it.

## Workflow

1. Read the root [AGENTS.md](../../../AGENTS.md) and its architecture/harness routes.
   Inventory the relevant source, tests, docs and referrers before changing paths.
2. Propose the smallest useful map beside existing docs. Prefer `docs/map/`.
   Use objects (owned concepts), processes (verified flows) and effects (impact
   routes) only when populated. Do not move source merely to match a template.
3. Present the target tree and migration map before moving files. Check outside
   consumers and case-folded collisions on Windows. Obtain approval for moves.
4. Keep catalogs small: `AGENTS.md` routes, `CONTEXT.md` names exact inputs,
   process, outputs and a concrete check. Separate reusable reference material
   from per-run evidence. One home per fact; link instead of copying a spec.
5. Cite source and revision for verified cards. Distinguish live, leftover and
   ghost. Record first-order change impacts and what is deliberately unaffected.
   Never promote intended behavior or a test proxy into a product guarantee.
6. Walk cold from the root to a relevant module and test in at most two more
   reads. Verify links, contracts and source claims. Save a pass/fail record in
   the designated run output; do not commit private traces or generated evidence.
7. Follow the existing Fisch harness and CI before publication. ICM adds context
   discipline, not exceptions to file budgets, architecture guards or approval.

## References (pinned upstream; read only the needed form)

- [Core and contract format](https://github.com/RinDig/icm-architect/blob/8bc2f5610d3843b3ffa31a142effe6b6337fef3c/references/core.md)
- [System-map audit](https://github.com/RinDig/icm-architect/blob/8bc2f5610d3843b3ffa31a142effe6b6337fef3c/references/system-map.md)
- [Forms](https://github.com/RinDig/icm-architect/blob/8bc2f5610d3843b3ffa31a142effe6b6337fef3c/references/forms.md)
- [Templates](https://github.com/RinDig/icm-architect/tree/8bc2f5610d3843b3ffa31a142effe6b6337fef3c/assets/templates)

No upstream scripts or hooks are installed. Review any future script before
running it. Real-time concurrency, cancellation and provider isolation remain
implemented in code, not folder sequencing. If an input is unavailable, record
the limit rather than inventing a map or claiming verification.
