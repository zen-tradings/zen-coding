---
title: "Use Zen Coding in any repository"
description: "Install the Zen Coding package once and use it wherever pi runs."
sidebarTitle: "Install anywhere"
---

# Using zen-coding in any repository

zen-coding is a [pi package](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md).
Install it once and its extensions, quant slash commands and skills load whenever you
run `pi` in *any* repository — a Next.js dashboard, a deploy repo, a research lab.
General engineering is the default; the research workflows are there when you type
them.

## Install

```bash
pi install git:github.com/zen-tradings/zen-coding        # user-wide (~/.pi/agent/git/)
pi install git:github.com/zen-tradings/zen-coding@<ref>  # pin a tag or commit
pi install git:github.com/zen-tradings/zen-coding -l     # project-local (.pi/git/), shareable via .pi/settings.json
pi install /path/to/zen-coding                           # from a local clone, without copying
```

pi clones the repository, runs `npm install --omit=dev` for third-party runtime
dependencies (such as `minimatch`), and registers the package in your settings so its
resources load in every session. The pi runtime packages themselves are declared as
`peerDependencies` — pi already bundles them for extensions, so nothing is duplicated.

Manage it like any other pi package:

```bash
pi list                     # show installed packages
pi update --extensions      # update packages (pinned @ref stays pinned)
pi remove git:github.com/zen-tradings/zen-coding
```

If you previously copied the prompt files into `~/.pi/agent/prompts/`, delete those
copies after installing: the package now ships them, and two `/alpha` commands produce a
collision warning at startup.

## What the package includes

The manifest (`pi` key in `package.json`) declares three resource roots. If it is not in
the manifest, it does not travel.

| Manifest entry | Resources | You get |
|---|---|---|
| `extensions: ./.pi/extensions` | `guardrails.ts`, `observability.ts`, `modes.ts` | Global guardrails (destructive shell, secrets, writes outside the project), path-scoped research guardrails, JSONL evidence traces, `/zen normal\|clarify\|plan` |
| `prompts: ./.pi/prompts` | `/alpha`, `/beta-audit`, `/portfolio`, `/backtest`, `/paper-replicate`, `/fundamental`, `/audit`, `/eval` | Explicit research checklists. They run only when typed; nothing is injected into other sessions |
| `skills: ./.pi/skills` | `beta-audit`, `alpha-research`, `backtest`, `paper-replication`, `wq-alpha-research`, `mintlify-docs` | Reusable procedures with scripts the agent loads when a task matches, or on demand with `/skill:<name>` |

The skill descriptions are deliberately narrow, so a dashboard or deploy task does not
load them. `wq-alpha-research` is vendored into the package (it used to be a git
submodule, which `pi install` cannot bring along).

Two things stay behind on purpose:

- **Default model.** `.pi/settings.json` in this repository sets Fireworks / Kimi as the
  default *for this checkout only*. Project settings are not part of the package: the
  package never overrides your model.
- **Connectors.** pi packages cannot ship MCP entries. `.pi/mcp.json` in this repository
  is the *source list*; it activates only while running inside this repository. To use
  the connectors elsewhere, merge them into your user-level `~/.pi/agent/mcp.json`:

  ```bash
  npm run connectors              # from a zen-coding checkout; add --only, --skip, --dry-run
  ```

  See [MCP connectors](mcp-connectors.md).

## Where state lives

A global install must not scatter files into the repositories you work in, so all state
resolves outside the current working directory:

| Env var | Default | Purpose |
|---|---|---|
| `ZEN_GUARDRAILS_CONFIG` | `.pi/guardrails.json` inside the installed package | Guardrail rules file. A missing or unreadable file is a **hard startup error** — guardrails never run silently disabled. |
| `ZEN_TRACE_DIR` | `~/.zen/traces` | JSONL telemetry output directory, created recursively if missing. |

Full conversation transcripts are kept by pi itself under `~/.pi/agent/sessions/`; the
zen traces add the timing, token, cost and evidence layer on top.

## How guardrails follow you

Global rules (`.env`, `*.key`, `*.pem`, `.pi/guardrails.json`, destructive shell
commands, writes outside the project root) apply in every repository, to every file.

Research rules (negative `shift`, centered windows, `fit` before `train_test_split`,
`inplace=True`, production data / model artifact / live-trading paths, cost-free
backtests, survivorship-prone universes) are **path-scoped**: they evaluate only files
matched by `research.paths` and not by `research.exclude` in the rules file — Python,
notebooks, R and Julia outside `frontend/`, `app/`, `services/`, `deploy/`, `docker/`
and similar directories. A TypeScript component or a `deploy.sh` never triggers them.

A repository can add its own rules in its own `.pi/guardrails.json`. These merge
**tighten-only** with the base rules:

- `denyBashPatterns`, `protectedPaths`, `research.paths`, `research.protectedPaths` and
  `research.rules` are unioned;
- an existing research rule may be raised from `warn` to `block` (`{ "id": ..., "action": "block" }`), never lowered;
- `research.exclude` cannot be extended by a repository;
- `allowWritesOutsideCwd` can only be narrowed to `false`.

A repository can therefore add protections but never weaken the base rules. A malformed
repo-local rules file is also a hard error — silently ignoring intended protections is
worse than failing loudly. Example for a deploy repository:

```json
{
  "protectedPaths": ["strategies/*/config.yaml", "envs/**"],
  "research": { "rules": [{ "id": "backtest-without-costs", "action": "block" }] }
}
```

## Trust

Packages installed user-wide load in every session without a prompt. When pi runs in a
repository that has its *own* `.pi/` resources, it asks you to trust that project before
loading them (interactive mode) or skips them unless trusted (`-p`, `--mode json`,
`--mode rpc`; override with `-a` / `--approve`). Declining trust for unfamiliar
codebases is the safe default — zen-coding's guardrails, being user-wide, still apply.
