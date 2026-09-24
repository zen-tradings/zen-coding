# zen-coding

**A coding agent for quantitative research and development.**

zen-coding is a terminal and Slack coding agent with quant workflows built in — alpha
research, beta audits, portfolio construction, backtest review, paper replication — and
guardrails against the mistakes that quietly ruin research code.

It is a layer on top of [pi](https://github.com/earendil-works/pi), an open-source
coding-agent harness: pi provides the agent loop, terminal UI, sessions, and model
providers; zen-coding adds extensions, prompt templates, skills, and MCP configuration
that pi discovers when you run it in this repository. The command you run is `pi`.

## Quick start

Requires **Node.js ≥ 22**.

```bash
# 1. Install pi (once)
npm install -g --ignore-scripts @earendil-works/pi-coding-agent   # or: curl -fsSL https://pi.dev/install.sh | sh

# 2. Get zen-coding
git clone https://github.com/zen-tradings/zen-coding.git
cd zen-coding
git submodule update --init   # optional: wq-alpha-research skill
npm install                   # extension dependencies

# 3. Set a provider key (default model is Kimi K3 on Fireworks; Anthropic and OpenAI also supported — switch with /model)
export FIREWORKS_API_KEY=...

# 4. Run pi inside the repository
pi
```

On first launch pi asks you to trust the project — project-local extensions are code.
Trust it and zen-coding loads. `npm run agent` does the same with the pi version pinned
in `package.json`, if you prefer not to install pi globally.

```
/model                          pick a model
/zen clarify                    ask clarifying questions before acting
/alpha short-term reversal in small caps, conditioned on volume
```
## Features

- **Quant workflows as slash commands** — `/alpha`, `/beta-audit`, `/portfolio`,
  `/fundamental`, `/paper-replicate`, `/audit`, `/backtest`, each a rigorous
  step-by-step procedure rather than a one-line prompt.
- **Guardrails at the tool boundary** — destructive shell commands blocked, secrets and
  protected paths unwritable, rules that repositories can only tighten.
- **Cross-model comparison** — Anthropic, OpenAI, and Fireworks (low-cost); switch
  with `/model` and compare on identical eval tasks.
- **Research connectors and skills** — alphaXiv, multi-source paper search, GitHub,
  Docker MCP Toolkit, Render, Mintlify via MCP; WorldQuant BRAIN alpha research as a skill.
- **Slack bot** — @-mention with a GitHub link; the agent clones the repo and streams
  its reply into the thread.
- **Observability and evals** — JSONL traces of latency, tokens, and cost per session;
  optional Braintrust; a reproducible eval harness for scoring models on identical tasks.


## Usage

### Interactive

**Modes** — `/zen <mode>`:

| Mode | Behaviour |
|---|---|
| `normal` | Default. Plan and implement. |
| `clarify` | Ask concise clarifying questions first when the request is ambiguous. |
| `plan` | Read-only. Explore, produce a step-by-step plan, stop. Edits are blocked. |

**Quant commands** — prompt templates in `.pi/prompts/`:

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

**Skills** load automatically when a task matches, or on demand with `/skill:<name>`.

### Headless

```bash
pi -p "explain src/foo.py"            # one-shot
pi --mode json -p "..."               # streamed JSON events
pi --mode rpc                         # JSON protocol over stdin/stdout
```

Non-interactive modes skip the trust prompt: trust the project once interactively or
pass `-a` / `--approve`, otherwise the zen extensions do not load.

### In any repository

zen-coding is also a [pi package](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md):

```bash
pi install git:github.com/zen-tradings/zen-coding
```

Guardrails, traces, `/zen` modes, and `exa_search` then load in every
project. The quant commands, skills, and connectors are project resources — run `pi`
inside this repository to use them. See [docs/install-anywhere.md](docs/install-anywhere.md).

## Models

Supported providers are **Anthropic**, **OpenAI**, and one low-cost provider,
**Fireworks** (Kimi K3, the project default), used for cross-model comparison. Export
the provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIREWORKS_API_KEY`) and select
a model with `/model`.

The project default lives in `.pi/settings.json` (`defaultProvider` / `defaultModel`).
Comparing models on cost, latency, and pass rate is a matter of re-running the
[eval harness](docs/evals.md) with `--model`.

## Slack bot

@-mention the bot in a channel — optionally with a GitHub link — or DM it. It works in a
backend session and streams its reply into the thread; follow-up messages steer the
running task, and `/zen` modes work from Slack.

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

External tools connect through MCP and are exposed via a single `mcp` proxy tool. A
connector without credentials is skipped with a warning.

| Connector | What it gives you | Requires |
|---|---|---|
| **alphaXiv** | Paper discovery, full-text Q&A, AI-digested reports, library management | `ALPHAXIV_API_KEY` or `/mcp-auth alphaxiv` |
| **paper-search** | Search/download across 24+ sources — arXiv, SSRN, Semantic Scholar, PubMed, OpenAlex, … | [uv](https://docs.astral.sh/uv/) |
| **GitHub** | Issues, pull requests, code search, notifications (official GitHub MCP server) | `gh auth login` |
| **Docker MCP Toolkit** | Discover and run catalog MCP servers in isolated containers | Docker Desktop with `docker mcp` |
| **Render** | Inspect and manage services deployed on Render | `RENDER_API_KEY` |
| **Mintlify docs** | Live search over Mintlify's documentation | — |

Details and how to add your own: [docs/mcp-connectors.md](docs/mcp-connectors.md).

## Skills

- [`wq-alpha-research`](https://github.com/zen-tradings/wq-alpha-research) — WorldQuant
  BRAIN US-equity alpha research: expressions, field selection, simulation diagnostics,
  Sharpe/fitness/turnover tuning, correlation management, submission. Git submodule;
  credentials via `WQ_BRAIN_USERNAME` / `WQ_BRAIN_PASSWORD`.
- `mintlify-docs` — write, build, validate, and deploy Mintlify documentation sites.

## Safety and guardrails

Every tool call passes through `guardrails.ts` before it executes. Rules in
[`.pi/guardrails.json`](.pi/guardrails.json):

- **Denied shell patterns** — `rm -rf /` and `rm -rf ~`, `git push --force` (without
  `--force-with-lease`), `git reset --hard`.
- **Protected paths** — `.env*`, `*.pem`, `*.key`, `.git/`, `.zen/`, and the rules file
  itself.
- **No writes outside the project root.**

A repository can add rules in its own `.pi/guardrails.json`; they merge *tighten-only*.
A missing or malformed rules file fails startup rather than running unguarded.

## Observability and evals

Every session writes a JSONL trace to `~/.zen/traces/<sessionId>.jsonl` (override with
`ZEN_TRACE_DIR`): turn and tool latency, token usage, cost, model switches. Set
`TRACE_TO_BRAINTRUST=true` and `BRAINTRUST_API_KEY` to also stream sessions — interactive
and Slack — to [Braintrust](https://www.braintrust.dev).

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

`scripts/run_eval.py` runs the agent headlessly against `evals/evals.json` — fresh
checkout per case, bash assertions, multiple attempts — and `scripts/aggregate.py`
produces a `benchmark.json` with per-track pass rates and regressions. Guide:
[docs/evals.md](docs/evals.md).

## Configuration reference

| Variable | Purpose |
|---|---|
| `FIREWORKS_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Model provider keys (at least one) |
| `EXA_API_KEY` | Enables the `exa_search` tool (web, code, paper search) |
| `ALPHAXIV_API_KEY`, `RENDER_API_KEY` | MCP connector credentials |
| `WQ_BRAIN_USERNAME`, `WQ_BRAIN_PASSWORD` | WorldQuant BRAIN credentials (`wq-alpha-research`) |
| `ZEN_TRACE_DIR`, `ZEN_GUARDRAILS_CONFIG` | Trace directory; alternate guardrail rules file |
| `TRACE_TO_BRAINTRUST`, `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT` | Braintrust tracing (opt-in) |
| `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ZEN_SLACK_*`, `GITHUB_TOKEN` | Slack backend — see [docs/slack.md](docs/slack.md) |

## Development

```bash
npm run typecheck     # tsc --noEmit over extensions and Slack backend — run after any TS change
npm run agent         # run the pinned pi version against this repository
```

| Path | Contents |
|---|---|
| `.pi/extensions/` | `guardrails.ts`, `observability.ts`, `modes.ts`, `zen-tools/` |
| `.pi/prompts/`, `.pi/skills/` | Quant prompt templates; skills (`wq-alpha-research` is a submodule) |
| `.pi/mcp.json`, `.pi/guardrails.json`, `.pi/settings.json` | Connector, guardrail, and default-model configuration |
| `src/slack/` | Slack backend (pi SDK) |
| `scripts/`, `evals/` | Eval harness and cases |
| `docs/`, `design.md` | Deep-dive docs; design notes |

Extensions are TypeScript loaded by pi without a build step; keep them dependency-light.
Contributor notes for agents are in [AGENTS.md](AGENTS.md). Never commit `.zen/`,
`.pi/npm/`, or secrets.

## License

Copyright 2026 zen-tradings. Licensed under the [Apache License, Version 2.0](LICENSE).
