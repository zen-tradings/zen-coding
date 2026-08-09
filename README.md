# zen-coding

Quant coding agent built on [pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`).

pi is a **pinned npm dependency, not vendored**: the harness (agent loop, TUI, sessions,
providers) comes from the package; everything zen-specific lives in `.pi/extensions/` and
is auto-discovered whenever pi runs inside this repo.

## Quick start

Requires Node >= 22.

```bash
npm install

# At least one model provider key (see Models below), e.g.:
export DEEPSEEK_API_KEY=...        # or ANTHROPIC_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, ...
export EXA_API_KEY=...             # optional, enables the exa_search tool

# Optional: Braintrust tracing of interactive sessions (off by default)
export TRACE_TO_BRAINTRUST=true
export BRAINTRUST_API_KEY=...
export BRAINTRUST_PROJECT=zen-coding

npm run agent                      # launches the pi TUI with zen extensions loaded
```

On first launch pi asks you to trust this project (project-local extensions run arbitrary
code). Pick a model with `/model`, switch behavior with `/zen <mode>`.

Headless runs (used later by the eval harness and Slack backend):

```bash
npx pi -p "explain src/foo.py"        # one-shot, prints result
npx pi --mode json -p "..."           # streamed JSON events
npx pi --mode rpc                     # JSON protocol over stdin/stdout
```

## Models

Open-source models are first-class. Two ways to use them:

- **Hosted**: export the provider key and select with `/model` — DeepSeek
  (`DEEPSEEK_API_KEY`), Groq (`GROQ_API_KEY`), Fireworks, Together, OpenRouter
  (`OPENROUTER_API_KEY`), Hugging Face (`HF_TOKEN`), Kimi, Qwen, ZAI/GLM, MiniMax, …
- **Self-hosted** (vLLM / SGLang / Ollama / LM Studio / llama.cpp): set
  `ZEN_LOCAL_BASE_URL` and `ZEN_LOCAL_MODELS` — see `.pi/extensions/zen-models.ts`.

Closed models (Anthropic/OpenAI/Google) work the same way, which makes cross-model
benchmarking (cost/latency per task, see design.md) a matter of swapping `/model`.

## What's in `.pi/extensions/`

| Extension | Purpose |
|---|---|
| `guardrails.ts` | Blocks denied bash patterns and writes to protected paths before any tool executes. Rules in `.pi/guardrails.json`. |
| `observability.ts` | JSONL telemetry per session → `~/.zen/traces/<sessionId>.jsonl` (override: `ZEN_TRACE_DIR`): turn/tool latency, token usage, cost, model switches. Full transcripts live in pi's session files. |

Optional hosted tracing: `@braintrust/pi-extension` (in `.pi/settings.json` packages) streams
interactive sessions to Braintrust when `TRACE_TO_BRAINTRUST=true` + `BRAINTRUST_API_KEY` are set.
Slack-backend (SDK) sessions are traced by `src/slack/tracing.ts` under the same env vars.
The local JSONL traces remain the source of truth for the eval harness; Braintrust is the dashboard.
| `modes.ts` | `/zen normal\|clarify\|plan` — clarify asks follow-up questions first; plan is read-only. |
| `zen-models.ts` | Registers self-hosted open-source model endpoints from `ZEN_LOCAL_*` env vars. |
| `zen-tools/` | `exa_search` (web/code/paper search). GitHub goes through `gh` + bash for now; proprietary data connectors land here. |

Extensions are TypeScript, loaded by pi without a build step. `npm run typecheck` checks them.

## Install globally

This repo is also a pi package (`pi` manifest in `package.json`), so the zen layer —
guardrails, observability, `/zen` modes, zen-models, zen-tools — can be installed once
and loaded when running `pi` inside **any** repo:

```bash
pi install git:github.com/zen-tradings/zen-coding  # or: pi install /path/to/zen-coding
```

pi clones the repo, runs `npm install` (third-party runtime deps like `minimatch`;
the pi runtime packages are `peerDependencies` since pi bundles them for extensions),
and loads `.pi/extensions/` in every session.

Global installs resolve their state outside the cwd, so nothing is scattered into the
repos you work in:

| Env var | Default | Purpose |
|---|---|---|
| `ZEN_GUARDRAILS_CONFIG` | `.pi/guardrails.json` inside the installed package | Guardrail rules file. Missing/unreadable rules are a hard startup error — guardrails never run silently disabled. |
| `ZEN_TRACE_DIR` | `~/.zen/traces` | JSONL telemetry output directory (created recursively). |

Protected-path rules (`.env`, `*.key`, `*.pem`, `.pi/guardrails.json`, …) are matched
relative to whatever project pi is running in, so they follow the agent into any repo;
writes outside the current project root remain blocked. A repo can add its own rules via
its own `.pi/guardrails.json` — these merge **tighten-only** (deny lists union,
`allowWritesOutsideCwd` can only narrow to `false`), so a repo can add protections but
never weaken the base rules.

Note: when running in an arbitrary repo, that repo's own project-local
`.pi/extensions/` will also execute once the project is trusted — so declining trust
for unfamiliar codebases is the safe default.

## Skills (`.pi/skills/`)

Skills are on-demand capability packages ([Agent Skills standard](https://agentskills.io));
pi puts their descriptions in the system prompt and the agent loads the full
instructions only when a task matches (or force with `/skill:<name>`).

| Skill | Purpose |
|---|---|
| `mintlify-docs` | Structure, write, build, and maintain internal documentation with [Mintlify](https://mintlify.com/docs) (docs.json + MDX). Includes reference sheets (navigation schema, frontmatter, components, CLI), a starter template for scaffolding new docs sites, and workflows for validation (`mint validate`, `mint broken-links`) and push-to-deploy. Pairs with the `mintlify-docs` MCP connector below for live reference lookup. |

## Slack backend

`src/slack/` implements design.md §User Interaction 1: @-mention the bot in a channel
(optionally with a GitHub link) and the agent works in a backend session, streaming its
reply into the thread via message edits. DMs work the same way without the mention.

```bash
export SLACK_BOT_TOKEN=xoxb-...   # bot token
export SLACK_APP_TOKEN=xapp-...   # app-level token (Socket Mode)
npm run slack
```

Slack app setup (<https://api.slack.com/apps> → Create New App → **From a manifest**):

1. Pick your workspace and paste [`slack-app-manifest.yaml`](slack-app-manifest.yaml)
   (scopes, events, and Socket Mode are pre-configured).
2. **Basic Information → App-Level Tokens** → generate a token with
   `connections:write` → this is `SLACK_APP_TOKEN` (`xapp-…`).
3. **Install App → Install to Workspace** → copy the Bot User OAuth Token → this is
   `SLACK_BOT_TOKEN` (`xoxb-…`).
4. Invite the bot to a channel (`/invite @zen-coding`) and @-mention it, or DM it.

For private channels, additionally add the `groups:history` scope and the
`message.groups` event, then reinstall the app.

How it maps to pi:

- **Thread ↔ session**: each Slack thread (or DM) gets its own pi `AgentSession`
  (SDK `createAgentSession`), persisted so threads survive restarts and idle
  eviction (mapping in `.zen/slack/threads.json`).
- **Repo checkout per thread**: a GitHub link in the first message pins the thread to
  a clone under `.zen/slack/workspaces/`; `GITHUB_TOKEN` enables private repos (token
  is passed per git call, never written to disk). No link → `ZEN_SLACK_DEFAULT_CWD`.
- **Streaming**: replies stream into one message via throttled `chat.update` edits,
  with a tool-activity status line; long answers are chunked.
- **Steering**: messages sent while the agent is running are delivered as steering
  input to the ongoing run. `/zen plan|clarify|normal` works from Slack too.
- **Isolation**: zen extensions/guardrails always load from *this* repo — a cloned
  repo's `.pi/extensions/` is never executed. Guardrails block writes outside the
  thread's checkout. `ZEN_SLACK_ALLOWED_USERS` (comma-separated user IDs) restricts
  who can drive the bot.

All knobs (model override, clone depth, idle eviction, …) are documented in
`src/slack/config.ts`.

## MCP connectors

MCP servers are bridged via [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter),
installed as a project package (`.pi/settings.json`; pi auto-installs it on first run
after trust). Servers are configured in `.pi/mcp.json`:

- **alphaXiv** (`https://api.alphaxiv.org/mcp/v1`) — quant paper research:
  `discover_papers`, `get_paper_content`, `answer_pdf_queries`, GitHub repo reading for
  papers, and library folder management. Auth: create an API key at alphaxiv.org →
  Settings → API Keys and `export ALPHAXIV_API_KEY=...`; in the TUI you can instead run
  `/mcp-auth alphaxiv` for browser OAuth. Without credentials the connector logs a
  warning and the session continues without it.
- **paper-search** ([openags/paper-search-mcp](https://github.com/openags/paper-search-mcp),
  local stdio server run via `uvx paper-search-mcp` — requires [uv](https://docs.astral.sh/uv/))
  — multi-source paper search/download across 24+ platforms: arXiv, PubMed,
  bioRxiv/medRxiv, Semantic Scholar, OpenAlex, Crossref, SSRN, Google Scholar, ….
  Unified `search_papers` / `download_with_fallback` plus per-platform tools. Most
  sources work without keys; optional keys (CORE, Semantic Scholar, Unpaywall email)
  go in `~/.config/paper-search-mcp/.env`. Complements alphaXiv: alphaXiv gives
  AI-digested reports and library management, paper-search gives raw multi-source
  retrieval including SSRN.
- **Mintlify docs** (`https://www.mintlify.com/docs/mcp`) — live search over the
  official Mintlify documentation (docs.json schema, MDX components, CLI). Public,
  no auth. Used by the `mintlify-docs` skill so docs work never relies on stale
  knowledge of Mintlify's format.
- **GitHub** (`https://api.githubcopilot.com/mcp/`, the official
  [github-mcp-server](https://github.com/github/github-mcp-server)) — structured
  issue/PR/repo tools: `create_issue`, `add_issue_comment`, `create_pull_request`,
  searches, notifications, …. Auth reuses your `gh` CLI login (the adapter runs
  `gh auth token` at connect time — no separate PAT needed). Note the agent acts as
  whoever `gh` is logged in as, regardless of which Slack user drove the request. To
  restrict capabilities, append `/readonly` to the URL or scope with
  `/x/<toolset>` paths (e.g. `/x/issues`).
- **Docker MCP Toolkit** (local stdio: `docker mcp gateway run`) — Docker Desktop's
  MCP gateway; requires the Docker CLI with the MCP plugin (`docker mcp`). Exposes
  the gateway's dynamic meta-tools (`mcp-find`, `mcp-add`, `mcp-exec`, …) so the
  agent can discover and invoke catalog servers on demand; servers run as
  containers with the gateway's secret/network isolation. Pre-enable servers with
  `docker mcp server enable <name>` to pin a fixed toolset. No auth needed for the
  gateway itself; individual servers may need `docker mcp secret` entries.

All MCP tools are exposed through a single `mcp` proxy tool to keep the per-session
context footprint small. MCP config resolves from this repo's working directory, so
repos checked out by the Slack backend cannot inject their own MCP servers via a
committed `.mcp.json` (verified — a checkout's `.mcp.json` is not read). Start the
Slack backend from the repo root so the same config applies there.

## Architecture & roadmap

The same extensions load in every pi mode, so the quant layer is built once and shared
across all interaction surfaces (design.md §User Interaction):

1. **TUI** (done — this scaffold): `npm run agent`.
2. **Slack backend** (done — `src/slack/`, see above): Slack threads ↔ pi sessions via
   the SDK; repo checkout per thread; streamed replies via message edits.
3. **Sandboxing**: run each backend session in a container (RPC subprocess), following
   pi-chat's isolation model.
4. **Eval/benchmark runner**: drive `pi --mode json` headlessly over task datasets
   (beta-audit, portfolio construction, …), scoring outputs and reading cost/latency
   from the traces.
5. **MCP connectors** (done for alphaXiv + GitHub via `pi-mcp-adapter`, see above):
   next up proprietary data connectors, via `.pi/mcp.json` or native tools in
   `zen-tools/`.

## References

- pi docs: <https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs>
  (extensions.md, sdk.md, rpc.md, models.md, providers.md)
- Design notes: [design.md](design.md)
