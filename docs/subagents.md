# Sub-agent delegation

zen-coding loads a `subagent` tool through `.pi/extensions/subagent/index.ts`. It is
adapted from [Pi's official example](https://github.com/earendil-works/pi/tree/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/coding-agent/examples/extensions/subagent),
not a dependency on the community `pi-subagents` package. The upstream MIT license
is preserved beside the extension. No separate service or database is required.

## Try it

Use Node >= 22.19 and run `npm install`. Launch the agent with search tools enabled
so exploratory children can inherit them:

```bash
npm run agent -- --tools read,grep,find,ls,bash,edit,write
```

Trust this project when Pi asks. In headless mode, add `-a` to approve loading this
repository's extensions. Sub-agents also work when the zen layer is installed as a
Pi package in another repository. They use that session's active workspace.

Examples to type into Pi:

```text
Use scout to trace the login flow. Return relevant file references.
Run two scouts in parallel: inspect authentication code and inspect its tests.
Use a chain: scout identifies the relevant code, planner proposes a fix,
then worker implements the plan.
```

The parent model invokes the tool. You can also explicitly describe the arguments:

```json
{"agent":"scout","task":"Read src/auth/login.ts and explain the failure path."}
```

```json
{"tasks":[
  {"agent":"scout","task":"Inspect src/auth/login.ts."},
  {"agent":"reviewer","task":"Inspect tests/auth.test.ts."}
]}
```

```json
{"chain":[
  {"agent":"scout","task":"Inspect src/auth/login.ts and report evidence."},
  {"agent":"planner","task":"Propose a fix using this evidence: {previous}"}
]}
```

Choose exactly one mode: `agent` + `task`, `tasks`, or `chain`. Each call accepts at
most eight tasks/steps. A failed chain stops; parallel work preserves completed
results alongside failure diagnostics. TUI rendering shows progress, tool calls,
turns, tokens, and estimated cost; expand the result to inspect child activity.

## Profiles and permissions

Bundled definitions live in `.pi/agents/` and are always available, including from
Slack or another checkout. The parent receives a compact catalog of available
profile names and descriptions before each turn:

| Profile | Purpose | Requested tools |
|---|---|---|
| `scout` | Explore code and return evidence | read, grep, find, ls |
| `planner` | Propose an implementation plan | read, grep, find, ls |
| `reviewer` | Review correctness and regressions | read, grep, find, ls |
| `worker` | Implement a focused task | read, grep, find, ls, bash, edit, write |

Actual child tools are the intersection of the profile allowlist and the parent's
active built-in tools. Pi normally starts with read, bash, edit, and write, so a
scout receives only `read` unless the parent also enables the search tools. Missing
or empty tool allowlists are rejected rather than granting full access.

Add a user definition at `~/.pi/agent/agents/<name>.md` (or the agents directory
under `PI_CODING_AGENT_DIR`):

```markdown
---
name: test-reviewer
description: Review tests for missing regression coverage
tools: read, grep, find, ls
# Optional: model: anthropic/claude-sonnet-4-5
---
Inspect the assigned tests. Report missing cases with file references.
Do not change files. State uncertainty explicitly.
```

The default `agentScope: "user"` combines bundled profiles with user overrides.
`agentScope: "project"` or `"both"` includes `.pi/agents` definitions from the nearest
project **only when Pi reports that workspace as trusted**. Project overrides win
in `both` scope; bundled profiles remain available in every scope. Slack does not
implicitly trust cloned repositories, so use bundled/user profiles there.

When a profile omits `model`, the child inherits the parent's provider/model and
thinking level. An override uses Pi's model resolver. Auth comes from the normal
Pi credential store/environment; custom models must be discoverable through
`models.json`. Providers or credentials registered only in the parent's memory are
not copied into children. Model-resolution warnings appear in child diagnostics.

## How execution works

1. The parent calls `subagent` with a focused task. Include needed facts, filenames,
   and constraints in the task; the full parent conversation is not copied.
2. The extension validates profiles, workspace, and permissions, then reserves a
   concurrency slot shared across that parent session's delegation calls.
3. A separate Node process runs `child.mjs` with the parent's installed Pi SDK.
   Its session history is in memory. It receives project context files, profile
   instructions, and the explicit task, but no parent's message history.
4. The child explicitly loads only zen guardrails, observability, and its tool
   policy. User/project extensions, MCP packages, skills, and prompt workflows are
   not automatically inherited. Extension load/startup errors fail before prompting.
5. JSON events stream back to the parent. Final text is returned as the tool result;
   child messages and usage remain in tool details for inspection. Chain steps
   receive prior output only through the explicit `{previous}` placeholder.

The bootstrap deliberately uses the SDK instead of guessing that
`process.argv[1]` is the Pi CLI: in Slack it is the service entrypoint. It also
checks extension startup errors before work begins. The official example's
profile discovery, single/parallel/chain orchestration, and TUI rendering are
retained with these zen adaptations.

## Restrictions and lifecycle

- Children stay in the parent's workspace. A different `cwd` is rejected.
- `/zen plan` restricts children to read, grep, find, and ls, even for `worker`.
  Clarify mode adds the parent's ambiguity-handling instruction.
- Children cannot recursively use the delegation tool or custom extension tools.
- Parallel tasks must have no bash, edit, or write capability. Use single/chain mode
  for implementation; isolated worktrees and concurrent writers are not included.
- Parent cancellation stops active children. On macOS/Linux, termination applies to
  the process group, including shell descendants, with forced termination after a
  grace period. Windows termination is limited to the direct child process.
- Timeouts apply per running child. Output capture is capped at 4 MiB per child;
  returned text is capped at approximately 50 KiB per tool result.

The existing guardrails are tool-level checks, **not an OS filesystem sandbox**.
Bash in a worker retains the same limitations as the parent: protected-path checks
apply to edit/write, while bash uses denied-command patterns. Arbitrary additional
parent extension policies are not copied. Do not treat a separate child context as
filesystem or credential isolation.

| Environment variable | Default | Accepted values |
|---|---|---|
| `ZEN_SUBAGENT_CONCURRENCY` | 4 | Integer 1–4 |
| `ZEN_SUBAGENT_TIMEOUT_SECONDS` | 600 | Integer 1–3600 |

Children produce normal zen trace files in `ZEN_TRACE_DIR` or `~/.zen/traces`.
Their `session_start` includes `parent_session_id` and `parent_tool_call_id` for
correlation. Child sessions are not resumable in this first integration; user-visible
results and child details persist in the parent session.

## Verification

```bash
npm run typecheck
node --check .pi/extensions/subagent/child.mjs
node --import tsx --test tests/subagents.test.ts
git diff --check
```

The suite uses a localhost mock model endpoint with real Pi parent/child sessions.
It exercises separate contexts, returning file evidence, single/parallel/chain
execution, partial failure, planning-mode propagation, guardrail enforcement,
untrusted extension exclusion, startup failures, cancellation, process-group
cleanup, and concurrency limits. It does not call a paid provider or a live Slack
workspace, and it does not visually verify the interactive TUI.
