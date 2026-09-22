# Research connectors (MCP)

zen-coding connects to external research and engineering tools through the
[Model Context Protocol](https://modelcontextprotocol.io). Servers are declared in
[`.pi/mcp.json`](../.pi/mcp.json) and bridged into pi by
[`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter), which is listed as a
project package in `.pi/settings.json` and installed automatically the first time pi
runs after you trust the project.

## How tools are exposed

All MCP servers are surfaced through a **single `mcp` proxy tool** rather than one tool
per remote function. This keeps the per-session context footprint small even with
dozens of connected tools, and lets the agent discover and call tools on demand.

A connector that cannot authenticate (missing key, expired token) logs a warning at
startup and the session continues without it — a missing optional connector never
blocks you from working.

## Connectors

### alphaXiv

- **Endpoint:** `https://api.alphaxiv.org/mcp/v1`
- **What it gives you:** quant paper research — `discover_papers`,
  `get_paper_content`, `answer_pdf_queries`, reading a paper's companion GitHub repo,
  and managing your alphaXiv library folders. alphaXiv returns AI-digested reports
  alongside the raw paper.
- **Auth:** create an API key at alphaxiv.org → Settings → API Keys and
  `export ALPHAXIV_API_KEY=...`. In the terminal UI you can instead run
  `/mcp-auth alphaxiv` for browser-based OAuth.

### paper-search

- **Runs locally:** `uvx paper-search-mcp` (stdio) — requires
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
- **Auth:** reuses your `gh` CLI login. The adapter runs `gh auth token` at connect
  time, so no separate personal access token is needed. The agent acts as whoever
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

Add an entry to `.pi/mcp.json`. Remote servers take a `url` plus an `auth` mode
(`bearer` with `bearerTokenEnv`, a shell command via `"!cmd"` as `bearerToken`, or
`false`); local servers take a `command` and `args`. Set `requestTimeoutMs` for slow
tools. Restart pi to pick up changes.

Connectors are configured per repository: the file in *this* repository is the one
that applies, including for repositories checked out by the Slack backend.
