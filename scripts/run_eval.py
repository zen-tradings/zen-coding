#!/usr/bin/env python3
"""Run the coding-agent eval suite (evals/evals.json).

For each case: clone `repo` at `base_commit` into evals/runs/iteration-N/<id>/repo,
run pi headless with the case prompt, then run the case's assertion commands in the
checkout. Results land next to the checkout as result.json; aggregate.py folds an
iteration into benchmark.json.

Usage:
  python3 scripts/run_eval.py                 # run all cases, next iteration number
  python3 scripts/run_eval.py smoke-hello     # only this case id
  python3 scripts/run_eval.py --track deploy-strategy   # only one track
  python3 scripts/run_eval.py --model deepseek --provider deepseek
  python3 scripts/run_eval.py --iteration 3   # write into iteration-3 explicitly
  python3 scripts/run_eval.py --clean         # delete each checkout after its run
  python3 scripts/run_eval.py --runs 3        # 3 attempts per case (variance estimate)

Each case runs `--runs` independent attempts (fresh checkout each) under
<case-id>/attempts/attempt-k/; the case-level result.json aggregates them:
pass_rate (+ binomial stddev), all_passed / any_passed, duration mean/stddev.
A case counts as passed only if ALL attempts pass (n=1 matches legacy behavior).
run_meta.json records the effective model/provider (CLI flags, else pi's
defaultModel/defaultProvider from settings.json) plus pi version and timestamp.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVALS = ROOT / "evals"
RUNS = EVALS / "runs"


def sh(cmd: list[str], cwd: Path | None = None, timeout: int | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, timeout=timeout, capture_output=True, text=True)


def next_iteration() -> int:
    RUNS.mkdir(parents=True, exist_ok=True)
    taken = [int(p.name.split("-")[1]) for p in RUNS.glob("iteration-*") if p.name.split("-")[1].isdigit()]
    return max(taken, default=0) + 1


def checkout(repo: str, commit: str, dest: Path) -> None:
    src = (ROOT / repo).resolve() if not repo.startswith(("http://", "https://", "git@")) else repo
    r = sh(["git", "clone", "--no-hardlinks", "--quiet", str(src), str(dest)])
    if r.returncode != 0:
        raise RuntimeError(f"clone failed: {r.stderr.strip()}")
    r = sh(["git", "-C", str(dest), "checkout", "--detach", "--quiet", commit])
    if r.returncode != 0:
        raise RuntimeError(f"checkout {commit} failed: {r.stderr.strip()}")


# Files copied from the real pi config dir into the per-case isolated one, so evals
# keep model auth but never load machine-global state (installed git extensions,
# sessions, trust db). Without this, running pi inside a zen-coding clone loads
# zen-tools twice (clone's .pi/extensions + ~/.pi/agent/git/... install) and pi
# refuses to start with a tool-name conflict.
PI_CONFIG_PASSTHROUGH = ("auth.json", "models.json", "models-store.json", "settings.json")


def isolated_pi_env(cdir: Path) -> dict:
    src = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent"))
    pi_home = cdir / "pi-home"
    pi_home.mkdir(parents=True, exist_ok=True)
    for name in PI_CONFIG_PASSTHROUGH:
        f = src / name
        if f.is_file():
            shutil.copy2(f, pi_home / name)
    env = dict(os.environ)
    env["PI_CODING_AGENT_DIR"] = str(pi_home)
    return env


def run_agent(prompt: str, cwd: Path, timeout_s: int, agent_args: list[str], log: Path, env: dict) -> dict:
    cmd = ["npx", "pi", "--mode", "json", "--no-session", *agent_args, "-p", prompt]
    start = time.monotonic()
    try:
        r = subprocess.run(cmd, cwd=cwd, timeout=timeout_s, capture_output=True, text=True, env=env)
        timed_out, exit_code = False, r.returncode
        log.write_text(r.stdout + ("\n--- stderr ---\n" + r.stderr if r.stderr else ""))
    except subprocess.TimeoutExpired as exc:
        timed_out, exit_code = True, -1
        log.write_text((exc.stdout or "") + "\n--- TIMED OUT ---\n")
    return {"exit": exit_code, "timed_out": timed_out, "duration_s": round(time.monotonic() - start, 1)}


def run_attempt(case: dict, adir: Path, agent_args: list[str], clean: bool) -> dict:
    workdir = adir / "repo"
    adir.mkdir(parents=True, exist_ok=True)
    result: dict = {"id": case["id"], "repo": case["repo"], "base_commit": case["base_commit"],
                    "track": case.get("track", "untagged")}
    try:
        checkout(case["repo"], case["base_commit"], workdir)
    except RuntimeError as exc:
        result.update(error=str(exc), passed=False)
        return result

    result["agent"] = run_agent(case["prompt"], workdir, case.get("timeout_s", 600), agent_args,
                                adir / "agent.jsonl", isolated_pi_env(adir))

    checks = []
    for a in case["assertions"]:
        r = subprocess.run(["bash", "-c", a["cmd"]], cwd=workdir, capture_output=True, text=True)
        checks.append({**a, "exit": r.returncode, "pass": r.returncode == 0,
                       "output": (r.stdout + r.stderr).strip()[-500:]})
    result["assertions"] = checks
    result["passed"] = all(c["pass"] for c in checks) and not result["agent"]["timed_out"]

    if clean:
        shutil.rmtree(workdir, ignore_errors=True)
    return result


def summarize(case: dict, attempts: list[dict]) -> dict:
    """Aggregate per-attempt results into the case-level result.json.

    Backward-compatible fields kept for aggregate.py: `passed` (strict: all
    attempts passed), `agent.duration_s` (mean), `assertions` (flattened across
    attempts, each tagged with its attempt number).
    """
    n = len(attempts)
    k = sum(1 for a in attempts if a.get("passed"))
    p = k / n
    durs = [a.get("agent", {}).get("duration_s", 0) for a in attempts]
    mean_dur = round(sum(durs) / n, 1)
    summary: dict = {
        "id": case["id"], "repo": case["repo"], "base_commit": case["base_commit"],
        "track": case.get("track", "untagged"),
        "runs": n,
        "pass_count": k,
        "pass_rate": round(p, 3),
        # binomial sampling error of the pass-rate estimate itself
        "pass_rate_stddev": round(math.sqrt(p * (1 - p) / n), 3),
        "all_passed": k == n,
        "any_passed": k > 0,
        "passed": k == n,
        "agent": {
            "duration_s": mean_dur,
            "mean_duration_s": mean_dur,
            "stddev_duration_s": round(statistics.stdev(durs), 1) if n > 1 else 0.0,
            "timed_out_count": sum(1 for a in attempts if a.get("agent", {}).get("timed_out")),
        },
        "assertions": [{**a, "attempt": i + 1}
                       for i, att in enumerate(attempts) for a in att.get("assertions", [])],
        "attempts": [{"attempt": i + 1, "passed": a.get("passed", False),
                      "duration_s": a.get("agent", {}).get("duration_s"),
                      "timed_out": a.get("agent", {}).get("timed_out", False),
                      "error": a.get("error")}
                     for i, a in enumerate(attempts)],
    }
    if all("error" in a for a in attempts):
        summary["error"] = attempts[-1]["error"]
    return summary


def run_case(case: dict, itdir: Path, agent_args: list[str], clean: bool, runs: int) -> dict:
    cdir = itdir / case["id"]
    cdir.mkdir(parents=True, exist_ok=True)
    attempts = []
    for k in range(1, runs + 1):
        if runs > 1:
            print(f"   attempt {k}/{runs} ...", flush=True)
        adir = cdir / "attempts" / f"attempt-{k}"
        a = run_attempt(case, adir, agent_args, clean)
        (adir / "result.json").write_text(json.dumps(a, indent=2))
        attempts.append(a)
    return summarize(case, attempts)


def pi_version() -> str | None:
    pkg = ROOT / "node_modules" / "@earendil-works" / "pi-coding-agent" / "package.json"
    try:
        return json.loads(pkg.read_text()).get("version")
    except (OSError, json.JSONDecodeError):
        return None


def effective_model(cli_model: str | None, cli_provider: str | None) -> tuple:
    """CLI flags win; otherwise fall back to the pi config dir's defaults so
    run_meta.json always names the model that actually produced the results."""
    if cli_model or cli_provider:
        return cli_model, cli_provider, "cli"
    src = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent")) / "settings.json"
    try:
        s = json.loads(src.read_text())
        return s.get("defaultModel"), s.get("defaultProvider"), "settings.json"
    except (OSError, json.JSONDecodeError):
        return None, None, "unknown"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_ids", nargs="*", help="run only these case ids")
    ap.add_argument("--iteration", type=int, help="iteration number (default: next free)")
    ap.add_argument("--track", help="run only cases with this track tag")
    ap.add_argument("--model", help="passed through to pi --model")
    ap.add_argument("--provider", help="passed through to pi --provider")
    ap.add_argument("--runs", type=int, default=1,
                    help="attempts per case (default 1); use >=3 for variance estimates")
    ap.add_argument("--clean", action="store_true", help="delete checkouts after each case")
    args = ap.parse_args()
    if args.runs < 1:
        sys.exit("--runs must be >= 1")

    cases = json.loads((EVALS / "evals.json").read_text())["cases"]
    cases = [c for c in cases if c.get("enabled", True)]
    if args.track:
        cases = [c for c in cases if c.get("track", "untagged") == args.track]
    if args.case_ids:
        cases = [c for c in cases if c["id"] in args.case_ids]
        missing = set(args.case_ids) - {c["id"] for c in cases}
        if missing:
            sys.exit(f"unknown case ids: {', '.join(sorted(missing))}")
    if not cases:
        sys.exit("no cases to run")

    agent_args = []
    if args.provider:
        agent_args += ["--provider", args.provider]
    if args.model:
        agent_args += ["--model", args.model]

    model, provider, model_source = effective_model(args.model, args.provider)
    itdir = RUNS / f"iteration-{args.iteration or next_iteration()}"
    itdir.mkdir(parents=True, exist_ok=True)
    (itdir / "run_meta.json").write_text(json.dumps({
        "model": model,
        "provider": provider,
        "model_source": model_source,
        "pi_version": pi_version(),
        "runs_per_case": args.runs,
        "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cases": [c["id"] for c in cases],
    }, indent=2))

    failed = 0
    for case in cases:
        print(f"== {case['id']} ... ({args.runs} run{'s' if args.runs > 1 else ''})", flush=True)
        result = run_case(case, itdir, agent_args, args.clean, args.runs)
        (itdir / case["id"] / "result.json").write_text(json.dumps(result, indent=2))
        ok = result.get("passed", False)
        failed += 0 if ok else 1
        stats = f"{result.get('pass_count', int(ok))}/{result.get('runs', 1)} runs"
        dur = result.get("agent", {}).get("mean_duration_s", "-")
        print(f"   {'PASS' if ok else 'FAIL'}  {stats}  (mean {dur}s)  -> {itdir / case['id']}")

    print(f"\n{len(cases) - failed}/{len(cases)} passed. Results in {itdir}")
    print("Next: python3 scripts/aggregate.py")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
