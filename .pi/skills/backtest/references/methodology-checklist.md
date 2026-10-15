# Backtest methodology checklist

## Timing
- [ ] Signal at `t` uses data with timestamps `<= t`; the trade happens at `t+1`
      (or later) at a price that was not used to form the signal.
- [ ] No centered rolling windows, no negative shifts outside labels, no backfill.
- [ ] Rebalance frequency matches the signal horizon.

## Universe
- [ ] Membership is point-in-time and includes delisted / acquired names.
- [ ] Minimum liquidity filters use trailing data only.

## Costs
- [ ] Commission, spread/slippage and borrow (for shorts) are modelled, with the
      assumption stated in bps; results shown gross and net.
- [ ] Turnover is reported and consistent with the cost drag.

## Data
- [ ] Prices adjusted for splits/dividends as of the ex-date; total-return where
      dividends matter.
- [ ] Fundamentals lagged to filing dates; estimates to revision dates.
- [ ] Missing-data handling stated (dropping NaN rows can silently delete the
      worst days).

## Statistics
- [ ] Out-of-sample or walk-forward period untouched by parameter choice.
- [ ] Number of variants tried is recorded (multiple-testing adjustment).
- [ ] Headline metrics survive removing the top five trades; block-bootstrap CI.

## Probes
- [ ] `backtest_check.py` exits 0 or every finding is justified.
- [ ] `lookahead_probe.py` passes both the perturbation and the truncation test.
