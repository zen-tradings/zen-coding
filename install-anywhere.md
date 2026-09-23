---
title: "Use Zen Coding in any repository"
description: "Install the Zen Coding extension layer and load it wherever pi runs."
sidebarTitle: "Install anywhere"
---

# Using zen-coding in any repository

zen-coding is a [pi package](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md):
besides running as a project, its extension layer can be installed once and loaded
whenever you run `pi` in *any* repository.

## Install

```bash
pi install git:github.com/zen-tradings/zen-coding        # user-wide (~/.pi/agent/git/)
pi install git:github.com/zen-tradings/zen-coding@<ref>  # pin a tag or commit
pi install git:github.com/zen-tradings/zen-coding -l     # project-local (.pi/git/), shareable via .pi/settings.json
pi install /path/to/zen-coding                           # from a local clone, without copying
```

pi clones the repository, runs `npm install --omit=dev` for third-party runtime
dependencies (such as `minimatch`), and registers the package in your settings so its
extensions load in every session. The pi runtime packages themselves are declared as
`peerDependencies` — pi already bundles them for extensions, so nothing is duplicated.

Manage it like any other pi package:

```bash
pi list                     # show installed packages
pi update --extensions      # update packages (pinned @ref stays pinned)
pi remove git:github.com/zen-tradings/zen-coding
```

## What a global install includes

The package manifest (`pi` key in `package.json`) currently declares **extensions
only** — `.pi/extensions/`:

| Extension | You get |
|---|---|
| `guardrails.ts` | Denied shell patterns, protected paths, no writes outside the project |
| `observability.ts` | JSONL traces of latency, tokens, and cost per session |
| `modes.ts` | `/zen` modes: `normal`, `clarify`, `plan` |
| `zen-models.ts` | Self-hosted model registration from `ZEN_LOCAL_*` |
| `zen-tools/` | `exa_search` (needs `EXA_API_KEY`) |

The quant slash commands (`.pi/prompts/`), skills (`.pi/skills/`), and MCP connectors
(`.pi/mcp.json`) are *project* resources: pi discovers them when you run it inside the
zen-coding repository. To use them elsewhere today, run `pi` from a zen-coding checkout,
or copy the prompt files into `~/.pi/agent/prompts/`.

## Where state lives

A global install must not scatter files into the repositories you work in, so all state
resolves outside the current working directory:

| Env var | Default | Purpose |
|---|---|---|
| `ZEN_GUARDRAILS_CONFIG` | `.pi/guardrails.json` inside the installed package | Guardrail rules file. A missing or unreadable file is a **hard startup error** — guardrails never run silently disabled. |
| `ZEN_TRACE_DIR` | `~/.zen/traces` | JSONL telemetry output directory, created recursively if missing. |

Full conversation transcripts are kept by pi itself under `~/.pi/agent/sessions/`; the
zen traces add the timing, token, and cost layer on top.

## How guardrails follow you

Protected-path rules (`.env`, `*.key`, `*.pem`, `.pi/guardrails.json`, …) are matched
relative to whichever project pi is running in, so they apply in every repository.
Writes outside the current project root remain blocked.

A repository can add its own rules in its own `.pi/guardrails.json`. These merge
**tighten-only** with the base rules:

- `denyBashPatterns` and `protectedPaths` are unioned;
- `allowWritesOutsideCwd` can only be narrowed to `false`.

A repository can therefore add protections but never weaken the base rules. A malformed
repo-local rules file is also a hard error — silently ignoring intended protections is
worse than failing loudly.

## Trust

Packages installed user-wide load in every session without a prompt. When pi runs in a
repository that has its *own* `.pi/` resources, it asks you to trust that project before
loading them (interactive mode) or skips them unless trusted (`-p`, `--mode json`,
`--mode rpc`; override with `-a` / `--approve`). Declining trust for unfamiliar
codebases is the safe default — zen-coding's guardrails, being user-wide, still apply.
