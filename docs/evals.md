# Eval harness

zen-coding ships a small, reproducible benchmark harness for measuring the agent
against a fixed set of coding tasks — and for comparing models on the same tasks.

Requirements: Python 3, `git`, and a working `npx pi` (i.e. `npm install` has run).

## Concepts

An **eval case** ([`evals/evals.json`](../evals/evals.json)) is:

| Field | Meaning |
|---|---|
| `id` | Unique case name |
| `track` | Workload group (e.g. `infra`, `quant-research`) — used for filtering and per-track pass rates |
| `repo` | Repository to test in: an absolute path, a path relative to the zen-coding root (`.` = zen-coding itself), or a git URL |
| `base_commit` | Commit to check out before the run |
| `prompt` | The task given to the agent |
| `timeout_s` | Wall-clock limit for the agent run |
| `assertions` | List of `{desc, cmd}` — each `cmd` runs in the checkout with bash; exit 0 = pass |
| `enabled` | Set to `false` to keep a case in the file but skip it |

For every case the runner makes a **fresh checkout**, runs pi headlessly
(`pi --mode json --no-session -p "<prompt>"`) inside it, then executes the
assertions. Pass criteria are fixed before the run — never adjust assertions to fit
results. `smoke-hello` is the one case that works out of the box; it only proves the
loop runs.

## Running

From the repository root:

```bash
python3 scripts/run_eval.py                          # all enabled cases, next iteration number
python3 scripts/run_eval.py smoke-hello              # a single case
python3 scripts/run_eval.py --track quant-research   # one track
python3 scripts/run_eval.py --model deepseek-chat --provider deepseek
python3 scripts/run_eval.py --runs 3                 # 3 attempts per case (variance estimate)
python3 scripts/run_eval.py --iteration 5            # write into a specific iteration
python3 scripts/run_eval.py --clean                  # delete each checkout after its run
```

Then fold the iteration into a benchmark summary and compare with the previous one:

```bash
python3 scripts/aggregate.py                # newest iteration
python3 scripts/aggregate.py --iteration 5
```

Inside the agent, `/eval [case-id ...] [--model m --provider p]` runs both steps and
reports the verdict — regressions first.

## Output layout

Everything lands under `evals/runs/` (gitignored):

```
evals/runs/iteration-N/
  run_meta.json                 # effective model/provider, pi version, timestamp
  benchmark.json                # written by aggregate.py
  <case-id>/
    result.json                 # case-level aggregate over attempts
    attempts/attempt-k/
      repo/                     # the checkout (unless --clean)
      agent.jsonl               # pi's streamed JSON events for the run
      result.json               # per-attempt pass/fail, durations, assertion results
```

`run_meta.json` always records the model that actually produced the results — either
the CLI flags or pi's `defaultModel`/`defaultProvider` from `.pi/settings.json`.

## Multiple attempts

With `--runs k`, each case runs `k` independent attempts on fresh checkouts. The
case-level `result.json` reports `pass_rate` with a binomial standard deviation,
`all_passed` / `any_passed`, and duration mean/stddev. A case counts as **passed only
if every attempt passes**; `--runs 1` matches single-run behaviour.

## benchmark.json

`aggregate.py` produces, per iteration:

- overall and per-case pass/fail and pass rates
- per-track pass rates
- mean duration
- `baseline_iteration` and `regressions` — cases that passed in the previous iteration
  and failed in this one. Any regression prints
  `REGRESSION vs previous iteration — do not promote.` and should block promotion of
  whatever changed.

## Writing a good case

- Make the prompt self-contained; the agent sees nothing but the checkout and the
  prompt.
- Assert on behaviour, not on implementation details, unless the detail *is* the
  requirement.
- Include at least one negative assertion (something that must **not** happen).
- Keep `timeout_s` generous — a slow model that finishes is more informative than a
  timeout.
- Cases that reference repositories you cannot publish should be marked
  `"enabled": false` or pointed at a public fork.
