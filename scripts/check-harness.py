#!/usr/bin/env python3
"""Strict Cloud/CI entry point; upstream's manual check deliberately exits zero."""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True


def check(root, commits=None):
    spec = importlib.util.spec_from_file_location("my_harness", ROOT / "tools/my-harness/harness.py")
    harness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(harness)
    repo = harness.find_repo(str(root))
    if repo is None:
        raise RuntimeError("my-harness requires a Git checkout")
    cfg = harness.load_config(repo)
    ctx = harness.full_ctx(repo, cfg)
    if commits is not None:
        ctx.commits = lambda: (commits, "PR merge base")
    results = harness.evaluate(ctx, "stop")
    for rid, blocks, title, value, limit, items, reasons in results:
        verdict = "FAIL" if reasons and blocks else "warn" if reasons else "ok"
        print("%s %s: %s / %s %s" % (rid, title, value, limit, verdict))
        for reason in reasons:
            print("  " + reason)
    print("R10/R11: unknown here; no client transcript was supplied.")
    return int(bool(harness.blocking_reasons(results)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", help="Check committed changes since this ref in an isolated clone")
    args = parser.parse_args()
    if not args.base:
        return check(ROOT)
    base = subprocess.check_output(["git", "merge-base", args.base, "HEAD"], cwd=ROOT, text=True).strip()
    commits = int(subprocess.check_output(["git", "rev-list", "--count", base + "..HEAD"], cwd=ROOT, text=True))
    with tempfile.TemporaryDirectory(prefix="fisch-harness-") as directory:
        subprocess.run(["git", "clone", "--shared", "--quiet", str(ROOT), directory], check=True)
        subprocess.run(["git", "reset", "--soft", base], cwd=directory, check=True)
        (Path(directory) / ".git/my-harness.toml").write_text('docs_extra_dirs = ["."]\n', encoding="utf-8")
        return check(Path(directory), commits)


if __name__ == "__main__":
    raise SystemExit(main())
