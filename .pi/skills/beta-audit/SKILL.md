---
name: beta-audit
description: Audit a strategy's or portfolio's factor exposures from its return series - regress returns on market, sector and style factors, report betas with standard errors, rolling-window drift, residual risk, and verify each neutrality or hedging claim. Use for beta audits, hedge verification and exposure checks on a return series. Not for dashboards, deployment, data cleaning, or alpha signal research.
---

# Beta audit

Decompose a strategy's returns into factor exposures and decide, with numbers,
whether its neutrality claims hold. A beta of 0.05 ± 0.20 is not "neutral".

Everything here is strictly trailing: a rolling estimate for date `t` uses
returns up to `t` only. Never hedge-ratio on the same sample you then use to
claim neutrality — that is in-sample bias, the most common way a beta audit
fools its author.

## Procedure

1. **Identify the claims.** What is the strategy supposed to be neutral to
   (market, sector, size, momentum, rates, ...)? Quote the code or config that
   makes the claim (beta bands, hedge rules, constraint layers).
2. **Assemble aligned daily returns.** One CSV, one row per date, one column per
   series: the strategy (or portfolio) and every relevant factor. Factor returns
   must be point-in-time (no restated index membership). Strategy returns must be
   *realized* returns, not weights × today's factor loadings.
3. **Run the audit script** (needs numpy and pandas):

   ```bash
   python3 <skill-dir>/scripts/beta_audit.py returns.csv \
       --strategy strat --factors SPY,semi,energy,indu \
       --window 63 --band -0.2 0.2 --hac-lags 5 \
       --markdown beta_audit.md --json beta_audit.json
   ```

   It prints full-sample betas with standard errors and t-stats (Newey-West when
   `--hac-lags` > 0), rolling-window drift (min/max/mean, fraction of windows
   inside the band, first-half vs second-half), alpha, R², residual volatility,
   and a PASS / FAIL / INCONCLUSIVE verdict per factor when a band is given.
4. **Check stability yourself.** A hedge that works on average but drifts is a
   failed hedge: look at the rolling min/max and the split-sample change, not
   just the full-sample point estimate.
5. **Check residual risk.** After removing targeted exposures, what remains?
   Report residual vol and R². If holdings are available, name the three
   positions contributing most to residual variance; if not, say so.
6. **Verdict.** For each claim: PASS / FAIL / INSUFFICIENT DATA with the numbers
   that justify it. Do not soften a FAIL.

## Failure modes to check explicitly

- Hedge ratio estimated on the same sample used to claim neutrality.
- Exposure computed on weights instead of realized returns.
- Stale loadings after corporate actions or regime shifts (compare windows).
- Sequential univariate regressions on correlated factors (double counting) —
  use one multivariate fit, as `beta_audit.py` does.
- Fewer than ~60 observations per window, or a window that straddles a
  strategy change.

See `references/checklist.md` for the full checklist and the output format.
