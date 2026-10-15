---
title: "Eval harness"
description: "Run reproducible benchmarks that cover both jobs of Zen Coding: engineering changes and research checks that fail on lookahead."
sidebarTitle: "Eval harness"
---

# Eval harness

zen-coding ships a small, reproducible benchmark harness for measuring the agent
against a fixed set of tasks — and for comparing models on the same tasks.

The suite covers both jobs the product serves. A frontend change and a deploy dry-run
must go through *without* the research rules firing; the research cases carry
verifiers that **fail when the diff introduces lookahead**. A prose note is not a
verifier: every assertion is a command whose exit code decides.

Requirements: Python 3 with `numpy`, `pandas` and `PyYAML`, Node ≥ 22, `git`, and
`npm install` run in this repository — the harness invokes `npx pi`, i.e. the pi version
pinned in `package.json`, so results are tied to a known pi release.

## Cases

| Case | Track | Repository | What it proves |
|---|---|---|---|
| `dashboard-sortino-ratio` | `dashboard` | `../Strategy_Dashboard` | A TypeScript metric change lands with tests; no research guardrail fires on `frontend/`; the session carries no research context |
| `deploy-dry-run` | `deploy` | `../zen-deploy-strategy` | A deploy plan is derived from `docker-compose.yml` and the checkout; the trace shows no `git pull` or container build/start; nothing but the plan files changed |
| `beta-audit-rolling` | `quant-research` | `../zen-deploy-strategy` | Full-sample and rolling exposure estimates recover known betas; **rolling betas are unchanged when data after T is perturbed and when the sample is truncated at T**; verdict rule; research session recorded with a code revision |
| `portfolio-construction` | `quant-research` | `../zen-deploy-strategy` | Dollar-neutral, gross- and single-name-capped book with inverse-vol sizing; **weights up to T are unchanged under perturbation and truncation**; the strongest name is long, the weakest short |
| `research-features-lookahead` | `quant-research` | `../quant_research_lab` | pandas features match their definitions and are strictly trailing; the only negative shift is an annotated label (`# lookahead-ok`); no `inplace=True` |

The priority order from `design.md` is beta audit first, then portfolio construction;
those two verifiers are the ones to extend first.

Target repositories are sibling checkouts (`repo` is resolved relative to this
repository's root). Cases that reference repositories you do not have fail at checkout
and are reported as such.

## Concepts

An **eval case** ([`evals/evals.json`](https://github.com/zen-tradings/zen-coding/blob/main/evals/evals.json)) is:

| Field | Meaning |
|---|---|
| `id` | Unique case name; `evals/fixtures/<id>/` holds its verifier scripts |
| `track` | Job group: `dashboard`, `deploy`, `quant-research` — used for filtering and per-track pass rates |
| `repo` | Repository to test in: an absolute path, a path relative to the zen-coding root, or a git URL |
| `base_commit` | Commit to check out before the run |
| `prompt` | The task given to the agent |
| `timeout_s` | Wall-clock limit for the agent run |
| `assertions` | List of `{desc, cmd}` — each `cmd` runs in the checkout with bash; exit 0 = pass |
| `enabled` | Set to `false` to keep a case in the file but skip it |

For every case the runner makes a **fresh checkout**, runs pi headlessly
(`pi --mode json --no-session -p "<prompt>"`) inside it, then executes the
assertions. Pass criteria are fixed before the run — never adjust assertions to fit
results.

Assertions receive these environment variables:

| Variable | Value |
|---|---|
| `ZEN_EVAL_FIXTURES` | `evals/fixtures/<case-id>` — the case's verifier scripts |
| `ZEN_EVAL_LIB` | `evals/fixtures/lib` — `trace_check.py` (assertions over the zen trace) |
| `ZEN_EVAL_ROOT` | this repository (e.g. to call the `backtest` skill's static scanner) |
| `ZEN_EVAL_TRACE_DIR` | the attempt's zen trace directory (JSONL, schema v2) |

`trace_check.py` subcommands: `forbid-bash REGEX`, `require-event EVENT`,
`no-event EVENT`, `no-guardrail-on REGEX`, `research-field FIELD`, `research-null`.
That is how a case asserts "nothing was deployed" or "no research rule fired on a
frontend file" from evidence rather than from the agent's own report.

## The package under test

Each attempt gets an **isolated pi config directory** (`PI_CODING_AGENT_DIR` →
`attempt-k/pi-home/`), seeded only with your auth and model settings — no sessions and
no saved trust decisions — so runs are reproducible and never touch your real
`~/.pi/agent/`.

By default the isolated home loads **this working tree** as its only pi package, so the
guardrails, traces and skills under test are your local changes, and personal packages
(memory, MCP adapters) cannot influence the run. `run_meta.json` records the package
path and its git revision. Pass `--installed` to keep your own package list instead —
then the zen extensions under test are the ones **published at the configured ref**.

## Running

From the repository root:

```bash
python3 scripts/run_eval.py                          # all enabled cases, next iteration number
python3 scripts/run_eval.py deploy-dry-run           # a single case
python3 scripts/run_eval.py --track quant-research   # one track
python3 scripts/run_eval.py --model deepseek-chat --provider deepseek
python3 scripts/run_eval.py --runs 3                 # 3 attempts per case (variance estimate)
python3 scripts/run_eval.py --iteration 5            # write into a specific iteration
python3 scripts/run_eval.py --clean                  # delete each checkout after its run
python3 scripts/run_eval.py --installed              # test the installed package, not this tree
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
  run_meta.json                 # effective model/provider, pi version, zen package + revision, timestamp
  benchmark.json                # written by aggregate.py
  <case-id>/
    result.json                 # case-level aggregate over attempts
    attempts/attempt-k/
      repo/                     # the checkout (unless --clean)
      traces/<session>.jsonl    # the zen trace of the run
      agent.jsonl               # pi's streamed JSON events for the run
      result.json               # per-attempt pass/fail, durations, assertion results
```

`run_meta.json` always records the model that actually produced the results — either
the CLI flags or pi's `defaultModel`/`defaultProvider` from the pi config directory.

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
- Put the verifier in `evals/fixtures/<id>/` and call it through `$ZEN_EVAL_FIXTURES`.
  Verify behaviour, not implementation details, unless the detail *is* the requirement.
- For research code, include a **perturbation** test (change data after T; outputs up to
  T must not move) and a **truncation** test (recompute on data ending at T; outputs must
  match). Together they catch indexed lookahead *and* full-sample statistics. Validate
  the verifier on a deliberately leaky implementation before trusting it.
- Include at least one negative assertion (something that must **not** happen) — the
  trace is the evidence (`trace_check.py forbid-bash`, `no-guardrail-on`).
- Keep `timeout_s` generous — a slow model that finishes is more informative than a
  timeout.
- Cases that reference repositories you cannot publish should be marked
  `"enabled": false` or pointed at a public fork.
