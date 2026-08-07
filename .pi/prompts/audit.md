---
description: Adversarial audit — attack a strategy, backtest, or research finding and try to falsify it
argument-hint: "<path or description of what to audit>"
---
Adversarially audit: $@

Your job is to BREAK this work, not to summarize or praise it. Assume it is wrong
until proven otherwise. Check, in rough order of how often each kills real
strategies:

1. **Lookahead bias** — any input knowable only after the decision timestamp:
   shifted indices, restated fundamentals, delisting-free universes, features
   computed over windows that cross the signal date.
2. **Overfitting / multiple testing** — how many variants were tried to get here?
   Is there an honest held-out period? Would the result survive a deflated-Sharpe
   or Bonferroni-style adjustment?
3. **Cost & capacity reality** — turnover × realistic spread/impact vs. gross
   edge. Can this trade the claimed size in the claimed names?
4. **Regime dependence** — does performance concentrate in one period or one
   macro regime? What happens in 2008/2020-style windows?
5. **Statistical fragility** — are headline metrics driven by a handful of
   observations? Check with the top-5 trades removed or with block bootstrap CIs.
6. **Implementation traps** — survivorship in the universe, corporate-action
   handling, timezone/calendar alignment, NaN handling that silently drops the
   worst days.

Deliverable: a numbered list of findings, each rated FATAL / SERIOUS / MINOR,
with the evidence. If you find nothing after genuinely trying, say what you
checked — "looks fine" without enumerated checks is not an acceptable verdict.
