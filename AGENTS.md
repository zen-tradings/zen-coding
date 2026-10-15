# zen-coding — Agent Instructions

Quant coding agent built on pi (`@earendil-works/pi-coding-agent`). pi is a pinned npm
dependency; zen-coding is a **pi package**: everything developers need in other
repositories (extensions, prompts, skills) is declared in the `pi` manifest of
`package.json` and auto-loads after `pi install git:github.com/zen-tradings/zen-coding`.
Running `pi` inside this checkout loads the same resources as project resources. See
README.md and design.md for the full picture.

## Commands

- `npm install` — install dependencies (Node >= 22)
- `pi` (run in the repo root) — launch the pi TUI with zen extensions; `npm run agent`
  does the same with the pi version pinned in `package.json`
- `npm run typecheck` — type-check the TS extensions, Slack backend and tests
  (`tsc --noEmit`); run this after editing anything in `.pi/extensions/`, `src/` or `tests/`
- `npm test` — unit tests: guardrail rule engine, trace detectors, and package discovery
  through pi's own resource loader (`node --test` via tsx)
- `npm run connectors` — merge `.pi/mcp.json` into the user-level `~/.pi/agent/mcp.json`
- `npm run slack` — start the Slack backend (Slack threads ↔ pi sessions)
- Headless: `pi -p "..."`, `pi --mode json -p "..."`, `pi --mode rpc` — non-interactive
  modes skip the trust prompt for project resources, so pass `-a` (or trust the project
  once interactively) when running inside this checkout
- Evals: `python3 scripts/run_eval.py [case-id|--track t]` then `python3 scripts/aggregate.py`
  (needs numpy, pandas, PyYAML and the sibling repos named in `evals/evals.json`)

## Environment variables

- Model provider key (at least one): `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`,
  `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `FIREWORKS_API_KEY`, …
- `EXA_API_KEY` — optional, key for the official Exa MCP connector
- `ALPHAXIV_API_KEY` — for the alphaXiv MCP server
- `RENDER_API_KEY` — for the Render MCP server
- `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` — Alpaca market-data connector (order tools hidden)
- GitHub MCP auth reuses `gh auth token` (no PAT needed)
- `WQ_BRAIN_USERNAME` / `WQ_BRAIN_PASSWORD` — WorldQuant BRAIN credentials for the
  `wq-alpha-research` skill (`.pi/skills/wq-alpha-research`, vendored). Its scripts also
  accept an untracked `credential.txt` (gitignored; never commit it).
- `ZEN_RESEARCH_SESSION`, `ZEN_DATA_SNAPSHOT`, `ZEN_RANDOM_SEED`, `ZEN_UNIVERSE` — pin
  the reproducibility fields a research session records in its trace
- Braintrust tracing (opt-in, off by default): `TRACE_TO_BRAINTRUST=true`,
  `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT=zen-coding`. Restart the process
  after setting these. Covers both interactive sessions (via
  `@braintrust/pi-extension`) and Slack-backend sessions (via
  `src/slack/tracing.ts`, which wraps the pi SDK with `wrapPiCodingAgentSDK`).

## Conventions

- Extensions are TypeScript, loaded without a build step. Keep them dependency-light;
  `npm run typecheck` and `npm test` must pass.
- If it is not in the `pi` manifest, it does not travel. Declare resource roots as
  directories (`./.pi/prompts`), not globs: pi 1.0.2 does not expand a glob that passes
  through a dot-directory (`tests/package.test.ts` guards this). New prompts go in
  `.pi/prompts/`, new skills in `.pi/skills/<name>/SKILL.md` (narrow descriptions so a
  dashboard or deploy task does not load them); both are already declared. Do not add
  git submodules — `pi install` cannot bring them along; vendor instead.
- Guardrails (denied bash patterns, protected paths, path-scoped research rules) are
  enforced by `.pi/extensions/guardrails.ts` from `.pi/guardrails.json` — do not bypass
  them. Research rules fire only on files matched by `research.paths` minus
  `research.exclude`; never make them fire on JS/TS UI or deploy files. Forward-return
  labels carry `# lookahead-ok: <reason>` on the line.
- `.pi/settings.json` (default model) is checkout-local and must not be made part of the
  package: never override the user's model.
- `.pi/mcp.json` is the connector **source list**; it only activates inside this
  checkout and for the Slack backend. Users merge it into `~/.pi/agent/mcp.json` with
  `npm run connectors`. pi packages cannot ship MCP entries. Tools are named
  `mcp__<server>__<tool>` and reached through `codemode` scripts by default; validate
  config with `pi mcp list`. Only one extension may register `/mcp`.
- `.zen/` is runtime state (Slack backend thread map and checkouts); never write to or
  read from it as a source of truth, and never commit it. Telemetry traces go to
  `~/.zen/traces/` (override: `ZEN_TRACE_DIR`), outside the repo.
- `.pi/npm/` is machine-local (installed packages) — never commit.
- Evals: pass criteria are fixed before a run. Research cases must keep a perturbation
  and a truncation verifier that fail on lookahead; verifiers live in
  `evals/fixtures/<case-id>/` and must be validated against a deliberately leaky
  implementation before being trusted.
- Committed secrets are forbidden (`.env`, `*.env`, `*.pem`, `*.key` are protected paths).

## Project layout

- `.pi/extensions/` — guardrails (global + research rules), observability (JSONL
  evidence traces → `~/.zen/traces/`, research context, guardrail events),
  `/zen normal|clarify|plan` modes
- `.pi/skills/` — `beta-audit`, `alpha-research`, `backtest`, `paper-replication`
  (with scripts), `wq-alpha-research` (vendored), `mintlify-docs`
- `.pi/prompts/` — the quant slash commands
- `src/slack/` — Slack backend (pi SDK)
- `evals/` — `evals.json` cases, `fixtures/<case-id>/` verifiers, `fixtures/lib/trace_check.py`
- `scripts/` — `run_eval.py`, `aggregate.py`, `install-connectors.mjs`
- `tests/` — unit tests for the extensions and the package manifest
- `docs/` — deep-dive docs (Slack internals, MCP connectors, install-anywhere, evals);
  README.md is the user-facing front page — keep reference detail in `docs/`
- `design.md` — architecture and roadmap
