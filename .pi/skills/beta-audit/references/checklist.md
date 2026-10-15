# Beta audit checklist

## Inputs
- [ ] Strategy returns are realized daily returns (net of costs if the claim is net).
- [ ] Factor returns are point-in-time; no survivorship in index baskets.
- [ ] Dates aligned; missing rows dropped (count reported), not forward-filled.
- [ ] Sample length ≥ 250 days for full-sample estimates; window ≥ 60 for rolling.

## Estimation
- [ ] One multivariate OLS on all factors, not sequential univariate fits.
- [ ] Standard errors reported (HAC / Newey-West when returns are autocorrelated).
- [ ] Rolling estimates are trailing only (window ends at `t`).

## Claims
For each neutrality claim record: factor, band, full-sample beta ± SE, 95% CI,
fraction of rolling windows inside the band, min/max rolling beta, split-sample
change, verdict.

Verdict rule used by `beta_audit.py`:
- PASS — 95% CI inside the band and ≥ 90% of rolling windows inside.
- FAIL — point estimate outside the band, or < 50% of rolling windows inside.
- INCONCLUSIVE — anything else (report what additional data would decide it).

## Output
```
| factor | beta | se | t | 95% CI | band | rolling inside | rolling min..max | verdict |
```
plus alpha (annualized, t-stat), R², residual vol (annualized), observations.
