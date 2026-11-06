import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import observability, {
  isExpectedVerificationFailure,
} from "../.pi/extensions/observability";

test("isExpectedVerificationFailure: [FAIL] marker + exit 1", () => {
  assert.equal(isExpectedVerificationFailure("./scripts/check_beta.py", "[OK] load\n[FAIL] beta drift\n", 1), true);
  assert.equal(isExpectedVerificationFailure("make check", "[fail] slippage guard\n", 1), true);
});

test("isExpectedVerificationFailure: verification context + pass/fail summary", () => {
  assert.equal(
    isExpectedVerificationFailure("./verify.sh", "survivorship check: 3 passed, 1 failed\nchecks failed\n", 1),
    true,
  );
  assert.equal(isExpectedVerificationFailure("audit alignments", "10 passed, 2 failed\n", 1), true);
});

test("isExpectedVerificationFailure: genuine failures stay ERROR", () => {
  // timeout / crash / permission style exits
  assert.equal(isExpectedVerificationFailure("./verify.sh", "[FAIL] x\n", 124), false);
  assert.equal(isExpectedVerificationFailure("./verify.sh", "[FAIL] x\n", 139), false);
  assert.equal(isExpectedVerificationFailure("./verify.sh", "[FAIL] x\n", 126), false);
  // exit 1 without a verification signal stays an error
  assert.equal(isExpectedVerificationFailure("./run.py", "boom\n", 1), false);
  assert.equal(isExpectedVerificationFailure("./verify.sh", "Traceback (most recent call last):\nKeyError: 'beta'\n", 1), false);
  assert.equal(isExpectedVerificationFailure("./verify.sh", "segmentation fault\n", 1), false);
});

interface Handler {
  (event: unknown, ctx: unknown): Promise<unknown>;
}

function loadObservability(traceDir: string) {
  const handlers = new Map<string, Handler>();
  const pi = {
    events: Object.assign(createEventBus(), {}), // claimExtension + zen:mode listener
    on: (name: string, handler: Handler) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
  } as unknown as ExtensionAPI;
  observability(pi);
  return handlers;
}

function bashEvent(toolCallId: string, exitCode: number, output: string) {
  return {
    toolCallId,
    toolName: "bash",
    input: { command: "./scripts/verify.sh" },
    content: [{ type: "text", text: `${output}\nCommand exited with code ${exitCode}` }],
    structuredContent: { output, truncated: false, exit_code: exitCode, wall_time_seconds: 0.1 },
    isError: exitCode !== 0,
  };
}

const CTX = {
  cwd: "/tmp",
  model: { provider: "p", id: "m" },
  sessionManager: { getSessionId: () => "verify-failure-test" },
};

async function toolCall(handlers: Map<string, Handler>, id: string, exitCode: number, output: string, isError: boolean) {
  await handlers.get("tool_execution_start")!({ toolCallId: id, toolName: "bash", args: { command: "./scripts/verify.sh" } }, CTX);
  const resultOverride = await handlers.get("tool_result")!(bashEvent(id, exitCode, output), CTX);
  const finalIsError = (resultOverride as { isError?: boolean } | undefined)?.isError ?? isError;
  // Real bash results append the status line; toolError() reads it.
  const finalText = exitCode !== 0 ? `${output}\nCommand exited with code ${exitCode}` : output;
  await handlers.get("tool_execution_end")!(
    {
      toolCallId: id,
      toolName: "bash",
      result: { content: [{ type: "text", text: finalText }] },
      isError: finalIsError,
    },
    CTX,
  );
  return resultOverride;
}

async function withTraceDir(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "zen-trace-"));
  const prev = process.env.ZEN_TRACE_DIR;
  process.env.ZEN_TRACE_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.ZEN_TRACE_DIR;
    else process.env.ZEN_TRACE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function traceLines(dir: string): Record<string, unknown>[] {
  return readFileSync(join(dir, "verify-failure-test.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

test("tool_result hook: expected verification failure -> isError cleared, self_check stays fail", async () => {
  await withTraceDir(async (dir) => {
    const handlers = loadObservability(dir);
    await handlers.get("session_start")!({}, CTX);

    const override = await toolCall(handlers, "t1", 1, "survivorship check: 3 passed, 1 failed\nchecks failed", true);
    assert.deepEqual(override, { isError: false });

    const end = traceLines(dir).find((l) => l.toolCallId === "t1" && l.event === "tool_call_end")!;
    assert.equal(end.isError, false);
    assert.equal(end.error, null);
    assert.deepEqual(end.self_check, { what_was_checked: "./scripts/verify.sh", result: "fail" });
    assert.equal(end.role, "check");
  });
});

test("tool_result hook: genuine non-zero exit stays isError + nonzero_exit trace error", async () => {
  await withTraceDir(async (dir) => {
    const handlers = loadObservability(dir);
    await handlers.get("session_start")!({}, CTX);

    const override = await toolCall(handlers, "t2", 1, "KeyError: 'close'\n", true);
    assert.equal(override, undefined);

    const end = traceLines(dir).find((l) => l.toolCallId === "t2" && l.event === "tool_call_end")!;
    assert.equal(end.isError, true);
    assert.equal((end.error as { type: string }).type, "nonzero_exit");
    assert.equal((end.self_check as { result: string }).result, "fail");
  });
});

test("tool_result hook: passing check untouched", async () => {
  await withTraceDir(async (dir) => {
    const handlers = loadObservability(dir);
    await handlers.get("session_start")!({}, CTX);

    const override = await toolCall(handlers, "t3", 0, "all checks passed\n", false);
    assert.equal(override, undefined);

    const end = traceLines(dir).find((l) => l.toolCallId === "t3" && l.event === "tool_call_end")!;
    assert.equal(end.isError, false);
    assert.equal(end.error, null);
    assert.equal((end.self_check as { result: string }).result, "pass");
  });
});
