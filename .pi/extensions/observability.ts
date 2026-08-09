/**
 * zen-coding observability: writes a JSONL trace of agent activity to
 * <traceDir>/<sessionId>.jsonl — turn timings, tool calls with latency,
 * per-message token usage and cost, and model switches.
 *
 * <traceDir> defaults to ~/.zen/traces (global, so traces don't scatter
 * .zen/ directories into every repo the agent touches); override with
 * ZEN_TRACE_DIR. The directory is created recursively if missing.
 *
 * The full conversation transcript already lives in pi's session files
 * (~/.pi/agent/sessions/); these traces add the timing/cost telemetry
 * layer for dashboards and benchmarking.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_FIELD_CHARS = 4000;

function compact(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text && text.length > MAX_FIELD_CHARS) {
    return `${text.slice(0, MAX_FIELD_CHARS)}…[truncated]`;
  }
  return value;
}

export default function (pi: ExtensionAPI) {
  let tracePath: string | null = null;
  let agentStartedAt = 0;
  const turnStartedAt = new Map<number, number>();
  const toolStartedAt = new Map<string, number>();

  const emit = (event: string, data: Record<string, unknown> = {}) => {
    if (!tracePath) return;
    try {
      appendFileSync(
        tracePath,
        `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`,
      );
    } catch {
      // Tracing must never break the agent.
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    const dir = process.env.ZEN_TRACE_DIR ?? join(homedir(), ".zen", "traces");
    try {
      mkdirSync(dir, { recursive: true });
      tracePath = join(dir, `${ctx.sessionManager.getSessionId()}.jsonl`);
    } catch {
      tracePath = null;
      return;
    }
    emit("session_start", { cwd: ctx.cwd, mode: ctx.mode });
  });

  pi.on("agent_start", async () => {
    agentStartedAt = Date.now();
    emit("agent_start");
  });

  pi.on("agent_end", async () => {
    emit("agent_end", { durationMs: Date.now() - agentStartedAt });
  });

  pi.on("turn_start", async (event) => {
    turnStartedAt.set(event.turnIndex, Date.now());
    emit("turn_start", { turnIndex: event.turnIndex });
  });

  pi.on("turn_end", async (event) => {
    const startedAt = turnStartedAt.get(event.turnIndex);
    turnStartedAt.delete(event.turnIndex);
    emit("turn_end", {
      turnIndex: event.turnIndex,
      durationMs: startedAt ? Date.now() - startedAt : undefined,
    });
  });

  pi.on("tool_execution_start", async (event) => {
    toolStartedAt.set(event.toolCallId, Date.now());
    emit("tool_call_start", {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: compact(event.args),
    });
  });

  pi.on("tool_execution_end", async (event) => {
    const startedAt = toolStartedAt.get(event.toolCallId);
    toolStartedAt.delete(event.toolCallId);
    emit("tool_call_end", {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
      durationMs: startedAt ? Date.now() - startedAt : undefined,
    });
  });

  pi.on("message_end", async (event) => {
    if (event.message.role !== "assistant") return;
    const usage = (event.message as { usage?: unknown }).usage;
    if (usage) emit("assistant_usage", { usage });
  });

  pi.on("model_select", async (event) => {
    emit("model_select", {
      model: `${event.model.provider}/${event.model.id}`,
      source: event.source,
    });
  });

  pi.on("session_shutdown", async () => {
    emit("session_shutdown");
    tracePath = null;
  });
}
