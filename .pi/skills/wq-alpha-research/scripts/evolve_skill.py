"""WQ Alpha Research Skill self-evolution helper.

Self-contained: only needs `requests`, `numpy`, and credentials supplied via
environment variables or a local untracked `credential.txt` file.

Usage:
    cd <skill-dir>
    pyenv exec python scripts/evolve_skill.py
    pyenv exec python scripts/evolve_skill.py --apply

Behavior:
    - First run (empty alpha_db.json): bulk snapshot.
    - Subsequent runs: incremental entries for new/changed alphas.
    - Without --apply: prints proposed markdown snippet, modifies nothing.
    - With --apply: appends snippet to SKILL.md Section 12 and saves alpha_db.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import requests
from requests.auth import HTTPBasicAuth

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
ALPHA_DB_PATH = SKILL_DIR / "alpha_db.json"
SKILL_PATH = SKILL_DIR / "SKILL.md"
CREDENTIAL_PATH = SKILL_DIR / "credential.txt"

API_BASE = "https://api.worldquantbrain.com"

HEADERS = {
    "Accept": "application/json;version=2.0",
    "Content-Type": "application/json",
}


def load_credentials() -> tuple[str, str]:
    """Load BRAIN credentials without relying on committed secrets."""
    env_user = os.getenv("WQ_BRAIN_USERNAME")
    env_password = os.getenv("WQ_BRAIN_PASSWORD")
    if env_user and env_password:
        return env_user, env_password

    candidates = [
        CREDENTIAL_PATH,
        Path.cwd() / "credential.txt",
    ]
    for p in candidates:
        if p.exists():
            username, password = json.loads(p.read_text(encoding="utf-8"))
            return str(username), str(password)
    raise FileNotFoundError(
        "BRAIN credentials not found. Set WQ_BRAIN_USERNAME/WQ_BRAIN_PASSWORD "
        'or create an untracked credential.txt with ["your_username", "your_password"].'
    )


def create_session() -> requests.Session:
    username, password = load_credentials()
    session = requests.Session()
    session.auth = HTTPBasicAuth(username, password)
    session.headers.update(HEADERS)

    resp = session.post(f"{API_BASE}/authentication")
    if resp.status_code != 201:
        raise RuntimeError(f"BRAIN auth failed: {resp.status_code} {resp.text}")
    return session


def get_with_retry(session: requests.Session, url: str, retries: int = 3, **kwargs) -> requests.Response:
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=(10, 60), **kwargs)
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 5))
                time.sleep(retry_after)
                continue
            return resp
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"GET {url} failed after {retries} retries")


def fetch_pnl(session: requests.Session, alpha_id: str) -> list[float]:
    """Fetch cumulative PnL recordset; tolerate list/dict schema.properties."""
    try:
        resp = get_with_retry(
            session,
            f"{API_BASE}/alphas/{alpha_id}/recordsets/pnl",
        )
    except Exception:
        return []
    if resp.status_code != 200 or not resp.text.strip():
        return []
    try:
        data = resp.json()
    except Exception:
        return []

    schema = data.get("schema", {})
    props = schema.get("properties", [])
    if isinstance(props, list):
        date_idx = next((i for i, p in enumerate(props) if p.get("name", "").lower() == "date"), 0)
        pnl_idx = next(
            (i for i, p in enumerate(props) if p.get("name", "").lower() in ("pnl", "cum_pnl", "returns", "ret")),
            1,
        )
    else:
        date_idx = next((v["index"] for k, v in props.items() if k.lower() == "date"), 0)
        pnl_idx = next(
            (v["index"] for k, v in props.items() if k.lower() in ("pnl", "cum_pnl", "returns", "ret")),
            1,
        )

    records = sorted(data.get("records", []), key=lambda r: r[date_idx])
    out: list[float] = []
    for row in records:
        rec = row[0] if isinstance(row, list) and len(row) == 1 and isinstance(row[0], list) else row
        try:
            out.append(float(rec[pnl_idx]))
        except Exception:
            continue
    return out


def fetch_user_alphas(session: requests.Session, limit: int = 100) -> list[dict]:
    """Fetch all user alphas with pagination."""
    all_alphas: list[dict] = []
    offset = 0
    while True:
        resp = get_with_retry(
            session,
            f"{API_BASE}/users/self/alphas",
            params={"limit": limit, "offset": offset},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Failed to fetch alphas: {resp.status_code} {resp.text}")
        data = resp.json()
        batch = data.get("results", data.get("alphas", []))
        if not batch:
            break
        all_alphas.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
        time.sleep(0.2)
    return all_alphas


def daily_returns(cum_pnl: list[float]) -> list[float]:
    return [cum_pnl[i + 1] - cum_pnl[i] for i in range(len(cum_pnl) - 1)]


def load_alpha_db() -> dict[str, Any]:
    if ALPHA_DB_PATH.exists():
        return json.loads(ALPHA_DB_PATH.read_text(encoding="utf-8"))
    return {"alphas": {}, "last_update": None, "version": 1}


def save_alpha_db(db: dict[str, Any]) -> None:
    ALPHA_DB_PATH.write_text(json.dumps(db, indent=2, default=str), encoding="utf-8")


def compute_alpha_fingerprint(alpha: dict) -> dict[str, Any]:
    """Stable snapshot of an alpha that we can compare across runs."""
    is_ = alpha.get("is", {}) if isinstance(alpha.get("is"), dict) else {}
    expr_obj = alpha.get("regular", alpha.get("expression", {}))
    expr = expr_obj.get("code") if isinstance(expr_obj, dict) else str(expr_obj)
    settings = alpha.get("settings", {})
    return {
        "status": alpha.get("status"),
        "expression": expr,
        "settings": settings,
        "sharpe": is_.get("sharpe"),
        "fitness": is_.get("fitness"),
        "returns": is_.get("returns"),
        "turnover": is_.get("turnover"),
        "drawdown": is_.get("drawdown"),
        "margin": is_.get("margin"),
        "long_count": is_.get("longCount"),
        "short_count": is_.get("shortCount"),
    }


def classify_alpha(expr: str) -> str:
    """Rough family classification based on expression tokens."""
    expr_lower = expr.lower()
    tokens = []
    if any(f in expr_lower for f in ["operating_income/equity", "oi/equity", "operating_income/sales"]):
        tokens.append("profitability")
    if any(f in expr_lower for f in ["est_eps", "est_fcf", "est_revenue", "est_ebitda", "est_ptp"]):
        tokens.append("analyst")
    if any(f in expr_lower for f in ["free_cash_flow", "cashflow_op", "cash_flow"]):
        tokens.append("cashflow")
    if any(f in expr_lower for f in ["close/open", "open/close", "vwap", "returns", "volume", "high + low"]):
        tokens.append("technical")
    if any(f in expr_lower for f in ["scl12_buzz", "scl12_sentiment", "sentiment"]):
        tokens.append("sentiment")
    if any(f in expr_lower for f in ["equity/assets", "liabilities/assets", "sales/assets"]):
        tokens.append("quality/leverage")
    return "+".join(tokens) if tokens else "other"


def correlation_with_existing(
    new_pnl: list[float], db: dict[str, Any], min_records: int = 50
) -> list[dict[str, Any]]:
    """Compute daily-return correlation of a new alpha against all ACTIVE alphas in DB."""
    if len(new_pnl) < min_records + 1:
        return []
    new_ret = np.array(daily_returns(new_pnl))
    results: list[dict[str, Any]] = []
    for old_id, old in db.get("alphas", {}).items():
        if old.get("status") != "ACTIVE" or not old.get("pnl"):
            continue
        old_ret = np.array(daily_returns(old["pnl"]))
        if len(new_ret) != len(old_ret):
            continue
        corr = float(np.corrcoef(new_ret, old_ret)[0, 1])
        results.append({"alpha_id": old_id, "corr": corr, "sharpe": old.get("sharpe"), "fitness": old.get("fitness")})
    results.sort(key=lambda x: abs(x["corr"]), reverse=True)
    return results


def generate_lesson(fp: dict[str, Any], top_corr: list[dict[str, Any]]) -> str:
    """Generate a one-line lesson from this alpha."""
    family = classify_alpha(fp["expression"])

    if fp["fitness"] is None:
        metric_note = "Simulation failed or data missing"
    elif fp["fitness"] >= 1.5 and fp["turnover"] is not None and fp["turnover"] <= 0.15:
        metric_note = "High Fitness and low turnover, excellent candidate"
    elif fp["fitness"] >= 1.1 and fp["turnover"] is not None and fp["turnover"] <= 0.20:
        metric_note = "Meets basic submission threshold"
    elif fp["turnover"] is not None and fp["turnover"] > 0.35:
        metric_note = "Turnover too high, need higher decay or signal blending"
    else:
        metric_note = "Average metrics, needs further optimization"

    if not top_corr:
        corr_note = "No ACTIVE alpha available for correlation comparison"
    elif abs(top_corr[0]["corr"]) >= 0.7:
        corr_note = f"Highly correlated with {top_corr[0]['alpha_id']} ({top_corr[0]['corr']:.2f}), need to change signal family"
    elif abs(top_corr[0]["corr"]) >= 0.5:
        corr_note = f"Moderately correlated with {top_corr[0]['alpha_id']} ({top_corr[0]['corr']:.2f}), submit with caution"
    else:
        corr_note = f"Low correlation with existing ACTIVE alphas ({top_corr[0]['corr']:.2f}), high diversification value"

    return f"{metric_note}; {corr_note}"


def truncate_expr(expr: str, max_len: int = 120) -> str:
    expr = expr or ""
    lines = expr.strip().splitlines()
    first = lines[0].strip() if lines else ""
    if len(first) > max_len:
        first = first[: max_len - 3] + "..."
    return first


def build_bulk_summary(alphas: list[dict], active_correlations: dict[str, list[dict[str, Any]]]) -> str:
    """Build a compact summary for the first (bulk) run."""
    from collections import Counter

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    total = len(alphas)
    active = [a for a in alphas if a.get("status") == "ACTIVE"]
    unsubmitted = [a for a in alphas if a.get("status") != "ACTIVE"]
    families = Counter(classify_alpha(a.get("regular", {}).get("code", "")) for a in alphas)

    top_active = sorted(active, key=lambda a: (a.get("is", {}).get("fitness") or 0), reverse=True)[:5]
    failures = [a for a in alphas if a.get("is", {}).get("fitness") is not None and a.get("is", {}).get("fitness") < 0.5]
    high_to = [a for a in alphas if a.get("is", {}).get("turnover") is not None and a.get("is", {}).get("turnover") > 0.50]

    lines = [
        f"\n### {now} — Bulk Initialization Snapshot\n",
        f"- Total alphas: {total} | ACTIVE: {len(active)} | Non-ACTIVE: {len(unsubmitted)}",
        f"- Signal family distribution: {dict(families.most_common(8))}",
        "",
        "**ACTIVE High Fitness Top 5**:",
    ]
    for a in top_active:
        is_ = a.get("is", {})
        expr = truncate_expr(a.get("regular", {}).get("code", ""))
        lines.append(
            f"- `{a['id']}` ({classify_alpha(a.get('regular', {}).get('code', ''))}): "
            f"Sharpe={is_.get('sharpe'):.2f}, Fitness={is_.get('fitness'):.2f}, TO={is_.get('turnover'):.3f} — `{expr}`"
        )

    if active_correlations:
        high_corr_pairs = []
        ids = sorted(active_correlations.keys())
        for i, a in enumerate(ids):
            for b in ids[i + 1 :]:
                corr = next((c["corr"] for c in active_correlations[a] if c["alpha_id"] == b), None)
                if corr is None:
                    corr = next((c["corr"] for c in active_correlations[b] if c["alpha_id"] == a), 0.0)
                if abs(corr) >= 0.7:
                    high_corr_pairs.append((a, b, corr))
        if high_corr_pairs:
            lines.extend(["", "**ACTIVE High Daily Return Correlation Pairs (≥ 0.7)**:"])
            for a, b, c in high_corr_pairs[:10]:
                lines.append(f"- `{a}` vs `{b}`: {c:.3f}")
        else:
            lines.extend(["", "**ACTIVE High Daily Return Correlation Pairs**: No pairs ≥ 0.7 (or insufficient PnL)"])

    if failures:
        lines.extend(["", f"**Failed Signals (Fitness < 0.5, Total: {len(failures)})**:"])
        families_fail = Counter(classify_alpha(a.get("regular", {}).get("code", "")) for a in failures)
        lines.append(f"- Family distribution: {dict(families_fail.most_common(5))}")

    if high_to:
        lines.extend(["", f"**High Turnover (TO > 50%, Total: {len(high_to)})**:"])
        families_to = Counter(classify_alpha(a.get("regular", {}).get("code", "")) for a in high_to)
        lines.append(f"- Family distribution: {dict(families_to.most_common(5))}")

    lines.append("\n---\n")
    return "\n".join(lines)


def build_incremental_report(entries: list[dict[str, Any]]) -> str:
    """Build per-alpha markdown for incremental updates."""
    if not entries:
        return ""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"\n### {now}\n"]
    for e in entries:
        if e.get("event") == "status_or_metric_changed":
            lines.append(
                f"- **{e['alpha_id']}** Status change: {e['old_status']} → {e['new_status']}; "
                f"Sharpe={e['sharpe']}, Fitness={e['fitness']}, TO={e['turnover']}. {e['lesson']}"
            )
        else:
            lines.append(
                f"- **{e['alpha_id']}** ({e['status']}, {e['family']}): "
                f"Sharpe={e['sharpe']}, Fitness={e['fitness']}, TO={e['turnover']}, DD={e['drawdown']}."
                f"{e['lesson']}"
            )
            if e["top_corr"]:
                corr_strs = [f"{c['alpha_id']}({c['corr']:+.2f})" for c in e["top_corr"]]
                lines.append(f"  - Correlation: {', '.join(corr_strs)}")
            expr = truncate_expr(e["expression"])
            if expr:
                lines.append(f"  - Expression: `{expr}`")
    lines.append("\n---\n")
    return "\n".join(lines)


def append_to_skill(snippet: str) -> None:
    """Append snippet to the end of SKILL.md (Section 12 is the last section)."""
    if not SKILL_PATH.exists():
        raise FileNotFoundError(f"SKILL.md not found at {SKILL_PATH}")
    content = SKILL_PATH.read_text(encoding="utf-8")
    marker = "## 12. Empirical Records (Auto-Updated)"
    if marker not in content:
        content += f"\n\n{marker}\n\n{snippet}"
    else:
        if not content.endswith("\n"):
            content += "\n"
        content += snippet + "\n"
    SKILL_PATH.write_text(content, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Evolve WQ Alpha Research SKILL with new empirical data.")
    parser.add_argument("--apply", action="store_true", help="Automatically append the generated snippet to SKILL.md")
    args = parser.parse_args()

    session = create_session()
    print("auth ok", flush=True)

    db = load_alpha_db()
    known_ids = set(db.get("alphas", {}).keys())
    is_first_run = len(known_ids) == 0

    all_alphas = fetch_user_alphas(session)
    print(f"fetched {len(all_alphas)} alphas, known={len(known_ids)}", flush=True)

    new_alphas: list[dict] = []
    changed_alphas: list[tuple[dict, dict]] = []

    for alpha in all_alphas:
        aid = alpha.get("id")
        if not aid:
            continue
        fp = compute_alpha_fingerprint(alpha)

        if aid not in known_ids:
            new_alphas.append(alpha)
        else:
            old = db["alphas"][aid]
            if old.get("status") != fp["status"] or old.get("sharpe") != fp["sharpe"]:
                changed_alphas.append((old, {**fp, "alpha_id": aid}))

    # ------------------------------------------------------------------
    # Preview mode: compute snippet without mutating DB
    # ------------------------------------------------------------------
    if is_first_run:
        print("first run: building bulk snapshot...", flush=True)
        active_alphas = [a for a in all_alphas if a.get("status") == "ACTIVE"]
        active_correlations: dict[str, list[dict[str, Any]]] = {}

        preview_db = {"alphas": {}}
        for idx, alpha in enumerate(all_alphas):
            aid = alpha.get("id")
            fp = compute_alpha_fingerprint(alpha)
            pnl = fetch_pnl(session, aid)
            preview_db["alphas"][aid] = {**fp, "pnl": pnl}
            if idx % 10 == 0:
                print(f"  fetched {idx + 1}/{len(all_alphas)} PnLs", flush=True)
            time.sleep(0.3)

        active_ids = [a.get("id") for a in active_alphas if a.get("id")]
        for aid in active_ids:
            pnl = preview_db["alphas"][aid].get("pnl", [])
            active_correlations[aid] = correlation_with_existing(pnl, preview_db)

        snippet = build_bulk_summary(all_alphas, active_correlations)

        if args.apply:
            db["alphas"] = preview_db["alphas"]
    else:
        # ------------------------------------------------------------------
        # Incremental run: per-alpha entries for new/changed only
        # ------------------------------------------------------------------
        print(f"incremental: {len(new_alphas)} new, {len(changed_alphas)} changed", flush=True)
        entries: list[dict[str, Any]] = []

        for alpha in new_alphas:
            aid = alpha.get("id")
            fp = compute_alpha_fingerprint(alpha)
            pnl = fetch_pnl(session, aid)

            top_corr = correlation_with_existing(pnl, db)
            lesson = generate_lesson(fp, top_corr)
            entries.append(
                {
                    "alpha_id": aid,
                    "status": fp["status"],
                    "family": classify_alpha(fp["expression"]),
                    "sharpe": fp["sharpe"],
                    "fitness": fp["fitness"],
                    "turnover": fp["turnover"],
                    "drawdown": fp["drawdown"],
                    "expression": fp["expression"],
                    "top_corr": top_corr[:3],
                    "lesson": lesson,
                }
            )
            if args.apply:
                db["alphas"][aid] = {**fp, "pnl": pnl}
            print(f"  new: {aid} | sharpe={fp['sharpe']} | fitness={fp['fitness']} | to={fp['turnover']}")
            time.sleep(0.3)

        for old, new in changed_alphas:
            aid = new["alpha_id"]
            if aid in db["alphas"] and "pnl" in db["alphas"][aid]:
                new["pnl"] = db["alphas"][aid]["pnl"]
            entries.append(
                {
                    "alpha_id": aid,
                    "event": "status_or_metric_changed",
                    "old_status": old.get("status"),
                    "new_status": new["status"],
                    "sharpe": new["sharpe"],
                    "fitness": new["fitness"],
                    "turnover": new["turnover"],
                    "lesson": f"Status changed from {old.get('status')} to {new['status']}",
                }
            )
            if args.apply:
                db["alphas"][aid] = new
            print(f"  changed: {aid} | {old.get('status')} -> {new['status']}")

        snippet = build_incremental_report(entries)

    if not snippet.strip():
        print("\nNo new empirical findings to record.")
        return 0

    print("\n" + "=" * 60)
    print("PROPOSED SKILL.md APPEND SNIPPET")
    print("=" * 60)
    print(snippet)
    print("=" * 60)

    if args.apply:
        append_to_skill(snippet)
        db["last_update"] = datetime.now(timezone.utc).isoformat()
        save_alpha_db(db)
        print(f"\nAppended to {SKILL_PATH}")
        print(f"alpha_db.json updated: {len(db['alphas'])} alphas tracked.")
    else:
        print("\nDry-run: SKILL.md and alpha_db.json were NOT modified. Use --apply to commit.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
