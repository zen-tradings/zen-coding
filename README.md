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
| `observability.ts` | JSONL telemetry per session → `.zen/traces/<sessionId>.jsonl`: turn/tool latency, token usage, cost, model switches. Full transcripts live in pi's session files. |
| `modes.ts` | `/zen normal\|clarify\|plan` — clarify asks follow-up questions first; plan is read-only. |
| `zen-models.ts` | Registers self-hosted open-source model endpoints from `ZEN_LOCAL_*` env vars. |
| `zen-tools/` | `exa_search` (web/code/paper search). GitHub goes through `gh` + bash for now; proprietary data connectors land here. |

Extensions are TypeScript, loaded by pi without a build step. `npm run typecheck` checks them.

## Slack backend

`src/slack/` implements design.md §User Interaction 1: @-mention the bot in a channel
(optionally with a GitHub link) and the agent works in a backend session, streaming its
reply into the thread via message edits. DMs work the same way without the mention.

```bash
export SLACK_BOT_TOKEN=xoxb-...   # bot token
export SLACK_APP_TOKEN=xapp-...   # app-level token (Socket Mode)
npm run slack
```

Slack app setup (<https://api.slack.com/apps> → Create New App):

1. **Socket Mode**: enable, create an app-level token with `connections:write`.
2. **OAuth scopes (bot)**: `app_mentions:read`, `chat:write`, `channels:history`,
   `im:history`, `im:read`, `im:write`, `reactions:write`.
3. **Event subscriptions (bot events)**: `app_mention`, `message.im`, `message.channels`.
4. Install to workspace, invite the bot to a channel, @-mention it.

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
5. **MCP connectors**: bridge MCP servers (GitHub connector, proprietary data) via
   pi-mcp-extension or native tools in `zen-tools/`.

## References

- pi docs: <https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs>
  (extensions.md, sdk.md, rpc.md, models.md, providers.md)
- Design notes: [design.md](design.md)
