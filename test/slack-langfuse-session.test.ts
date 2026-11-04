/**
 * Reproduction: Slack backend runs many pi sessions in ONE process, each with
 * its own instance of @langfuse/pi-observability-plugin. Suspected mis-filing:
 *
 *  1. The plugin reads LANGFUSE_PI_PARENT_* (process-wide env) at factory time.
 *     While thread A's turn runs, A has published its trace/session there, so a
 *     thread-B session created at that moment thinks it is A's subagent.
 *  2. Each plugin instance calls setLangfuseTracerProvider() (a globalThis
 *     singleton) and stamps trace attributes in its own processor's onStart, so
 *     spans started by A after B's runtime exists go through B's provider.
 *
 * The plugin is driven through its real event handlers with a fake ExtensionAPI;
 * spans are captured by a local OTLP/HTTP endpoint (LANGFUSE_BASE_URL). Tests
 * asserting the CORRECT behavior are marked `todo` while the bug is unfixed, so
 * they report as failing TODOs without failing `npm test`.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { gunzipSync } from "node:zlib";

const PLUGIN = [
  join(process.cwd(), ".pi/npm/node_modules/@langfuse/pi-observability-plugin/src/index.ts"),
  join(process.cwd(), "node_modules/@langfuse/pi-observability-plugin/src/index.ts"),
].find(existsSync);

interface CapturedSpan {
  name: string;
  attrs: Record<string, string>;
}
const spans: CapturedSpan[] = [];
let server: Server;

type Handler = (event: unknown, ctx: unknown) => unknown;
type Factory = (pi: unknown) => void;
let factory: Factory;

function session(id: string) {
  const handlers: Record<string, Handler[]> = {};
  const pi = {
    on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn),
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  };
  factory(pi);
  const ctx = {
    hasUI: false,
    cwd: "/tmp",
    model: { id: "fake-model", provider: "fake" },
    sessionManager: { getSessionId: () => id, getEntries: () => [] },
  };
  return {
    emit: async (name: string, event: unknown = {}) => {
      for (const h of handlers[name] ?? []) await h(event, ctx);
    },
  };
}

const assistant = (text: string) => ({
  message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
});

/** Session id stamped on the span whose input or output mentions `marker`. */
function sessionOf(marker: string, spanName?: string): string | undefined {
  const span = spans.find(
    (s) =>
      (!spanName || s.name === spanName) &&
      ((s.attrs["langfuse.observation.input"] ?? "") + (s.attrs["langfuse.observation.output"] ?? "")).includes(marker),
  );
  return span?.attrs["session.id"];
}

before(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("LANGFUSE_")) delete process.env[k];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body);
      try {
        const json = JSON.parse(body.toString("utf8"));
        for (const rs of json.resourceSpans ?? [])
          for (const ss of rs.scopeSpans ?? [])
            for (const sp of ss.spans ?? []) {
              const attrs: Record<string, string> = {};
              for (const a of sp.attributes ?? []) attrs[a.key] = a.value?.stringValue ?? JSON.stringify(a.value);
              spans.push({ name: sp.name, attrs });
            }
      } catch {
        // ignore non-JSON
      }
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, {
    LANGFUSE_PUBLIC_KEY: "pk-lf-test",
    LANGFUSE_SECRET_KEY: "sk-lf-test",
    LANGFUSE_BASE_URL: `http://127.0.0.1:${port}`,
    LANGFUSE_MEDIA_UPLOAD_ENABLED: "false",
  });
  assert.ok(PLUGIN, "plugin not installed (pi install npm:@langfuse/pi-observability-plugin)");
  factory = (await import(PLUGIN)).default as Factory;

  // Scenario: thread A is mid-turn when a new thread-B session is created.
  const a = session("thread-A");
  await a.emit("session_start");
  await a.emit("before_agent_start", { prompt: "prompt-from-A" });
  const b = session("thread-B");
  await b.emit("session_start");
  await b.emit("before_agent_start", { prompt: "prompt-from-B" });
  await b.emit("agent_settled");
  // A continues its turn after B exists: one more model call.
  await a.emit("before_provider_request");
  await a.emit("message_end", assistant("answer-from-A"));
  await a.emit("agent_settled");
  await a.emit("session_shutdown", { reason: "quit" });
  await b.emit("session_shutdown", { reason: "quit" });

  // Scenario 2 (no overlapping turns): C runs a turn, then D runs a turn, then
  // C runs a second turn. No parent env is published while sessions are created.
  const c = session("thread-C");
  const d = session("thread-D");
  await c.emit("session_start");
  await d.emit("session_start");
  await c.emit("before_agent_start", { prompt: "prompt-C1" });
  await c.emit("agent_settled");
  await d.emit("before_agent_start", { prompt: "prompt-D1" });
  await d.emit("agent_settled");
  await c.emit("before_agent_start", { prompt: "prompt-C2" });
  await c.emit("agent_settled");
  await c.emit("session_shutdown", { reason: "quit" });
  await d.emit("session_shutdown", { reason: "quit" });
});

after(() => server?.close());

test("control: thread A's root span (started before B existed) is filed under thread-A", () => {
  assert.equal(sessionOf("prompt-from-A", "Conversational Turn"), "thread-A");
});

test(
  "thread-B session created during thread A's turn is filed under thread-B",
  { todo: "plugin reads process-wide LANGFUSE_PI_PARENT_* at factory time" },
  () => {
    assert.equal(sessionOf("prompt-from-B"), "thread-B");
  },
);

test("thread A's later generation (after B's runtime exists) stays under thread-A", () => {
  assert.equal(sessionOf("answer-from-A", "LLM Call"), "thread-A");
});

test(
  "non-overlapping sessions: every turn is filed under its own session",
  { todo: "each plugin instance replaces the globalThis Langfuse tracer provider; the last one stamps its trace attributes on every session's spans" },
  () => {
    assert.equal(sessionOf("prompt-C1"), "thread-C");
    assert.equal(sessionOf("prompt-D1"), "thread-D");
    assert.equal(sessionOf("prompt-C2"), "thread-C");
  },
);

test("diagnostic dump", () => {
  for (const s of spans) {
    const io = (s.attrs["langfuse.observation.input"] ?? s.attrs["langfuse.observation.output"] ?? "").slice(0, 40);
    console.log(`${s.name.padEnd(20)} session=${s.attrs["session.id"]} io=${io}`);
  }
  assert.ok(spans.length > 0, "no spans captured");
});
