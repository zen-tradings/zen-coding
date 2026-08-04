---
description: Run the eval suite (evals/evals.json) and report the benchmark verdict
argument-hint: "[case-id ...] [--model m --provider p]"
---
Run the internal eval suite and report the verdict.

1. Run `python3 scripts/run_eval.py ${@:-}` from the repo root and wait for it to
   finish (each case clones a repo and runs a full headless agent session — this
   can take minutes).
2. Then run `python3 scripts/aggregate.py`.
3. Read the newest `evals/runs/iteration-N/benchmark.json` and report:
   - pass/fail per case, with the failed assertion descriptions and, for
     failures, the relevant tail of that case's `agent.jsonl`
   - mean duration
   - regressions vs the baseline iteration (if any — call these out first;
     a regression blocks promotion)

Do not fix failures unless asked — the deliverable is the verdict.
