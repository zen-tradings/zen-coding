# Point-in-time conventions

| Input | Knowable at | Lag to apply |
|---|---|---|
| Close price on day t | after the close of t | signal at t trades at t+1 open/close at the earliest |
| Volume on day t | after the close of t | same as close |
| Quarterly fundamentals | filing date (not period end) | lag to the filing date; if unknown, period end + 90 days |
| Analyst estimates | revision timestamp | use the revision date, never the consensus "as of today" |
| Index membership | announcement/effective date | use historical constituents including delisted names |
| Corporate actions | ex-date | adjust prices as of the ex-date only |

## Forward returns (labels)

`fwd_h[t] = close[t+h] / close[t] - 1` is a label and legitimately uses future
rows. Mark the line: `# lookahead-ok: forward-return label`. Everything else in
the pipeline must be computable with rows `<= t`.

## Self-checks

- Perturbation test: change prices after date T and confirm signals up to T are
  unchanged (`backtest` skill, `scripts/lookahead_probe.py`).
- Truncation test: compute signals on data truncated at T and confirm they equal
  the full-sample signals up to T — this catches full-sample z-scoring and
  other "global statistics" leaks that a perturbation test alone can miss.
