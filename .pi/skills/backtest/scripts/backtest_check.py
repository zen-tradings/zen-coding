#!/usr/bin/env python3
"""Static lookahead / methodology scan for backtest and research code.

Usage:
  python3 backtest_check.py FILE_OR_DIR [...] [--warn-only] [--json out.json]

Scans Python files (and .ipynb cells) for the patterns that most often leak the
future or inflate results. Findings are "error" (exit 1 unless --warn-only) or
"warning". A line annotated `# lookahead-ok: <reason>` (or `# inplace-ok`) is
exempt; the annotation is what makes a label line auditable.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

RULES = [
    ("error", "negative-shift", r"\.shift\(\s*(periods\s*=\s*)?-\s*(\d|[A-Za-z_])", "lookahead-ok",
     "negative shift reads future rows (lookahead); only labels may, annotate them"),
    ("error", "negative-pct-change", r"\.(pct_change|diff)\(\s*(periods\s*=\s*)?-\s*(\d|[A-Za-z_])", "lookahead-ok",
     "negative periods read future rows (lookahead)"),
    ("error", "centered-window", r"\.rolling\([^)]*center\s*=\s*True", "lookahead-ok",
     "centered rolling window uses future rows"),
    ("error", "backfill", r"\.bfill\(|fillna\(\s*method\s*=\s*['\"]bfill['\"]|\.backfill\(", "lookahead-ok",
     "backfilling copies future values into the past"),
    ("warning", "random-split", r"train_test_split\((?![^)]*shuffle\s*=\s*False)", None,
     "random train/test split on time-series data; use shuffle=False or a walk-forward split"),
    ("warning", "inplace", r"\binplace\s*=\s*True\b", "inplace-ok",
     "inplace=True mutates a frame other experiments may share"),
    ("warning", "survivorship", r"List_of_S%26P_500_companies|\bsp500_tickers\b|\bget_sp500\w*\(|\bnasdaq_?100_tickers\b|\bcurrent_constituents\b", None,
     "universe built from today's index constituents (survivorship bias)"),
    ("warning", "hardcoded-universe", r"^\s*(tickers|universe|symbols)\s*=\s*\[\s*['\"][A-Z.]{1,6}['\"]", None,
     "hard-coded ticker list: confirm it is point-in-time, including delisted names"),
    ("warning", "index-plus-one", r"\.iloc\[\s*[A-Za-z_]\w*\s*\+\s*\d+\s*\]|\[\s*[ti]\s*\+\s*1\s*\]", "lookahead-ok",
     "index + 1 access inside a loop reads the next row; make sure it is a label, not a feature"),
]

FIT_RE = re.compile(r"\.fit(_transform)?\(")
SPLIT_RE = re.compile(r"\btrain_test_split\(")
BACKTEST_RE = re.compile(r"\bbacktest|\bsharpe\b|\bpnl\b|\bequity_curve\b|\bmax_drawdown\b", re.I)
COST_RE = re.compile(r"\bcost|\bcommission|\bslippage|\bfee\b|\bfees\b|\bspread|\bbps\b|\bimpact\b", re.I)
MARKER_RE = {m: re.compile(r"#\s*" + re.escape(m) + r"\b") for m in ("lookahead-ok", "inplace-ok")}


def source_lines(path: str) -> list[str]:
    with open(path, encoding="utf8", errors="replace") as fh:
        text = fh.read()
    if path.endswith(".ipynb"):
        try:
            nb = json.loads(text)
            cells = [c for c in nb.get("cells", []) if c.get("cell_type") == "code"]
            return [line.rstrip("\n") for c in cells for line in "".join(c.get("source", [])).split("\n")]
        except json.JSONDecodeError:
            return text.split("\n")
    return text.split("\n")


def scan_file(path: str) -> list[dict]:
    lines = source_lines(path)
    findings = []
    for severity, rule, pattern, marker, message in RULES:
        rx = re.compile(pattern)
        for i, line in enumerate(lines, start=1):
            if rx.search(line) and not (marker and MARKER_RE[marker].search(line)):
                findings.append({"severity": severity, "rule": rule, "path": path, "line": i, "message": message,
                                 "code": line.strip()[:120]})
    fit_line = split_line = None
    for i, line in enumerate(lines, start=1):
        if re.match(r"\s*(from|import)\b", line):
            continue
        if fit_line is None and FIT_RE.search(line) and not MARKER_RE["lookahead-ok"].search(line):
            fit_line = i
        if split_line is None and SPLIT_RE.search(line):
            split_line = i
    if fit_line and split_line and fit_line < split_line:
        findings.append({"severity": "error", "rule": "fit-before-split", "path": path, "line": fit_line,
                         "message": "model/scaler fitted before train_test_split: it sees test data",
                         "code": lines[fit_line - 1].strip()[:120]})
    text = "\n".join(lines)
    if BACKTEST_RE.search(text) and not COST_RE.search(text):
        findings.append({"severity": "warning", "rule": "no-cost-model", "path": path, "line": None,
                         "message": "backtest without any cost/commission/slippage/fee/spread term", "code": ""})
    return findings


def iter_files(paths: list[str]):
    for p in paths:
        if os.path.isdir(p):
            for root, dirs, files in os.walk(p):
                dirs[:] = [d for d in dirs if d not in {".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache"}]
                for f in files:
                    if f.endswith((".py", ".ipynb")):
                        yield os.path.join(root, f)
        elif p.endswith((".py", ".ipynb")):
            yield p


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--warn-only", action="store_true", help="exit 0 even with error-level findings")
    ap.add_argument("--json")
    args = ap.parse_args()

    findings = [f for path in iter_files(args.paths) for f in scan_file(path)]
    findings.sort(key=lambda f: (f["severity"] != "error", f["path"], f["line"] or 0))
    for f in findings:
        where = f"{f['path']}:{f['line']}" if f["line"] else f["path"]
        print(f"{f['severity'].upper():7} [{f['rule']}] {where}: {f['message']}" + (f"\n        {f['code']}" if f["code"] else ""))
    errors = sum(1 for f in findings if f["severity"] == "error")
    warnings = len(findings) - errors
    print(f"\n{errors} error(s), {warnings} warning(s)")
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(findings, fh, indent=2)
    return 1 if errors and not args.warn_only else 0


if __name__ == "__main__":
    sys.exit(main())
