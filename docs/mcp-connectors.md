---
title: "Research connectors"
description: "Connect Zen Coding to research and engineering tools through MCP."
sidebarTitle: "MCP connectors"
---

# Research connectors (MCP)

zen-coding connects to external research and engineering tools through the
[Model Context Protocol](https://modelcontextprotocol.io). Servers are declared in
[`.pi/mcp.json`](https://github.com/zen-tradings/zen-coding/blob/experimental/.pi/mcp.json)
and loaded by pi's built-in MCP support (pi ≥ 0.99), once you trust the project. No
adapter package is needed.

> If another extension that registers `/mcp` is installed (for example
> `pi-mcp-adapter` or `@codella/pi-mcp-support`), pi skips its built-in MCP support and
> this file is not read. Remove that package from your user settings.

## How tools are exposed

Each server tool is registered as `mcp__<server>__<tool>` (dashes become underscores,
e.g. `mcp__paper_search__search_papers`). All servers use pi's default `codemode`
exposure: their tools are not declared to the model, so dozens of connected tools cost
almost no context. Servers are listed in a short `mcp_servers` system-prompt section with
their `description`, and the agent finds tools with `searchTools()` inside a `codemode`
script and calls them there, in parallel if useful.

To make a small, frequently used tool visible to the model directly, set
`"exposure": "direct"` on the server or a single tool via `toolExposure`; see pi's
[MCP docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md#control-tool-exposure).

Every MCP call goes through pi's tool pipeline, so zen guardrails and `/zen plan` see
it like any other tool call.

A connector that cannot connect (missing key, expired token, Docker not running) is
reported once after startup and the session continues without it. `pi mcp list` connects
to every server and prints its state and errors; `/mcp` shows the same inside a session.

## Connectors

### alphaXiv

- **Endpoint:** `https://api.alphaxiv.org/mcp/v1`
- **What it gives you:** quant paper research — `discover_papers`,
  `get_paper_content`, `answer_pdf_queries`, reading a paper's companion GitHub repo,
  and managing your alphaXiv library folders. alphaXiv returns AI-digested reports
  alongside the raw paper.
- **Auth:** create an API key at alphaxiv.org → Settings → API Keys and
  `export ALPHAXIV_API_KEY=...`. It is sent as an `Authorization: Bearer` header. To
  sign in with browser OAuth instead, define an `alphaxiv` entry without `headers` in
  your user-level `~/.pi/agent/mcp.json` and run `/mcp login alphaxiv`.

### paper-search

- **Runs locally:** `uvx --with 'mcp<2' paper-search-mcp` (stdio; the pin keeps it on
  the MCP Python SDK v1 API it was written for) — requires
  [uv](https://docs.astral.sh/uv/). Source:
  [openags/paper-search-mcp](https://github.com/openags/paper-search-mcp).
- **What it gives you:** unified search and download across 24+ sources — arXiv,
  PubMed, bioRxiv/medRxiv, Semantic Scholar, OpenAlex, Crossref, SSRN, Google
  Scholar, and more — via `search_papers` / `download_with_fallback` plus per-platform
  tools. Complements alphaXiv: alphaXiv gives digested reports and library management;
  paper-search gives raw multi-source retrieval, including SSRN.
- **Auth:** most sources work without keys. Optional keys (CORE, Semantic Scholar,
  Unpaywall email) go in `~/.config/paper-search-mcp/.env`.

### GitHub

- **Endpoint:** `https://api.githubcopilot.com/mcp/` — the official
  [github-mcp-server](https://github.com/github/github-mcp-server).
- **What it gives you:** structured issue, pull-request, and repository tools —
  `create_issue`, `add_issue_comment`, `create_pull_request`, code and issue search,
  notifications, and more.
- **Auth:** reuses your `gh` CLI login. The `Authorization` header is the command
  `!echo Bearer $(gh auth token)`, run at connect time, so no separate personal access
  token is needed. The agent acts as whoever
  `gh` is logged in as.
- **Restricting scope:** append `/readonly` to the URL for read-only access, or scope
  to a toolset with `/x/<toolset>` (e.g. `/x/issues`).

### Docker MCP Toolkit

- **Runs locally:** `docker mcp gateway run` (stdio) — requires Docker Desktop with the
  MCP Toolkit plugin (`docker mcp`).
- **What it gives you:** Docker's MCP gateway and its dynamic meta-tools (`mcp-find`,
  `mcp-add`, `mcp-exec`, …), so the agent can discover and invoke catalog servers on
  demand. Each server runs in its own container with the gateway's secret and network
  isolation.
- **Auth:** none for the gateway itself. Individual servers may need
  `docker mcp secret` entries. Pre-enable servers with
  `docker mcp server enable <name>` to pin a fixed toolset.

### Render

- **Endpoint:** `https://mcp.render.com/mcp`
- **What it gives you:** inspect and manage services deployed on
  [Render](https://render.com) — services, deploys, logs, and environment — useful when
  the agent maintains a strategy or data pipeline that is hosted there.
- **Auth:** `export RENDER_API_KEY=...` (Render dashboard → Account Settings → API Keys).

### Mintlify docs

- **Endpoint:** `https://www.mintlify.com/docs/mcp`
- **What it gives you:** live search over the official Mintlify documentation
  (`docs.json` schema, MDX components, CLI). Used by the `mintlify-docs` skill so that
  documentation work never relies on stale knowledge of Mintlify's format.
- **Auth:** none (public).

## Adding a connector

Add an entry to `.pi/mcp.json` (same format as Claude Code and Cursor):

```json
"my-server": {
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "Bearer ${MY_SERVER_TOKEN}" },
  "description": "One sentence on what it offers; shown to the model and used to rank its tools",
  "timeout": 60
}
```

- Remote servers take `url` and optional `headers`. Values can use `${ENV_VAR}` or be a
  whole-value `!command`. Without an `Authorization` header pi uses OAuth when the
  server asks for it (`/mcp login <name>`).
- Local servers take `command`, `args`, and optional `env` and `cwd`.
- `timeout` is per request, in seconds (default 60).
- Project files cannot use `"auth": { "provider": ... }`; that belongs in the user-level
  `~/.pi/agent/mcp.json`.

Run `pi mcp list` to validate, then `/reload` in a running session.

Connectors are configured per repository: the file in *this* repository is the one
that applies, including for repositories checked out by the Slack backend.
