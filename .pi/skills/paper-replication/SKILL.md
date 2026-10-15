---
name: paper-replication
description: Replicate a quantitative finance paper end to end - fetch it, extract the methodology into a written spec, flag data and ambiguity risks before coding, implement signal, portfolio and statistics in verifiable pieces, and compare against the paper's reported numbers with a tolerance table and an honest verdict. Use when asked to replicate, reproduce or verify a paper's results. Not for literature search alone, dashboards, or deployment.
---

# Paper replication

Replication is a measurement, not a demo. The deliverable is the gap between
the paper's numbers and ours, with the plausible cause of each gap.

## Procedure

1. **Get the paper.** Use the paper-search or alphaXiv connectors (codemode
   scripts: `searchTools("paper")`), or the user's PDF. If it cannot be found,
   stop and ask — do not replicate from memory of the abstract.
2. **Write the spec before any code** using
   `references/replication-spec-template.md`: data (universe, period, sources,
   filters), signal construction (exact formulas, lookbacks, lags), portfolio
   formation (sorts, weighting, rebalance), the headline numbers to match
   (tables/figures), and every ambiguity with the choice you make for it.
   Save it as `<paper-dir>/replication/spec.md` and show it to the user.
3. **Flag replication risks upfront:** data we lack (CRSP vs Yahoo, delisting
   returns), survivorship-prone universes, vague parameters, and whether the
   paper reports gross or net of costs. List them in the spec.
4. **Implement in small verifiable pieces** — `signal.py` → `portfolio.py` →
   `backtest.py` — checking intermediate values against the paper's descriptive
   statistics (universe size, mean returns, number of positions) where given.
   Research-code guardrails apply: no negative shifts outside annotated labels,
   no `inplace=True`, state the cost assumption. Run the `backtest` skill's
   `backtest_check.py` and `lookahead_probe.py` on the signal function.
5. **Compare** with the tolerance table. Put the paper's metrics in
   `paper_metrics.json` and ours in `our_metrics.json` (flat `{metric: number}`)
   and run:

   ```bash
   python3 <skill-dir>/scripts/compare_metrics.py paper_metrics.json our_metrics.json \
       --rel 0.15 --tol sharpe=0.2 --tol max_drawdown=0.05 --markdown benchmark.md
   ```

   Absolute tolerances (`--tol name=value`) override the default relative
   tolerance; the script prints the table and a verdict.
6. **Verdict:** replicated / partially replicated / failed, with an honest
   account of which discrepancies are data limitations vs implementation
   issues vs possible overfitting in the original paper. A replication that
   matches too cleanly is suspicious — say so.

## What not to do

- Do not tune parameters until the replication "matches": that is overfitting
  to the paper, not replication.
- Do not add costs the paper did not model when the goal is to reproduce its
  numbers; report net-of-cost as a separate line.
- Do not declare a paper wrong from one replication; frame divergences as
  questions with evidence.

Output contract: `<paper-dir>/replication/` containing `spec.md`, `signal.py`,
`portfolio.py`, `backtest.py`, `our_metrics.json`, `benchmark.md`.
