# zen-coding

**A coding agent for quantitative research and development.**

zen-coding is a terminal coding agent built on top of [pi](https://github.com/earendil-works/pi),
an open-source coding-agent harness: pi provides the agent loop, terminal UI, sessions,
and model providers; zen-coding adds extensions, skills, and MCP configuration that pi
discovers when you run it in this repository. The command you run is `pi`.

For quant work it ships research connectors for paper discovery and full-text search
(alphaXiv, arXiv, SSRN, …). Backtests run in a session are tracked automatically
(variants tried, seeds) as Langfuse session scores, agent-made commits carry
`Langfuse-Session` / `Zen-Work-Type` trailers, and traces carry evidence fields (sources,
checks, errors) so research steps can be audited later. Guardrails enforce tool-boundary
safety (destructive commands, secrets, protected paths); research-quality verifiers —
beta audits, portfolio-construction checks — are on the roadmap ([design.md](design.md)).

## Quick start

Requires **Node.js ≥ 22**.

```bash
# 1. Install pi (once)
npm install -g --ignore-scripts @earendil-works/pi-coding-agent   # or: curl -fsSL https://pi.dev/install.sh | sh

# 2. Get zen-coding
git clone https://github.com/zen-tradings/zen-coding.git
cd zen-coding
npm install                   # extension dependencies

# 3. Set a provider key (default model is glm-5.3-flash on DigitalOcean GenAI; Fireworks, Anthropic and OpenAI also supported — switch with /model)
export ZEN_DIGITALOCEAN_API_KEY=...        # DO GenAI Model Access Key
#export FIREWORKS_API_KEY=...              # alternative low-cost provider (Kimi K3)

# 4. Run pi inside the repository
pi
```

On first launch pi asks you to trust the project — project-local extensions are code.
Trust it and zen-coding loads. `npm run agent` does the same with the pi version pinned
in `package.json`, if you prefer not to install pi globally.

```
/model                          pick a model
/zen clarify                    ask clarifying questions before acting
```
## Features

- **Guardrails at the tool boundary** — destructive shell commands blocked, secrets and
  protected paths unwritable, rules that repositories can only tighten.
- **Cross-model comparison** — Anthropic, OpenAI, and Fireworks (low-cost); switch
  with `/model` and compare on identical eval tasks.
- **Research connectors and skills** — alphaXiv, multi-source paper search, GitHub,
  Docker MCP Toolkit, Render, Mintlify via MCP; WorldQuant BRAIN alpha research as a skill.
- **Process telemetry** — Langfuse session scores for backtest variants tried, work type,
  and commits; `Langfuse-Session` / `Zen-Work-Type` trailers on agent-made commits.
- **Observability and evals** — JSONL traces of latency, tokens, and cost per session;
  optional Langfuse tracing; a reproducible eval harness for scoring models on identical tasks.


## Usage

### Interactive

**Modes** — `/zen <mode>`:

| Mode | Behaviour |
|---|---|
| `normal` | Default. Plan and implement. |
| `clarify` | Ask concise clarifying questions first when the request is ambiguous. |
| `plan` | Read-only. Explore, produce a step-by-step plan, stop. Edits are blocked. |

**Work type** — `/zen type <research | conversion | ops | platform>` tags the session
(Langfuse score `process.work_type`, commit trailer `Zen-Work-Type`); `/zen type` shows
the current value. It is stored in the session, so it survives a restart or resume.
Fallbacks, in order: `ZEN_WORK_TYPE`, the target repo's `zen.config.json`
(`{"workType": "research"}`, nearest file up to the git root), then `unknown`.

**Skills** load automatically when a task matches, or on demand with `/skill:<name>`.

### Headless

```bash
pi -p "explain how guardrails.ts works"  # one-shot
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

Guardrails, traces, `/zen` modes, work-type tags, commit trailers, and `exa_search`
then load in every project. The quant commands, skills, and connectors are project
resources — run `pi` inside this repository to use them. See
[docs/install-anywhere.md](docs/install-anywhere.md).

## Models

Supported providers are **Anthropic**, **OpenAI**, and two low-cost providers,
**DigitalOcean GenAI** (the project default when configured) and **Fireworks**
(Kimi K3), used for cross-model comparison. Export the provider key
(`ZEN_DIGITALOCEAN_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIREWORKS_API_KEY`)
and select a model with `/model`.

**DigitalOcean GenAI** (the project default when configured): export
`ZEN_DIGITALOCEAN_API_KEY` (Model Access Key) and models are auto-discovered from
`ZEN_DIGITALOCEAN_BASE_URL` (default `https://inference.do-ai.run/v1`); optional
`ZEN_DIGITALOCEAN_MODELS` and `ZEN_DIGITALOCEAN_REASONING_MODELS` override the discovered
list and DeepSeek-style thinking per model — non-chat models
(embeddings/rerankers/image/audio/video) are filtered out automatically. See
`.pi/extensions/zen-models-do.ts`.

The project default lives in `.pi/settings.json` (`defaultProvider` / `defaultModel`).
Comparing models on cost, latency, and pass rate is a matter of re-running the
[eval harness](docs/evals.md) with `--model`.

## Research connectors

External tools connect through pi's built-in MCP support. Their tools stay out of the
model's tool list until needed: the agent finds and calls them from `codemode` scripts.
A connector without credentials fails to connect and is reported once; the others keep
working. Check them with `pi mcp list` or `/mcp`.

| Connector | What it gives you | Requires |
|---|---|---|
| **alphaXiv** | Paper discovery, full-text Q&A, AI-digested reports, library management | `ALPHAXIV_API_KEY` |
| **paper-search** | Search/download across 24+ sources — arXiv, SSRN, Semantic Scholar, PubMed, OpenAlex, … | [uv](https://docs.astral.sh/uv/) |
| **GitHub** | Issues, pull requests, code search, notifications (official GitHub MCP server) | `gh auth login` |
| **Docker MCP Toolkit** | Discover and run catalog MCP servers in isolated containers | Docker Desktop with `docker mcp` |
| **Render** | Inspect and manage services deployed on Render | `RENDER_API_KEY` |
| **Mintlify docs** | Live search over Mintlify's documentation | — |

Details and how to add your own: [docs/mcp-connectors.md](docs/mcp-connectors.md).

## Skills

- `mintlify-docs` — write, build, validate, and deploy Mintlify documentation sites.

## Safety and guardrails

Every tool call passes through `guardrails.ts` before it executes. Rules in
[`.pi/guardrails.json`](.pi/guardrails.json):

- **Denied shell patterns** — `rm -rf /` and `rm -rf ~`, `git push --force` (without
  `--force-with-lease`), `git reset --hard`.
- **Protected paths** — `.env*`, `*.pem`, `*.key`, `.git/`, `.zen/`, and the rules file
  itself.
- **Secret hygiene.** Tool inputs and outputs are uploaded to Langfuse, and the plugin
  redacts only Langfuse keys; there is no masking hook. So the agent is kept from putting
  secrets in tool output in the first place:
  - `denyReadPaths` stops `read`/`grep` on credential files: `.env*`, `*.env`, keys,
    `~/.pi/agent/{langfuse,auth}.json`, and similar. `allowReadPaths` exempts templates
    such as `.env.example`.
  - `denySecretBashPatterns` blocks commands that dump secrets: bare `env`/`printenv`,
    `cat`/`grep`/`head` of env and key files, and `echo`/`printf` of `$*_KEY`/`*_TOKEN`/
    `*_SECRET` variables.
  - Sourcing an env file into a command (`set -a; . envs/x.env; set +a; python …`) is
    still allowed.
  - Defaults live in `guardrails.ts`. Set any of these fields in `.pi/guardrails.json`
    to replace the defaults.
  - A program that prints a secret itself, for example `python -c 'print(os.environ[…])'`,
    is **not** caught.
- **No writes outside the project root.**

A repository can add rules in its own `.pi/guardrails.json`; they merge *tighten-only*.
A missing or malformed rules file fails startup rather than running unguarded.

## Observability and evals

Every session writes a JSONL trace to `~/.zen/traces/<sessionId>.jsonl` (override with
`ZEN_TRACE_DIR`): turn and tool latency, token usage, cost, model switches. To also
stream sessions to [Langfuse](https://langfuse.com), set `LANGFUSE_PUBLIC_KEY` and
`LANGFUSE_SECRET_KEY` (optionally `LANGFUSE_BASE_URL`, `LANGFUSE_TRACING_ENVIRONMENT`,
`LANGFUSE_USER_ID`); this covers both interactive sessions (via the
`@langfuse/pi-observability-plugin` project pi package). `LANGFUSE_TRACING_ENABLED=false`
disables it.
The trace environment is set per entry point and wins over `langfuse.json`:
`development` (`npm run agent`) and `experiment`
(`scripts/run_eval.py`, which also exports the Langfuse credentials into its isolated
pi home). Plain `pi` uses whatever `LANGFUSE_TRACING_ENVIRONMENT` / `langfuse.json` say.

**Process telemetry** (`.pi/extensions/zen-process/`) adds three Langfuse *session*
scores, with idempotent ids `<sessionId>-<name>` so updates replace rather than duplicate:

- `process.variants_tried` (numeric) — distinct backtest variants this session, from a
  local ledger (`~/.zen/ledger/<sessionId>.jsonl`). Backtest entry points add one line
  that calls `scripts/zen_ledger.py` (code state + config contents + args, seeds
  excluded); total runs and per-variant seeds are in the score metadata. Repos without
  the helper fall back to matching bash commands (`.pi/zen-process.json`,
  `ZEN_BACKTEST_PATTERNS`) and are marked `source: "bash-heuristic"`.
- `process.work_type` (categorical) — see **Work type** above.
- `process.commits` (text) — `repo@sha` of every commit the agent made in the session.

**Commit trailers** — the agent's own `git commit` commands get
`Langfuse-Session: <sessionId>` and `Zen-Work-Type: <type>` (via `git commit --trailer`,
git >= 2.32; no hooks are installed). Commits you make yourself, and commits made by
scripts the agent runs, are not touched. Every agent bash command also sees
`ZEN_SESSION_ID`. Telemetry fails open: with Langfuse unreachable or tracing off, no
scores are sent but trailers and the ledger still work; errors go to
`~/.zen/telemetry.log`. Details and edge cases: [docs/process-telemetry.md](docs/process-telemetry.md).

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
| `ZEN_TRACE_DIR`, `ZEN_GUARDRAILS_CONFIG` | Trace directory; alternate guardrail rules file |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_USER_ID` | Langfuse tracing (opt-in; keys can also live in `~/.pi/agent/langfuse.json`) |
| `ZEN_WORK_TYPE` | Default session work type (below `/zen type`, above `zen.config.json`) |
| `ZEN_BACKTEST_PATTERNS` | Regexes (JSON array or one per line) replacing the fallback backtest patterns in `.pi/zen-process.json` |
| `ZEN_LEDGER_DIR`, `ZEN_TELEMETRY_DEBUG` | Backtest ledger directory (default `~/.zen/ledger`); `1` = also print telemetry errors to stderr |
| `ZEN_SESSION_ID`, `ZEN_LEDGER_PY` | Set *by* zen-coding in every agent bash command (session id; path of `scripts/zen_ledger.py`) |

## Development

```bash
npm run typecheck     # tsc --noEmit over the extensions — run after any TS change
npm test              # unit tests (test/*.test.ts, via tsx)
npm run agent         # run the pinned pi version against this repository
```

| Path | Contents |
|---|---|
| `.pi/extensions/` | `guardrails.ts`, `observability.ts`, `modes.ts`, `zen-models-do.ts`, `zen-tools/`, `zen-process/` |
| `.pi/skills/` | Skills |
| `.pi/mcp.json`, `.pi/guardrails.json`, `.pi/zen-process.json`, `.pi/settings.json` | Connector, guardrail, process-telemetry, and default-model configuration |
| `scripts/`, `evals/` | Eval harness and cases; `scripts/zen_ledger.py` backtest ledger helper |
| `docs/`, `design.md` | Deep-dive docs; design notes |

Extensions are TypeScript loaded by pi without a build step; keep them dependency-light.
Contributor notes for agents are in [AGENTS.md](AGENTS.md). Never commit `.zen/`,
`.pi/npm/`, or secrets.

## License

Copyright 2026 zen-tradings. Licensed under the [Apache License, Version 2.0](LICENSE).
