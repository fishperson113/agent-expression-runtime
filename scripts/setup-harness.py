#!/usr/bin/env python3
"""Opt-in repository setup and additive, repository-scoped Codex hook installation."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tools/my-harness/harness.py"
sys.dont_write_bytecode = True


def setup_repo():
    gitdir = subprocess.check_output(["git", "rev-parse", "--git-common-dir"], cwd=ROOT, text=True).strip()
    config = (ROOT / gitdir).resolve() / "my-harness.toml"
    text = config.read_text(encoding="utf-8") if config.exists() else ""
    sys.path.insert(0, str(HARNESS.parent))
    from harness import parse_toml
    dirs = parse_toml(text).get("docs_extra_dirs", [])
    if "." in dirs:
        return
    line = "docs_extra_dirs = " + json.dumps(dirs + ["."])
    text = re.sub(r"(?m)^docs_extra_dirs\s*=.*$", line, text) if "docs_extra_dirs" in parse_toml(text) else text + "\n" + line + "\n"
    config.write_text(text, encoding="utf-8")
    print("Configured root instruction documents in " + str(config))


def install_codex():
    path = Path.home() / ".codex/hooks.json"
    document = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    hooks = document.setdefault("hooks", {})
    command = '"%s" "%s" --codex-hook' % (sys.executable, Path(__file__).resolve())
    handler = {"type": "command", "command": command, "commandWindows": command, "timeout": 10}
    for event in ("SessionStart", "PreToolUse", "Stop"):
        entry = {"hooks": [handler]}
        if event == "PreToolUse":
            entry["matcher"] = "^apply_patch$"
        entries = hooks.setdefault(event, [])
        if entry not in entries:
            entries.append(entry)
    if path.exists():
        backup = path.with_name("hooks.json.my-harness-backup")
        if not backup.exists():
            backup.write_bytes(path.read_bytes())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print("Merged Codex hooks; restart Codex and review/trust them in /hooks.")


def codex_hook():
    payload = sys.stdin.read()
    data = json.loads(payload or "{}")
    cwd = data.get("cwd") or (data.get("workspace") or {}).get("current_dir") or "."
    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd, capture_output=True, text=True)
    if result.returncode == 0 and Path(result.stdout.strip()).resolve() == ROOT:
        return subprocess.run([sys.executable, str(HARNESS), "codex"], input=payload, text=True, cwd=ROOT).returncode
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex", action="store_true", help="Also merge local Codex user hooks")
    parser.add_argument("--codex-hook", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.codex_hook:
        return codex_hook()
    setup_repo()
    if args.codex:
        install_codex()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
