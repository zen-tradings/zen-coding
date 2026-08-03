/**
 * pi session factory for Slack threads.
 *
 * Security note: extensions (guardrails, observability, modes, zen-tools) are
 * ALWAYS discovered from the zen-coding repo root — never from the checked-out
 * repo — so a cloned repo's .pi/extensions/ can never execute code in this
 * service. Context files (AGENTS.md / CLAUDE.md) from the checkout are plain
 * content and are injected as virtual context instead.
 */
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  type ModelRuntime,
  resolveCliModel,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_CONTEXT_CHARS = 20_000;

const SLACK_CONTEXT = [
  "# Slack surface",
  "You are replying inside a Slack thread. Keep answers compact: short paragraphs,",
  "bullet lists, and only the relevant code hunks — no full-file dumps. The user",
  "cannot see your working directory, so name files with repo-relative paths.",
  "When you change code, end with a short summary of what changed and how to verify it.",
].join("\n");

export interface ThreadSessionOptions {
  /** Working directory the agent's tools operate in (the checkout). */
  cwd: string;
  /** zen-coding repo root: extension/guardrail discovery happens here. */
  zenRoot: string;
  modelRuntime: ModelRuntime;
  /** Optional "provider/model[:thinking]" spec, resolved like the CLI --model flag. */
  modelSpec?: string;
  /** Resume an existing session file (thread continuation after restart). */
  sessionFile?: string;
}

function loadCheckoutContext(cwd: string, zenRoot: string): Array<{ path: string; content: string }> {
  if (cwd === zenRoot) return [];
  const files: Array<{ path: string; content: string }> = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const path = join(cwd, name);
    if (!existsSync(path)) continue;
    try {
      files.push({ path, content: readFileSync(path, "utf8").slice(0, MAX_CONTEXT_CHARS) });
    } catch {
      // Unreadable context file: skip, the agent can still read it itself.
    }
  }
  return files;
}

export async function createThreadSession(opts: ThreadSessionOptions): Promise<AgentSession> {
  const checkoutContext = loadCheckoutContext(opts.cwd, opts.zenRoot);

  const loader = new DefaultResourceLoader({
    cwd: opts.zenRoot,
    agentDir: getAgentDir(),
    agentsFilesOverride: (current) => ({
      agentsFiles: [
        ...current.agentsFiles,
        ...checkoutContext,
        { path: "zen://slack-context/AGENTS.md", content: SLACK_CONTEXT },
      ],
    }),
  });
  await loader.reload();

  let model;
  let thinkingLevel;
  if (opts.modelSpec) {
    const resolved = resolveCliModel({ cliModel: opts.modelSpec, modelRuntime: opts.modelRuntime });
    if (resolved.error) throw new Error(resolved.error);
    if (resolved.warning) console.warn(`[zen-slack] ${resolved.warning}`);
    model = resolved.model;
    thinkingLevel = resolved.thinkingLevel;
  }

  const { session } = await createAgentSession({
    cwd: opts.cwd,
    agentDir: getAgentDir(),
    resourceLoader: loader,
    modelRuntime: opts.modelRuntime,
    model,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    sessionManager:
      opts.sessionFile && existsSync(opts.sessionFile)
        ? SessionManager.open(opts.sessionFile)
        : SessionManager.create(opts.cwd),
  });
  return session;
}
