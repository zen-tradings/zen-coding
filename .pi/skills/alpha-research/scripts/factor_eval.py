#!/usr/bin/env python3
"""Cross-sectional factor evaluation: IC, RankIC, decay, quantile spread, turnover, cost drag.

Usage:
  python3 factor_eval.py panel.csv --signal signal [--close close | --ret ret] \
      [--date-col date] [--symbol-col symbol] [--horizons 1,5,21] [--decay-lags 0,1,5,10,21] \
      [--quantiles 5] [--cost-bps 10] [--existing momentum,value] [--min-names 10] \
      [--start 2020-01-01] [--end 2024-12-31] [--json out.json] [--markdown out.md]

Input: long CSV, one row per (date, symbol) with the signal value and either a
close price (forward returns are computed from it) or a daily simple return.
The signal at date t must be knowable at t; the script only looks ahead to
build the forward-return LABELS (marked lookahead-ok below).
Requires numpy and pandas.
"""
from __future__ import annotations

import argparse
import json
import math
import sys

import numpy as np
import pandas as pd

ANNUAL = 252


def xs_corr(a: pd.DataFrame, b: pd.DataFrame, min_names: int, rank: bool) -> pd.Series:
    """Per-date cross-sectional correlation of two wide (date x symbol) frames."""
    out = {}
    for date in a.index.intersection(b.index):
        x, y = a.loc[date], b.loc[date]
        mask = x.notna() & y.notna()
        if mask.sum() < min_names:
            continue
        xv, yv = x[mask], y[mask]
        if rank:
            xv, yv = xv.rank(), yv.rank()
        if xv.std() == 0 or yv.std() == 0:
            continue
        out[date] = float(np.corrcoef(xv, yv)[0, 1])
    return pd.Series(out, dtype=float)


def ic_stats(ic: pd.Series) -> dict:
    n = int(ic.notna().sum())
    if n < 2:
        return {"n": n, "mean": None, "std": None, "t": None, "hit_rate": None}
    mean, std = float(ic.mean()), float(ic.std(ddof=1))
    return {"n": n, "mean": mean, "std": std, "t": mean / std * math.sqrt(n) if std > 0 else None,
            "hit_rate": float((ic > 0).mean())}


def quantile_returns(signal: pd.DataFrame, fwd: pd.DataFrame, q: int, min_names: int) -> dict:
    per_bucket: dict[int, list[float]] = {k: [] for k in range(1, q + 1)}
    top_members_prev: set | None = None
    top_turnover = []
    for date in signal.index.intersection(fwd.index):
        s, r = signal.loc[date], fwd.loc[date]
        mask = s.notna() & r.notna()
        if mask.sum() < max(min_names, q):
            continue
        ranks = s[mask].rank(method="first")
        buckets = np.ceil(ranks / len(ranks) * q).astype(int).clip(1, q)
        for k in range(1, q + 1):
            sel = buckets == k
            if sel.any():
                per_bucket[k].append(float(r[mask][sel].mean()))
        top = set(buckets[buckets == q].index)
        if top_members_prev is not None and top:
            top_turnover.append(1.0 - len(top & top_members_prev) / len(top))
        top_members_prev = top
    means = {k: (float(np.mean(v)) if v else None) for k, v in per_bucket.items()}
    spread = None
    if means[q] is not None and means[1] is not None:
        spread = means[q] - means[1]
    return {"bucket_mean_return": means, "top_minus_bottom": spread,
            "top_quantile_turnover": float(np.mean(top_turnover)) if top_turnover else None}


def rank_turnover(signal: pd.DataFrame) -> float | None:
    """Mean absolute day-over-day change of the [0,1] rank-normalized signal."""
    ranks = signal.rank(axis=1, pct=True)
    diff = (ranks - ranks.shift(1)).abs()  # shift(+1): yesterday's rank, no lookahead
    vals = diff.stack().dropna()
    return float(vals.mean()) if len(vals) else None


def evaluate(df: pd.DataFrame, signal_col: str, close_col: str | None, ret_col: str | None,
             horizons: list[int], decay_lags: list[int], q: int, cost_bps: float,
             existing: list[str], min_names: int) -> dict:
    sig = df.pivot_table(index="date", columns="symbol", values=signal_col).sort_index()
    if close_col:
        close = df.pivot_table(index="date", columns="symbol", values=close_col).sort_index()
    else:
        ret = df.pivot_table(index="date", columns="symbol", values=ret_col).sort_index()
        close = (1 + ret.fillna(0)).cumprod()
    result: dict = {"dates": int(len(sig)), "symbols": int(sig.shape[1]), "horizons": {}, "decay": {},
                    "turnover": {}, "existing_factor_corr": {}}

    fwd_by_h = {}
    for h in horizons:
        fwd = close.shift(-h) / close - 1  # lookahead-ok: forward-return label for evaluation
        fwd_by_h[h] = fwd
        ic = xs_corr(sig, fwd, min_names, rank=False)
        ric = xs_corr(sig, fwd, min_names, rank=True)
        qr = quantile_returns(sig, fwd, q, min_names)
        spread = qr["top_minus_bottom"]
        result["horizons"][str(h)] = {
            "ic": ic_stats(ic),
            "rank_ic": ic_stats(ric),
            "quantiles": qr,
            "top_minus_bottom_annualized": None if spread is None else spread * ANNUAL / h,
        }

    base_h = horizons[0]
    for lag in decay_lags:
        lagged = sig.shift(lag)  # positive shift: older signal, no lookahead
        result["decay"][str(lag)] = ic_stats(xs_corr(lagged, fwd_by_h[base_h], min_names, rank=True))

    to = rank_turnover(sig)
    top_to = result["horizons"][str(base_h)]["quantiles"]["top_quantile_turnover"]
    # Round-trip cost: each unit of turnover is a sell and a buy at cost_bps each.
    drag_daily = None if top_to is None else top_to * 2 * cost_bps / 1e4
    result["turnover"] = {
        "rank_turnover_daily": to,
        "top_quantile_turnover_daily": top_to,
        "cost_bps_per_side": cost_bps,
        "implied_cost_drag_annual_top_quantile": None if drag_daily is None else drag_daily * ANNUAL,
    }
    for col in existing:
        other = df.pivot_table(index="date", columns="symbol", values=col).sort_index()
        corr = xs_corr(sig, other, min_names, rank=True)
        result["existing_factor_corr"][col] = ic_stats(corr)["mean"]
    return result


def fmt(x, nd=3):
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.{nd}f}"


def to_markdown(r: dict, signal: str) -> str:
    lines = [f"# Factor evaluation: {signal}", "",
             f"{r['dates']} dates × {r['symbols']} symbols.", "",
             "| horizon | IC mean | IC t | RankIC mean | RankIC t | hit rate | top-bottom (ann.) |", "|---|---|---|---|---|---|---|"]
    for h, s in r["horizons"].items():
        lines.append(f"| {h}d | {fmt(s['ic']['mean'])} | {fmt(s['ic']['t'], 2)} | {fmt(s['rank_ic']['mean'])} | "
                     f"{fmt(s['rank_ic']['t'], 2)} | {fmt(s['rank_ic']['hit_rate'], 2)} | {fmt(s['top_minus_bottom_annualized'], 4)} |")
    lines += ["", "IC decay (RankIC of the lagged signal vs the shortest horizon):", "",
              "| signal lag | RankIC | t |", "|---|---|---|"]
    for lag, s in r["decay"].items():
        lines.append(f"| {lag}d | {fmt(s['mean'])} | {fmt(s['t'], 2)} |")
    t = r["turnover"]
    lines += ["", f"- rank turnover: {fmt(t['rank_turnover_daily'])} per day; top-quantile membership turnover: "
                  f"{fmt(t['top_quantile_turnover_daily'])} per day",
              f"- implied cost drag on the top quantile at {t['cost_bps_per_side']} bps per side: "
                  f"{fmt(t['implied_cost_drag_annual_top_quantile'], 4)} per year"]
    if r["existing_factor_corr"]:
        lines += ["", "Cross-sectional rank correlation with existing factors:", ""]
        lines += [f"- {k}: {fmt(v)}" for k, v in r["existing_factor_corr"].items()]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv")
    ap.add_argument("--signal", required=True)
    ap.add_argument("--close", default="close", help="close-price column (default: close)")
    ap.add_argument("--ret", help="daily return column; used instead of --close when given")
    ap.add_argument("--date-col", default="date")
    ap.add_argument("--symbol-col", default="symbol")
    ap.add_argument("--horizons", default="1,5,21")
    ap.add_argument("--decay-lags", default="0,1,5,10,21")
    ap.add_argument("--quantiles", type=int, default=5)
    ap.add_argument("--cost-bps", type=float, default=10.0)
    ap.add_argument("--existing", default="", help="comma-separated existing factor columns")
    ap.add_argument("--min-names", type=int, default=10)
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--json")
    ap.add_argument("--markdown")
    args = ap.parse_args()

    df = pd.read_csv(args.csv)
    df = df.rename(columns={args.date_col: "date", args.symbol_col: "symbol"})
    df["date"] = pd.to_datetime(df["date"])
    if args.start:
        df = df[df["date"] >= pd.Timestamp(args.start)]
    if args.end:
        df = df[df["date"] <= pd.Timestamp(args.end)]
    horizons = [int(x) for x in args.horizons.split(",")]
    decay = [int(x) for x in args.decay_lags.split(",")]
    existing = [c.strip() for c in args.existing.split(",") if c.strip()]
    close_col = None if args.ret else args.close
    for col in [args.signal, *( [args.ret] if args.ret else [args.close]), *existing]:
        if col not in df.columns:
            raise SystemExit(f"column {col!r} not in {list(df.columns)}")
    result = evaluate(df, args.signal, close_col, args.ret, horizons, decay, args.quantiles,
                      args.cost_bps, existing, args.min_names)
    md = to_markdown(result, args.signal)
    print(md)
    if args.markdown:
        with open(args.markdown, "w") as fh:
            fh.write(md + "\n")
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(result, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
