---
description: Replicate a quant research paper — extract methodology, implement, verify against reported numbers
argument-hint: "<paper title, arXiv ID, or URL>"
---
Replicate this paper: $@

1. **Get the paper.** Use the paper-search or alphaXiv MCP tools to fetch it.
   If the paper can't be found, stop and ask.
2. **Extract the methodology** into a spec before writing code:
   - Data: universe, sample period, sources, filters
   - Signal/factor construction: exact formulas, lookbacks, lags
   - Portfolio formation: sorts, weighting, rebalance frequency
   - Reported results: the headline numbers we need to match (tables/figures)
3. **Flag replication risks upfront:** data we don't have access to,
   ambiguous parameter choices, survivorship-prone universes, and any step where
   the paper is vague. List these before implementing.
4. **Implement** in small verifiable pieces (signal → sorts → portfolio stats),
   checking intermediate values against the paper's descriptive statistics
   (universe size, mean returns) where given.
5. **Compare** our numbers to the reported ones with a tolerance table:
   | metric | paper | ours | within tolerance? | plausible cause of gap |
6. **Verdict:** replicated / partially replicated / failed — with an honest
   account of which discrepancies are data limitations vs. implementation issues
   vs. possible overfitting in the original paper.
