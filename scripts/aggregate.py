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


def case_rate(r: dict) -> float:
    """Per-case pass rate; legacy single-run results only carry the boolean."""
    return r.get("pass_rate", 1.0 if r.get("passed") else 0.0)


def load_iteration(n: int) -> dict | None:
    itdir = RUNS / f"iteration-{n}"
    if not itdir.is_dir():
        return None
    # one level deep on purpose: per-attempt results live at
    # <case>/attempts/attempt-k/result.json and must not be picked up here
    results = [json.loads(p.read_text()) for p in sorted(itdir.glob("*/result.json"))]
    if not results:
        return None
    meta_file = itdir / "run_meta.json"
    meta = json.loads(meta_file.read_text()) if meta_file.is_file() else {}
    checks = [a for r in results for a in r.get("assertions", [])]
    rates = {r["id"]: case_rate(r) for r in results}
    tracks: dict[str, list[float]] = {}
    for r in results:
        tracks.setdefault(r.get("track", "untagged"), []).append(rates[r["id"]])
    return {
        "iteration": n,
        "model": meta.get("model"),
        "provider": meta.get("provider"),
        "pi_version": meta.get("pi_version"),
        "recorded_at": meta.get("recorded_at"),
        "runs_per_case": meta.get("runs_per_case", 1),
        "cases": {r["id"]: r.get("passed", False) for r in results},
        # mean of per-case pass rates (equals strict rate when runs_per_case=1)
        "case_pass_rate": round(sum(rates.values()) / len(rates), 3),
        "strict_pass_rate": round(sum(r.get("passed", False) for r in results) / len(results), 3),
        "assertion_pass_rate": round(sum(c["pass"] for c in checks) / len(checks), 3) if checks else None,
        "case_stats": {
            r["id"]: {
                "runs": r.get("runs", 1),
                "pass_count": r.get("pass_count", int(r.get("passed", False))),
                "pass_rate": round(rates[r["id"]], 3),
                "pass_rate_stddev": r.get("pass_rate_stddev", 0.0),
                "mean_duration_s": r.get("agent", {}).get("mean_duration_s",
                                                          r.get("agent", {}).get("duration_s")),
                "stddev_duration_s": r.get("agent", {}).get("stddev_duration_s", 0.0),
            }
            for r in results
        },
        "tracks": {t: {"cases": len(v), "pass_rate": round(sum(v) / len(v), 3)}
                   for t, v in sorted(tracks.items())},
        "mean_duration_s": round(
            sum(r.get("agent", {}).get("duration_s", 0) for r in results) / len(results), 1),
        "failures": [
            {"id": r["id"],
             "pass_count": r.get("pass_count", int(r.get("passed", False))),
             "runs": r.get("runs", 1),
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
        # only cases that ran in BOTH iterations can regress — a case absent
        # from this (partial) run is not a regression
        bench["regressions"] = sorted(
            cid for cid, ok in prev["cases"].items()
            if ok and cid in bench["cases"] and not bench["cases"][cid])

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
