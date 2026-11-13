# System map contract

## Inputs
- Working: the changed source paths in the current Git diff.
- Reference: [root instructions](../../AGENTS.md), [harness](../my-harness.md),
  [architecture](../architecture.md), and only the relevant cards in [catalog](AGENTS.md).

## Process
1. Choose one card from the catalog and verify its source links before editing.
2. Follow its first-order impact links; do not load the entire docs tree.
3. Update affected cards with the same change, or label them stale.
4. Keep public paths and runtime behavior unchanged unless the task requires them.

## Outputs
Updated cards in this map; run-specific traces remain in ignored `.runtime/`,
not in cards. No source files are relocated by this integration.

## Check
A cold reviewer follows root -> map -> card -> source, identifies a relevant
test and impact, and records pass/fail plus commit in the PR evidence. Run the
normal harness and architecture checks from the repository root.

## Schema and scope
Cards use YAML `kind` (object/process), `universe` (live/leftover/ghost),
`status` (verified/stale), `verified_at`, and `source_revision`. Verified means
source navigation was checked, not that human UX or native performance passed.
Use kebab-case filenames, relative links and named source symbols. Recheck symbols
when code moves; line numbers are hints, not a second source of truth.

This first map covers the active Live expression path. Historical pane planners,
Braille and legacy worker-host app paths are outside this slice, not deleted or
claimed dead. Preserve external consumers of CLI/config paths; inventory them
with the owner before proposing a move. No outside-consumer inventory is claimed.

ICM adaptation: existing root safety/harness invariants stay in AGENTS.md rather
than being moved just to make it a pure router. This graph is not a numbered
pipeline: Fisch's realtime concurrent runtime remains code. See [upstream system
map](https://github.com/RinDig/icm-architect/blob/8bc2f5610d3843b3ffa31a142effe6b6337fef3c/references/system-map.md).
