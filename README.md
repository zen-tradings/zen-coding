# zen-coding

**A coding agent for quantitative research and development.**

zen-coding is a terminal and Slack coding agent for the two jobs a quant team actually
has: ordinary engineering (dashboards, services, deploys) and research (alpha
research, beta audits, portfolio construction, backtest review, paper replication) —
with guardrails against the mistakes that quietly ruin research code, enforced where a
checklist cannot be: at the tool boundary.

It is a layer on top of [pi](https://github.com/earendil-works/pi), an open-source
coding-agent harness: pi provides the agent loop, terminal UI, sessions, and model
providers; zen-coding is a **pi package** — extensions, prompt templates and skills that
install once and load in every repository you run `pi` in. The command you run is `pi`.

## Quick start

Requires **Node.js ≥ 22**.

```bash
# 1. Install pi (once)
npm install -g --ignore-scripts @earendil-works/pi-coding-agent   # or: curl -fsSL https://pi.dev/install.sh | sh

# 2. Install zen-coding as a pi package (once) — it then loads in every repository
pi install git:github.com/zen-tradings/zen-coding

# 3. Set a provider key and run pi in any project
export ANTHROPIC_API_KEY=...        # or FIREWORKS_API_KEY, OPENAI_API_KEY, ...
cd ~/Strategy_Dashboard && pi
```

```
/model                          pick a model
/zen clarify                    ask clarifying questions before acting
/beta-audit strategies/beta2    decompose returns into factor exposures, verify the hedge
/alpha short-term reversal in small caps, conditioned on volume
```

Research connectors (papers, GitHub, market data, deploy targets) are user-level and
installed separately: `npm run connectors` from a checkout — see
[Research connectors](#research-connectors).

To work on zen-coding itself, clone it and run `pi` inside the checkout (`npm install`
first; pi asks you to trust the project because extensions are code). `npm run agent`
runs the pi version pinned in `package.json`.

## Features

- **One package, every repository** — `pi install` once; guardrails, traces, `/zen`
  modes, the quant commands and the skills travel with it. General engineering is the
  default; research workflows run only when you type them.
- **Guardrails at the tool boundary** — destructive shell commands blocked, secrets and
  protected paths unwritable everywhere; in research code only, lookahead patterns
  (`shift(-n)`, centered windows, `fit` before a split), `inplace=True` and writes into
  production data, model artifacts or live-trading config are blocked, and cost-free
  backtests or survivorship-prone universes warn at edit time.
- **Quant workflows as slash commands** — `/alpha`, `/beta-audit`, `/portfolio`,
  `/fundamental`, `/paper-replicate`, `/audit`, `/backtest`, each a rigorous
  step-by-step procedure rather than a one-line prompt.
- **Skills with runnable procedures** — `beta-audit`, `alpha-research`, `backtest`,
  `paper-replication` (scripts for exposures with standard errors, IC/decay/turnover,
  static lookahead scans, perturbation probes, tolerance tables), WorldQuant BRAIN
  `wq-alpha-research`, and `mintlify-docs`.
- **Research connectors** — alphaXiv, multi-source paper search, Exa, GitHub, Render,
  and Alpaca market data (read-only) via MCP, merged into your user-level pi config.
- **Observability and evals** — JSONL evidence traces per session; research sessions
  also record code revision, data snapshot, random seed and universe; an eval harness
  whose research cases fail when a diff introduces lookahead.
- **Slack bot** — @-mention with a GitHub link; the agent clones the repo and streams
  its reply into the thread.

## Usage

### Interactive

**Modes** — `/zen <mode>`:

| Mode | Behaviour |
|---|---|
| `normal` | Default. Plan and implement. |
| `clarify` | Ask concise clarifying questions first when the request is ambiguous. |
| `plan` | Read-only. Explore, produce a step-by-step plan, stop. Edits are blocked. |

**Quant commands** — prompt templates in `.pi/prompts/`, available in every repository
once the package is installed. They are explicit checklists: nothing is injected into a
session unless you type the command.

| Command | What it does |
|---|---|
| `/alpha <hypothesis>` | Alpha/factor research from hypothesis to IC, decay, turnover, and correlation with existing factors |
| `/beta-audit <strategy>` | Decompose returns into factor exposures and verify hedging claims |
| `/portfolio <objective>` | Build or review an allocation given signals, constraints, and a risk model |
| `/fundamental <ticker>` | Filings-based fundamental analysis with every claim traceable to a source |
| `/paper-replicate <paper>` | Extract a paper's methodology, implement it, verify against reported numbers |
| `/audit <target>` | Adversarial audit — try to falsify a strategy, backtest, or finding |
| `/backtest <path>` | Review a backtest for methodological soundness, then interpret results |
| `/eval [case-id ...]` | Run the eval suite and report the verdict |

**Skills** are reusable procedures with scripts. The model loads one when a task
matches its (deliberately narrow) description, or you force it with `/skill:<name>`:

| Skill | Procedure and scripts |
|---|---|
| `beta-audit` | Factor exposures from a return series: betas with (HAC) standard errors, rolling drift, residual risk, PASS/FAIL per neutrality claim — `scripts/beta_audit.py` |
| `alpha-research` | Point-in-time construction, IC/RankIC with t-stats, IC decay, quantile spreads, turnover and cost drag, correlation with existing factors — `scripts/factor_eval.py` |
| `backtest` | Methodology audit: static lookahead scan (`scripts/backtest_check.py`), perturbation + truncation probe of a signal function (`scripts/lookahead_probe.py`), then results |
| `paper-replication` | Spec before code, risk list, signal → portfolio → stats in verifiable pieces, tolerance table (`scripts/compare_metrics.py`) |
| `wq-alpha-research` | WorldQuant BRAIN US-equity alpha research (vendored; credentials via `WQ_BRAIN_USERNAME` / `WQ_BRAIN_PASSWORD`) |
| `mintlify-docs` | Write, build, validate, and deploy Mintlify documentation sites |

### Headless

```bash
pi -p "explain src/foo.py"            # one-shot
pi --mode json -p "..."               # streamed JSON events
pi --mode rpc                         # JSON protocol over stdin/stdout
```

Non-interactive modes skip the trust prompt for *project* resources; the installed
package loads regardless. Inside the zen-coding checkout itself, trust the project once
interactively or pass `-a` / `--approve`.

### The package

The `pi` manifest in `package.json` declares `./.pi/extensions`, `./.pi/prompts` and
`./.pi/skills`. If it is not in the manifest, it does not travel. Two things stay
local on purpose: the default model in `.pi/settings.json` (never override the user's
model) and the connector list in `.pi/mcp.json` (pi packages cannot ship MCP entries).
Details: [docs/install-anywhere.md](docs/install-anywhere.md).

## Models

Supported providers are **Anthropic**, **OpenAI**, and one low-cost provider,
**Fireworks** (Kimi K3), used for cross-model comparison. Export the provider key
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIREWORKS_API_KEY`) and select a model with
`/model`.

`.pi/settings.json` sets Fireworks / Kimi as the default **inside this checkout only**;
the package does not carry it, so your own default applies everywhere else. Comparing
models on cost, latency, and pass rate is a matter of re-running the
[eval harness](docs/evals.md) with `--model`.

## Slack bot

@-mention the bot in a channel — optionally with a GitHub link — or DM it. It works in a
backend session and streams its reply into the thread; follow-up messages steer the
running task, and `/zen` modes work from Slack. Slack is a separate entrypoint, not the
way the package is loaded.

Create the app at <https://api.slack.com/apps> → *Create New App* → *From a manifest*:

1. Paste [`slack-app-manifest.yaml`](slack-app-manifest.yaml) (scopes, events, and
   Socket Mode pre-configured).
2. *Basic Information → App-Level Tokens*: generate a token with `connections:write` →
   `SLACK_APP_TOKEN` (`xapp-…`).
3. *Install App → Install to Workspace*: copy the Bot User OAuth Token →
   `SLACK_BOT_TOKEN` (`xoxb-…`).
4. Invite the bot to a channel (`/invite @zen-coding`).

```bash
export SLACK_BOT_TOKEN=xoxb-... SLACK_APP_TOKEN=xapp-...
export GITHUB_TOKEN=...            # optional: private repositories
npm run slack
```

Each thread gets its own persistent session and repository checkout; a cloned
repository's extensions never execute. Architecture and all options: [docs/slack.md](docs/slack.md).

## Research connectors

External tools connect through pi's built-in MCP support. Connectors are
**user-level**: [`.pi/mcp.json`](.pi/mcp.json) in this repository is the source list,
and `npm run connectors` merges it into `~/.pi/agent/mcp.json` without touching your
other entries (`--only`, `--skip`, `--dry-run`, `--force`). Their tools stay out of
the model's tool list until needed: the agent finds and calls them from `codemode`
scripts. A connector without credentials fails to connect and is reported once; the
others keep working. Check them with `pi mcp list` or `/mcp`.

| Connector | What it gives you | Requires |
|---|---|---|
| **Alpaca** | Market data: stock/option/crypto bars, quotes, trades, snapshots, corporate actions, calendar — order tools hidden | `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, [uv](https://docs.astral.sh/uv/) |
| **Exa** | Neural web search, research papers, code examples and docs, full-page fetch (official Exa MCP server) | `EXA_API_KEY` |
| **alphaXiv** | Paper discovery, full-text Q&A, AI-digested reports, library management | `ALPHAXIV_API_KEY` |
| **paper-search** | Search/download across 24+ sources — arXiv, SSRN, Semantic Scholar, PubMed, OpenAlex, … | [uv](https://docs.astral.sh/uv/) |
| **GitHub** | Issues, pull requests, code search, notifications (official GitHub MCP server) | `gh auth login` |
| **Render** | Inspect and manage services deployed on Render | `RENDER_API_KEY` |
| **Mintlify docs** | Live search over Mintlify's documentation | — |

Only one extension may own `/mcp`: if `@codella/pi-mcp-support` or `pi-mcp-adapter` is
installed, pi's built-in loader never starts. Keep one of the two. Details and how to
add your own: [docs/mcp-connectors.md](docs/mcp-connectors.md).

## Safety and guardrails

Every tool call passes through `guardrails.ts` before it executes. Rules live in
[`.pi/guardrails.json`](.pi/guardrails.json) and come in two layers.

**Global rules** — every repository, every file:

- **Denied shell patterns** — `rm -rf /` and `rm -rf ~`, `git push --force` (without
  `--force-with-lease`), `git reset --hard`.
- **Protected paths** — `.env*` and `*.env` anywhere, `*.pem`, `*.key`, `.git/`,
  `.zen/`, and the rules file itself; also enforced for shell redirects, `cp`, `mv`,
  `tee`, `rm` and `sed -i` targets.
- **No writes outside the project root.**

**Research rules** — only files matched by `research.paths` and not `research.exclude`
(Python, notebooks, R, Julia; never `frontend/`, `app/`, `services/`, `deploy/`,
`docker/`, …). A TypeScript component or a `deploy.sh` never triggers them.

| Rule | Action | Trigger |
|---|---|---|
| `lookahead-shift` | block | `.shift(-n)`, negative `pct_change`/`diff`, `rolling(..., center=True)` in pandas/polars code |
| `fit-before-split` | block | `.fit()` / `.fit_transform()` before `train_test_split()` in the same file |
| `inplace-mutation` | block | `inplace=True` in pandas code |
| research protected paths | block | `data/prod/`, `models/**/*.pkl` and other artifacts, `live/`, `*.live.yaml`, … |
| `backtest-without-costs` | warn | a backtest with no cost / commission / slippage / fee / spread term |
| `survivorship-universe` | warn | a universe built from today's index constituents |

A blocked edit is refused with the rule's message; a warning lets the edit through and
appends the message to the tool result so the model sees it immediately. Forward-return
labels are legitimate: annotate the line with `# lookahead-ok: <reason>` (or
`# inplace-ok` for a provably local frame) to make the exception explicit and auditable.

A repository can add rules in its own `.pi/guardrails.json`; they merge *tighten-only*
(union lists, raise warn→block, never exclude more). A missing or malformed rules file
fails startup rather than running unguarded.

## Observability and evals

Every session writes a JSONL trace to `~/.zen/traces/<sessionId>.jsonl` (override with
`ZEN_TRACE_DIR`): turn and tool latency, token usage, cost, model switches, guardrail
decisions. Set `TRACE_TO_BRAINTRUST=true` and `BRAINTRUST_API_KEY` to also stream
sessions — interactive and Slack — to [Braintrust](https://www.braintrust.dev).

### Evidence trace fields

Every trace line carries `schema_version: 2` (v1 lines have no such field) plus these
per-step fields. The trace holds pointers only — never file contents, prompts, or model
outputs (write/edit content and bash heredocs are redacted from `args`). The `TraceLine`
type is exported from `.pi/extensions/observability.ts`.

| Field | Meaning |
|---|---|
| `role` | `plan` (step in `/zen plan` mode), `code` (`write`/`edit`), `check` (bash test/typecheck/lint command), else `other` |
| `model` | `provider/model-id` used for the step; `null` if none selected |
| `evidence_refs` | Pointers the step relied on: `file` (path + 1-indexed line range), `tool_call` (id), `url` (search result), `dataset` (id) |
| `as_of` | When the evidence dates from — file mtime, search result publish date; `null` when unknown, never guessed |
| `error` | `null`, or `{ type, message, tool_call_id }`; `type` is `tool_error`, `nonzero_exit`, `timeout`, `aborted`, `blocked`, or `model_error` |
| `recovery` | `null`, or `{ action, attempts }` after a failed tool call: `retry` (same tool), `alternate_tool` (different tool), `gave_up` (run ended unresolved) |
| `self_check` | `null`, or `{ what_was_checked, result }` on `check` steps: `pass`, `fail`, or `uncertain` (timed out, aborted, blocked) |
| `research` | `null` for engineering sessions. For research sessions: `{ trigger, code_revision, data_snapshot_id, random_seed, universe }` |

Two events are specific to zen: `guardrail` lines record every block or warning
(`path`, `findings[]`), and a `research_session` line marks the moment a session is
recognised as research — a quant command was typed, a research skill was read, a
write/edit targeted research code, or `ZEN_RESEARCH_SESSION` is set. From then on every
line carries the `research` context: `code_revision` is the git HEAD of the working
directory (`-dirty` when uncommitted changes exist, refreshed after git commands),
`data_snapshot_id`, `random_seed` and `universe` come from the environment
(`ZEN_DATA_SNAPSHOT`, `ZEN_RANDOM_SEED`, `ZEN_UNIVERSE`) or from the code written in the
session (`np.random.seed(42)`, `universe = [...]`, `snapshot="2026-09-30"`), and stay
`null` when unknown. Nothing is required of a frontend edit.

`scripts/run_eval.py` runs the agent headlessly against `evals/evals.json` — fresh
checkout per case, the local working tree loaded as the package under test, fixture
verifiers plus trace assertions — and `scripts/aggregate.py` produces a `benchmark.json`
with per-track pass rates and regressions. The suite covers a dashboard change, a deploy
dry-run, a beta-audit verifier, a portfolio verifier and a feature-engineering case; the
research verifiers fail when the diff introduces lookahead. Guide:
[docs/evals.md](docs/evals.md).

## Configuration reference

| Variable | Purpose |
|---|---|
| `FIREWORKS_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Model provider keys (at least one) |
| `EXA_API_KEY` | Key for the official Exa MCP connector (web, paper, and code search) |
| `ALPHAXIV_API_KEY`, `RENDER_API_KEY` | MCP connector credentials |
| `ALPACA_API_KEY`, `ALPACA_SECRET_KEY` | Alpaca market-data connector (paper account is enough) |
| `WQ_BRAIN_USERNAME`, `WQ_BRAIN_PASSWORD` | WorldQuant BRAIN credentials (`wq-alpha-research`) |
| `ZEN_TRACE_DIR`, `ZEN_GUARDRAILS_CONFIG` | Trace directory; alternate guardrail rules file |
| `ZEN_RESEARCH_SESSION`, `ZEN_DATA_SNAPSHOT`, `ZEN_RANDOM_SEED`, `ZEN_UNIVERSE` | Mark a session as research and pin its reproducibility fields in the trace |
| `TRACE_TO_BRAINTRUST`, `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT` | Braintrust tracing (opt-in) |
| `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ZEN_SLACK_*`, `GITHUB_TOKEN` | Slack backend — see [docs/slack.md](docs/slack.md) |

## Development

```bash
npm run typecheck     # tsc --noEmit over extensions, Slack backend and tests — run after any TS change
npm test              # guardrail rules, trace detectors, and package discovery through pi's own loader
npm run connectors    # merge .pi/mcp.json into ~/.pi/agent/mcp.json
npm run agent         # run the pinned pi version against this repository
```

| Path | Contents |
|---|---|
| `.pi/extensions/` | `guardrails.ts`, `observability.ts`, `modes.ts` |
| `.pi/prompts/`, `.pi/skills/` | Quant prompt templates; skills (all vendored, no submodules) |
| `.pi/mcp.json`, `.pi/guardrails.json`, `.pi/settings.json` | Connector source list, guardrail rules, checkout-local default model |
| `src/slack/` | Slack backend (pi SDK) |
| `scripts/`, `evals/` | Eval harness, connector installer; cases and fixture verifiers |
| `tests/` | Unit tests (`node --test` via tsx) |
| `docs/`, `design.md` | Deep-dive docs; design notes |

Extensions are TypeScript loaded by pi without a build step; keep them dependency-light.
Contributor notes for agents are in [AGENTS.md](AGENTS.md). Never commit `.zen/`,
`.pi/npm/`, or secrets.

## License

Copyright 2026 zen-tradings. Licensed under the [Apache License, Version 2.0](LICENSE).
