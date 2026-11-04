# Process telemetry (Langfuse session scores, commit trailers)

Code: `.pi/extensions/zen-process/` (+ `/zen type` in `.pi/extensions/modes.ts`),
`scripts/zen_ledger.py`. Tests: `npm test`.

## Session id

Same id the Langfuse plugin uses for the session: `ctx.sessionManager.getSessionId()`.
For a pi process launched by another pi turn (a subagent), it is the parent's session
from `LANGFUSE_PI_PARENT_SESSION_ID`. zen-coding reads that variable once, from the
**launch environment** (first module load). The plugin rewrites the `LANGFUSE_PI_PARENT_*`
variables process-wide on every turn, so reading them later (as the plugin does) can pick
up another session's turn in the multi-session Slack backend. Every agent bash command
gets the result as `ZEN_SESSION_ID`.

## Session scores

All are posted with `POST /api/public/scores` (available on v4 `events_only` deployments)
to the session, with id `<sessionId>-<name>`, the score config id if one with that name
exists, and the same `environment` as the traces.

| Name | Type | Value | Metadata | Sent |
|---|---|---|---|---|
| `process.variants_tried` | NUMERIC | distinct variants | `total_runs`, `source` (`ledger` / `bash-heuristic` / `mixed`), `helper_runs`, `heuristic_runs`, `max_seeds_per_variant`, `variants[]` (hash prefix, runs, seeds) | after each backtest, at end of each run, on shutdown |
| `process.work_type` | CATEGORICAL | `research` / `conversion` / `ops` / `platform` / `unknown` | `source` (`command` / `env` / `repo` / `default`) | first prompt of each process, on `/zen type` |
| `process.commits` | TEXT | `repo@sha` per line | `commits[]` (sha, repo, ts) | after each agent commit, on shutdown |

Read them back with `GET /api/public/v3/scores?sessionId=<id>&fields=details`.

## Backtest ledger

`~/.zen/ledger/<sessionId>.jsonl` (override `ZEN_LEDGER_DIR`). Entry points call the
stdlib-only helper once per run; it is a no-op unless `ZEN_SESSION_ID` is set, and it
never raises.

```python
import os, runpy; os.environ.get("ZEN_LEDGER_PY") and runpy.run_path(os.environ["ZEN_LEDGER_PY"])["record"](configs=[args.config], seeds=args.seeds)
```

`record(configs=(), seeds=None, args=None, script=None)` stores git HEAD, a hash of the
uncommitted diff (tracked changes plus untracked files), content hashes of `configs`
and of any `--config/-c/--cfg/--params` argument, the CLI args, and the seeds.
`variant_hash` covers everything **except seeds** (`--seed`, `--seeds`, `--random-seed`,
`--random-state`, `--rng-seed`, or the `seeds=` argument). Config paths are replaced by
their content hash, so the same config under a different path counts as the same
variant.

**Fallback** for repos without the helper: a bash command matching one of the
`backtestPatterns` (`.pi/zen-process.json`; `ZEN_BACKTEST_PATTERNS` replaces them)
that succeeds without producing a helper record counts as one `bash-heuristic` run.
Its variant is git HEAD + `git diff HEAD` + untracked file names + the command with
seed flags removed. Once a repo has any helper record, its heuristic records are
ignored. Limits: one bash call counts as one run even if it loops over several
backtests, and backtests started from Python heredocs or `subprocess` are not detected.

## Commit trailers

The `tool_call` hook rewrites each unquoted `git [global options] commit` in the agent's
bash command to:

```
git [global options] -c trailer.ifexists=addIfDifferent commit \
  --trailer=Langfuse-Session=<sessionId> --trailer=Zen-Work-Type=<type> ...
```

Only the executed command changes. The command the model wrote, the session history,
and the traced tool input keep the original, because pi validates tool input into a
copy. The hook also works when another extension replaces `bash` (for example
`ssh.ts`). After the command finishes, zen-coding looks for
`Langfuse-Session: <sessionId>` in `git log` in the session cwd and in every
`cd`/`-C` target. New SHAs are stored in the session (custom entry `zen-commit`, so
they survive a resume) and posted as `process.commits`.

Edge cases:

- **Amend** gets the trailers too. `addIfDifferent` prevents duplicates, and an amend
  from a different session adds that session's `Langfuse-Session` line. The SHAs before
  and after the amend are both recorded.
- **Rebase, cherry-pick, merge** are not `git commit`. Trailers already in a message
  are kept, but the SHAs change, so the SHA recorded earlier goes stale. Merge commits
  have no trailers.
- **Not rewritten:** quoted commands (`bash -c '…'`), heredoc bodies (scripts being
  written), git aliases (`git ci`), `git commit-tree`, and commits made by scripts or
  programs the agent runs (no hooks are installed).
- Needs git >= 2.32 (`--trailer`). With older git the rewrite is skipped and logged,
  and the commit still runs.
- Commits made by people outside agent sessions are never touched: nothing is
  installed into the repo.

## Failure behavior

With Langfuse unreachable or `LANGFUSE_TRACING_ENABLED=false`, no scores are sent, but
ZEN_SESSION_ID, the ledger, and trailers keep working. Errors are appended to
`~/.zen/telemetry.log` (`ZEN_TELEMETRY_DEBUG=1` also prints them), and HTTP calls time
out after 5 s. On shutdown, pending scores get 3 s.
