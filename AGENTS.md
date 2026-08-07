# zen-coding — Agent Instructions

Quant coding agent built on pi (`@earendil-works/pi-coding-agent`). pi is a pinned npm
dependency; all zen-specific behavior lives in `.pi/extensions/` and auto-loads when pi
runs in this repo. See README.md and design.md for the full picture.

## Commands

- `npm install` — install dependencies (Node >= 22)
- `npm run agent` — launch the pi TUI with zen extensions
- `npm run typecheck` — type-check the TS extensions (`tsc --noEmit`); run this after
  editing anything in `.pi/extensions/` or `src/`
- `npm run slack` — start the Slack backend (Slack threads ↔ pi sessions)
- Headless: `npx pi -p "..."`, `npx pi --mode json -p "..."`, `npx pi --mode rpc`

## Environment variables

- Model provider key (at least one): `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`,
  `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `FIREWORKS_API_KEY`, …
- `EXA_API_KEY` — optional, enables the `exa_search` tool
- `ALPHAXIV_API_KEY` — for the alphaXiv MCP server
- `RENDER_API_KEY` — for the Render MCP server
- GitHub MCP auth reuses `gh auth token` (no PAT needed)
- `ZEN_LOCAL_BASE_URL` / `ZEN_LOCAL_MODELS` — self-hosted model endpoints
  (see `.pi/extensions/zen-models.ts`)
- Braintrust tracing (opt-in, off by default): `TRACE_TO_BRAINTRUST=true`,
  `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT=zen-coding`. Restart the process
  after setting these. Covers both interactive sessions (via
  `@braintrust/pi-extension`) and Slack-backend sessions (via
  `src/slack/tracing.ts`, which wraps the pi SDK with `wrapPiCodingAgentSDK`).

## Conventions

- Extensions are TypeScript, loaded without a build step. Keep them dependency-light;
  `npm run typecheck` must pass.
- Guardrails (denied bash patterns, protected paths) are enforced by
  `.pi/extensions/guardrails.ts` from `.pi/guardrails.json` — do not bypass them.
- `.zen/` is runtime state (telemetry traces); never write to or read from it as a
  source of truth, and never commit it.
- `.pi/npm/` is machine-local (installed packages) — never commit.
- MCP servers are configured in `.pi/mcp.json` at the repo root; all MCP tools go
  through the single `mcp` proxy tool.
- Committed secrets are forbidden (`.env`, `*.pem`, `*.key` are protected paths).

## Project layout

- `.pi/extensions/` — guardrails, observability (JSONL traces → `.zen/traces/`),
  `/zen normal|clarify|plan` modes, self-hosted model registration, zen-tools
- `.pi/skills/`, `.pi/prompts/` — shared skills and prompt templates
- `src/slack/` — Slack backend (pi SDK)
- `evals/` — eval/benchmark runner work
- `design.md` — architecture and roadmap
