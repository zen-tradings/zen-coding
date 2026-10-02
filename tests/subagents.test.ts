import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import subagents, { getFinalOutput, getPiInvocation, mapWithConcurrencyLimit, runSingleAgent, type DispatchDefaults } from "../.pi/extensions/subagent/index.ts";
import { discoverAgents, type AgentConfig } from "../.pi/extensions/subagent/agents.ts";
import { childTools, createLimiter, readSettings, validateTaskCwd } from "../.pi/extensions/subagent/policy.ts";

const root = resolve(import.meta.dirname, "..");
const bundled = join(root, ".pi/agents");
const defaults: DispatchDefaults = { tools: ["read", "write", "edit", "bash", "grep", "find", "ls"], mode: "normal", timeoutMs: 10_000 };
const profile: AgentConfig = { name: "scout", description: "test", tools: ["read"], systemPrompt: "Only assigned context", source: "bundled", filePath: "test.md" };
const details = (results: any[]) => ({ mode: "single" as const, agentScope: "user" as const, projectAgentsDir: null, results });
const text = (result: any) => result.content.map((c: any) => c.text ?? "").join("\n");

function fixture() { return mkdtempSync(join(tmpdir(), "zen-subagent-test-")); }

test("profile permissions intersect the parent and planning removes all mutating tools", () => {
  assert.deepEqual(childTools(["read", "write", "grep"], ["read", "write"], "normal"), ["read", "write"]);
  assert.deepEqual(childTools(["read", "write", "bash"], defaults.tools, "plan"), ["read"]);
  assert.throws(() => childTools(["subagent"], defaults.tools, "normal"), /recursive/);
  assert.throws(() => childTools(undefined, defaults.tools, "normal"), /allowlist/);
  assert.throws(() => childTools(["write"], ["read"], "normal"), /no tools/);
  assert.throws(() => readSettings({ ZEN_SUBAGENT_CONCURRENCY: "0" }), /integer/);
  assert.throws(() => readSettings({ ZEN_SUBAGENT_TIMEOUT_SECONDS: "1.5" }), /integer/);
});

test("bundled profiles work outside the zen checkout; untrusted project overrides stay excluded", () => {
  const dir = fixture();
  try {
    mkdirSync(join(dir, ".pi/agents"), { recursive: true });
    writeFileSync(join(dir, ".pi/agents/scout.md"), "---\nname: scout\ndescription: project\ntools: [read]\n---\nProject instructions");
    const safe = discoverAgents(dir, "project", bundled, false);
    assert.equal(safe.agents.find((a) => a.name === "scout")?.source, "bundled");
    const trusted = discoverAgents(dir, "project", bundled, true);
    assert.equal(trusted.agents.find((a) => a.name === "scout")?.systemPrompt, "Project instructions");
    assert.throws(() => validateTaskCwd(root, dir), /parent's workspace/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("concurrency is bounded across calls, and cancelled waiters do not leak slots", async () => {
  const run = createLimiter(2);
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 7 }, () => run(async () => {
    active++; peak = Math.max(peak, active); await delay(10); active--;
  })));
  assert.equal(peak, 2);
  const serial = createLimiter(1);
  let release!: () => void;
  const first = serial(() => new Promise<void>((r) => { release = r; }));
  const controller = new AbortController();
  const waiting = serial(async () => assert.fail("cancelled task started"), controller.signal);
  controller.abort();
  await assert.rejects(waiting, /cancelled/);
  release(); await first;
  assert.equal(await serial(async () => 42), 42);
  let cleanupFinished = false;
  await assert.rejects(mapWithConcurrencyLimit([0, 1], 2, async (item) => {
    if (!item) throw new Error("failed worker");
    await delay(20); cleanupFinished = true;
  }), /failed worker/);
  assert.equal(cleanupFinished, true, "failure must wait for other worker cleanup");
});

test("runner uses the Pi SDK subprocess rather than the parent Slack entrypoint", async () => {
  const dir = fixture();
  try {
    const cli = join(dir, "fake.mjs");
    writeFileSync(cli, `const msg = {type:'message_end', message:{role:'assistant',content:[{type:'text',text:'first'},{type:'text',text:'second'}],stopReason:'end',usage:{input:3,output:2,cost:{total:0.1}}}}; const line=JSON.stringify(msg)+'\\n'; process.stdout.write(line.slice(0,10)); setTimeout(()=>process.stdout.write(line.slice(10)),10);`);
    const result = await runSingleAgent(dir, { ...defaults, cliPath: cli }, [profile], "scout", "Focused task", undefined, undefined, undefined, undefined, details);
    assert.equal(result.exitCode, 0); assert.equal(getFinalOutput(result.messages), "first\nsecond");
    assert.equal(result.usage.input, 3);
    assert.ok(getPiInvocation([]).args[0].endsWith("child.mjs"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("timeouts kill uncooperative processes and shell descendants", async () => {
  const dir = fixture();
  try {
    const cli = join(dir, "hang.mjs"), pidFile = join(dir, "pid");
    writeFileSync(cli, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{}); const p=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'}); writeFileSync(${JSON.stringify(pidFile)}, String(p.pid)); setInterval(()=>{},1000);`);
    const result = await runSingleAgent(dir, { ...defaults, cliPath: cli, timeoutMs: 300, killGraceMs: 50 }, [profile], "scout", "task", undefined, undefined, undefined, undefined, details);
    assert.equal(result.exitCode, 1); assert.match(result.errorMessage!, /timed out/);
    const descendant = Number(readFileSync(pidFile, "utf8"));
    await delay(50);
    assert.throws(() => process.kill(descendant, 0), /ESRCH/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cancellation stops a running child and already-aborted tasks never launch", async () => {
  const dir = fixture();
  try {
    const cli = join(dir, "wait.mjs");
    writeFileSync(cli, `console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'ready'}]}})); setInterval(()=>{},1000);`);
    const controller = new AbortController();
    const result = await runSingleAgent(dir, { ...defaults, cliPath: cli }, [profile], "scout", "task", undefined, undefined, controller.signal, () => controller.abort(), details);
    assert.match(result.errorMessage!, /cancelled/);
    await assert.rejects(runSingleAgent(dir, { ...defaults, cliPath: cli }, [profile], "scout", "task", undefined, undefined, controller.signal, undefined, details), /before launch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tool preflight rejects unknown agents and parallel writers before launching", async () => {
  let tool: any;
  subagents({ registerTool: (definition: any) => { tool = definition; }, events: { on() {} }, on() {}, getActiveTools: () => defaults.tools } as any);
  const ctx = { cwd: root, model: undefined, sessionManager: { getSessionId: () => "test" }, isProjectTrusted: () => true };
  await assert.rejects(tool.execute("id", { agent: "missing", task: "x" }, undefined, undefined, ctx), /Unknown agent/);
  await assert.rejects(tool.execute("id", { tasks: [{ agent: "worker", task: "x" }] }, undefined, undefined, ctx), /read-only profiles/);
  await assert.rejects(tool.execute("id", { chain: [], tasks: [{ agent: "worker", task: "x" }] }, undefined, undefined, ctx), /read-only profiles/);
});

// Deterministic OpenAI-compatible endpoint exercises real Pi session loops and
// subprocesses without paid calls or dependence on a model following instructions.
test("real parent/child Pi loops: context separation, read result, protected paths, and plan inheritance", { timeout: 60_000 }, async () => {
  const dir = fixture(), agentDir = join(dir, "agent"), workspace = join(dir, "workspace");
  mkdirSync(agentDir); mkdirSync(workspace);
  mkdirSync(join(workspace, ".pi/extensions"), { recursive: true });
  writeFileSync(join(workspace, ".pi/extensions/evil.ts"), `import {writeFileSync} from 'node:fs'; export default function(){writeFileSync(${JSON.stringify(join(workspace, "extension-loaded"))}, 'bad')}`);
  writeFileSync(join(workspace, ".pi/guardrails.json"), JSON.stringify({ denyBashPatterns: ["printf"] }));
  writeFileSync(join(workspace, "sample.txt"), "delegated-evidence");
  const original = { agent: process.env.PI_CODING_AGENT_DIR, trace: process.env.ZEN_TRACE_DIR };
  process.env.PI_CODING_AGENT_DIR = agentDir; process.env.ZEN_TRACE_DIR = join(dir, "traces");
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const last = body.messages.at(-1), user = body.messages.findLast((m: any) => m.role === "user");
    const task = typeof user?.content === "string" ? user.content : JSON.stringify(user?.content);
    const child = body.messages.some((m: any) => m.role === "system" && String(m.content).includes("delegated child agent"));
    let delta: any = { content: child ? "CHILD_RESULT: " + String(last?.content) : "PARENT_RESULT: " + String(last?.content) };
    let finish = "stop";
    if (last?.role !== "tool") {
      const name = child ? (task.includes("BASH") ? "bash" : task.includes("PROTECTED") || task.includes("OUTSIDE") || task.includes("PLAN") ? "write" : "read") : "subagent";
      const arguments_ = child ? (name === "read" ? { path: "sample.txt" } : name === "bash" ? { command: "printf probe > blocked.txt" } : { path: task.includes("OUTSIDE") ? join(dir, "outside.txt") : ".env", content: "must not be written" }) : { agent: task.includes("PARENT_PLAN") ? "worker" : "scout", task: task.includes("PARENT_PLAN") ? "PLAN" : "Read sample.txt and return its evidence" };
      delta = { tool_calls: [{ index: 0, id: "call1", type: "function", function: { name, arguments: JSON.stringify(arguments_) } }] }; finish = "tool_calls";
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", model: "test", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { "subagent-test": {
    baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "test",
    models: [{ id: "test", name: "test", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 256, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  let session: any;
  try {
    const settings = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({ cwd: workspace, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
      additionalExtensionPaths: ["subagent/index.ts", "modes.ts"].map((p) => join(root, ".pi/extensions", p)) });
    await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
    const runtime = await ModelRuntime.create();
    const created = await createAgentSession({ cwd: workspace, agentDir, resourceLoader: loader, settingsManager: settings, modelRuntime: runtime,
      model: runtime.getModel("subagent-test", "test"), tools: [...defaults.tools, "subagent"], sessionManager: SessionManager.inMemory(workspace) });
    session = created.session; await session.bindExtensions({});
    await session.prompt("PARENT_ONLY_CONTEXT: delegate the file investigation");
    assert.match(session.getLastAssistantText(), /delegated-evidence/);
    const childRequests = requests.filter((b) => b.messages.some((m: any) => m.role === "system" && String(m.content).includes("delegated child agent")));
    assert.ok(childRequests.length >= 2);
    assert.ok(!JSON.stringify(childRequests).includes("PARENT_ONLY_CONTEXT"));
    assert.ok(childRequests.every((b) => !b.tools.some((t: any) => t.function.name === "subagent")));
    const agents = discoverAgents(workspace, "user", bundled, false).agents;
    for (const scenario of ["PROTECTED", "OUTSIDE", "PLAN", "BASH"]) {
      const before = requests.length;
      const result = await runSingleAgent(workspace, { ...defaults, model: "subagent-test/test", mode: scenario === "PLAN" ? "plan" : "normal", parentSessionId: "parent", parentToolCallId: "call" }, agents, "worker", scenario, undefined, undefined, undefined, undefined, details);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(!existsSync(join(workspace, ".env"))); assert.ok(!existsSync(join(dir, "outside.txt")));
      const calls = requests.slice(before);
      const toolResponse = calls.at(-1).messages.findLast((m: any) => m.role === "tool");
      assert.match(String(toolResponse.content), /protected|outside|not found|not available|Unknown tool|denied/i);
      assert.ok(!existsSync(join(workspace, "blocked.txt")));
      if (scenario === "PLAN") assert.ok(calls.every((b) => b.tools.every((t: any) => !["write", "edit", "bash"].includes(t.function.name))));
    }
    let tool: any;
    subagents({ registerTool: (definition: any) => { tool = definition; }, events: { on() {} }, on() {}, getActiveTools: () => defaults.tools } as any);
    const toolCtx = { cwd: workspace, model: runtime.getModel("subagent-test", "test"), sessionManager: { getSessionId: () => "parent" }, isProjectTrusted: () => false };
    const parallel = await tool.execute("parallel", { tasks: [{ agent: "scout", task: "Read sample.txt" }, { agent: "reviewer", task: "Read sample.txt" }] }, undefined, undefined, toolCtx);
    assert.match(text(parallel), /2\/2 succeeded/);
    const chain = await tool.execute("chain", { chain: [{ agent: "scout", task: "Read sample.txt" }, { agent: "reviewer", task: "Inspect the preceding evidence: {previous}" }] }, undefined, undefined, toolCtx);
    assert.equal(chain.details.results.length, 2);
    assert.match(chain.details.results[1].task, /delegated-evidence/);
    mkdirSync(join(agentDir, "agents"));
    writeFileSync(join(agentDir, "agents/broken.md"), "---\nname: broken\ndescription: broken model\ntools: read\nmodel: missing-provider/invalid\n---\nReturn findings");
    const mixed = await tool.execute("mixed", { tasks: [{ agent: "scout", task: "Read sample.txt" }, { agent: "broken", task: "Read sample.txt" }] }, undefined, undefined, toolCtx);
    assert.match(text(mixed), /1\/2 succeeded/); assert.match(text(mixed), /failed/); assert.match(text(mixed), /delegated-evidence/);
    await session.prompt("/zen plan");
    const beforePlan = requests.length;
    await session.prompt("PARENT_PLAN: delegate a planning task");
    const planChildCalls = requests.slice(beforePlan).filter((b) => b.messages.some((m: any) => m.role === "system" && String(m.content).includes("delegated child agent")));
    assert.ok(planChildCalls.length >= 2);
    assert.ok(planChildCalls.every((b) => b.tools.every((t: any) => !["write", "edit", "bash"].includes(t.function.name))));
    assert.ok(!existsSync(join(workspace, "extension-loaded")));
    const beforeFailure = requests.length;
    writeFileSync(join(workspace, ".pi/guardrails.json"), "invalid json");
    const failed = await runSingleAgent(workspace, { ...defaults, model: "subagent-test/test" }, agents, "worker", "PROTECTED", undefined, undefined, undefined, undefined, details);
    assert.equal(failed.exitCode, 1); assert.match(failed.stderr, /guardrails/);
    assert.equal(requests.length, beforeFailure, "startup failure must precede any model call");
  } finally {
    session?.dispose();
    await new Promise<void>((r) => server.close(() => r()));
    if (original.agent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = original.agent;
    if (original.trace === undefined) delete process.env.ZEN_TRACE_DIR; else process.env.ZEN_TRACE_DIR = original.trace;
    rmSync(dir, { recursive: true, force: true });
  }
});
