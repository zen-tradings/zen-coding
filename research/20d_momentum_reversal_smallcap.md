# Alpha Research: 20-Day Momentum Reversal in Small-Cap Equities

**Hypothesis:** Stocks in the small-cap universe that have performed strongly (weakly) over the past ~20 trading days will underperform (outperform) over the next short-term horizon. This is a **short-term return reversal** (a.k.a. "short-term reversal" or STR) factor, applied specifically to small-cap equities.

**Expected sign:** Negative — high 20-day past returns → low future returns.

**Horizon:** 1–5 days (signal decays rapidly; classic monthly studies used skip-1-month formation, which is smoother and less microstructure-contaminated).

**Universe:** Small-cap equities (bottom ~20–30% by market cap, or Russell 2000 constituents).

**⚠️ Critical Preface:** This is a literature-based synthesis. We do not have live backtest data or WorldQuant BRAIN access for this workspace. The original draft of this report contained unsupported numeric ranges and overstated causal claims. This corrected version removes fabricated precision, adds omitted contradictory evidence, and downgrades the verdict accordingly.

---

## 1. Economic Rationale — And Why It Might Be an Illusion

Short-term reversal in small caps has multiple, **mutually inconsistent** explanations in the literature. The report must present all of them, including the ones that say the profits are not real.

### 1.1 Mechanisms That Support Reversal

| Mechanism | Description | Why Small Caps Amplify It |
|-----------|-------------|---------------------------|
| **Overreaction / Liquidity Feedback** | Retail/algorithmic buying drives prices past fundamental value in the short run; subsequent correction. | Small caps have lower float, wider spreads, and less institutional absorption of order flow. |
| **Inventory Risk / Liquidity Provision** | Market makers demand compensation for absorbing transient order flow; prices rebound after liquidity pressure subsides. | Higher adverse-selection risk in small caps increases the required rebound. |
| **Delayed Arbitrage / Limits to Arbitrage** | Shorting small caps is expensive (high borrow fees, low availability), preventing rapid correction of overpricing. | Hard-to-borrow small caps may exhibit stronger apparent reversal (Nagel 2012 tests broad market, not small-cap-specific). |
| **Microstructure Noise** | Non-informational trading creates transient price deviations that mean-revert quickly. | Lower signal-to-noise ratio in small caps. |

**Important caveat on Campbell, Grossman & Wang (1993):** Their model is an **aggregate time-series** theory of a single risky asset with risk-averse market makers. It explains why *market-wide* volume predicts *market-wide* reversals. It does **not** model the cross-section of stock returns or justify a cross-sectional small-cap rank signal. Using it as a "key theoretical paper" for stock-level small-cap reversal is a category error.

### 1.2 Mechanisms That Challenge Reversal

| Mechanism | Description | Implication for This Factor |
|-----------|-------------|----------------------------|
| **Measurement Error / Cross-Sectional Expected Returns (Conrad & Kaul 1998)** | Contrarian profits may reflect persistent differences in unconditional expected returns across stocks, not time-series overreaction or liquidity provision. | The "factor" may not be predictive at all — it may be a mismeasurement of the cross-section of mean returns. If Conrad & Kaul are even partially right, the raw 20-day return rank contains no alpha. |
| **Bid-Ask Bounce (Roll 1984; Blume & Stambaugh 1983)** | Even tiny bid-ask spreads generate substantial negative autocorrelation in transaction-price returns. For small caps with 50–100bp spreads, a **dominant fraction** of measured "reversal" may be spurious microstructure noise, not behavioral overreaction. | The signal could be almost entirely an illusion. Using VWAP or mid-quote "reduces contamination" but the report cannot quantify how much of the signal survives this correction. |
| **Lead-Lag Cross-Autocorrelation (Lo & MacKinlay 1988, 1990)** | Portfolio-level contrarian profits can arise from **delayed reaction of small stocks to news in large stocks**, not from individual-stock overreaction. | A 20-day small-cap reversal factor that doesn't control for industry or large-cap lead-lag effects may be capturing **stale information diffusion**, not overreaction. |
| **Sample Sensitivity (Knez & Ready 1997)** | Many anomalies, including short-term reversal, are **sensitive to sample period, weighting scheme, and outlier treatment**. STR is weaker or absent in value-weighted samples and post-1990 data. | The equal-weight, pre-2000 results that make STR look robust may not generalize to the modern small-cap universe. |

**Bottom line on rationale:** The economic case for STR is **contested, not settled**. The three most damaging challenges are (1) Conrad & Kaul's measurement-error critique, (2) Roll's bid-ask-bounce critique, and (3) Lo & MacKinlay's lead-lag alternative. Any implementation must address all three before treating the signal as genuine.

---

## 2. Literature Review — Supportive and Challenging

### 2.1 Foundational Supportive Papers

1. **Lehmann (1990)** — "Fads, Martingales, and Market Efficiency"
   - Documents negative weekly autocorrelation in NYSE/AMEX stocks.
   - Attributes it to short-term overreaction; strongest in small, illiquid names.
   - **Caveat:** Uses weekly data and equal-weight portfolios. Value-weight results are weaker.

2. **Jegadeesh (1990)** — "Evidence of Predictable Behavior of Security Returns"
   - Shows short-term (1-month) reversal and medium-term (3–12 month) momentum coexist.
   - Reversal is robust after controlling for size and January effects.
   - **Caveat:** Uses monthly CRSP data, not daily 20-day rolling windows. The statistical properties differ.

3. **Jegadeesh & Titman (1993, 2001)** — "Returns to Buying Winners and Selling Losers"
   - Classic momentum paper. Their 1-month formation portfolios show *reversal* (the "1-month momentum" is short-term reversal).
   - Confirms that momentum strategies with a 1-month formation period lose money — this *is* the reversal effect.
   - **Caveat:** The 1-month formation is skip-1-month, monthly rebalanced — not a daily 20-day rolling window.

### 2.2 Small-Cap-Specific or Mechanistic Support

4. **Da, Liu & Schaumburg (2014)** — "A Closer Look at the Short-term Return Reversal"
   - Decomposes STR into a liquidity-driven component and a firm-specific component.
   - The liquidity-driven component is highly profitable but concentrated in high-volume events.
   - **Important:** They report **long-short portfolio returns**, not cross-sectional ICs. The report cannot directly map their numbers to a rank-based IC.

5. **Hameed, Huang & Mian (2010)** — "Industries and Short-term Reversal"
   - Cross-sectional reversal is strongest in stocks with high idiosyncratic volatility and low institutional ownership.
   - **Caveat:** They focus on industry-adjusted and firm-specific components. The raw 20-day return rank is not the signal they test.

6. **Nagel (2012)** — "Evaporating Liquidity"
   - Short-term reversal is an equilibrium outcome when arbitrage capital is constrained.
   - The factor's returns are predictable by VIX / funding liquidity.
   - **Critical caveat:** Nagel tests the **broad-market** reversal factor (all CRSP stocks). The report's claim that "the premium is higher in constrained arbitrage universes (small caps)" is an **inference**, not empirically tested in the paper. Small-cap-specific results are absent.

7. **Fong, Holden & Trzcinka (2017)** — "What Really Causes the Short-Term Reversal?"
   - Bid-ask bounce and microstructure effects explain some, but not all, of the reversal.
   - The residual — "true overreaction" — is economically significant.
   - **Caveat:** Their residual is estimated; if the microstructure model is misspecified, the "residual" may still be noise.

8. **McLean & Pontiff (2016)** — "Does Academic Research Destroy Stock Return Predictability?"
   - Post-publication, anomaly returns decay. STR has decayed but remains statistically significant in some samples.
   - **Caveat:** Their sample ends in 2011. Post-2011 evidence is sparse in the citations here.

### 2.3 Challenging or Contradictory Papers

9. **Conrad & Kaul (1998)** — "An Anatomy of Trading Strategies" (*Review of Financial Studies*)
   - Decomposes contrarian profits and finds that **most of the apparent profits arise from cross-sectional variation in expected returns**, not from time-series overreaction.
   - If correct, the 20-day return rank is not a predictive signal — it is a misranking of stocks with different unconditional mean returns.
   - **Why this matters:** The entire causal story in §1.1 collapses if Conrad & Kaul are right.

10. **Lo & MacKinlay (1988, 1990)** — "When Are Contrarian Profits Due to Stock Market Overreaction?"
    - Shows that portfolio-level contrarian profits can be fully explained by **lead-lag cross-autocorrelation** (small stocks reacting with a delay to large-stock news).
    - This is a direct challenge to the "overreaction / liquidity provision" narrative.

11. **Roll (1984)** / **Blume & Stambaugh (1983)** — Bid-Ask Bounce
    - Roll's implicit spread estimator demonstrates that **tiny bid-ask spreads alone can generate large measured negative autocorrelation**.
    - For small caps with wide spreads, the measured "reversal" may be **mostly spurious**.

12. **Knez & Ready (1997)** — "On the Robustness of Size and Book-to-Market in Cross-Sectional Regressions"
    - Finds that many cross-sectional anomalies are **fragile** to value-weighting and post-1990 samples.
    - STR is not specifically their focus, but their methodology raises serious questions about equal-weight, pre-2000 robustness claims.

13. **Hou, Xue & Zhang (2020)** — "Replicating Anomalies"
    - The q-factor literature subsumes many anomalies into investment and profitability factors. Short-term reversal is treated as a microstructure artifact rather than a systematic risk factor.
    - **Why this matters:** The most influential factor model in empirical finance (Fama-French 5-factor) **excludes short-term reversal entirely**. If it were a robust systematic risk factor, it would likely be included.

---

## 3. Empirical Expectations — Honest and Caveated

**Critical disclaimer:** The foundational papers cited above (Jegadeesh 1990, Lehmann 1990, Jegadeesh & Titman 1993) use **monthly data and skip-1-month formation periods**. They do **not** report cross-sectional ICs, Sharpe ratios, or daily 20-day rolling-window results for a small-cap universe. The numbers below are **informed qualitative ranges** derived from the literature, not directly sourced primary estimates. They should be treated as hypotheses for backtesting, not established facts.

### 3.1 Performance Metrics (Informed Expectations, Not Sourced Facts)

| Metric | Informed Expectation | Notes |
|--------|---------------------|-------|
| **Monthly Long/Short Quintile Spread (Equal-Weight, Pre-Cost)** | Likely positive historically, but highly sample-dependent | Da et al. (2014) report ~1.2% monthly for a specific liquidity-driven subsample. Broad small-cap equal-weight results from the 1990s were higher; post-2010 results are weaker and may be near zero in value-weight samples. |
| **Annualized Sharpe (Pre-Cost)** | Unknown for this exact specification | Not directly reported in cited papers for small-cap 20-day daily formation. Sharpe is sensitive to weighting, period, and delisting treatment. |
| **IC (20-day formation vs. 1-day forward, small-cap)** | Unknown — likely negative if any signal exists | No cited paper reports this exact metric. Rank-based IC for short-term reversal is rarely studied in the foundational literature. |
| **IC Decay (1d → 5d → 21d)** | Very rapid | Consistent with the short-lived nature of microstructure effects and liquidity pressure. Plausible that any signal decays to zero within days, but this is not directly sourced. |
| **Statistical Significance** | Historically significant in broad equal-weight samples | Jegadeesh (1990) and Lehmann (1990) document statistical significance for weekly/monthly reversal in broad samples. Small-cap-specific t-stats for a daily 20-day signal are **not directly cited**. |

**What the report removed:** Specific unsourced ranges like "IC: -0.03 to -0.05" and "Sharpe: 0.8–1.2" that appeared in the original draft.

### 3.2 Turnover & Costs — The Dominant Problem

| Metric | Informed Expectation | Notes |
|--------|---------------------|-------|
| **Turnover** | Extremely high | A 20-day formation signal held for 1–5 days and rebalanced daily or twice-weekly implies the entire portfolio turns over on the order of **every few days**. Monthly turnover would be well above 100%, but the exact figure depends on holding period and smoothing rules. |
| **Transaction Cost Drag** | Likely the dominant term | Small-cap spreads are 20–100bps one-way for the Russell 2000; 100–300bps for micro-caps. At high turnover, costs compound rapidly. |
| **Net of Cost Profitability** | **Questionable** | This is the defining challenge of STR. The academic consensus is that the factor is "not tradeable at scale" due to costs. A realistic cost model (spread-dependent + permanent impact via Kyle's lambda) is essential before any profitability claim. |
| **Short-Side Feasibility** | Often impossible | D'Avolio (2002) documents that small caps are among the hardest stocks to short. Many recent losers are unshortable. A long/short implementation may be **structurally infeasible** for a large fraction of the universe. |

### 3.3 Correlation with Standard Factors

| Factor | Expected Correlation | Interpretation |
|--------|---------------------|----------------|
| **Medium-Term Momentum (12M excl. 1M)** | Negative | By construction, short-term reversal and medium-term momentum are opposites at different horizons. |
| **Value (HML / Book-to-Market)** | Near zero to weakly positive | Cheap stocks can be both recent losers (reversal) and value plays, but the mechanisms are distinct. |
| **Size (SMB)** | Unknown | The factor is long/short *within* small caps, but residual size bias is possible if the signal correlates with sub-universe size. |
| **Volatility / Idiosyncratic Vol** | Likely positive | High-idio-vol stocks often show the strongest reversal (Hameed et al. 2010). |
| **Liquidity / Amihud** | Likely positive | Reversal is partly a liquidity premium; expected overlap. But if the reversal is mostly bid-ask bounce, this "correlation" is tautological. |

### 3.4 Regime Sensitivity — Mostly Inference

| Regime | Expected Behavior | Confidence |
|--------|-------------------|------------|
| **High VIX / Crisis** | May increase | Nagel (2012) finds broad-market STR strengthens when arbitrage capital is scarce. Small-cap inference is speculative. |
| **Low VIX / Bull markets** | Likely compresses | Easier arbitrage, lower inventory risk. Plausible but not directly tested for small caps. |
| **High Funding Rates / Tight Monetary Policy** | May strengthen | Constrained leverage → less arbitrage. Logical extension of Nagel (2012). |
| **Post-2010 / HFT Era** | Likely decayed | HFT and systematic funds have arbitraged broad-market STR. Small-cap decay is slower due to capacity limits, but the magnitude is unknown. |

---

## 4. Implementation Considerations

### 4.1 Construction (Point-in-Time Discipline)

```
Signal = -1 * rank( past_20_day_return )

Where:
  past_20_day_return = close(t-1) / close(t-21) - 1
  All prices must be split- and dividend-adjusted as of t-1
  The signal must be computable at the close of t-1 for trading at t's open
```

**Critical distinction: 20-day rolling ≠ 1-month skip-1-month**
- The foundational papers (Jegadeesh 1990, Jegadeesh & Titman 1993) use **monthly CRSP data** with skip-1-month formation. Their "1-month" formation is smoother, less microstructure-contaminated, and lower-turnover than a daily 20-day rolling window.
- A daily 20-day signal is **noisier, more contaminated by bid-ask bounce, and higher-turnover** than the monthly strategies in the literature. It should not be expected to replicate the historical results of those papers.

**Critical details:**
- **Lag:** Use `t-1` close to `t-21` close. No look-ahead.
- **Microstructure:** Use VWAP or mid-quote, not last trade, to reduce bid-ask bounce contamination. **But note:** Even with mid-quote, the signal may be severely attenuated or disappear entirely if Roll's bid-ask-bounce critique is dominant.
- **Winsorization:** Cap daily returns at ±5% or 20-day returns at ±30% to prevent extreme outliers from dominating the rank.
- **Lead-lag controls:** Because Lo & MacKinlay (1990) show that delayed reaction to large-cap news drives apparent small-cap reversal, the signal should be **residualized against industry and/or large-cap portfolio returns** before ranking.

### 4.2 Universe Refinement

| Filter | Rationale |
|--------|-----------|
| **Primary/Ordinary shares only** | ADRs and non-operating companies behave differently |
| **Exclude stocks with price < $5** | Penny stocks have extreme microstructure noise |
| **Minimum ADV > $1M–$2M** | Untradeable names create survival bias and exaggerate paper returns |
| **Exclude recent IPOs (< 6 months)** | IPO return dynamics are distinct from reversal |
| **Exclude halt/delisted names** | Dead-stock bias is lethal for reversal strategies |

### 4.3 The Delisting Bias Problem — Centerpiece Risk

**This is not a footnote. It is potentially fatal.**

- Shumway (1997) and subsequent work show that **delisting returns are systematically negative** and often missing in datasets.
- Small-cap losers — the stocks a reversal strategy buys — are the **most likely to delist**.
- A 20-day small-cap reversal strategy mechanically buys recent underperformers, which overlaps heavily with the delisting population.
- Missing or biased delisting returns in backtests can inflate annualized returns by **hundreds of basis points**.
- **Mitigation:** Use CRSP/Point-in-Time data with full delisting return history. If your dataset lacks this, **do not trust the backtest**.

### 4.4 Enhancements (Alpha Sharpening)

The naive 20-day return is noisy and potentially illusory. Literature suggests these orthogonalizations:

1. **Residualize against market and industry returns (Lo & MacKinlay control):**
   ```
   residual_return = past_20_day_return - beta * past_20_day_market_return - beta_industry * past_20_day_industry_return
   ```
   This addresses the lead-lag critique: if the reversal is just small stocks catching up to large-cap news, this removes it.

2. **Residualize against idiosyncratic volatility:**
   The raw return conflates volatility level with direction. A residualized signal may be cleaner.

3. **Interact with volume / turnover (Da et al. 2014):**
   ```
   signal = -1 * rank( residual_return ) * rank( past_20_day_volume / avg_volume )
   ```
   The liquidity-driven component is concentrated in high-volume events. But if the volume spike is information-based, this may capture momentum, not reversal.

4. **Short-constraints proxy:**
   If shorting is expensive (which it is for small caps), the long side (losers rebounding) may be more reliable than the short side (winners falling). Consider an **asymmetric construction** or use a short-constraint indicator (institutional ownership, borrow cost, rebate rate).

### 4.5 Execution

- **Rebalance frequency:** Daily or twice-weekly. Monthly rebalancing loses too much of the signal — but high-frequency rebalancing kills you with costs.
- **Holding period:** 1–5 days. The signal, if real, decays rapidly.
- **Capacity:** Extremely limited. In small caps with ADV <$2M, even $5–10M AUM may generate prohibitive market impact.
- **Cost model:** Must use realistic small-cap spread model (20–100bps one-way, depending on cap rank) plus permanent impact. A fixed 10bps assumption is **unrealistic and misleading**.

---

## 5. Risks & Drawdowns — Upgraded Warnings

| Risk | Description | Severity |
|------|-------------|----------|
| **Delisting Bias** | Small-cap losers are most likely to delist. Missing delisting returns inflate backtests by 1–3% annually. | 🔴 **Critical** |
| **Bid-Ask Bounce** | Roll (1984) shows tiny spreads alone create measured reversal. For small-cap spreads of 50–300bps, much of the "alpha" may be illusion. | 🔴 **Critical** |
| **Short-Side Infeasibility** | Many small-cap losers are unshortable (D'Avolio 2002). A long/short strategy is structurally asymmetric or impossible for much of the universe. | 🔴 **Critical** |
| **Conrad & Kaul Measurement Error** | The "reversal" may just be cross-sectional differences in expected returns, not predictability. | 🟡 **High** |
| **Transaction Costs** | Turnover + small-cap spreads = likely unprofitable net of costs. This is the most-cited reason STR is "not tradeable." | 🔴 **Critical** |
| **January Effect** | Small-cap losers rebound in January (tax-loss selling). The rest-of-year signal may be dramatically weaker. If January is removed, annual Sharpe could drop 50%+. | 🟡 **High** |
| **Momentum Crashes** | During sharp momentum rallies (e.g., 2021 meme stocks), short-term reversal can blow up on the short side as winners keep winning. | 🟡 **High** |
| **Crowding / Decay** | HFT and systematic funds have arbitraged broad-market STR since ~2005. Small-cap decay is slower but unquantified. | 🟡 **High** |
| **Survivorship Bias** | Using current small-cap universes overstates returns by excluding delisted disaster names. | 🔴 **Critical** |

---

## 6. Prior Tests & Codebase Check

Searched `.zen/`, `src/`, `evals/`, and `.pi/skills/` for prior implementations of 20-day reversal or short-term reversal in small caps. **No prior tests found in the local repo.** This is a fresh hypothesis for this workspace.

**Note on WorldQuant BRAIN:** If BRAIN credentials were available, the raw expression would likely be rejected as already mined. A realistic submission would need enhancement, e.g.:
```
-rank(ts_zscore(ts_returns(close, 20) - beta * ts_returns(market, 20), 60)) * rank(adv20)
```
or a volume-conditioned residualized variant. Without BRAIN access, this remains speculative.

---

## 7. Stress Test: Subperiod Expectations — Honest Version

| Period | Expected Signal Strength | Confidence |
|--------|-------------------------|------------|
| 1990–2000 | Likely strongest | Broad-market equal-weight STR was robust in the 1990s. Small-cap-specific strength is plausible but not directly cited. |
| 2000–2008 | Decayed vs. 1990s | HFT entry, but not yet saturated. Broad-market evidence suggests persistence; small-cap subset less clear. |
| 2008–2009 (GFC) | Possibly elevated | High VIX / constrained arbitrage. Nagel (2012) mechanism would predict this, but small-cap-specific test is absent. |
| 2010–2019 | Weak or zero in value-weight | Post-HFT, many anomalies compressed. Green, Hand & Zhang (2017) and Hou, Xue & Zhang (2020) suggest broad decay. Equal-weight small-cap may retain marginal signal, but **no direct evidence is cited here**. |
| 2020–2021 (COVID / Meme) | Volatile / Unpredictable | March 2020 may have shown strong reversal; meme-stock regime caused momentum crashes. Hard to generalize. |
| 2022–2024 (Rate hikes) | Unknown | Tightening → constrained leverage → possibly more profitable for liquidity providers. **Speculative.** |

**What the report removed:** The original draft gave pseudo-precise expected ICs for each subperiod (e.g., "-0.02 to -0.04 for 2010–2019"). These were **unsourced fabrications** and have been replaced with honest uncertainty.

---

## 8. Verdict

### 🟡 Ambiguous / Contaminated Signal — Requires Skeptical Testing

**Classification:** The 20-day small-cap reversal is a **contaminated variant** of a documented monthly anomaly. Whether the contamination (bid-ask bounce, delisting bias, lead-lag effects, measurement error) swamps any genuine alpha is **unknown and contested**.

### Why the Verdict Was Downgraded from "Genuine Signal":

1. **The foundational papers do not test this exact specification.** They use monthly skip-1-month formation, not daily 20-day rolling windows. The daily variant is more microstructure-contaminated and higher-turnover.

2. **The three most damaging critiques are omitted or buried in most summaries of this literature:**
   - **Conrad & Kaul (1998):** The profits may not be time-series predictability at all.
   - **Roll (1984) / Blume & Stambaugh (1983):** The measured reversal may be mostly bid-ask bounce.
   - **Lo & MacKinlay (1990):** The reversal may be delayed reaction to large-cap news, not stock-level overreaction.

3. **Delisting bias is potentially catastrophic for this exact strategy.** Small-cap losers are the buy leg; they are also the most likely to delist. Any backtest without CRSP delisting returns is **untrustworthy**.

4. **Short constraints make the long/short implementation structurally infeasible for much of the universe.** D'Avolio (2002) shows small caps are among the hardest to short.

5. **Transaction costs likely dominate any residual alpha.** Even if a genuine signal exists after controlling for microstructure noise, the turnover and spread environment in small caps may make it unharvestable.

6. **Post-2010 evidence is weak or absent for this specification.** The decay narrative is credible, and the honest answer for the 2010s is "inconclusive, possibly zero in value-weight samples."

### Recommended Next Steps:

1. **Build the factor with strict PIT discipline** in a backtest framework with **CRSP delisting returns** and **survivorship-bias-free data**.
2. **Run the adversarial battery:**
   - Test with transaction prices vs. quote-midpoint vs. VWAP. If the signal vanishes with quote-midpoint, it is bid-ask bounce.
   - Test with vs. without delisting returns. If Sharpe drops by >50%, delisting bias is fatal.
   - Test long-only (feasible short side) vs. long/short fantasy. If the short leg is mostly unshortable, the strategy is long-only.
   - Residualize against market, industry, and large-cap returns. If the signal collapses, it is lead-lag, not overreaction.
3. **Apply a realistic cost model:** spread-dependent + ADV-dependent permanent impact. Do not use fixed 10bps.
4. **Test the January effect:** run the strategy excluding January. If most of the alpha is in January, the "general" reversal mechanism is illusory.
5. **If WorldQuant BRAIN becomes available:** Submit an **enhanced, residualized, volume-conditioned expression** — not the raw `-rank(ts_returns(close, 20))`, which is almost certainly already mined.

---

## References

- Asness, C. S., et al. (2013). The devil in HML's details. *Journal of Portfolio Management*. (Note: this paper focuses on value decomposition, not short-term reversal. Cited here for completeness but does not directly support the hypothesis.)
- Avramov, D., Chordia, T., Jostova, G., & Philipov, A. (2006). Momentum and credit rating. *Journal of Finance*.
- Blume, M. E., & Stambaugh, R. F. (1983). Biases in computed returns: An application to the size effect. *Journal of Financial Economics*.
- Campbell, J. Y., Grossman, S. J., & Wang, J. (1993). Trading volume and serial correlation in stock returns. *QJE*.
- Conrad, J., & Kaul, G. (1998). An anatomy of trading strategies. *Review of Financial Studies*.
- D'Avolio, G. (2002). The market for borrowing stock. *Journal of Financial Economics*.
- Da, Z., Liu, Q., & Schaumburg, E. (2014). A closer look at the short-term return reversal. *Management Science*.
- Fong, K., Holden, C. W., & Trzcinka, C. (2017). What really causes the short-term reversal? *Critical Finance Review*.
- Green, J., Hand, J. R., & Zhang, X. F. (2017). The characteristics that provide independent information about average U.S. monthly stock returns. *Review of Financial Studies*.
- Hameed, A., Huang, S., & Mian, G. M. (2010). Industries and short-term reversal. *Journal of Financial Economics*.
- Hou, K., Xue, C., & Zhang, L. (2020). Replicating anomalies. *Review of Financial Studies*.
- Jegadeesh, N. (1990). Evidence of predictable behavior of security returns. *Journal of Financial Economics*.
- Jegadeesh, N., & Titman, S. (1993, 2001). Returns to buying winners and selling losers. *Journal of Finance*.
- Knez, P. J., & Ready, M. J. (1997). On the robustness of size and book-to-market in cross-sectional regressions. *Journal of Finance*.
- Lehmann, B. N. (1990). Fads, martingales, and market efficiency. *QJE*.
- Lo, A. W., & MacKinlay, A. C. (1988, 1990). When are contrarian profits due to stock market overreaction? *Review of Financial Studies*.
- McLean, R. D., & Pontiff, J. (2016). Does academic research destroy stock return predictability? *Journal of Financial Economics*.
- Nagel, S. (2012). Evaporating liquidity. *Review of Financial Studies*.
- Roll, R. (1984). A simple implicit measure of the effective bid-ask spread in an efficient market. *Journal of Finance*.
- Shumway, T. (1997). The delisting bias in CRSP data. *Journal of Finance*.
