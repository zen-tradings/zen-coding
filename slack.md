---
title: "Slack bot"
description: "Understand Zen Coding's Slack architecture and configuration."
sidebarTitle: "Slack bot"
---

# Slack bot — architecture and configuration

This page explains how the Slack backend (`src/slack/`) works and lists every
configuration option. For the step-by-step setup (creating the Slack app, generating
tokens, inviting the bot) see the [Slack bot section of the README](https://github.com/zen-tradings/zen-coding#slack-bot).

## How it works

The backend is a long-running Node process (`npm run slack`) that connects to Slack
over **Socket Mode** and drives pi through its SDK (`createAgentSession`). No public
URL, webhook, or inbound firewall rule is needed.

### One thread, one session

Every Slack thread (or DM conversation) maps to exactly one pi `AgentSession`. Sessions
are persisted, so a thread survives backend restarts and idle eviction — the next
message in an old thread resumes where it left off. The mapping is stored in
`.zen/slack/threads.json`.

### Repository checkout per thread

If the first message in a thread contains a GitHub link, the thread is pinned to a
fresh clone of that repository under `.zen/slack/workspaces/` and the agent works
inside that checkout.

- `GITHUB_TOKEN` (or `GH_TOKEN`) enables cloning private repositories. The token is
  passed per git invocation and is never written to disk.
- `ZEN_SLACK_CLONE_DEPTH` controls shallow cloning (`0` = full clone, the default).
- Without a link, the agent works in `ZEN_SLACK_DEFAULT_CWD` (default: the zen-coding
  repository itself).

### Streaming replies

The agent's reply streams into a single Slack message through throttled `chat.update`
edits, with a status line showing the tool currently running. Long answers are split
across multiple messages, and Markdown is adapted for Slack's formatting
(`src/slack/markdown.ts`).

### Steering a running task

Messages posted while the agent is still working are delivered as *steering input* to
the ongoing run rather than queued as a new turn. `/zen plan`, `/zen clarify`, and
`/zen normal` work from Slack exactly as they do in the terminal.

### Isolation model

- **Extensions always load from zen-coding.** Guardrails, observability, modes, and
  zen-tools come from this repository — a cloned repository's own `.pi/extensions/`
  is never executed.
- **MCP configuration is fixed.** MCP servers resolve from zen-coding's working
  directory, so a cloned repository cannot inject servers via a committed `.mcp.json`.
  Start the backend from the zen-coding repo root so the same connectors apply.
- **Writes are confined to the checkout.** Guardrails block writes outside the thread's
  working directory (`allowWritesOutsideCwd: false`).
- **Access control.** `ZEN_SLACK_ALLOWED_USERS` restricts who may drive the bot. Empty
  (the default) allows anyone in the workspace who can message the bot.
- **Identity caveat.** Tools that act on external services (the GitHub MCP connector,
  `gh`, …) run as whoever the *backend host* is authenticated as — not as the Slack
  user who sent the message. Scope the host's credentials accordingly.

### Tracing

Set `TRACE_TO_BRAINTRUST=true` and `BRAINTRUST_API_KEY` to stream backend sessions to
Braintrust; `src/slack/tracing.ts` wraps the pi SDK with `wrapPiCodingAgentSDK` so
SDK-driven sessions are traced the same way interactive ones are. Local JSONL traces
(`~/.zen/traces/`) are written regardless.

## Configuration reference

All settings are environment variables, read once at startup (`src/slack/config.ts`).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | yes | — | Bot token (`xoxb-…`) |
| `SLACK_APP_TOKEN` | yes | — | App-level token with `connections:write` (`xapp-…`), for Socket Mode |
| `ZEN_SLACK_MODEL` | no | pi default | Model override as `provider/model[:thinkingLevel]`, e.g. `deepseek/deepseek-chat` |
| `ZEN_SLACK_DEFAULT_CWD` | no | zen-coding root | Working directory when a message has no GitHub link |
| `ZEN_SLACK_WORKSPACES` | no | `.zen/slack/workspaces` | Where per-thread checkouts live |
| `ZEN_SLACK_CLONE_DEPTH` | no | `0` (full clone) | Shallow-clone depth |
| `ZEN_SLACK_IDLE_MINUTES` | no | `60` | Dispose sessions idle longer than this; they resume on the next message |
| `ZEN_SLACK_ALLOWED_USERS` | no | everyone | Comma-separated Slack user IDs allowed to use the bot |
| `GITHUB_TOKEN` / `GH_TOKEN` | no | — | Clone private repositories |
| `TRACE_TO_BRAINTRUST`, `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT` | no | off | Braintrust tracing (see above) |

## Slack app manifest

[`slack-app-manifest.yaml`](https://github.com/zen-tradings/zen-coding/blob/experimental/slack-app-manifest.yaml) pre-configures the bot's
scopes, event subscriptions, and Socket Mode. To let the bot work in **private
channels**, add the `groups:history` scope and the `message.groups` event, then
reinstall the app to your workspace.

## Runtime state

Everything the backend writes lives under `.zen/slack/` (gitignored):

- `threads.json` — thread → session mapping
- `workspaces/` — per-thread repository checkouts
