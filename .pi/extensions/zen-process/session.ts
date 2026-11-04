/**
 * Langfuse session id resolution, mirroring @langfuse/pi-observability-plugin:
 * a pi process launched by another pi turn (subagent) inherits the parent's
 * session via LANGFUSE_PI_PARENT_* env vars; otherwise the pi session id is used.
 *
 * The inherited parent is read ONCE per process, at first module evaluation —
 * i.e. from the launch environment — and never again. The plugin rewrites
 * those variables process-wide during every turn, so reading them later (as the
 * plugin does at each session's factory time) can pick up another in-process
 * session's turn; in the Slack backend that would stamp the wrong session.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const HEX_TRACE_ID = /^[0-9a-f]{32}$/;
const HEX_SPAN_ID = /^[0-9a-f]{16}$/;
const SNAPSHOT = Symbol.for("zen-coding.inheritedParentSessionId");

/** Same validity rules as the plugin's readInheritedParent(). */
export function readInheritedParentSessionId(env: NodeJS.ProcessEnv): string | undefined {
  const traceId = env.LANGFUSE_PI_PARENT_TRACE_ID?.trim().toLowerCase();
  const spanId = env.LANGFUSE_PI_PARENT_SPAN_ID?.trim().toLowerCase();
  if (!traceId || !spanId) return undefined;
  if (!HEX_TRACE_ID.test(traceId) || !HEX_SPAN_ID.test(spanId)) return undefined;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined;
  return env.LANGFUSE_PI_PARENT_SESSION_ID?.trim() || undefined;
}

export function inheritedParentSessionId(): string | undefined {
  const g = globalThis as Record<symbol, string | undefined>;
  if (!(SNAPSHOT in g)) g[SNAPSHOT] = readInheritedParentSessionId(process.env);
  return g[SNAPSHOT];
}
inheritedParentSessionId(); // snapshot the launch environment now

export function resolveSessionId(ctx: Pick<ExtensionContext, "sessionManager">): string {
  return inheritedParentSessionId() ?? ctx.sessionManager.getSessionId();
}
