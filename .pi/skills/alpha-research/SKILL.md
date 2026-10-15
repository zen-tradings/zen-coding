---
name: alpha-research
description: Evaluate a cross-sectional alpha signal or factor from hypothesis to verdict - point-in-time construction checks, IC and RankIC with t-stats, IC decay across horizons, quantile spreads, turnover and implied cost drag, and correlation with existing factors. Use when researching, testing or comparing alpha signals or factors on a panel of symbols. Not for dashboards, deployment, WorldQuant BRAIN expressions (see wq-alpha-research), or beta/exposure audits (see beta-audit).
---

# Alpha research

From hypothesis to a verdict with numbers. A null result reported clearly is a
valid deliverable; a positive result produced by skipping steps is not.

## Procedure

1. **State the hypothesis precisely.** Economic rationale, expected sign,
   horizon, universe. Write it down before touching data.
2. **Check the ledger.** Search the repository (and prior notes) for earlier
   tests of this idea or close variants. Build on them instead of redoing them.
3. **Construct the signal point-in-time.** Every input must be knowable at the
   signal date. State the lag structure explicitly (e.g. fundamentals lagged to
   their filing date, prices as of the close). Only *labels* (forward returns)
   may look ahead, and only on lines annotated `# lookahead-ok: label` — the
   guardrails block any other negative shift in research code.
4. **Evaluate with the script** (needs numpy and pandas). Input is a long CSV
   with one row per (date, symbol): `date,symbol,signal,close` (column names are
   configurable; `--ret` lets you pass daily returns instead of prices):

   ```bash
   python3 <skill-dir>/scripts/factor_eval.py panel.csv \
       --signal signal --horizons 1,5,21 --quantiles 5 --cost-bps 10 \
       --existing momentum,value --markdown factor_eval.md --json factor_eval.json
   ```

   Output: per-horizon IC / RankIC mean, std, t-stat and hit rate; IC decay by
   signal lag; quantile returns and the top-minus-bottom spread (annualized);
   daily rank turnover, top-quantile membership turnover and the implied
   round-trip cost drag at the given bps; cross-sectional correlation with
   existing factor columns.
5. **Stress it.** Subperiods and regimes (high-vol vs low-vol, crisis
   windows): run the script on date slices (`--start/--end`) and compare. A
   signal that only works in one regime must be labelled as such.
6. **Verdict:** genuine signal / likely a variant of an existing factor / noise,
   with the numbers. Report cost-adjusted spread, not just gross IC.

## Rules of thumb

- |IC| t-stat below 2 over fewer than ~250 dates is noise until proven otherwise.
- A spread that disappears at 10 bps round-trip cost is not tradeable at the
  stated turnover.
- Correlation above ~0.7 with an existing factor means you have a variant, not
  a new signal.
- Survivorship: a universe built from today's constituents inflates everything;
  the guardrails warn on common patterns, but check the universe source yourself.

See `references/point-in-time.md` for the lag conventions.
