---
description: Beta/exposure audit of a strategy or portfolio — decompose returns into factor exposures and verify hedging claims
argument-hint: "<path-or-description of strategy/portfolio>"
---
Perform a beta audit on: $@

Work through these steps in order, showing intermediate numbers:

1. **Identify the claims.** What is this strategy/portfolio supposed to be neutral
   to? (market beta, sector, size, momentum, rates, …) Quote the relevant code or
   docs.
2. **Compute realized exposures.** Regress returns on the relevant factor returns
   (or load the exposure matrix directly if one exists in the codebase). Report
   point estimates AND standard errors — a beta of 0.05 ± 0.20 is not "neutral".
3. **Check stability over time.** Rolling-window or split-sample exposures. A
   hedge that works on average but drifts is a failed hedge.
4. **Check residual risk.** After removing targeted exposures, what remains?
   Report residual vol and its largest contributors.
5. **Verdict.** For each neutrality claim: PASS / FAIL / INSUFFICIENT DATA, with
   the numbers that justify it. Do not soften a FAIL.

Common failure modes to check explicitly:
- Hedge ratio estimated on the same sample used to claim neutrality (in-sample bias)
- Exposure computed on weights rather than realized returns
- Stale factor loadings (corporate actions, regime shifts)
