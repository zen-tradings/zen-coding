#!/usr/bin/env python3
"""Compare replicated metrics against a paper's reported metrics with a tolerance table.

Usage:
  python3 compare_metrics.py paper_metrics.json our_metrics.json \
      [--rel 0.15] [--tol sharpe=0.2 --tol max_drawdown=0.05] [--markdown benchmark.md] [--json out.json]

Both JSON files are flat objects {metric: number}; nested {"value": number}
objects are accepted. --rel is the default relative tolerance; --tol sets an
absolute tolerance for one metric (overrides --rel for it).
Verdict: replicated when every shared metric is within tolerance; partially
replicated when at least half are; failed otherwise. Exit 0/1/2 respectively.
"""
from __future__ import annotations

import argparse
import json
import math
import sys


def load(path: str) -> dict[str, float]:
    with open(path) as fh:
        raw = json.load(fh)
    out = {}
    for k, v in raw.items():
        if isinstance(v, dict) and "value" in v:
            v = v["value"]
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = float(v)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paper")
    ap.add_argument("ours")
    ap.add_argument("--rel", type=float, default=0.15, help="default relative tolerance (fraction of the paper value)")
    ap.add_argument("--tol", action="append", default=[], help="absolute tolerance for one metric: name=value")
    ap.add_argument("--markdown")
    ap.add_argument("--json")
    args = ap.parse_args()

    paper, ours = load(args.paper), load(args.ours)
    abs_tol = {}
    for item in args.tol:
        name, _, value = item.partition("=")
        abs_tol[name.strip()] = float(value)

    shared = [k for k in paper if k in ours]
    missing = [k for k in paper if k not in ours]
    rows, within = [], 0
    for k in shared:
        p, o = paper[k], ours[k]
        delta = o - p
        tol = abs_tol.get(k, abs(p) * args.rel)
        ok = abs(delta) <= tol
        within += ok
        rows.append({"metric": k, "paper": p, "ours": o, "delta": delta, "tolerance": tol, "within": ok})
    n = len(rows)
    if n == 0:
        verdict, code = "no comparable metrics", 2
    elif within == n:
        verdict, code = "replicated", 0
    elif within * 2 >= n:
        verdict, code = "partially replicated", 1
    else:
        verdict, code = "failed", 2

    lines = ["| metric | paper | ours | Δ | tolerance | within? |", "|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['metric']} | {r['paper']:.4g} | {r['ours']:.4g} | {r['delta']:+.4g} | ±{r['tolerance']:.4g} | {'yes' if r['within'] else 'NO'} |")
    lines.append("")
    lines.append(f"**Verdict: {verdict}** — {within}/{n} metrics within tolerance" + (f"; not reported by us: {', '.join(missing)}" if missing else ""))
    md = "\n".join(lines)
    print(md)
    if args.markdown:
        with open(args.markdown, "w") as fh:
            fh.write(md + "\n")
    if args.json:
        with open(args.json, "w") as fh:
            json.dump({"verdict": verdict, "within": within, "compared": n, "missing": missing, "rows": rows}, fh, indent=2)
    return code


if __name__ == "__main__":
    sys.exit(main())
