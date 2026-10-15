---
name: backtest
description: Review, audit or run a trading-strategy backtest for methodological soundness - lookahead and survivorship checks (static scan plus perturbation and truncation probes), execution lag, transaction costs, point-in-time universe, subperiod stability - then interpret Sharpe, drawdown, turnover and capacity. Use for backtest reviews or when asked whether a backtest result is credible. Not for live deployment, dashboards, or alpha signal evaluation (see alpha-research).
---

# Backtest review

A number from a backtest is worth exactly as much as the methodology behind it.
Audit the methodology first; interpret results only if it holds.

## Part 1 — Methodology (before trusting any number)

1. **Static scan** of the backtest code for the patterns that most often leak the
   future (negative `shift`, centered rolling windows, backfill, `fit` before a
   train/test split, random splits on time series, no cost term, universe from
   today's constituents):

   ```bash
   python3 <skill-dir>/scripts/backtest_check.py path/to/backtest.py [more files or dirs]
   ```

   Exit code 1 means at least one error-level finding; fix or justify each one
   (`# lookahead-ok: <reason>` on a label line is the accepted justification).
2. **Perturbation and truncation probes** on the signal/weight function. The
   protocol: a Python function `f(df: DataFrame indexed by date, **kwargs) ->
   Series | DataFrame indexed by date`. The probe perturbs rows after a cut
   date and checks outputs up to the cut are unchanged, then recomputes on data
   truncated at the cut and checks equality — this catches full-sample
   statistics (z-scores, vol targets, hedge ratios fitted on everything):

   ```bash
   python3 <skill-dir>/scripts/lookahead_probe.py strategy/signals.py:build_signal \
       --input prices.csv --date-col date --cut 2023-06-30 --kwargs '{"lookback": 20}'
   ```
3. **Checklist** (`references/methodology-checklist.md`): signal timestamps
   strictly precede trade timestamps; point-in-time universe; costs and
   slippage with stated assumptions; corporate actions, dividends, delistings
   handled; no parameter tuned on the full sample including the "test" period.

## Part 2 — Results (only if Part 1 passes)

- Sharpe (annualized; state the convention), max drawdown and its duration,
  hit rate, turnover, capacity estimate.
- Attribution: how much comes from a handful of trades or one period? Remove
  the top five trades and recompute.
- Rolling / regime breakdown — stable edge or episodic?
- Net-of-cost vs gross: how much edge does the cost model eat?

## Part 3 — Verdict

SOUND (methodology holds, results credible) / FLAWED (name the fatal issue) /
INCONCLUSIVE (name the test that would decide). Include the specific numbers
behind the verdict. Never report a metric you did not compute or read from
actual output.
