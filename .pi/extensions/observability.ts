/**
 * zen-coding observability: writes a JSONL evidence trace of agent activity to
 * <traceDir>/<sessionId>.jsonl — turn timings, tool calls with latency,
 * per-message token usage and cost, and model switches, plus per-step
 * evidence fields (role, model, evidence_refs, as_of, error, recovery,
 * self_check). Every line carries schema_version 2; see TraceLine below.
 *
 * <traceDir> defaults to ~/.zen/traces (global, so traces don't scatter
 * .zen/ directories into every repo the agent touches); override with
 * ZEN_TRACE_DIR. The directory is created recursively if missing.
 *
 * The trace holds pointers only — never file contents, prompts, or model
 * outputs. The full conversation transcript already lives in pi's session
 * files (~/.pi/agent/sessions/).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export const TRACE_SCHEMA_VERSION = 2;

export type StepRole = "plan" | "code" | "check" | "other";

export type EvidenceRef =
  | {
      kind: "file";
      path: string;
      /** 1-indexed, inclusive; end null = to end of file/read window; lines null = whole file. */
      lines: { start: number; end: number | null } | null;
      as_of: string | null;
    }
  | { kind: "tool_call"; id: string }
  | { kind: "url"; url: string; as_of: string | null }
  | { kind: "dataset"; id: string; as_of: string | null };

export interface TraceError {
  type: "tool_error" | "nonzero_exit" | "timeout" | "aborted" | "blocked" | "model_error";
  message: string;
  tool_call_id: string | null;
}

export interface TraceRecovery {
  action: "retry" | "alternate_tool" | "replan" | "gave_up";
  attempts: number;
}

export interface TraceSelfCheck {
  what_was_checked: string;
  result: "pass" | "fail" | "uncertain";
}

export type TraceEvent =
  | "session_start"
  | "agent_start"
  | "agent_end"
  | "turn_start"
  | "turn_end"
  | "tool_call_start"
  | "tool_call_end"
  | "assistant_usage"
  | "model_select"
  | "session_shutdown";

/** One line of <traceDir>/<sessionId>.jsonl. */
export interface TraceLine {
  schema_version: typeof TRACE_SCHEMA_VERSION;
  ts: string;
  event: TraceEvent;
  role: StepRole;
  /** "provider/model-id" in use for this step; null when no model is selected. */
  model: string | null;
  evidence_refs: EvidenceRef[];
  /** Earliest as_of across dated refs; null if any ref's date is unknown or there are none. */
  as_of: string | null;
  error: TraceError | null;
  recovery: TraceRecovery | null;
  self_check: TraceSelfCheck | null;
  // Event-specific telemetry (schema v1 fields, unchanged).
  cwd?: string;
  mode?: string;
  zen_mode?: string;
  durationMs?: number;
  turnIndex?: number;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  usage?: unknown;
  source?: string;
}

type StepFields = Omit<TraceLine, "schema_version" | "ts" | "event">;

const MAX_FIELD_CHARS = 4000;
const MAX_MESSAGE_CHARS = 300;
const MAX_REFS = 50;

// Bash commands treated as verification steps (role "check").
const CHECK_COMMAND =
  /\b(pytest|unittest|tsc|mypy|pyright|ruff|flake8|eslint|jest|vitest|go (test|vet)|cargo (test|check|clippy)|(npm|pnpm|yarn)( run)? (test|typecheck|lint|check)|make (test|check|lint)|run_eval\.py)\b/;

const MUTATING_FILE_TOOLS = new Set(["write", "edit"]);
const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

function compact(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text && text.length > MAX_FIELD_CHARS) {
    return `${text.slice(0, MAX_FIELD_CHARS)}…[truncated]`;
  }
  return value;
}

/** Strip file contents from tool args (write content, edit old/new text, bash heredocs). */
function redactArgs(toolName: string, args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  for (const key of ["content", "oldText", "newText"]) {
    if (typeof out[key] === "string") out[key] = `[redacted ${(out[key] as string).length} chars]`;
  }
  if (Array.isArray(out.edits)) out.edits = `[redacted ${out.edits.length} edits]`;
  if (toolName === "bash" && typeof out.command === "string" && out.command.includes("<<")) {
    out.command = `${out.command.split("\n")[0]} …[heredoc redacted]`;
  }
  return compact(out);
}

function clip(text: string, max = MAX_MESSAGE_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function modelId(model: { provider: string; id: string } | undefined): string | null {
  return model ? `${model.provider}/${model.id}` : null;
}

function mtime(absPath: string): string | null {
  try {
    return statSync(absPath).mtime.toISOString();
  } catch {
    return null;
  }
}

function isDirectory(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function resultText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content;
  return (content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

function earliestAsOf(refs: EvidenceRef[]): string | null {
  const dated = refs.filter((r) => r.kind !== "tool_call") as Exclude<EvidenceRef, { kind: "tool_call" }>[];
  if (dated.length === 0 || dated.some((r) => r.as_of === null)) return null;
  const times = dated.map((r) => Date.parse(r.as_of as string));
  if (times.some(Number.isNaN)) return null;
  return new Date(Math.min(...times)).toISOString();
}

export default function (pi: ExtensionAPI) {
  let tracePath: string | null = null;
  let agentStartedAt = 0;
  let zenMode = "normal";
  const turnStartedAt = new Map<number, number>();
  const toolStartedAt = new Map<string, number>();
  const toolCalls = new Map<string, { args: unknown; role: StepRole; refs: EvidenceRef[] }>();
  // Unresolved tool failure chain, used to infer recovery on later steps.
  let pendingFailure: { toolName: string; attempts: number } | null = null;

  pi.events.on("zen:mode", (mode) => {
    if (typeof mode === "string") zenMode = mode;
  });

  const baseRole = (): StepRole => (zenMode === "plan" ? "plan" : "other");

  const toolRole = (toolName: string, args: unknown): StepRole => {
    const command = (args as { command?: unknown } | undefined)?.command;
    if (toolName === "bash" && typeof command === "string" && CHECK_COMMAND.test(command)) return "check";
    if (zenMode === "plan") return "plan";
    if (MUTATING_FILE_TOOLS.has(toolName)) return "code";
    return "other";
  };

  const fileRef = (
    cwd: string,
    path: string,
    lines: { start: number; end: number | null } | null,
  ): EvidenceRef => {
    const abs = resolve(cwd, path);
    const rel = relative(cwd, abs);
    const shown = rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : abs;
    return { kind: "file", path: shown, lines, as_of: mtime(abs) };
  };

  // Evidence known before the tool runs: the files/dirs it targets.
  const inputRefs = (toolName: string, args: unknown, cwd: string): EvidenceRef[] => {
    if (!PATH_TOOLS.has(toolName) || !args || typeof args !== "object") return [];
    const a = args as { path?: unknown; offset?: unknown; limit?: unknown };
    const path = typeof a.path === "string" ? a.path : toolName === "read" ? null : ".";
    if (!path) return [];
    let lines: { start: number; end: number | null } | null = null;
    if (toolName === "read" && (typeof a.offset === "number" || typeof a.limit === "number")) {
      const start = typeof a.offset === "number" ? a.offset : 1;
      lines = { start, end: typeof a.limit === "number" ? start + a.limit - 1 : null };
    }
    return [fileRef(cwd, path, lines)];
  };

  // Evidence discovered in the tool's output: grep match locations, search result URLs.
  const outputRefs = (toolName: string, args: unknown, result: unknown, cwd: string): EvidenceRef[] => {
    const text = resultText(result);
    const refs: EvidenceRef[] = [];
    if (toolName === "grep") {
      const searchPath = (args as { path?: unknown } | undefined)?.path;
      const base = typeof searchPath === "string" ? searchPath : ".";
      const baseIsDir = isDirectory(resolve(cwd, base));
      for (const line of text.split("\n")) {
        const m = /^(.+?):(\d+): /.exec(line);
        if (!m) continue;
        const n = Number(m[2]);
        refs.push(fileRef(cwd, baseIsDir ? join(base, m[1]) : base, { start: n, end: n }));
        if (refs.length >= MAX_REFS) break;
      }
    } else if (toolName === "exa_search") {
      // exa_search output: "   <url>" optionally followed by "   published: <date>".
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && refs.length < MAX_REFS; i++) {
        const url = /^ {3}(https?:\/\/\S+)$/.exec(lines[i])?.[1];
        if (!url) continue;
        const published = /^ {3}published: (.+)$/.exec(lines[i + 1] ?? "")?.[1];
        const date = published ? new Date(published) : null;
        refs.push({
          kind: "url",
          url,
          as_of: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
        });
      }
    }
    return refs;
  };

  const toolError = (toolCallId: string, toolName: string, result: unknown): TraceError => {
    const text = resultText(result).trim();
    const lines = text.split("\n").filter((l) => l.trim());
    // Bash errors embed the command output; keep only the trailing status line.
    const message = clip((toolName === "bash" ? lines.at(-1) : lines[0]) ?? "");
    let type: TraceError["type"] = "tool_error";
    if (/^(zen-guardrails:|zen plan mode|Tool execution was blocked)/.test(text)) type = "blocked";
    else if (/Command exited with code \d+/.test(message)) type = "nonzero_exit";
    else if (/timed out|^timeout:/.test(message)) type = "timeout";
    else if (/aborted/i.test(message)) type = "aborted";
    return { type, message, tool_call_id: toolCallId };
  };

  const emit = (event: TraceEvent, ctx: ExtensionContext | undefined, data: Partial<StepFields> = {}) => {
    if (!tracePath) return;
    const refs = data.evidence_refs ?? [];
    const line: TraceLine = {
      schema_version: TRACE_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      event,
      role: baseRole(),
      model: modelId(ctx?.model),
      error: null,
      recovery: null,
      self_check: null,
      ...data,
      evidence_refs: refs,
      as_of: data.as_of !== undefined ? data.as_of : earliestAsOf(refs),
    };
    try {
      appendFileSync(tracePath, `${JSON.stringify(line)}\n`);
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
    emit("session_start", ctx, { cwd: ctx.cwd, mode: ctx.mode, zen_mode: zenMode });
  });

  pi.on("agent_start", async (_event, ctx) => {
    agentStartedAt = Date.now();
    pendingFailure = null;
    emit("agent_start", ctx, { zen_mode: zenMode });
  });

  pi.on("agent_end", async (_event, ctx) => {
    const recovery: TraceRecovery | null = pendingFailure
      ? { action: "gave_up", attempts: pendingFailure.attempts }
      : null;
    pendingFailure = null;
    emit("agent_end", ctx, { durationMs: Date.now() - agentStartedAt, recovery });
  });

  pi.on("turn_start", async (event, ctx) => {
    turnStartedAt.set(event.turnIndex, Date.now());
    emit("turn_start", ctx, { turnIndex: event.turnIndex });
  });

  pi.on("turn_end", async (event, ctx) => {
    const startedAt = turnStartedAt.get(event.turnIndex);
    turnStartedAt.delete(event.turnIndex);
    emit("turn_end", ctx, {
      turnIndex: event.turnIndex,
      durationMs: startedAt ? Date.now() - startedAt : undefined,
      evidence_refs: event.toolResults.map((r) => ({ kind: "tool_call" as const, id: r.toolCallId })),
    });
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    toolStartedAt.set(event.toolCallId, Date.now());
    const role = toolRole(event.toolName, event.args);
    const refs = inputRefs(event.toolName, event.args, ctx.cwd);
    toolCalls.set(event.toolCallId, { args: event.args, role, refs });
    const recovery: TraceRecovery | null = pendingFailure
      ? {
          action: pendingFailure.toolName === event.toolName ? "retry" : "alternate_tool",
          attempts: pendingFailure.attempts + 1,
        }
      : null;
    emit("tool_call_start", ctx, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: redactArgs(event.toolName, event.args),
      role,
      evidence_refs: [{ kind: "tool_call", id: event.toolCallId }, ...refs],
      recovery,
    });
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    const startedAt = toolStartedAt.get(event.toolCallId);
    toolStartedAt.delete(event.toolCallId);
    const call = toolCalls.get(event.toolCallId);
    toolCalls.delete(event.toolCallId);
    const role = call?.role ?? toolRole(event.toolName, undefined);

    const error = event.isError ? toolError(event.toolCallId, event.toolName, event.result) : null;
    if (error) {
      pendingFailure = {
        toolName: event.toolName,
        attempts: pendingFailure ? pendingFailure.attempts + 1 : 0,
      };
    } else {
      pendingFailure = null;
    }

    let selfCheck: TraceSelfCheck | null = null;
    const command = (call?.args as { command?: unknown } | undefined)?.command;
    if (role === "check" && typeof command === "string") {
      selfCheck = {
        what_was_checked: clip(command.split("\n")[0], 200),
        result: !error
          ? "pass"
          : error.type === "timeout" || error.type === "aborted" || error.type === "blocked"
            ? "uncertain"
            : "fail",
      };
    }

    emit("tool_call_end", ctx, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
      durationMs: startedAt ? Date.now() - startedAt : undefined,
      role,
      evidence_refs: [
        { kind: "tool_call" as const, id: event.toolCallId },
        ...(call?.refs ?? []),
        ...outputRefs(event.toolName, call?.args, event.result, ctx.cwd),
      ].slice(0, MAX_REFS),
      error,
      self_check: selfCheck,
    });
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const message = event.message as {
      usage?: unknown;
      provider?: string;
      model?: string;
      stopReason?: string;
      errorMessage?: string;
    };
    if (!message.usage) return;
    emit("assistant_usage", ctx, {
      usage: message.usage,
      model: message.provider && message.model ? `${message.provider}/${message.model}` : modelId(ctx.model),
      error:
        message.stopReason === "error"
          ? { type: "model_error", message: clip(message.errorMessage ?? ""), tool_call_id: null }
          : null,
    });
  });

  pi.on("model_select", async (event, ctx) => {
    emit("model_select", ctx, {
      model: modelId(event.model),
      source: event.source,
    });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    emit("session_shutdown", ctx);
    tracePath = null;
  });
}
