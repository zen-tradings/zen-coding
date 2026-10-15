---
name: wq-alpha-research
description: "Use for WorldQuant BRAIN US market alpha research: designing WQ Alpha expressions for US equities (USA TOP3000 / TOP1000 / TOP500), selecting US fields and operators, diagnosing simulation and IS check failures, tuning Sharpe/Fitness/Turnover, submitting US alphas, and building low-correlation US equity alpha portfolios."
---

# WQ Alpha Research Skill (US Equities Market)

> Dedicated US Market Playbook: Fields → Expressions → Backtesting → Checks → Submissions → Portfolios. 100% calibrated for WorldQuant BRAIN **US Equities** (`region: USA`, `universe: TOP3000 / TOP1000 / TOP500`, `delay: 1`) with 4,367 local US data fields and GICS Subindustry neutralization.

---

## 1. Quick Decision Tree

```
Start
  ├── Fetch all alpha list ──→ Look only at ACTIVE; calculate **daily return** correlation, >0.7 then revise or drop
  ├── Design new factor
  │    ├── Field already verified? ──No──→ Check Section 2 (Search local field files / simulate rank(field))
  │    └── Yes
  │         ├── Fundamental ──→ group_rank + ts_rank, SUBINDUSTRY, decay=0
  │         ├── Analyst ──────→ group_rank + ts_rank, INDUSTRY/SUBINDUSTRY, decay=0–4
  │         ├── Technical ────→ High decay(10–30) or blend with fundamental to lower turnover
  │         └── Sentiment ────→ nanHandling=ON, caution with small windows
  └── After submission ──→ Verify status == ACTIVE, otherwise check SELF_CORRELATION
```

---

## 2. Field Quick Lookup (Local Dataset)

This SKILL includes the full field list for USA TOP3000 delay=1 (4,367 fields in total), so there is no need to fetch from webpage / API every time:

- `references/wq_usa_top3000_delay1_data_fields.json`: Full field metadata array
- `references/wq_usa_top3000_delay1_data_fields.csv`: CSV version, convenient for Excel / pandas viewing
- `references/wq_usa_top3000_delay1_data_fields_summary.json`: Category statistics and sample fields

Field distribution:

| Category | Count | Description |
|----------|-------|-------------|
| fundamental | 1652 | Financial statements and notes items |
| analyst | 1324 | Analyst expectations and consensus estimates |
| news | 996 | News and earnings events |
| pv | 195 | Price-volume, ADV, VWAP, etc. |
| option | 138 | Option implied volatility, Put/Call, etc. |
| model | 40 | Model factors |
| socialmedia | 22 | Social media sentiment |
| univ1 | 6 | Universe related |

### 2.1 Search Local Fields

```python
import json
from pathlib import Path

# Assume running in the skill directory; if elsewhere, use actual path
skill_dir = Path(".")
field_dir = skill_dir / "references"
data = json.loads((field_dir / "wq_usa_top3000_delay1_data_fields.json").read_text(encoding="utf-8"))

keyword = "operating_income"
matches = [
    f for f in data
    if keyword.lower() in f["id"].lower()
    or (f.get("description") and keyword.lower() in f["description"].lower())
]

for f in matches[:10]:
    print(f"{f['id']} | {f.get('category',{}).get('name')} | {f.get('dataset',{}).get('name')} | coverage={f.get('coverage')} | alphaCount={f.get('alphaCount')}")
```

### 2.2 Filter by Category

```python
category = "pv"  # Or fundamental / analyst / news / option / model / socialmedia
fields = [f for f in data if f.get("category", {}).get("id") == category]
print(f"{category}: {len(fields)} fields")
for f in sorted(fields, key=lambda x: x.get("alphaCount", 0), reverse=True)[:10]:
    print(f"  {f['id']} | alphaCount={f.get('alphaCount')} | coverage={f.get('coverage')}")
```

### 2.3 Field Verification

After obtaining candidate fields, **first simulate and verify with a simple expression** to check if the field is actually usable:

```python
payload = {
    "type": "REGULAR",
    "settings": {
        "instrumentType": "EQUITY", "region": "USA", "universe": "TOP3000",
        "delay": 1, "decay": 0, "neutralization": "MARKET",
        "truncation": 0.08, "pasteurization": "ON", "unitHandling": "VERIFY",
        "nanHandling": "ON", "language": "FASTEXPR", "visualization": False,
    },
    "regular": "rank(my_candidate_field)",
}
resp = session.post("https://api.worldquantbrain.com/simulations", json=payload)
# 201 indicates field is usable; non-201 usually indicates field does not exist or parameter mismatch
```

### 2.4 When Refetching Is Needed

This SKILL is strictly calibrated for the US Market (`USA` region, `TOP3000` universe, `delay=1`). The local dataset contains 4,367 US equity fields. Refetching from BRAIN is only required under the following conditions:

- Changing US Market Universe (e.g., TOP500, TOP1000)
- Changing US Delay parameter (e.g., 0)
- BRAIN platform US field list has undergone major updates (compare `dateCreated` against local)

---

## 3. Operator Cheat Sheet

| Category | Operator | Function |
|----------|----------|----------|
| Cross-Sectional | `rank(x)`, `zscore(x)`, `normalize(x)`, `scale(x)`, `winsorize(x, std=4)` | Daily cross-sectional normalization across all stocks |
| Time-Series | `ts_mean`, `ts_std_dev`, `ts_delta`, `ts_rank`, `ts_corr`, `ts_decay_linear`, `ts_backfill`, `ts_zscore` | Single-stock historical window calculation |
| Group | `group_rank(x, group)`, `group_neutralize(x, group)`, `group_zscore(x, group)`, `group_backfill(x, group, N)` | Intra-group neutralization |
| Conditional | `if_else(cond, a, b)`, `trade_when(x, cond, delay)` | Conditional exposure |
| Vector | `vec_avg(a, b, c)`, `vec_sum(a, b, c)` | Multi-field element-wise average / sum |

**Golden Combination**: `group_rank(ts_rank(signal, N), subindustry)`

---

## 4. Factor Template Library

### 4.1 High Pass-Rate Templates

```fastexpr
-- Template A: ROE Trend (Highest Pass Rate)
group_rank(ts_rank(operating_income / equity, 126), subindustry)

-- Template B: EPS Yield Revision
group_rank(ts_rank(est_eps / close, 126), industry)

-- Template C: FCF Yield
group_rank(ts_rank(free_cash_flow_reported_value / equity, 126), industry)

-- Template D: Multi-Factor Blend (High Fitness)
0.5 * group_rank(ts_rank(operating_income / equity, 126), subindustry)
+ 0.5 * group_rank(ts_rank(est_eps / close, 126), industry)

-- Template E: Low-Correlation Technical + Fundamental Blend
0.5 * rank(-(close / open - 1)) + 0.5 * rank(ts_rank(operating_income / equity, 126))

-- Template F: Asset Turnover × Profit Margin
rank(ts_rank(operating_income / sales * sales / assets, 126))
```

### 4.2 Recommended Default Settings

| Factor Type | Decay | Neutralization | Truncation | nanHandling | Expected TO |
|-------------|-------|----------------|------------|-------------|-------------|
| Fundamental Quality | 0 | SUBINDUSTRY | 0.08 | ON | 2–8% |
| Analyst Expectation | 0–4 | INDUSTRY/SUBINDUSTRY | 0.08 | ON | 9–16% |
| Technical Reversal | 10–30 | INDUSTRY | 0.08 | OFF | 15–35% |
| Blended Factor | 4–20 | INDUSTRY/SUBINDUSTRY | 0.08 | ON | 10–20% |
| Sentiment | 4–10 | INDUSTRY | 0.05–0.08 | ON | 8–30% |

---

## 5. Metrics and Checks

### 5.1 Core Metrics

| Metric | Formula / Meaning | Target |
|--------|-------------------|--------|
| Sharpe | Daily IR × √252 | ≥ 1.5 (Minimum 1.25) |
| Fitness | Sharpe × √(|Returns| / max(TO, 0.125)) | ≥ 1.1 (Minimum 1.0) |
| Returns | Annualized Return / $10M | ≥ 7% |
| Turnover | Daily Traded Volume / Book Size | 1%–20% |
| Drawdown | Peak-to-Trough Maximum Drawdown | < 15% |
| Margin | PnL / Total Traded Value | Higher is better |

### 5.2 IS Checklist

| Check Item | Threshold | Failure Cause | Fix Method |
|------------|-----------|---------------|------------|
| LOW_SHARPE | ≥ 1.25 | Weak signal | Change field/window/add group_rank |
| LOW_FITNESS | ≥ 1.0 | Turnover too high | Increase decay, blend stable signals |
| LOW_TURNOVER | ≥ 1% | Signal too static | Shorten window, use more active field |
| HIGH_TURNOVER | ≤ 70% | Turnover explosion | Increase decay, trade_when, blending |
| CONCENTRATED_WEIGHT | Single stock < 10% & well-distributed | Weight concentration | Use rank(), reduce truncation, ts_backfill |
| LOW_SUB_UNIVERSE_SHARPE | TOP1000 also effective | Small-cap dependency | Use fundamentals, SUBINDUSTRY, avoid cap bias |
| SELF_CORRELATION | **Daily Return** corr < 0.7 | Too similar to existing alphas | Change signal family, add filters, change Universe; don't just tweak parameters |
| MATCHES_COMPETITION | Informational | — | No impact |

### 5.3 Failure Statistics

| Failure Cause | Percentage | Conclusion |
|---------------|------------|------------|
| LOW_SHARPE | 90.7% | Signal quality is the biggest bottleneck |
| LOW_FITNESS | 66.2% | Usually a soft version of HIGH_TURNOVER |
| LOW_SUB_UNIVERSE_SHARPE | 51.0% | Avoid small-cap / liquidity bias |

**Pass rate by data type**: Fundamental 40% > Blend 12.7% > Pure Technical 5.3% > Others 0%

---

## 6. Diagnosis and Troubleshooting

| Symptom | Probable Cause | Fix |
|---------|----------------|-----|
| Fitness < 1.0 | Turnover > 30% | Increase decay, blend fundamentals, ts_decay_linear |
| Sharpe < 1.25 | Weak signal | Lengthen window, group_rank, change field |
| TO > 50% | Signal changes too fast | Decay 10–30, trade_when, blending |
| DD > 15% | High volatility/leverage | Increase decay, lower truncation, blend low-vol signals |
| CONCENTRATED_WEIGHT FAIL | Sparse/extreme values | rank(), truncation 0.05, ts_backfill |
| Sub-Universe FAIL | Small-cap dependency | Avoid `rank(-assets)`, use group_rank, add liquidity filter |
| simulation_error | Field non-existent / operator parameter error | First verify field with `rank(field)`, check operator argument count |
| trade_when zero trades | Condition too strict | Relax condition or use `if_else` |

---

## 7. BRAIN API Automation

### 7.1 Authentication

**Credentials must be prepared before use**. Environment variables are recommended; you can also place an untracked `credential.txt` locally (ignored by `.gitignore`), containing a JSON array:

```json
["your_username", "your_password"]
```

⚠️ **Warning**: Do not write real account passwords into the repository. Prefer `WQ_BRAIN_USERNAME` / `WQ_BRAIN_PASSWORD` environment variables.

```python
import json
import os
import requests
from requests.auth import HTTPBasicAuth

API_BASE = "https://api.worldquantbrain.com"

# 1. Read credentials
username = os.getenv("WQ_BRAIN_USERNAME")
password = os.getenv("WQ_BRAIN_PASSWORD")
if not (username and password):
    with open("credential.txt") as f:
        username, password = json.load(f)

# 2. Create session and authenticate
session = requests.Session()
session.auth = HTTPBasicAuth(username, password)
session.headers.update({
    "Content-Type": "application/json",
    "Accept": "application/json",
})

resp = session.post(f"{API_BASE}/authentication")
assert resp.status_code == 201, f"Authentication failed: {resp.status_code} {resp.text}"
print("Authentication successful")
```

### 7.2 Fetch Submitted Alphas and Calculate Correlation

**Goal**: Before submitting a new factor, avoid high PnL correlation (correlation coefficient ≥ 0.7) with existing factors.

```python
import numpy as np

def fetch_pnl(session, alpha_id):
    """Fetch Alpha cumulative PnL series; schema.properties can be list or dict."""
    r = session.get(f"{API_BASE}/alphas/{alpha_id}/recordsets/pnl")
    if r.status_code != 200 or not r.text.strip():
        return []
    data = r.json()
    props = data.get("schema", {}).get("properties", [])
    if isinstance(props, list):
        date_idx = next((i for i, p in enumerate(props) if p.get("name", "").lower() == "date"), 0)
        pnl_idx = next((i for i, p in enumerate(props) if p.get("name", "").lower() in ("pnl", "cum_pnl", "returns", "ret")), 1)
    else:
        date_idx = next((v["index"] for k, v in props.items() if k.lower() == "date"), 0)
        pnl_idx = next((v["index"] for k, v in props.items() if k.lower() in ("pnl", "cum_pnl", "returns", "ret")), 1)
    records = sorted(data.get("records", []), key=lambda r: r[date_idx])
    out = []
    for row in records:
        rec = row[0] if isinstance(row, list) and len(row) == 1 and isinstance(row[0], list) else row
        try:
            out.append(float(rec[pnl_idx]))
        except Exception:
            continue
    return out

def daily_returns(cum_pnl):
    """Convert cumulative PnL to daily returns; correlation MUST be based on daily returns, not cumulative curves."""
    return [cum_pnl[i+1] - cum_pnl[i] for i in range(len(cum_pnl) - 1)]

def get_active_alphas(session, user_id="self", limit=100):
    """Fetch all alphas (including ACTIVE / UNSUBMITTED) with pagination."""
    all_alphas = []
    offset = 0
    while True:
        data = session.get(f"{API_BASE}/users/{user_id}/alphas", params={"limit": limit, "offset": offset}).json()
        batch = data.get("results", data.get("alphas", []))
        if not batch:
            break
        all_alphas.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return all_alphas

# Compute daily return correlation of new factor against all ACTIVE alphas
new_pnl = fetch_pnl(session, new_alpha_id)
new_ret = daily_returns(new_pnl)
existing = get_active_alphas(session)
active = [a for a in existing if a.get("status") == "ACTIVE"]

high_corr = []
for alpha in active:
    old_id = alpha.get("id")
    try:
        old_pnl = fetch_pnl(session, old_id)
        old_ret = daily_returns(old_pnl)
        if len(new_ret) == len(old_ret) and len(new_ret) > 20:
            corr = float(np.corrcoef(new_ret, old_ret)[0, 1])
            print(f"Daily return correlation with {old_id}: {corr:.3f}")
            if abs(corr) >= 0.7:
                high_corr.append((old_id, corr))
    except Exception:
        continue

if high_corr:
    print(f"⚠️ Found {len(high_corr)} highly correlated factors; revision or abandonment recommended")
```

**Decision Rules (based on daily returns, NOT cumulative PnL)**:

| Correlation Coefficient | Action |
|-------------------------|--------|
| abs(corr) < 0.5 | ✅ Submittable |
| 0.5 ≤ abs(corr) < 0.7 | ⚠️ Caution, need to improve Sharpe or modify signal |
| abs(corr) ≥ 0.7 | ❌ Abandon or refactor (unless new Sharpe ≥ old Sharpe × 1.1) |

> ⚠️ **Do not calculate correlation on cumulative PnL**. Cumulative curves carry strong trend bias that drastically inflates correlation between different signals.

### 7.3 Backtesting

```python
payload = {
    "type": "REGULAR",
    "settings": {
        "instrumentType": "EQUITY", "region": "USA", "universe": "TOP3000",
        "delay": 1, "decay": 0, "neutralization": "SUBINDUSTRY",
        "truncation": 0.08, "pasteurization": "ON", "unitHandling": "VERIFY",
        "nanHandling": "ON", "language": "FASTEXPR", "visualization": False,
    },
    "regular": "group_rank(ts_rank(operating_income/equity, 126), subindustry)",
}
resp = session.post("https://api.worldquantbrain.com/simulations", json=payload)
sim_id = resp.headers["Location"].rstrip("/").split("/")[-1]

while True:
    data = session.get(f"https://api.worldquantbrain.com/simulations/{sim_id}").json()
    if data.get("status") == "COMPLETE":
        alpha_id = data["alpha"]
        break
    time.sleep(8)

alpha = session.get(f"https://api.worldquantbrain.com/alphas/{alpha_id}").json()
```

### 7.4 Submission and Monitoring

```python
# Submit
sub = session.post(f"https://api.worldquantbrain.com/alphas/{alpha_id}/submit")
print(sub.status_code)  # 201 Success

# Monitor SELF_CORRELATION
for _ in range(30):
    alpha = session.get(f"https://api.worldquantbrain.com/alphas/{alpha_id}").json()
    sc = next((c for c in alpha.get("is", {}).get("checks", []) if c["name"] == "SELF_CORRELATION"), {})
    if sc.get("result") in ("PASS", "FAIL"):
        break
    time.sleep(60)
```

### 7.5 Automated Submission Template

```python
import numpy as np

def simulate_and_submit(expression, settings, existing_pnls=None):
    """
    existing_pnls: {alpha_id: [cum_pnl_values]}, cumulative PnL series of online factors.
    Returns: {"alpha_id": ..., "decision": "submitted|skip|high_corr|verify_failed", ...}
    """
    payload = {"type": "REGULAR", "settings": settings, "regular": expression}
    resp = session.post("https://api.worldquantbrain.com/simulations", json=payload)
    if resp.status_code != 201:
        return {"error": "simulate_failed"}
    sim_id = resp.headers["Location"].rstrip("/").split("/")[-1]
    while True:
        data = session.get(f"https://api.worldquantbrain.com/simulations/{sim_id}").json()
        if data.get("status") == "COMPLETE":
            alpha_id = data["alpha"]
            break
        if data.get("status") in ("ERROR", "FAILED"):
            return {"error": "simulation_error"}
        time.sleep(8)
    alpha = session.get(f"https://api.worldquantbrain.com/alphas/{alpha_id}").json()
    is_ = alpha.get("is", {})

    # 1. Basic metric filtering
    if is_.get("fitness", 0) < 1.1 or is_.get("sharpe", 0) < 1.3 or is_.get("turnover", 1) > 0.20:
        return {"alpha_id": alpha_id, "decision": "skip", "reason": "metrics", "metrics": is_}

    # 2. Correlation check (based on daily returns)
    def daily_rets(cum):
        return [cum[i+1] - cum[i] for i in range(len(cum) - 1)]

    if existing_pnls:
        new_pnl = fetch_pnl(session, alpha_id)
        new_ret = daily_rets(new_pnl)
        for old_id, old_pnl in existing_pnls.items():
            old_ret = daily_rets(old_pnl)
            if len(new_ret) == len(old_ret) and len(new_ret) > 20:
                corr = abs(float(np.corrcoef(new_ret, old_ret)[0, 1]))
                if corr >= 0.7:
                    # Exception: new Sharpe is >10% higher than old Sharpe -> submittable
                    old_sharpe = None  # Passed externally or cached
                    if old_sharpe is None or is_.get("sharpe", 0) < old_sharpe * 1.1:
                        return {"alpha_id": alpha_id, "decision": "high_corr", "corr_with": old_id, "corr": corr}

    # 3. Submission
    sub = session.post(f"https://api.worldquantbrain.com/alphas/{alpha_id}/submit")
    if sub.status_code not in (200, 201):
        return {"alpha_id": alpha_id, "decision": "submit_failed", "status": sub.status_code}

    # 4. Verify whether it actually goes live (BRAIN may keep UNSUBMITTED status due to SELF_CORRELATION)
    for _ in range(20):
        time.sleep(10)
        alpha = session.get(f"https://api.worldquantbrain.com/alphas/{alpha_id}").json()
        if alpha.get("status") == "ACTIVE":
            return {"alpha_id": alpha_id, "decision": "submitted", "status": "ACTIVE"}
        sc = next((c for c in alpha.get("is", {}).get("checks", []) if c["name"] == "SELF_CORRELATION"), {})
        if sc.get("result") == "FAIL":
            return {"alpha_id": alpha_id, "decision": "self_correlation_fail", "status": alpha.get("status")}

    return {"alpha_id": alpha_id, "decision": "verify_failed", "status": alpha.get("status")}
```

### 7.6 Rate Limiting

- Sleep 2–5 seconds between simulations/submissions.
- On 429 response, read `Retry-After` header and apply exponential backoff.
- For batch processing, single-threading or ≤ 2 concurrency is recommended.

### 7.7 Post-Submission Verification (201 ≠ Live)

`POST /alphas/{id}/submit` returning 201 only indicates that the request was accepted, **it does NOT mean the alpha has become ACTIVE**. Common practical scenarios:

- Alpha status remains `UNSUBMITTED` (failed SELF_CORRELATION check or under review).
- New alpha generated by tweaking parameters on the same signal is flagged as duplicate by the system and fails to submit.

**Must double-confirm**:

```python
alpha = session.get(f"{API_BASE}/alphas/{alpha_id}").json()
print(alpha.get("status"))  # Only ACTIVE counts as truly submitted

# If status == UNSUBMITTED, check SELF_CORRELATION result in checks
for c in alpha.get("is", {}).get("checks", []):
    print(c["name"], c.get("result"), c.get("value"))
```

**Fetch all alphas and count ACTIVE total**:

```python
def get_all_alphas(session, limit=100):
    all_alphas = []
    offset = 0
    while True:
        data = session.get(f"{API_BASE}/users/self/alphas", params={"limit": limit, "offset": offset}).json()
        batch = data.get("results", data.get("alphas", []))
        if not batch:
            break
        all_alphas.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return all_alphas

all_alphas = get_all_alphas(session)
active = [a for a in all_alphas if a.get("status") == "ACTIVE"]
print(f"total={len(all_alphas)}, ACTIVE={len(active)}")
```

---

## 8. Portfolio Construction Rules

### 8.1 Diversified Portfolio Example

| Family | Representative Expression |
|--------|---------------------------|
| Profitability | `group_rank(ts_rank(operating_income/equity, 126), subindustry)` |
| Analyst | `group_rank(ts_rank(est_eps/close, 252), subindustry)` |
| FCF | `group_rank(ts_rank(free_cash_flow_reported_value/equity, 126), industry)` |
| Low-Corr Blend | `0.5*rank(-(close/open-1)) + 0.5*rank(ts_rank(operating_income/equity, 126))` |
| Quality Portfolio | `0.5*group_rank(ts_rank(oi/equity,126),subindustry) + 0.5*group_rank(ts_rank(est_eps/close,126),industry)` |

### 8.2 Submission Priority

1. High Fitness (≥ 1.5) and low TO (< 15%)
2. Alphas from different signal families
3. If SELF_CORRELATION conflicts occur, retain the higher Fitness version

### 8.3 The Truth About Correlation

Analyzing daily return correlations among ACTIVE alphas reveals:

- **Extremely high correlation within the same signal family**:
  - Two open-close reversal + OI/Equity blends (with different weights) have daily return correlation of **0.84**
  - Two analyst EPS factors have correlation of **0.74**
  - Two leverage/quality factors (`-equity/assets` vs `liabilities/assets`) have correlation of **0.84**
- **Cross-family signals do not guarantee diversification**: Sentiment alpha based on `scl12_buzz` and analyst alpha based on `est_eps/close` still correlate at **0.59–0.67**.
- **Cumulative PnL correlation is severely distorted**: Pairwise correlations of cumulative PnL across alphas are universally **> 0.90**, misleadingly suggesting all factors are identical.

**Conclusion**:

- Tweaking windows, weights, or neutralization **cannot create true low correlation**.
- True low correlation stems from **completely different data sources or economic logic** (e.g., macro events, option flow, cross-border, alternative data).
- In the standard USA TOP3000 fundamental/PV/analyst pool, "low correlation" usually means **0.3–0.6 daily return correlation**; do not expect 0.

---

## 9. Pre-Submission Checklist

- [ ] Fetched **ALL** alpha list (including ACTIVE / UNSUBMITTED), not just the current simulation batch
- [ ] New factor **daily return** correlation with existing ACTIVE alphas is < 0.7 (or new Sharpe ≥ old Sharpe × 1.1)
- [ ] Correlation is calculated based on **daily returns**, NOT cumulative PnL
- [ ] Fields are verified
- [ ] Simulation completed with zero errors
- [ ] Sharpe ≥ 1.3 (Ideally ≥ 1.5)
- [ ] Fitness ≥ 1.1
- [ ] Turnover 1%–20% (Relaxable to ≤ 35%)
- [ ] Drawdown < 15%
- [ ] All IS checks passed
- [ ] Long/Short counts are reasonable
- [ ] After submission, **confirm again that status == ACTIVE** (201 does not mean live)

---

## 10. Core Lessons (One-Liners)

1. **Fetch all ACTIVE alpha PnLs before generating new factors** to avoid high-correlation duplication.
2. **Correlation must be calculated on daily returns**; cumulative PnL correlation treats all factors as identical.
3. **201 response ≠ successful submission**: Always confirm `status == ACTIVE` post-submit.
4. **Fundamental > Blend > Technical**: `operating_income/equity`, `est_eps/close`, `free_cash_flow_reported_value/equity` are the most reliable starting points.
5. **group_rank + ts_rank is the golden combination**.
6. **SUBINDUSTRY neutralization has the highest pass rate**.
7. **Decay is the primary lever to control turnover**: Fundamental 0, Technical 10–30.
8. **50/50 orthogonal blending lowers turnover, but may not lower correlation**; correlation depends on signal source, not weighting.
9. **Verify fields first**; invalid fields fail within seconds.
10. **True low correlation in USA TOP3000 is difficult**; different expressions from the same data pool are often highly correlated.

---

## 11. Self-Evolution Mechanism

After each interaction with BRAIN (submissions, queries, analysis), the AI should write new findings back into this SKILL so that it continuously evolves with practical experience.

### 11.1 Trigger Conditions

Run `scripts/evolve_skill.py` once whenever any of the following occurs:

- Submitted one or more new alphas
- Completed a batch backtest of alphas
- Queried alpha status and detected state changes (e.g., UNSUBMITTED → ACTIVE, or rejected)
- Discovered new field availability / failure modes

### 11.2 Execution

**Prerequisites**: Set `WQ_BRAIN_USERNAME` / `WQ_BRAIN_PASSWORD`, or place an untracked `credential.txt` in the skill directory containing BRAIN credentials as a JSON array:

```json
["your_username", "your_password"]
```

```bash
# 1. Preview: Generate proposed markdown snippet to append without modifying any files
pyenv exec python scripts/evolve_skill.py

# 2. Apply: Append snippet to SKILL.md and update alpha_db.json
pyenv exec python scripts/evolve_skill.py --apply
```

> Note: **Preview mode without `--apply` will not modify `alpha_db.json` or `SKILL.md`**, allowing manual review before committing. The script depends only on `requests` and `numpy`. Data files are distributed with the SKILL.

The script will:

1. Fetch `/users/self/alphas` (paginated) to obtain all alphas.
2. Compare against local `alpha_db.json` to identify **newly added** or **status/metric-changed** alphas.
3. Fetch `recordsets/pnl` for new alphas and compute **daily return correlation** against existing ACTIVE alphas.
4. Automatically generate lesson entries (metric assessment + correlation evaluation + expression summary).
5. Output a **bulk snapshot** on first run; output **incremental entries** on subsequent runs.
6. Under `--apply` mode, append entries to `## 12. Empirical Records (Auto-Updated)` and save to local `alpha_db.json`.

### 11.3 How AI Should Summarize Lessons

After script execution, the AI should **manually evaluate** which entries are worth persisting in the SKILL:

- **Keep**: High Fitness, low turnover success cases; new low-correlation signal families; unexpected failure patterns.
- **Consolidate**: Multiple repetitive entries from the same signal family should be merged into concise rules.
- **Update Templates / Thresholds**: If a field or template fails repeatedly, return to Sections 4, 5, and 6 to update rules.

### 11.4 Data Structures

- `alpha_db.json`: Local alpha snapshot database, including status, metrics, expressions, and PnL. Contains personal research records and is ignored by `.gitignore` by default.
- `SKILL.md`: Final human-readable playbook. Section 12 contains only sanitized, general empirical rules.

## 12. Empirical Records (Auto-Updated)

> This section retains mechanism instructions only. Real execution records including alpha IDs, expressions, PnL, submission statuses, and correlations are stored in local `alpha_db.json` and are not published with the repository.
> To record general empirical lessons, manually summarize them into sanitized rules and write them back into Sections 4, 5, 6, 8, and 10.
