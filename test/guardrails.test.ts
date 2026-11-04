import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";
import guardrails from "../.pi/extensions/guardrails";

type Handler = (event: unknown, ctx: unknown) => Promise<{ block?: boolean; reason?: string } | undefined>;

function load() {
  const handlers: Record<string, Handler[]> = {};
  const pi = { on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) };
  guardrails(pi as never);
  const ctx = { cwd: "/repo" };
  const call = async (toolName: string, input: Record<string, unknown>) => {
    for (const h of handlers.tool_call ?? []) {
      const r = await h({ toolName, input }, ctx);
      if (r?.block) return r;
    }
    return undefined;
  };
  return { bash: (command: string) => call("bash", { command }), read: (path: string) => call("read", { path }) };
}

test("bash: secret-dumping commands are blocked", async () => {
  const g = load();
  for (const cmd of [
    "env",
    "env | grep KEY",
    "printenv",
    "printenv ZEN_DIGITALOCEAN_API_KEY",
    "export -p",
    "cat .env",
    "cd lab && cat envs/alpha1.env",
    "head -5 ~/.pi/agent/langfuse.json",
    "grep KEY /repo/.env.local",
    "cat server.key",
    "echo $MASSIVE_API_KEY",
    'echo "broker: ${ALPACA_SECRET_KEY}"',
    "printf '%s' \"$LANGFUSE_SECRET_KEY\"",
    "echo $DO_TOKEN",
  ]) {
    assert.ok((await g.bash(cmd))?.block, `should block: ${cmd}`);
  }
});

test("bash: normal work, sourcing and presence checks stay allowed", async () => {
  const g = load();
  for (const cmd of [
    "set -a; . envs/alpha1.env; set +a; python3 backtests/alpha1_book.py",
    "source .env && npm start",
    "env FOO=1 python3 run.py backtest --start 2021-01-04",
    "cat envs/alpha1.env.example",
    "cp .env.example .env.template.bak",
    '[ -n "$ZEN_DIGITALOCEAN_API_KEY" ] && echo set',
    "echo ${#MASSIVE_API_KEY}",
    "echo ${MASSIVE_API_KEY:+set}",
    "echo $PATH",
    "cat README.md | head",
    "git add .env.example",
    "grep -n daily_bars backtests/alpha1_book.py",
  ]) {
    assert.equal((await g.bash(cmd))?.block, undefined, `should allow: ${cmd}`);
  }
});

test("read: credential files blocked, templates allowed", async () => {
  const g = load();
  for (const p of [".env", "sub/.env.production", "envs/beta1.env", "certs/tls.pem", "~/.pi/agent/langfuse.json", `${homedir()}/.pi/agent/auth.json`, "../other/.env"]) {
    assert.ok((await g.read(p))?.block, `should block read: ${p}`);
  }
  for (const p of [".env.example", "envs/alpha1.env.example", "README.md", "src/env.ts", "config/environment.yaml"]) {
    assert.equal((await g.read(p))?.block, undefined, `should allow read: ${p}`);
  }
});

test("existing rules unchanged", async () => {
  const g = load();
  assert.ok((await g.bash("git reset --hard"))?.block);
  assert.ok((await g.bash("git push --force"))?.block);
  assert.equal((await g.bash("git push --force-with-lease"))?.block, undefined);
});
