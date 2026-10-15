#!/usr/bin/env python3
"""Verifier for research-features-lookahead: features must be strictly trailing; only the label may look ahead."""
import importlib.util
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.getcwd())
spec = importlib.util.spec_from_file_location("momentum_features", "research/momentum_features.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


rng = np.random.default_rng(42)
dates = pd.bdate_range("2024-01-01", periods=300)
close = pd.Series(100 * np.cumprod(1 + rng.normal(0, 0.01, 300)), index=dates)
df = pd.DataFrame({"close": close})
before = df.copy()
H = 5
out = m.add_features(df, horizon=H)
check(df.equals(before), "add_features must not mutate its input")
check(isinstance(out, pd.DataFrame), "add_features must return a DataFrame")
for col in ["ret_1", "mom_21", "vol_21", "target_fwd"]:
    check(col in out.columns, f"missing column {col}")

close_o = out["close"] if "close" in out.columns else close
ret1 = close.pct_change()
exp = {
    "ret_1": ret1,
    "mom_21": close / close.shift(21) - 1,
    "vol_21": ret1.rolling(21).std(),
    "target_fwd": close.shift(-H) / close - 1,  # lookahead-ok: label, this is the verifier
}
for col, series in exp.items():
    if col in out.columns:
        got = out[col].reindex(dates).to_numpy(dtype=float)
        want = series.to_numpy(dtype=float)
        ok = np.isclose(got, want, atol=1e-10, rtol=0, equal_nan=True)
        # allow NaN-vs-value at the warm-up/tail edges only if the agent chose a different NaN policy there
        core = ok | (np.isnan(got) & np.isnan(want))
        check(core.all(), f"{col}: {int((~core).sum())} value(s) differ from the definition (first at {dates[int(np.argmax(~core))].date()})")

# --- lookahead: features up to T must not move when later prices change ---------
T = dates[200]
pert = df.copy()
after = pert.index > T
pert.loc[after, "close"] = pert.loc[after, "close"].to_numpy() * rng.uniform(0.5, 1.5, int(after.sum()))
out_p = m.add_features(pert, horizon=H)
for col in ["ret_1", "mom_21", "vol_21"]:
    if col in out.columns and col in out_p.columns:
        a = out[col].loc[:T].to_numpy(dtype=float)
        b = out_p[col].loc[:T].to_numpy(dtype=float)
        same = np.isclose(a, b, atol=1e-12, rtol=0, equal_nan=True)
        check(same.all(), f"LOOKAHEAD: {col} changed at {dates[int(np.argmax(~same))].date()} when prices after {T.date()} were perturbed")
out_t = m.add_features(df.loc[:T], horizon=H)
for col in ["ret_1", "mom_21", "vol_21"]:
    if col in out.columns and col in out_t.columns:
        a = out[col].loc[:T].to_numpy(dtype=float)
        b = out_t[col].to_numpy(dtype=float)
        same = np.isclose(a, b, atol=1e-12, rtol=0, equal_nan=True)
        check(same.all(), f"LOOKAHEAD: {col} differs when the data ends at {T.date()}")

for f in fails:
    print("FAIL:", f)
print(f"{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
