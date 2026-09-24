#!/usr/bin/env python3
"""Fold an eval iteration into benchmark.json and compare with the previous one.

Usage:
  python3 scripts/aggregate.py               # newest evals/runs/iteration-N
  python3 scripts/aggregate.py --iteration 3
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

RUNS = Path(__file__).resolve().parent.parent / "evals" / "runs"


def load_iteration(n: int) -> dict | None:
    itdir = RUNS / f"iteration-{n}"
    if not itdir.is_dir():
        return None
    results = [json.loads(p.read_text()) for p in sorted(itdir.glob("*/result.json"))]
    if not results:
        return None
    checks = [a for r in results for a in r.get("assertions", [])]
    return {
        "iteration": n,
        "cases": {r["id"]: r.get("passed", False) for r in results},
        "case_pass_rate": round(sum(r.get("passed", False) for r in results) / len(results), 3),
        "assertion_pass_rate": round(sum(c["pass"] for c in checks) / len(checks), 3) if checks else None,
        "mean_duration_s": round(
            sum(r.get("agent", {}).get("duration_s", 0) for r in results) / len(results), 1),
        "failures": [
            {"id": r["id"],
             "failed_assertions": [a["desc"] for a in r.get("assertions", []) if not a["pass"]],
             "timed_out": r.get("agent", {}).get("timed_out", False),
             "error": r.get("error")}
            for r in results if not r.get("passed", False)
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iteration", type=int)
    args = ap.parse_args()

    taken = sorted(int(p.name.split("-")[1]) for p in RUNS.glob("iteration-*")
                   if p.name.split("-")[1].isdigit())
    if not taken:
        sys.exit("no iterations found — run scripts/run_eval.py first")
    n = args.iteration or taken[-1]

    bench = load_iteration(n)
    if bench is None:
        sys.exit(f"iteration-{n} has no results")

    prev = load_iteration(max((t for t in taken if t < n), default=0))
    if prev:
        bench["baseline_iteration"] = prev["iteration"]
        bench["regressions"] = sorted(
            cid for cid, ok in prev["cases"].items() if ok and not bench["cases"].get(cid, False))

    out = RUNS / f"iteration-{n}" / "benchmark.json"
    out.write_text(json.dumps(bench, indent=2))
    print(json.dumps(bench, indent=2))
    print(f"\nwrote {out}", file=sys.stderr)
    if bench.get("regressions"):
        print("REGRESSION vs previous iteration — do not promote.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
