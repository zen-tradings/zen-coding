---
description: Review a backtest for methodological soundness and interpret its results
argument-hint: "<path to backtest code/results> [or 'run it']"
---
Backtest review: $@

Part 1 — Methodology (before trusting any number):
- Signal timestamps strictly precede trade timestamps (execution lag modeled)
- Universe is point-in-time (no survivorship bias)
- Transaction costs and slippage included; state the assumptions
- Corporate actions, dividends, and delistings handled
- No parameter was tuned on the full sample including the "test" period

Part 2 — Results (only if Part 1 passes):
- Sharpe (annualized, state the convention), max drawdown and its duration,
  hit rate, turnover, capacity estimate
- Return attribution: how much comes from a handful of trades or one period?
- Rolling/regime breakdown — is the edge stable or episodic?
- Net-of-cost vs. gross: how much edge does the cost model eat?

Part 3 — Verdict:
One of: SOUND (methodology holds, results credible) / FLAWED (name the fatal
issue) / INCONCLUSIVE (what additional test would decide). Include the specific
numbers behind the verdict. Never report a metric you did not compute or read
from actual output.
