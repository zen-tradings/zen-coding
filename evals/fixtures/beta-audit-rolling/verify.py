#!/usr/bin/env python3
"""Verifier for beta-audit-rolling: backtests/beta_audit.py must recover known exposures and never look ahead."""
import importlib.util
import math
import os
import random
import sys
from datetime import date, timedelta

sys.path.insert(0, os.getcwd())
spec = importlib.util.spec_from_file_location("beta_audit", "backtests/beta_audit.py")
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


rng = random.Random(7)
dates = bdays(400)
f1 = {d: rng.gauss(0.0004, 0.01) for d in dates}
f2 = {d: rng.gauss(0.0002, 0.012) for d in dates}
strat = {d: 0.0002 + 0.3 * f1[d] - 0.1 * f2[d] + rng.gauss(0, 0.003) for d in dates}
factors = {"f1": f1, "f2": f2}

# --- full sample recovers the construction ---------------------------------
fs = m.full_sample(strat, factors)
check(fs is not None and fs.get("n") == 400, f"full_sample n={fs and fs.get('n')}")
if fs:
    check(abs(fs["betas"]["f1"] - 0.3) < 0.05, f"beta f1 {fs['betas']['f1']:.3f} != 0.3")
    check(abs(fs["betas"]["f2"] + 0.1) < 0.05, f"beta f2 {fs['betas']['f2']:.3f} != -0.1")
    check(all(v > 0 for v in fs["se"].values()), f"standard errors must be positive: {fs['se']}")
    check(0 < fs["r2"] <= 1, f"r2 {fs['r2']}")
check(m.full_sample({d: strat[d] for d in dates[:10]}, factors) is None, "fewer than 20 dates must return None")

# --- rolling: trailing windows only -----------------------------------------
W = 60
roll = m.rolling_betas(strat, factors, W)
check(set(roll) <= set(dates), "rolling keys must be dates of the sample")
check(len(roll) == 400 - W + 1, f"rolling has {len(roll)} entries, expected {400 - W + 1}")
check(dates[W - 1] in roll and dates[W - 2] not in roll, "first rolling entry must be the W-th date")
t = dates[250]
if t in roll:
    sl = dates[250 - W + 1: 251]
    ref = m.full_sample({d: strat[d] for d in sl}, {k: {d: v[d] for d in sl} for k, v in factors.items()})
    check(all(abs(roll[t][k] - ref["betas"][k]) < 1e-9 for k in factors),
          f"rolling beta at {t} must equal the full-sample fit over the trailing {W} dates")

# --- lookahead: perturb the future, outputs up to T must not move ------------
T = dates[250]
rng2 = random.Random(99)
pert = lambda s: {d: (v if d <= T else v * rng2.uniform(-2, 2) + rng2.gauss(0, 0.01)) for d, v in s.items()}
roll_p = m.rolling_betas(pert(strat), {k: pert(v) for k, v in factors.items()}, W)
moved = [d for d in roll if d <= T and (d not in roll_p or any(abs(roll[d][k] - roll_p[d][k]) > 1e-12 for k in factors))]
check(not moved, f"LOOKAHEAD: rolling betas changed for {len(moved)} date(s) <= {T} when later data was perturbed (first: {moved[:1]})")

trunc = lambda s: {d: v for d, v in s.items() if d <= T}
roll_t = m.rolling_betas(trunc(strat), {k: trunc(v) for k, v in factors.items()}, W)
check(set(roll_t) == {d for d in roll if d <= T}, "truncated sample must yield exactly the rolling dates <= T")
moved = [d for d in roll_t if any(abs(roll[d][k] - roll_t[d][k]) > 1e-12 for k in factors)]
check(not moved, f"LOOKAHEAD: rolling betas on data ending at {T} differ from the full-sample values ({len(moved)} date(s))")

# --- audit verdicts ----------------------------------------------------------
a = m.audit(strat, factors, (-0.2, 0.2), W)
check(a["verdict"].get("f1") == "FAIL", f"f1 (beta 0.3) must FAIL a [-0.2, 0.2] band, got {a['verdict'].get('f1')}")
check(a["verdict"].get("f2") == "PASS", f"f2 (beta -0.1) must PASS a [-0.2, 0.2] band, got {a['verdict'].get('f2')} "
                                         f"(inside fraction {a['inside_band_fraction'].get('f2')})")
check(a["inside_band_fraction"].get("f2", 0) >= 0.9, "f2 rolling betas must be inside the band >= 90% of windows")
check(a["inside_band_fraction"].get("f1", 1) < 0.5, "f1 rolling betas must be outside the band most of the time")

for f in fails:
    print("FAIL:", f)
print(f"{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
