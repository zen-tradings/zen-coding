---
description: Portfolio construction — build or review an allocation given signals, constraints, and risk model
argument-hint: "<objective and constraints, or path to existing construction code>"
---
Portfolio construction task: $@

1. **Clarify the objective before optimizing.** Max expected return at target vol?
   Min tracking error? Max Sharpe net of costs? If the request is ambiguous, ask.
2. **Inventory the inputs:** alpha signals (with their ICs/horizons), risk model or
   covariance estimator, constraints (position limits, sector bands, turnover cap,
   gross/net limits), cost model.
3. **Build or review the optimizer:**
   - Objective and constraints match the stated goal — flag mismatches
   - Covariance: shrinkage or factor structure? Sample covariance with more assets
     than observations is a red flag
   - Constraint feasibility: can all constraints hold simultaneously?
4. **Sanity-check the output portfolio:** top positions, sector/factor tilts,
   turnover vs. the signals' decay horizon, leverage, concentration (HHI or top-10
   weight). An optimizer is a signal multiplier for estimation error — extreme
   weights mean the inputs are being over-trusted.
5. **Report:** expected vs. realized-risk tradeoff, cost drag at the implied
   turnover, and the 3 positions that contribute most to active risk.
