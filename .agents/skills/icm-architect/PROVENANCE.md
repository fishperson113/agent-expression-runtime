# ICM skill provenance

Source: [RinDig/icm-architect](https://github.com/RinDig/icm-architect).
Pinned revision: `8bc2f5610d3843b3ffa31a142effe6b6337fef3c`.
Method: Van Clief and McDermott, [arXiv:2603.16021](https://arxiv.org/abs/2603.16021).
License: [MIT](LICENSE), copyright 2026 Jake Van Clief.

This is a Fisch-specific adaptation, not an unmodified vendored distribution.
The local skill condenses the upstream invariants and system-map workflow;
other forms/templates remain pinned external references. No upstream Python
scripts, generated indexes or hooks are installed. The LICENSE is copied intact.

Codex loads the canonical `.agents/skills/icm-architect/SKILL.md`. Claude's
project skill is a routing adapter to the same file, not another methodology.
This does not alter global agent settings or install executables.

To update: review upstream changes and license, choose a new exact revision,
update pinned links together, recheck the local adaptation and both discovery
paths, then run skill/harness tests. Never imply this method itself proves a
runtime speedup or behavioral correctness.
