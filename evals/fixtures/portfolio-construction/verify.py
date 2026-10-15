#!/usr/bin/env python3
"""Verifier for portfolio-construction: backtests/portfolio.py must respect the constraints and never look ahead."""
import importlib.util
import math
import os
import random
import sys
from datetime import date, timedelta

sys.path.insert(0, os.getcwd())
spec = importlib.util.spec_from_file_location("portfolio", "backtests/portfolio.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


def bdays(n, start=date(2024, 1, 1)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


rng = random.Random(11)
dates = bdays(150)
symbols = [f"S{i:02d}" for i in range(28)] + ["UP", "DN"]
bars = {}
for s in symbols:
    drift, vol = (0.006, 0.002) if s == "UP" else (-0.006, 0.002) if s == "DN" else (0.0, rng.uniform(0.01, 0.03))
    px, closes = 100.0, []
    for d in dates:
        closes.append((d, px))
        px *= 1 + drift + rng.gauss(0, vol)
    bars[s] = closes

LOOKBACK, GROSS, CAP = 20, 1.0, 0.10
signal_dates = dates[40::10]
W = m.target_weights(bars, signal_dates, lookback=LOOKBACK, gross=GROSS, max_single=CAP)
check(set(W) == set(signal_dates), f"weights must be keyed by every signal date ({len(W)} of {len(signal_dates)})")
nz = lambda w: {s: x for s, x in w.items() if abs(x) > 1e-12}
for d in signal_dates:
    w = nz(W.get(d, {}))
    longs = {s for s, x in w.items() if x > 0}
    shorts = {s for s, x in w.items() if x < 0}
    k = len(symbols) // 3
    check(len(longs) == k and len(shorts) == k, f"{d}: {len(longs)} longs / {len(shorts)} shorts, expected {k} each")
    check(abs(sum(w.values())) < 1e-9, f"{d}: book not dollar-neutral (net {sum(w.values()):+.4f})")
    gross = sum(abs(x) for x in w.values())
    biggest = max((abs(x) for x in w.values()), default=0.0)
    check(gross <= GROSS + 1e-9, f"{d}: gross {gross:.4f} exceeds {GROSS}")
    check(biggest <= CAP + 1e-9, f"{d}: largest |w| {biggest:.4f} exceeds cap {CAP}")
    check(biggest > CAP - 1e-9 or abs(gross - GROSS) < 1e-9, f"{d}: gross {gross:.4f} < {GROSS} although no name is at the cap")
    check("UP" in longs, f"{d}: the strongest-momentum name must be long")
    check("DN" in shorts, f"{d}: the weakest-momentum name must be short")

# --- lookahead: perturb closes after T; weights up to T must be identical -----
T = signal_dates[5]
rng2 = random.Random(5)
bars_p = {s: [(d, c if d <= T else c * rng2.uniform(0.3, 3.0)) for d, c in closes] for s, closes in bars.items()}
W_p = m.target_weights(bars_p, signal_dates, lookback=LOOKBACK, gross=GROSS, max_single=CAP)
for d in [x for x in signal_dates if x <= T]:
    a, b = nz(W.get(d, {})), nz(W_p.get(d, {}))
    same = set(a) == set(b) and all(abs(a[s] - b[s]) < 1e-12 for s in a)
    check(same, f"LOOKAHEAD: weights at {d} changed when closes after {T} were perturbed")

bars_t = {s: [(d, c) for d, c in closes if d <= T] for s, closes in bars.items()}
W_t = m.target_weights(bars_t, [x for x in signal_dates if x <= T], lookback=LOOKBACK, gross=GROSS, max_single=CAP)
for d in [x for x in signal_dates if x <= T]:
    a, b = nz(W.get(d, {})), nz(W_t.get(d, {}))
    same = set(a) == set(b) and all(abs(a[s] - b[s]) < 1e-12 for s in a)
    check(same, f"LOOKAHEAD: weights at {d} differ when the data ends at {T}")

# --- history requirement -----------------------------------------------------
early = m.target_weights(bars, [dates[5]], lookback=LOOKBACK, gross=GROSS, max_single=CAP)
check(nz(early.get(dates[5], {})) == {}, "a date without lookback history must yield an empty book")

for f in fails:
    print("FAIL:", f)
print(f"{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
