import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { heuristicVariant, loadBacktestPatterns, readLedger, summarize } from "../.pi/extensions/zen-process/ledger";
import { readInheritedParentSessionId } from "../.pi/extensions/zen-process/session";
import { rewriteGitCommits } from "../.pi/extensions/zen-process/trailers";

const T = { "Langfuse-Session": "sid-1", "Zen-Work-Type": "research" };
const TR = "--trailer=Langfuse-Session=sid-1 --trailer=Zen-Work-Type=research";
const rw = (cmd: string, cwd = "/repo") => rewriteGitCommits(cmd, { trailers: T, cwd });

test("trailers: plain and compound commits", () => {
  assert.equal(rw(`git commit -m "x"`).command, `git -c trailer.ifexists=addIfDifferent commit ${TR} -m "x"`);
  const r = rw(`cd /other && git add -A && git commit -q -m "fix the git commit hook"`);
  assert.equal(r.commits, 1);
  assert.equal(
    r.command,
    `cd /other && git add -A && git -c trailer.ifexists=addIfDifferent commit ${TR} -q -m "fix the git commit hook"`,
  );
  assert.deepEqual(r.dirs, ["/other"]);
});

test("trailers: global options, -C dirs, env prefixes, amend", () => {
  const r = rw(`GIT_AUTHOR_NAME=x git -C ../lab --no-pager commit --amend --no-edit`);
  assert.equal(r.command, `GIT_AUTHOR_NAME=x git -C ../lab --no-pager -c trailer.ifexists=addIfDifferent commit ${TR} --amend --no-edit`);
  assert.deepEqual(r.dirs, ["/lab"]);
});

test("trailers: never touches quoted text, heredoc bodies, other subcommands", () => {
  for (const cmd of [
    `echo 'git commit -m x'`,
    `bash -c "git commit -m x"`,
    `git commit-tree HEAD^{tree} -m x`,
    `git log --grep commit`,
    `cat > s.sh <<'EOF'\ngit commit -m scripted\nEOF\nchmod +x s.sh`,
    `git status # then git commit`,
  ]) {
    const r = rw(cmd);
    assert.equal(r.command, cmd, cmd);
    assert.equal(r.commits, 0, cmd);
  }
});

test("trailers: heredoc then a real commit; $(...) message; idempotent", () => {
  const cmd = `cat > a.txt <<EOF\ngit commit\nEOF\ngit add a.txt && git commit -m "$(cat <<'MSG'\nsubject\n\nbody\nMSG\n)"`;
  const r = rw(cmd);
  assert.equal(r.commits, 1);
  assert.ok(r.command.includes(`git add a.txt && git -c trailer.ifexists=addIfDifferent commit ${TR} -m "$(cat`));
  assert.ok(r.command.startsWith("cat > a.txt <<EOF\ngit commit\nEOF\n"));
  const again = rw(r.command);
  assert.equal(again.commits, 0);
  assert.equal(again.command, r.command);
});

test("trailers: unsafe values are dropped, never injected", () => {
  const r = rewriteGitCommits("git commit -m x", { trailers: { "Langfuse-Session": "a b;rm -rf /" }, cwd: "/r" });
  assert.equal(r.command, "git commit -m x");
  assert.equal(r.commits, 0);
});

test("trailers: real git produces both trailers", () => {
  const dir = mkdtempSync(join(tmpdir(), "zen-trailer-"));
  execFileSync("git", ["init", "-q", dir]);
  const cmd = rw(`git -c user.name=t -c user.email=t@t commit -q --allow-empty -m "subject"`, dir).command;
  execFileSync("bash", ["-c", cmd], { cwd: dir });
  const msg = execFileSync("git", ["-C", dir, "log", "-1", "--format=%B"], { encoding: "utf8" });
  assert.match(msg, /^subject\n\nLangfuse-Session: sid-1\nZen-Work-Type: research\n/);
});

test("session id: inherited parent mirrors plugin validation", () => {
  const ok = {
    LANGFUSE_PI_PARENT_TRACE_ID: "95081c96f978b9cab7bc19b7a491b1d4",
    LANGFUSE_PI_PARENT_SPAN_ID: "572e13a4893118f5",
    LANGFUSE_PI_PARENT_SESSION_ID: "parent",
  };
  assert.equal(readInheritedParentSessionId(ok), "parent");
  assert.equal(readInheritedParentSessionId({ ...ok, LANGFUSE_PI_PARENT_SPAN_ID: "0000000000000000" }), undefined);
  assert.equal(readInheritedParentSessionId({ LANGFUSE_PI_PARENT_SESSION_ID: "parent" }), undefined);
});

test("backtest patterns: interpreter runs only", () => {
  const pats = loadBacktestPatterns({});
  const hit = (c: string) => pats.some((p) => p.test(c));
  assert.ok(hit("../../.venv/bin/python run.py backtest --start 2021-01-04 --end 2026-10-23 --seeds 5"));
  assert.ok(hit("set -a; . envs/alpha1.env; set +a; python3 backtests/alpha1_book.py"));
  assert.ok(hit("python -u v0.2.0/backtest.py --cfg x.yaml"));
  assert.ok(!hit("grep -n daily_bars backtests/alpha1_book.py"));
  assert.ok(!hit("git add backtests/beta2_rotation.py design.md"));
  assert.ok(!hit("python3 -m pytest test_strategy.py -q"));
  assert.equal(loadBacktestPatterns({ ZEN_BACKTEST_PATTERNS: '["\\\\bmybt\\\\b"]' }).length, 1);
});

test("heuristic variant ignores seeds", () => {
  const a = heuristicVariant("python run.py backtest --start 1 --seeds 5", "s");
  const b = heuristicVariant("python run.py backtest --start 1 --seeds=9", "s");
  const c = heuristicVariant("python run.py backtest --start 2 --seeds 5", "s");
  assert.equal(a.variantHash, b.variantHash);
  assert.notEqual(a.variantHash, c.variantHash);
  assert.deepEqual(b.seeds, ["9"]);
});

test("python helper: 3 runs, 2 variants, seeds excluded; no-op without ZEN_SESSION_ID", () => {
  const repo = mkdtempSync(join(tmpdir(), "zen-ledger-repo-"));
  const ledger = mkdtempSync(join(tmpdir(), "zen-ledger-"));
  execFileSync("git", ["init", "-q", repo]);
  mkdirSync(join(repo, "bt"));
  writeFileSync(
    join(repo, "bt", "run.py"),
    'import os, runpy; os.environ.get("ZEN_LEDGER_PY") and runpy.run_path(os.environ["ZEN_LEDGER_PY"])["record"](configs=["cfg.yaml"])\n',
  );
  writeFileSync(join(repo, "cfg.yaml"), "lookback: 90\n");
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
  const env = { ...process.env, ZEN_SESSION_ID: "s-helper", ZEN_LEDGER_DIR: ledger, ZEN_LEDGER_PY: join(process.cwd(), "scripts", "zen_ledger.py") };
  const run = (args: string[], e: NodeJS.ProcessEnv = env) => execFileSync("python3", ["bt/run.py", ...args], { cwd: repo, env: e });
  run(["--start", "2021", "--seed", "1"]);
  run(["--start", "2021", "--seed", "2"]); // same variant, different seed
  writeFileSync(join(repo, "cfg.yaml"), "lookback: 120\n"); // config change = new variant
  run(["--start", "2021", "--seed", "1"]);
  const { ZEN_SESSION_ID: _drop, ...noSession } = env;
  run(["--start", "2021"], noSession);

  const records = readLedger("s-helper", { ZEN_LEDGER_DIR: ledger });
  assert.equal(records.length, 3);
  const s = summarize(records);
  assert.equal(s.distinct, 2);
  assert.equal(s.metadata.total_runs, 3);
  assert.equal(s.metadata.source, "ledger");
  assert.equal(s.metadata.max_seeds_per_variant, 2);
});

test("summary: heuristic records are ignored for repos that have helper records", () => {
  const base = { v: 1, ts: "t", session_id: "s" };
  const s = summarize([
    { ...base, source: "helper", variant_hash: "a", repo: "/r1", seeds: ["1"] },
    { ...base, source: "bash-heuristic", variant_hash: "h1", repo: "/r1" },
    { ...base, source: "bash-heuristic", variant_hash: "h2", repo: "/r2" },
  ]);
  assert.equal(s.distinct, 2);
  assert.equal(s.metadata.source, "mixed");
  assert.equal(s.metadata.heuristic_runs, 1);
});
