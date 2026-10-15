/**
 * pi session factory for Slack threads.
 *
 * Security note: extensions (guardrails, observability, modes) are
 * ALWAYS discovered from the zen-coding repo root — never from the checked-out
 * repo — so a cloned repo's .pi/extensions/ can never execute code in this
 * service. Context files (AGENTS.md / CLAUDE.md) from the checkout are plain
 * content and are injected as virtual context instead.
 *
 * MCP: SDK sessions do not load pi's built-in extensions, so the MCP, codemode,
 * and tool-search extensions are added explicitly. The built-in MCP loader
 * would read <session cwd>/.pi/mcp.json — the checkout — so its file loading is
 * disabled and the servers from zen-coding's own .pi/mcp.json are registered
 * instead. A cloned repo can therefore never add or redirect MCP servers.
 */
import * as pi from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  ExtensionAPI,
  McpServerConfig,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { maybeWrapPiForTracing } from "./tracing.js";

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

/** Servers from zen-coding's .pi/mcp.json; pi validates each on registration. */
function loadZenMcpServers(zenRoot: string): Array<[string, McpServerConfig]> {
  const path = join(zenRoot, ".pi", "mcp.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers?: Record<string, McpServerConfig>;
    };
    return Object.entries(parsed.mcpServers ?? {});
  } catch (err) {
    console.warn(`[zen-slack] ignoring unreadable ${path}: ${(err as Error).message}`);
    return [];
  }
}

export async function createThreadSession(opts: ThreadSessionOptions): Promise<AgentSession> {
  const {
    createAgentSession,
    createCodemodeExtension,
    createMcpExtension,
    createToolSearchExtension,
    DefaultResourceLoader,
    getAgentDir,
    resolveCliModel,
    SessionManager,
  } = await maybeWrapPiForTracing(pi);

  const checkoutContext = loadCheckoutContext(opts.cwd, opts.zenRoot);
  const mcpServers = loadZenMcpServers(opts.zenRoot);
  const registerZenMcpServers = (api: ExtensionAPI) => {
    for (const [name, config] of mcpServers) api.registerMcpServer(name, config);
  };

  const loader = new DefaultResourceLoader({
    cwd: opts.zenRoot,
    agentDir: getAgentDir(),
    extensionFactories: [
      createCodemodeExtension(),
      createToolSearchExtension(),
      // No file loading: never read the checkout's (or the host's) mcp.json.
      createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }) }),
      registerZenMcpServers,
    ],
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
  // Emits session_start: extensions initialise and MCP servers connect in the background.
  await session.bindExtensions({});
  return session;
}
