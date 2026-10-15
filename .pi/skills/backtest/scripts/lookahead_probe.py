#!/usr/bin/env python3
"""Lookahead probe: does a signal/weight function use data from after each date?

Usage:
  python3 lookahead_probe.py path/to/module.py:function --input data.csv \
      [--date-col date] [--cut 2023-06-30 | --cut-frac 0.7] [--kwargs '{"lookback": 20}'] \
      [--seed 0] [--atol 1e-10]

Protocol: `function(df, **kwargs)` receives a DataFrame indexed by date (sorted
ascending; every other CSV column is a numeric column) and returns a Series or
DataFrame indexed by date (a subset of the input dates is fine).

Two tests, both must pass:
  perturbation  rows after the cut are replaced by random values; outputs up to
                the cut must be identical.
  truncation    the function is re-run on data ending at the cut; outputs must
                equal the full-sample outputs up to the cut. This catches
                full-sample statistics (z-scores, vol targets, hedge ratios).
Exit 0 = no leak detected, 1 = leak, 2 = usage error. Requires numpy and pandas.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys

import numpy as np
import pandas as pd


def load_function(spec: str):
    if ":" not in spec:
        raise SystemExit("function spec must be path/to/module.py:function_name")
    path, name = spec.rsplit(":", 1)
    module_spec = importlib.util.spec_from_file_location("probe_target", path)
    if module_spec is None or module_spec.loader is None:
        raise SystemExit(f"cannot import {path}")
    module = importlib.util.module_from_spec(module_spec)
    sys.path.insert(0, str(pd.io.common.os.path.dirname(pd.io.common.os.path.abspath(path))))
    module_spec.loader.exec_module(module)
    fn = getattr(module, name, None)
    if fn is None:
        raise SystemExit(f"{path} has no function {name}")
    return fn


def as_frame(out) -> pd.DataFrame:
    if isinstance(out, pd.Series):
        out = out.to_frame(name=out.name or "value")
    if not isinstance(out, pd.DataFrame):
        raise SystemExit(f"function must return a Series or DataFrame, got {type(out).__name__}")
    return out.sort_index()


def first_difference(a: pd.DataFrame, b: pd.DataFrame, atol: float):
    """Return (date, column) of the first differing cell, or None when equal (NaN == NaN)."""
    a, b = a.align(b, join="outer")
    for col in a.columns:
        x, y = a[col].to_numpy(dtype=float), b[col].to_numpy(dtype=float)
        same = np.isclose(x, y, atol=atol, rtol=0, equal_nan=True)
        if not same.all():
            idx = int(np.argmax(~same))
            return a.index[idx], col, x[idx], y[idx]
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("function", help="path/to/module.py:function")
    ap.add_argument("--input", required=True, help="CSV with a date column and numeric columns")
    ap.add_argument("--date-col", default="date")
    ap.add_argument("--cut", help="cut date (inclusive); default: --cut-frac of the sample")
    ap.add_argument("--cut-frac", type=float, default=0.7)
    ap.add_argument("--kwargs", default="{}", help="JSON object of keyword arguments")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--atol", type=float, default=1e-10)
    args = ap.parse_args()

    fn = load_function(args.function)
    kwargs = json.loads(args.kwargs)
    df = pd.read_csv(args.input)
    df[args.date_col] = pd.to_datetime(df[args.date_col])
    df = df.sort_values(args.date_col).set_index(args.date_col)
    if args.cut:
        cut = pd.Timestamp(args.cut)
    else:
        cut = df.index[max(1, int(len(df) * args.cut_frac)) - 1]
    if cut >= df.index[-1] or cut < df.index[0]:
        print(f"cut {cut.date()} must be inside the sample {df.index[0].date()}..{df.index[-1].date()}")
        return 2

    full = as_frame(fn(df.copy(), **kwargs))
    upto = full.loc[:cut]
    if upto.empty:
        print(f"function returned nothing on or before {cut.date()}; choose a later cut")
        return 2

    rng = np.random.default_rng(args.seed)
    perturbed = df.copy()
    after = perturbed.index > cut
    numeric = perturbed.select_dtypes(include=[np.number]).columns
    perturbed.loc[after, numeric] = perturbed.loc[after, numeric].to_numpy() * rng.uniform(0.5, 1.5, (int(after.sum()), len(numeric)))
    out_perturbed = as_frame(fn(perturbed, **kwargs)).loc[:cut]
    diff = first_difference(upto, out_perturbed, args.atol)
    leak = False
    if diff is None:
        print(f"perturbation test: PASS (outputs up to {cut.date()} unchanged when later rows change)")
    else:
        leak = True
        d, col, x, y = diff
        print(f"perturbation test: FAIL — output[{col}] at {d.date()} changed from {x!r} to {y!r} when rows after {cut.date()} were perturbed")

    out_truncated = as_frame(fn(df.loc[:cut].copy(), **kwargs))
    diff = first_difference(upto, out_truncated, args.atol)
    if diff is None:
        print(f"truncation test:   PASS (outputs up to {cut.date()} equal those computed on data ending at the cut)")
    else:
        leak = True
        d, col, x, y = diff
        print(f"truncation test:   FAIL — output[{col}] at {d.date()} is {x!r} on the full sample but {y!r} on data ending at {cut.date()}")
    print("\nresult: LOOKAHEAD DETECTED" if leak else "\nresult: no lookahead detected")
    return 1 if leak else 0


if __name__ == "__main__":
    sys.exit(main())
