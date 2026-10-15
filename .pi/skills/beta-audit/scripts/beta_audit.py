#!/usr/bin/env python3
"""Beta audit: regress a strategy's daily returns on factor returns.

Usage:
  python3 beta_audit.py returns.csv --strategy strat --factors SPY,semi,energy \
      [--date-col date] [--window 63] [--band -0.2 0.2] [--hac-lags 0] \
      [--json out.json] [--markdown out.md]

Input: a CSV with a date column (first column by default) and one column per
daily simple-return series (decimals). Rows with a missing value in any used
column are dropped (the count is reported). Columns not named are ignored.

All estimates are strictly trailing: the rolling estimate for date t uses rows
t-window+1 .. t only. Requires numpy and pandas.
"""
from __future__ import annotations

import argparse
import json
import math
import sys

import numpy as np
import pandas as pd

ANNUAL = 252


def ols(y: np.ndarray, X: np.ndarray, hac_lags: int = 0):
    """OLS with intercept already in X. Returns (beta, se, resid, r2)."""
    n, k = X.shape
    xtx_inv = np.linalg.pinv(X.T @ X)
    beta = xtx_inv @ X.T @ y
    resid = y - X @ beta
    if n <= k:
        return beta, np.full(k, np.nan), resid, np.nan
    if hac_lags > 0:
        xe = X * resid[:, None]
        S = xe.T @ xe
        for lag in range(1, hac_lags + 1):
            w = 1.0 - lag / (hac_lags + 1.0)
            G = xe[lag:].T @ xe[:-lag]
            S += w * (G + G.T)
        cov = xtx_inv @ S @ xtx_inv
    else:
        sigma2 = float(resid @ resid) / (n - k)
        cov = sigma2 * xtx_inv
    se = np.sqrt(np.maximum(np.diag(cov), 0.0))
    sst = float(((y - y.mean()) ** 2).sum())
    r2 = 1.0 - float(resid @ resid) / sst if sst > 0 else np.nan
    return beta, se, resid, r2


def rolling_betas(y: np.ndarray, X: np.ndarray, window: int) -> np.ndarray:
    """Trailing-window OLS betas; row t uses rows t-window+1..t. NaN before the first full window."""
    n, k = X.shape
    out = np.full((n, k), np.nan)
    for t in range(window - 1, n):
        sl = slice(t - window + 1, t + 1)
        out[t] = np.linalg.pinv(X[sl].T @ X[sl]) @ X[sl].T @ y[sl]
    return out


def verdict(beta: float, se: float, inside_frac: float | None, band: tuple[float, float] | None) -> str:
    if band is None or inside_frac is None or math.isnan(se):
        return "n/a"
    lo, hi = band
    ci_lo, ci_hi = beta - 1.96 * se, beta + 1.96 * se
    if not (lo <= beta <= hi) or inside_frac < 0.5:
        return "FAIL"
    if lo <= ci_lo and ci_hi <= hi and inside_frac >= 0.9:
        return "PASS"
    return "INCONCLUSIVE"


def audit(df: pd.DataFrame, strategy: str, factors: list[str], window: int,
          band: tuple[float, float] | None, hac_lags: int) -> dict:
    used = [strategy, *factors]
    missing = [c for c in used if c not in df.columns]
    if missing:
        raise SystemExit(f"columns not found: {missing}; available: {list(df.columns)}")
    clean = df[used].dropna()
    dropped = len(df) - len(clean)
    y = clean[strategy].to_numpy(dtype=float)
    F = clean[factors].to_numpy(dtype=float)
    X = np.column_stack([np.ones(len(y)), F])
    beta, se, resid, r2 = ols(y, X, hac_lags)
    n = len(y)

    roll = rolling_betas(y, X, window) if n >= window else np.full((n, len(factors) + 1), np.nan)
    half = n // 2
    result: dict = {
        "observations": n,
        "dropped_rows": dropped,
        "start": str(clean.index[0].date()) if hasattr(clean.index[0], "date") else str(clean.index[0]),
        "end": str(clean.index[-1].date()) if hasattr(clean.index[-1], "date") else str(clean.index[-1]),
        "window": window,
        "hac_lags": hac_lags,
        "band": list(band) if band else None,
        "alpha_annual": float(beta[0] * ANNUAL),
        "alpha_t": float(beta[0] / se[0]) if se[0] > 0 else None,
        "r2": None if math.isnan(r2) else float(r2),
        "strategy_vol_annual": float(y.std(ddof=1) * math.sqrt(ANNUAL)) if n > 1 else None,
        "residual_vol_annual": float(resid.std(ddof=1) * math.sqrt(ANNUAL)) if n > 1 else None,
        "factors": {},
    }
    for i, f in enumerate(factors, start=1):
        rb = roll[:, i]
        valid = rb[~np.isnan(rb)]
        inside = float(np.mean((valid >= band[0]) & (valid <= band[1]))) if band and len(valid) else None
        b1, _, _, _ = ols(y[:half], X[:half], 0) if half > len(factors) + 2 else (np.full(len(factors) + 1, np.nan),) * 4
        b2, _, _, _ = ols(y[half:], X[half:], 0) if n - half > len(factors) + 2 else (np.full(len(factors) + 1, np.nan),) * 4
        result["factors"][f] = {
            "beta": float(beta[i]),
            "se": float(se[i]),
            "t": float(beta[i] / se[i]) if se[i] > 0 else None,
            "ci95": [float(beta[i] - 1.96 * se[i]), float(beta[i] + 1.96 * se[i])],
            "rolling_windows": int(len(valid)),
            "rolling_min": float(valid.min()) if len(valid) else None,
            "rolling_max": float(valid.max()) if len(valid) else None,
            "rolling_mean": float(valid.mean()) if len(valid) else None,
            "rolling_latest": float(valid[-1]) if len(valid) else None,
            "rolling_inside_band": inside,
            "first_half_beta": None if math.isnan(b1[i]) else float(b1[i]),
            "second_half_beta": None if math.isnan(b2[i]) else float(b2[i]),
            "verdict": verdict(float(beta[i]), float(se[i]), inside, band),
        }
    result["rolling"] = {
        str(idx.date() if hasattr(idx, "date") else idx): {f: (None if math.isnan(roll[t, i]) else float(roll[t, i]))
                                                          for i, f in enumerate(factors, start=1)}
        for t, idx in enumerate(clean.index) if not math.isnan(roll[t, 1])
    }
    return result


def fmt(x, nd=3):
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.{nd}f}"


def to_markdown(r: dict, strategy: str) -> str:
    lines = [f"# Beta audit: {strategy}", "",
             f"Sample {r['start']} .. {r['end']}, {r['observations']} observations "
             f"({r['dropped_rows']} rows dropped for missing data), rolling window {r['window']}, "
             f"HAC lags {r['hac_lags']}, band {r['band'] or 'none'}.", "",
             "| factor | beta | se | t | 95% CI | rolling inside band | rolling min..max | 1st half → 2nd half | verdict |",
             "|---|---|---|---|---|---|---|---|---|"]
    for f, s in r["factors"].items():
        inside = "n/a" if s["rolling_inside_band"] is None else f"{s['rolling_inside_band']:.0%} of {s['rolling_windows']}"
        lines.append(f"| {f} | {fmt(s['beta'])} | {fmt(s['se'])} | {fmt(s['t'], 2)} | "
                     f"[{fmt(s['ci95'][0])}, {fmt(s['ci95'][1])}] | {inside} | "
                     f"{fmt(s['rolling_min'])}..{fmt(s['rolling_max'])} | "
                     f"{fmt(s['first_half_beta'])} → {fmt(s['second_half_beta'])} | {s['verdict']} |")
    lines += ["",
              f"- alpha: {r['alpha_annual']:.2%} annualized (t = {fmt(r['alpha_t'], 2)})",
              f"- R²: {fmt(r['r2'])}",
              f"- strategy vol: {fmt(r['strategy_vol_annual'])} annualized; residual vol: {fmt(r['residual_vol_annual'])} annualized",
              "",
              "Verdict rule: PASS = 95% CI inside the band and ≥ 90% of rolling windows inside; "
              "FAIL = point estimate outside the band or < 50% of windows inside; otherwise INCONCLUSIVE."]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv")
    ap.add_argument("--strategy", required=True)
    ap.add_argument("--factors", help="comma-separated factor columns (default: every other column)")
    ap.add_argument("--date-col", help="date column (default: first column)")
    ap.add_argument("--window", type=int, default=63)
    ap.add_argument("--band", nargs=2, type=float, metavar=("LO", "HI"), help="neutrality band, e.g. --band -0.2 0.2")
    ap.add_argument("--hac-lags", type=int, default=0, help="Newey-West lags for standard errors (0 = classical)")
    ap.add_argument("--json")
    ap.add_argument("--markdown")
    args = ap.parse_args()

    df = pd.read_csv(args.csv)
    date_col = args.date_col or df.columns[0]
    df[date_col] = pd.to_datetime(df[date_col])
    df = df.sort_values(date_col).set_index(date_col)
    factors = [f.strip() for f in args.factors.split(",")] if args.factors else [c for c in df.columns if c != args.strategy]
    band = (args.band[0], args.band[1]) if args.band else None
    if band and band[0] > band[1]:
        raise SystemExit("--band LO must be <= HI")

    result = audit(df, args.strategy, factors, args.window, band, args.hac_lags)
    md = to_markdown(result, args.strategy)
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
