# Using zen-coding in any repository

zen-coding is a **pi package**: besides running as a project, its extension layer
(guardrails, observability, `/zen` modes, self-hosted model registration, zen-tools)
can be installed once and loaded whenever you run `pi` in *any* repository.

## Install

```bash
pi install git:github.com/zen-tradings/zen-coding
# or, from a local clone:
pi install /path/to/zen-coding
```

pi clones the repository, runs `npm install` for third-party runtime dependencies
(such as `minimatch`), and registers `.pi/extensions/` to load in every session. The
pi runtime packages themselves are declared as `peerDependencies` — pi already bundles
them for extensions, so nothing is duplicated.

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

## Trust and third-party extensions

When pi runs in a repository, that repository's *own* `.pi/extensions/` will also
execute once you trust the project. Declining trust for unfamiliar codebases is the safe
default; zen-coding's guardrails still load either way.

## Updating

Re-run `pi install` with the same source to pull the latest version.
