---
description: Alpha/factor research workflow — from hypothesis to IC, decay, turnover, and correlation with existing factors
argument-hint: "<hypothesis or factor idea>"
---
Research this alpha hypothesis: $@

Follow the full loop — do not skip steps to get to a positive result faster:

1. **State the hypothesis precisely.** Economic rationale (why should this predict
   returns?), expected sign, horizon, and the universe it applies to.
2. **Check the ledger first.** Search the codebase, docs, and `.zen/` traces for
   prior tests of this idea or close variants. If tried before, say so and build
   on it rather than redoing it.
3. **Construct the factor** with strict point-in-time discipline: every input must
   be knowable as of the signal date. State the lag structure explicitly.
4. **Evaluate:**
   - IC / RankIC vs. forward returns at the stated horizon, with t-stats
   - IC decay across horizons (1d, 5d, 21d as applicable)
   - Turnover and implied transaction-cost drag (state the cost assumption)
   - Correlation with standard factors (momentum, value, size, vol) and with any
     existing factor library in this repo
5. **Stress it.** Subperiods and regimes (high-vol vs. low-vol, crisis windows).
   A factor that only works in one regime must be labeled as such.
6. **Verdict:** genuine signal / likely already-covered variant / noise —
   with the numbers. A negative or null result is a valid, valuable deliverable;
   report it as clearly as a positive one.
