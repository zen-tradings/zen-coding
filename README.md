# zen-coding

**A coding agent for quantitative research.**

zen-coding is a terminal and Slack coding agent with quant workflows built in — alpha
research, beta audits, portfolio construction, backtest review, paper replication — plus
guardrails against the mistakes that quietly ruin research code. It runs on any LLM you
choose, open-source or closed, hosted or on your own hardware.

It is built on [pi](https://github.com/earendil-works/pi), an open-source coding-agent
harness: pi provides the agent loop, terminal UI, sessions, and model providers;
zen-coding adds the quant layer as a set of extensions, skills, and prompt templates.

## Features

- **Quant workflows as slash commands** — `/alpha`, `/beta-audit`, `/portfolio`,
  `/fundamental`, `/paper-replicate`, `/audit`, `/backtest`. Each encodes a rigorous,
  step-by-step research procedure rather than a one-line prompt.
- **Guardrails at the tool boundary** — destructive shell commands are blocked,
  secrets and protected paths cannot be written, and the agent cannot edit its own
  rules. Rules are declarative and repositories can only tighten them.
- **Any model** — DeepSeek, Kimi, Qwen, GLM, Groq, Fireworks, OpenRouter, Hugging
  Face, Anthropic, OpenAI, Google, or a self-hosted vLLM / Ollama endpoint. Switch with
  `/model`; benchmark models against each other on identical tasks.
- **Research connectors** — alphaXiv, multi-source paper search (arXiv, SSRN, Semantic
  Scholar, …), GitHub, Docker MCP Toolkit, Render, and Mintlify, all via MCP.
- **Skills** — WorldQuant BRAIN alpha research and Mintlify documentation, loaded on
  demand.
- **Slack bot** — @-mention the bot with a GitHub link; it clones the repo, works in a
  backend session, and streams its reply into the thread.
- **Observability and evals** — per-session JSONL traces of latency, tokens, and cost;
  optional Braintrust dashboards; a reproducible eval harness for scoring the agent per
  model.
- **Installable anywhere** — `pi install` once and the zen layer follows you into every
  repository.

## Quick start

Requires **Node.js ≥ 22**.

```bash
git clone https://github.com/zen-tradings/zen-coding.git
cd zen-coding
git submodule update --init   # optional: pulls the wq-alpha-research skill
npm install

# The project default model is Kimi K3 on Fireworks. Set that key, or any other
# provider's key and switch with /model once inside.
export FIREWORKS_API_KEY=...
# export DEEPSEEK_API_KEY=... ANTHROPIC_API_KEY=... GROQ_API_KEY=... OPENROUTER_API_KEY=...

npm run agent
```

On first launch pi asks you to trust the project — project-local extensions are code,
so this is a deliberate step. Then:

```
/model                          pick a model
/zen clarify                    ask clarifying questions before acting
/alpha short-term reversal in small caps, conditioned on volume
```

## Usage

### Interactive (terminal)

`npm run agent` opens the pi terminal UI with zen-coding loaded.

**Modes** — `/zen <mode>` changes how the agent approaches a task:

| Mode | Behaviour |
|---|---|
| `normal` | Default. Plan and implement. |
| `clarify` | If the request is ambiguous, ask concise clarifying questions first and wait. |
| `plan` | Read-only. Explore, produce a step-by-step plan, stop. File edits are blocked. |

**Quant commands** — each is a prompt template in `.pi/prompts/`; pass your argument
after the command:

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

**Skills** load automatically when a task matches their description, or on demand with
`/skill:<name>`.

### Headless

```bash
npx pi -p "explain src/foo.py"        # one-shot, prints the result
npx pi --mode json -p "..."           # streamed JSON events, for pipelines
npx pi --mode rpc                     # JSON protocol over stdin/stdout, for embedding
```

### In any repository

Install the zen layer once and it loads whenever you run `pi`, in any project:

```bash
pi install git:github.com/zen-tradings/zen-coding
```

Guardrails, traces, modes, and tools follow you; nothing is written into the
repositories you work in. Details: [docs/install-anywhere.md](docs/install-anywhere.md).

## Models

Open-source models are first-class citizens.

| | How |
|---|---|
| **Hosted** | Export the provider's key and select with `/model`. Supported: DeepSeek (`DEEPSEEK_API_KEY`), Groq (`GROQ_API_KEY`), Fireworks (`FIREWORKS_API_KEY`), OpenRouter (`OPENROUTER_API_KEY`), Hugging Face (`HF_TOKEN`), Together, Kimi, Qwen, ZAI/GLM, MiniMax, Anthropic, OpenAI, Google, and more — see pi's [providers docs](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs). |
| **Self-hosted** | vLLM, SGLang, Ollama, LM Studio, llama.cpp — any OpenAI-compatible endpoint. Set `ZEN_LOCAL_BASE_URL` (e.g. `http://localhost:11434/v1`) and `ZEN_LOCAL_MODELS` (comma-separated ids); the models appear in `/model`. |

The default model for this project is set in `.pi/settings.json`
(`defaultProvider` / `defaultModel`); edit it to change what a fresh session starts with.
Because every model is selected the same way, comparing cost, latency, and pass rate
across models is a matter of re-running the [eval harness](docs/evals.md) with
`--model`.

## Slack bot

@-mention the bot in a channel — optionally with a GitHub link — and it works on the
task in a backend session, streaming its reply into the thread. DMs work the same way
without the mention. Follow-up messages steer the running task; `/zen` modes work
from Slack too.

**Set up the Slack app** at <https://api.slack.com/apps> → *Create New App* →
*From a manifest*:

1. Pick your workspace and paste [`slack-app-manifest.yaml`](slack-app-manifest.yaml)
   (scopes, events, and Socket Mode are pre-configured).
2. *Basic Information → App-Level Tokens*: generate a token with `connections:write`.
   This is `SLACK_APP_TOKEN` (`xapp-…`).
3. *Install App → Install to Workspace*: copy the Bot User OAuth Token. This is
   `SLACK_BOT_TOKEN` (`xoxb-…`).
4. Invite the bot to a channel (`/invite @zen-coding`) and @-mention it, or DM it.

**Run the backend** from the repository root:

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
export GITHUB_TOKEN=...            # optional: clone private repositories
npm run slack
```

Each thread gets its own persistent session and its own repository checkout; a cloned
repository's extensions are never executed, and writes are confined to the checkout.
Architecture, isolation model, and all configuration options:
[docs/slack.md](docs/slack.md).

## Research connectors

External tools are connected through MCP and exposed via a single `mcp` proxy tool to
keep context usage low. A connector without credentials is skipped with a warning; the
session continues.

| Connector | What it gives you | Requires |
|---|---|---|
| **alphaXiv** | Paper discovery, full-text Q&A, AI-digested reports, library management | `ALPHAXIV_API_KEY` or `/mcp-auth alphaxiv` |
| **paper-search** | Unified search/download across 24+ sources — arXiv, SSRN, Semantic Scholar, PubMed, OpenAlex, … | [uv](https://docs.astral.sh/uv/) (runs `uvx paper-search-mcp`) |
| **GitHub** | Issues, pull requests, code search, notifications via the official GitHub MCP server | `gh auth login` |
| **Docker MCP Toolkit** | Discover and run catalog MCP servers in isolated containers | Docker Desktop with `docker mcp` |
| **Render** | Inspect and manage services deployed on Render | `RENDER_API_KEY` |
| **Mintlify docs** | Live search over Mintlify's documentation | — |

Per-connector details and how to add your own: [docs/mcp-connectors.md](docs/mcp-connectors.md).

## Skills

Skills are on-demand capability packages following the
[Agent Skills](https://agentskills.io) standard. Their one-line descriptions sit in the
system prompt; full instructions load only when a task matches.

| Skill | Purpose |
|---|---|
| [`wq-alpha-research`](https://github.com/zen-tradings/wq-alpha-research) | WorldQuant BRAIN US-equity alpha research: designing expressions, selecting fields and operators, diagnosing simulation failures, tuning Sharpe/fitness/turnover, managing correlation, submitting alphas. Git submodule — run `git submodule update --init`. Credentials via `WQ_BRAIN_USERNAME` / `WQ_BRAIN_PASSWORD`. |
| `mintlify-docs` | Structure, write, build, validate, and deploy documentation sites with Mintlify (`docs.json` + MDX). Pairs with the Mintlify MCP connector for live reference lookup. |

## Safety and guardrails

Every tool call passes through `guardrails.ts` before it executes. The rules live in
[`.pi/guardrails.json`](.pi/guardrails.json):

- **Denied shell patterns** — `rm -rf /` and `rm -rf ~`, `git push --force` (without
  `--force-with-lease`), `git reset --hard`.
- **Protected paths** — `.env*`, `*.pem`, `*.key`, `.git/`, `.zen/`, and the rules
  file itself. The agent cannot write to them.
- **No writes outside the project root.**

A repository can add its own rules in its own `.pi/guardrails.json`; they merge
*tighten-only*, so a project can add protections but never remove the base ones. If the
rules file is missing or malformed, startup fails rather than running unguarded.

Quant-specific checks — flagging lookahead bias (`shift(-1)`, fitting before a
train/test split), shared-DataFrame mutation, and backtests without transaction costs —
are on the [roadmap](#roadmap).

## Observability and evals

**Traces.** Every session writes a JSONL trace to `~/.zen/traces/<sessionId>.jsonl`
(override with `ZEN_TRACE_DIR`): turn and tool latency, token usage, cost, and model
switches. Full transcripts live in pi's own session files. Optionally stream sessions
to [Braintrust](https://www.braintrust.dev):

```bash
export TRACE_TO_BRAINTRUST=true
export BRAINTRUST_API_KEY=...
export BRAINTRUST_PROJECT=zen-coding   # default
```

Both interactive and Slack-backend sessions are covered.

**Evals.** `scripts/run_eval.py` runs the agent headlessly against the cases in
`evals/evals.json` — fresh checkout per case, bash assertions for scoring, multiple
attempts for variance — and `scripts/aggregate.py` produces a `benchmark.json` with
per-track pass rates and regressions against the previous iteration. Use `--model` to
compare models on identical tasks. Full guide: [docs/evals.md](docs/evals.md).

## Configuration reference

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY`, `FIREWORKS_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `HF_TOKEN`, … | Model provider keys (at least one) |
| `ZEN_LOCAL_BASE_URL`, `ZEN_LOCAL_MODELS` | Self-hosted OpenAI-compatible endpoint and its model ids |
| `ZEN_LOCAL_API_KEY`, `ZEN_LOCAL_CONTEXT_WINDOW`, `ZEN_LOCAL_MAX_TOKENS` | Self-hosted tuning (defaults: `local`, `128000`, `8192`) |
| `EXA_API_KEY` | Enables the built-in `exa_search` tool (web, code, and paper search) |
| `ALPHAXIV_API_KEY`, `RENDER_API_KEY` | MCP connector credentials |
| `WQ_BRAIN_USERNAME`, `WQ_BRAIN_PASSWORD` | WorldQuant BRAIN credentials for the `wq-alpha-research` skill |
| `ZEN_TRACE_DIR` | JSONL trace directory (default `~/.zen/traces`) |
| `ZEN_GUARDRAILS_CONFIG` | Alternate guardrail rules file |
| `TRACE_TO_BRAINTRUST`, `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT` | Braintrust tracing (opt-in) |
| `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ZEN_SLACK_*`, `GITHUB_TOKEN` | Slack backend — see [docs/slack.md](docs/slack.md) |

## Architecture

```
                 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  surfaces       │ Terminal UI  │   │  Slack bot   │   │ Headless /   │
                 │  npm run agent│   │ npm run slack│   │ eval harness │
                 └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
                        └──────────────────┼──────────────────┘
                                           ▼
  zen layer      .pi/extensions/  guardrails · observability · /zen modes · models · tools
                 .pi/prompts/     /alpha /beta-audit /portfolio /fundamental /paper-replicate …
                 .pi/skills/      wq-alpha-research · mintlify-docs
                 .pi/mcp.json     alphaXiv · paper-search · GitHub · Docker · Render · Mintlify
                                           ▼
  harness        pi (@earendil-works/pi-coding-agent)  — agent loop, sessions, providers
```

The same extensions load on every surface, so the quant layer is built once and shared.
pi is a pinned npm dependency, not a fork: upgrades are a version bump. Design notes and
rationale live in [design.md](design.md).

### Roadmap

- **Quant guardrails** — edit-time warnings for lookahead bias, shared-DataFrame
  mutation, cost-free backtests, and writes to production strategy configs.
- **Sandboxing** — run each backend session in a container.
- **Proprietary data connectors** — via `.pi/mcp.json` or native tools in
  `.pi/extensions/zen-tools/`.
- **Public benchmarks** — cost and latency against open-source coding agents on
  shared quant task sets.

## Development

```bash
npm run typecheck     # tsc --noEmit over the extensions and Slack backend
npm run agent         # run the agent against this repository
```

Extensions are TypeScript loaded by pi without a build step. Keep them dependency-light
and make sure `npm run typecheck` passes after any change under `.pi/extensions/` or
`src/`.

| Path | Contents |
|---|---|
| `.pi/extensions/` | `guardrails.ts`, `observability.ts`, `modes.ts`, `zen-models.ts`, `zen-tools/` (`exa_search`) |
| `.pi/prompts/` | Quant prompt templates (the slash commands above) |
| `.pi/skills/` | Skills; `wq-alpha-research` is a git submodule |
| `.pi/mcp.json`, `.pi/guardrails.json`, `.pi/settings.json` | Connector, guardrail, and default-model configuration |
| `src/slack/` | Slack backend (pi SDK) |
| `scripts/`, `evals/` | Eval harness and case definitions |
| `docs/` | Deep-dive documentation |

Agent-facing contributor notes are in [AGENTS.md](AGENTS.md). Never commit `.zen/`
(runtime state), `.pi/npm/` (machine-local packages), or secrets — the guardrails
protect these paths, and `.gitignore` excludes them.

## License

Copyright 2026 zen-tradings. Licensed under the [Apache License, Version 2.0](LICENSE).
