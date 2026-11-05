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
| `modes.ts` | `/zen` modes: `normal`, `clarify`, `plan`; `/zen type` work-type tags |
| `zen-models-do.ts` | DigitalOcean GenAI provider (needs `ZEN_DIGITALOCEAN_API_KEY`) |
| `zen-tools/` | `exa_search` (needs `EXA_API_KEY`) |
| `zen-process/` | Session scores (`process.variants_tried`, `process.work_type`, `process.commits`), `ZEN_SESSION_ID`, commit trailers — see [process-telemetry.md](process-telemetry.md) |

The skills (`.pi/skills/`) and MCP connectors
(`.pi/mcp.json`) are *project* resources: pi discovers them when you run it inside the
zen-coding repository. To use them elsewhere today, run `pi` from a zen-coding checkout.

## Install only zen-process (`/zen type` + session scores)

To get work-type tagging in every project without the other extensions (guardrails,
DigitalOcean models, `jev/auto`, observability, `exa_search`), install the package and
narrow it to two extensions:

- `modes.ts`, which registers `/zen`, including `/zen type`
- `zen-process/`, which posts the `process.work_type` session score and adds the commit
  trailers

**1. Install (user-wide, no `-l`):**

```bash
pi install git:github.com/zen-tradings/zen-coding
```

**2. Narrow it.** `pi install` writes a plain string entry to `~/.pi/agent/settings.json`.
Replace that entry with the object form (keep your other packages as they are):

```json
{
  "packages": [
    {
      "source": "git:github.com/zen-tradings/zen-coding",
      "extensions": [".pi/extensions/modes.ts", ".pi/extensions/zen-process/index.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

Skip step 2 to keep the full extension layer. `/zen type` works the same either way.

**3. Langfuse credentials (for the score).** zen-process reads the same credentials as the
Langfuse plugin. Environment variables win over `~/.pi/agent/langfuse.json`:

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-...  LANGFUSE_SECRET_KEY=sk-lf-...
export LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or your region / self-hosted URL
```

If there are no keys, or `LANGFUSE_TRACING_ENABLED=false` is set, `/zen type`, the status
bar and commit trailers still work; nothing is sent. To also see the session's traces in
Langfuse, not just its scores, install the tracing plugin:
`pi install npm:@langfuse/pi-observability-plugin`.

**4. Use it in any project:**

```
/zen type research        # research | conversion | ops | platform
/zen type                 # show the current value and where it came from
```

The value is resolved per session, first match wins:

1. `/zen type`, saved in the session so it survives restart and resume
2. `ZEN_WORK_TYPE`
3. a per-repo default in `zen.config.json` (`{"workType": "platform"}`, nearest one
   walking up from the cwd)
4. otherwise `unknown`

It is posted as the `process.work_type` CATEGORICAL session score. The metadata `source`
is `command`, `env`, `repo` or `default`. Read it back with
`GET /api/public/v3/scores?name=process.work_type&fields=details` (see
[process-telemetry.md](process-telemetry.md)).

**Verify:** `pi list` shows `git:github.com/zen-tradings/zen-coding (filtered)`. In any
repo, `/zen type research` shows `type: research` in the status bar.

**Update / remove:** `pi update git:github.com/zen-tradings/zen-coding`,
or `pi remove git:github.com/zen-tradings/zen-coding`.

## Global install + zen-coding checkout

When a global install is active and you run `pi` inside a zen-coding checkout, pi sees
two copies of every extension: the project's `.pi/extensions/` and the installed package.
Each zen extension claims its name on the session's extension event bus at load
(`.pi/extensions/shared/load-once.ts`), and the second copy returns without registering
anything. pi loads project extensions first, so inside a checkout your working tree wins.
There is still one `/zen` command, and nothing is traced, scored or rewritten twice.

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
