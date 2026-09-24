#!/usr/bin/env python3
"""Run the coding-agent eval suite (evals/evals.json).

For each case: clone `repo` at `base_commit` into evals/runs/iteration-N/<id>/repo,
run pi headless with the case prompt, then run the case's assertion commands in the
checkout. Results land next to the checkout as result.json; aggregate.py folds an
iteration into benchmark.json.

Usage:
  python3 scripts/run_eval.py                 # run all cases, next iteration number
  python3 scripts/run_eval.py smoke-hello     # only this case id
  python3 scripts/run_eval.py --model deepseek --provider deepseek
  python3 scripts/run_eval.py --iteration 3   # write into iteration-3 explicitly
  python3 scripts/run_eval.py --clean         # delete each checkout after its run
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
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


def run_agent(prompt: str, cwd: Path, timeout_s: int, agent_args: list[str], log: Path) -> dict:
    cmd = ["npx", "pi", "--mode", "json", "--no-session", *agent_args, "-p", prompt]
    start = time.monotonic()
    try:
        r = subprocess.run(cmd, cwd=cwd, timeout=timeout_s, capture_output=True, text=True)
        timed_out, exit_code = False, r.returncode
        log.write_text(r.stdout + ("\n--- stderr ---\n" + r.stderr if r.stderr else ""))
    except subprocess.TimeoutExpired as exc:
        timed_out, exit_code = True, -1
        log.write_text((exc.stdout or "") + "\n--- TIMED OUT ---\n")
    return {"exit": exit_code, "timed_out": timed_out, "duration_s": round(time.monotonic() - start, 1)}


def run_case(case: dict, itdir: Path, agent_args: list[str], clean: bool) -> dict:
    cdir = itdir / case["id"]
    workdir = cdir / "repo"
    cdir.mkdir(parents=True, exist_ok=True)
    result: dict = {"id": case["id"], "repo": case["repo"], "base_commit": case["base_commit"]}
    try:
        checkout(case["repo"], case["base_commit"], workdir)
    except RuntimeError as exc:
        result.update(error=str(exc), passed=False)
        return result

    result["agent"] = run_agent(case["prompt"], workdir, case.get("timeout_s", 600), agent_args, cdir / "agent.jsonl")

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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_ids", nargs="*", help="run only these case ids")
    ap.add_argument("--iteration", type=int, help="iteration number (default: next free)")
    ap.add_argument("--model", help="passed through to pi --model")
    ap.add_argument("--provider", help="passed through to pi --provider")
    ap.add_argument("--clean", action="store_true", help="delete checkouts after each case")
    args = ap.parse_args()

    cases = json.loads((EVALS / "evals.json").read_text())["cases"]
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

    itdir = RUNS / f"iteration-{args.iteration or next_iteration()}"
    itdir.mkdir(parents=True, exist_ok=True)
    (itdir / "run_meta.json").write_text(json.dumps(
        {"model": args.model, "provider": args.provider, "cases": [c["id"] for c in cases]}, indent=2))

    failed = 0
    for case in cases:
        print(f"== {case['id']} ...", flush=True)
        result = run_case(case, itdir, agent_args, args.clean)
        (itdir / case["id"] / "result.json").write_text(json.dumps(result, indent=2))
        ok = result.get("passed", False)
        failed += 0 if ok else 1
        dur = result.get("agent", {}).get("duration_s", "-")
        print(f"   {'PASS' if ok else 'FAIL'}  ({dur}s)  -> {itdir / case['id']}")

    print(f"\n{len(cases) - failed}/{len(cases)} passed. Results in {itdir}")
    print("Next: python3 scripts/aggregate.py")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
