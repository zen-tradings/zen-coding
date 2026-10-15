---
title: "Research connectors"
description: "Connect Zen Coding to research, market-data and engineering tools through MCP."
sidebarTitle: "MCP connectors"
---

# Research connectors (MCP)

zen-coding connects to external research and engineering tools through the
[Model Context Protocol](https://modelcontextprotocol.io), using pi's built-in MCP
support (pi ≥ 0.99). No adapter package is needed.

## Where connectors live

Connectors are **user-level**. pi packages cannot ship MCP entries, and a project
`.pi/mcp.json` is only read while pi runs inside that project — so
[`.pi/mcp.json`](https://github.com/zen-tradings/zen-coding/blob/main/.pi/mcp.json) in
this repository is the **source list**, not something that follows you into
`Strategy_Dashboard` or a deploy repo. Merge it into `~/.pi/agent/mcp.json` once:

```bash
npm run connectors                                   # add every connector that is not configured yet
node scripts/install-connectors.mjs --only alpaca,github
node scripts/install-connectors.mjs --skip paper-search --dry-run
node scripts/install-connectors.mjs --force          # overwrite entries you edited
node scripts/install-connectors.mjs --migrate-legacy # convert a top-level "servers" block
                                                     # left by @codella/pi-mcp-support
```

The script only touches `mcpServers`; unrelated entries and keys stay as they are, and
credentials are never written — every entry references an environment variable
(`${EXA_API_KEY}`, `${ALPACA_API_KEY}`, …) or a command (`!echo Bearer $(gh auth
token)`). Validate with `pi mcp list`, then `/reload` in a running session.

> **One `/mcp` only.** An installed extension that registers `/mcp` (for example
> `pi-mcp-adapter` or `@codella/pi-mcp-support`) replaces pi's built-in MCP support:
> pi then never reads `mcp.json` and the built-in server loader never starts. Keep one
> of the two — either `pi remove npm:@codella/pi-mcp-support`, or disable the built-in
> extension with `"extensions": ["-builtin:mcp"]` in your settings — not both.

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
`toolExposure` also hides tools: the Alpaca entry below hides every order- and
position-changing tool so the connector is read-only market data.

Every MCP call goes through pi's tool pipeline, so zen guardrails and `/zen plan` see
it like any other tool call.

A connector that cannot connect (missing key, expired token, local command not installed) is
reported once after startup and the session continues without it. `pi mcp list` connects
to every server and prints its state and errors; `/mcp` shows the same inside a session.

## Connectors

### Alpaca (market data)

- **Runs locally:** `uvx alpaca-mcp-server serve` (stdio) — the official
  [alpaca-mcp-server](https://github.com/alpacahq/alpaca-mcp-server); requires
  [uv](https://docs.astral.sh/uv/).
- **What it gives you:** stock, option and crypto bars at any timeframe, quotes, trades,
  snapshots, corporate actions, the trading calendar and clock, plus read access to the
  account and positions of the configured (paper) account.
- **Auth:** `export ALPACA_API_KEY=... ALPACA_SECRET_KEY=...` (a free paper account
  works). `ALPACA_PAPER_TRADE` is pinned to `True` in the entry.
- **Guardrail:** `toolExposure` hides `place_*`, `cancel_*`, `close_*`, `exercise_*`
  and the watchlist mutators. The agent can read markets; it cannot trade through this
  connector.

### Exa

- **Endpoint:** `https://mcp.exa.ai/mcp` — Exa's official hosted MCP server, with
  four tools enabled through the `tools` query parameter.
- **What it gives you:** `web_search_exa` (neural web search), `web_search_advanced_exa`
  (category, domain, and date filters, e.g. `research paper` or `news`),
  `get_code_context_exa` (code examples and library docs from GitHub and the web), and
  `web_fetch_exa` (a page as clean markdown). All are read-only.
- **Auth:** `export EXA_API_KEY=...` (dashboard.exa.ai → API Keys), sent as the
  `x-api-key` header. Exa also serves keyless requests on a rate-limited free tier; to
  use that, edit the entry in `~/.pi/agent/mcp.json` and drop `headers`.

### alphaXiv

- **Endpoint:** `https://api.alphaxiv.org/mcp/v1`
- **What it gives you:** quant paper research — `discover_papers`,
  `get_paper_content`, `answer_pdf_queries`, reading a paper's companion GitHub repo,
  and managing your alphaXiv library folders. alphaXiv returns AI-digested reports
  alongside the raw paper.
- **Auth:** create an API key at alphaxiv.org → Settings → API Keys and
  `export ALPHAXIV_API_KEY=...`. It is sent as an `Authorization: Bearer` header. To
  sign in with browser OAuth instead, remove `headers` from the entry in
  `~/.pi/agent/mcp.json` and run `/mcp login alphaxiv`.

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
  token is needed. The agent acts as whoever `gh` is logged in as.
- **Restricting scope:** append `/readonly` to the URL for read-only access, or scope
  to a toolset with `/x/<toolset>` (e.g. `/x/issues`).

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

Add an entry to `.pi/mcp.json` (same format as Claude Code and Cursor), then re-run
`npm run connectors` so it reaches your user-level file:

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

The Slack backend is the one place where the repository file applies directly: SDK
sessions register the servers from zen-coding's own `.pi/mcp.json` and never read a
checked-out repository's file (see [Slack](slack.md)).
