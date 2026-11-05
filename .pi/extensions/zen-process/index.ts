/**
 * zen-coding process telemetry for quant research sessions.
 *
 * - Session id: resolved like the Langfuse plugin (see ./session.ts) and
 *   exported to every bash tool call as ZEN_SESSION_ID (+ ZEN_LEDGER_PY,
 *   ZEN_LEDGER_DIR for scripts/zen_ledger.py).
 * - process.variants_tried (NUMERIC session score): distinct backtest variants
 *   from the ledger (./ledger.ts); total runs and seeds in metadata.
 * - process.work_type (CATEGORICAL session score): see ./work-type.ts and
 *   `/zen type` in ../modes.ts.
 * - Commit trailers: the agent's own `git commit` calls get Langfuse-Session /
 *   Zen-Work-Type trailers (./trailers.ts); new commit SHAs are recorded on the
 *   session as process.commits (TEXT score).
 *
 * Bash commands are adjusted in the tool_call hook (env exports + trailer
 * rewrite); the bash tool itself is not overridden, so this composes with
 * other extensions that replace bash (e.g. ssh).
 *
 * Fails open: telemetry errors are logged (~/.zen/telemetry.log) and never
 * block a tool call; with LANGFUSE_TRACING_ENABLED=false or no keys, no scores
 * are sent but ZEN_SESSION_ID, the ledger and commit trailers still work.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLangfuseApiConfig, logTelemetry, ScoreClient, withTimeout } from "./langfuse";
import {
  appendLedger,
  heuristicVariant,
  ledgerDir,
  loadBacktestPatterns,
  readLedger,
  summarize,
} from "./ledger";
import { resolveSessionId } from "./session";
import { rewriteGitCommits } from "./trailers";
import { resolveWorkType, type WorkType } from "./work-type";
import { claimExtension } from "../shared/load-once";

const COMMIT_ENTRY = "zen-commit";
const SHUTDOWN_BUDGET_MS = 3000;
const LEDGER_HELPER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "zen_ledger.py");

interface CommitRecord {
  sha: string;
  repo: string;
  ts: string;
}

export default function (pi: ExtensionAPI) {
  if (!claimExtension(pi, "zen-process")) return; // already loaded (project + global install)
  const lfConfig = loadLangfuseApiConfig();
  const scores = lfConfig ? new ScoreClient(lfConfig) : undefined;
  const backtestPatterns = loadBacktestPatterns();

  let sessionId: string | undefined;
  let lastCtx: ExtensionContext | undefined;
  let commits: CommitRecord[] = [];
  let lastVariantsKey = "";
  let postedWorkType: string | undefined;
  let gitHasTrailers = true; // `git commit --trailer` needs git >= 2.32

  const git = async (cwd: string, args: string[]): Promise<string | undefined> => {
    try {
      const r = await pi.exec("git", ["-C", cwd, ...args], { timeout: 5000 });
      return r.code === 0 ? r.stdout.trim() : undefined;
    } catch {
      return undefined;
    }
  };

  // --- scores -------------------------------------------------------------

  const postVariants = (force = false): Promise<void> | undefined => {
    if (!scores || !sessionId) return;
    const sid = sessionId;
    return scores.upsert("process.variants_tried", () => {
      const s = summarize(readLedger(sid));
      const key = JSON.stringify([s.distinct, s.total, s.metadata.variants]);
      if (!s.total || (!force && key === lastVariantsKey)) return undefined;
      lastVariantsKey = key;
      return { sessionId: sid, name: "process.variants_tried", dataType: "NUMERIC", value: s.distinct, metadata: s.metadata };
    });
  };

  const postWorkType = (ctx: ExtensionContext, force = false): Promise<void> | undefined => {
    if (!scores || !sessionId) return;
    const { workType, source } = resolveWorkType(ctx);
    const key = `${sessionId}:${workType}`;
    if (!force && key === postedWorkType) return;
    postedWorkType = key;
    const sid = sessionId;
    return scores.upsert("process.work_type", () => ({
      sessionId: sid,
      name: "process.work_type",
      dataType: "CATEGORICAL",
      value: workType,
      metadata: { source },
    }));
  };

  const postCommits = (): Promise<void> | undefined => {
    if (!scores || !sessionId || !commits.length) return;
    const sid = sessionId;
    const list = [...commits];
    return scores.upsert("process.commits", () => ({
      sessionId: sid,
      name: "process.commits",
      dataType: "TEXT",
      value: list.map((c) => `${c.repo}@${c.sha}`).join("\n"),
      metadata: { count: list.length, commits: list },
    }));
  };

  const setWorkTypeStatus = (ctx: ExtensionContext, workType: WorkType) => {
    if (ctx.hasUI) ctx.ui.setStatus("zen-type", `type: ${workType}`);
  };

  // --- lifecycle ----------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    sessionId = resolveSessionId(ctx);
    lastVariantsKey = "";
    postedWorkType = undefined;
    commits = ctx.sessionManager
      .getEntries()
      .filter((e) => e.type === "custom" && (e as { customType?: string }).customType === COMMIT_ENTRY)
      .map((e) => (e as { data?: CommitRecord }).data)
      .filter((d): d is CommitRecord => !!d && typeof d.sha === "string");
    setWorkTypeStatus(ctx, resolveWorkType(ctx).workType);
    try {
      const r = await pi.exec("git", ["--version"], { timeout: 2000 });
      const m = /(\d+)\.(\d+)/.exec(r.stdout);
      gitHasTrailers = !m || Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 32);
      if (!gitHasTrailers) logTelemetry(`git ${m?.[0]} lacks --trailer (needs >= 2.32); commit trailers disabled`);
    } catch {
      // no git: nothing to rewrite anyway
    }
  });

  pi.on("before_agent_start", (_event, ctx) => {
    lastCtx = ctx;
    sessionId = resolveSessionId(ctx);
    void postWorkType(ctx);
  });

  // Emitted by `/zen type <value>` (modes.ts) after it persisted the entry.
  pi.events.on("zen:work-type", () => {
    if (!lastCtx) return;
    setWorkTypeStatus(lastCtx, resolveWorkType(lastCtx).workType);
    void postWorkType(lastCtx, true);
  });

  // Background backtests (`... &`) finish after their bash call returned.
  pi.on("agent_settled", () => {
    void postVariants();
  });

  pi.on("session_shutdown", async () => {
    await withTimeout(Promise.all([postVariants(true), postCommits()]), SHUTDOWN_BUDGET_MS);
  });

  // --- bash: env + trailers + post-run bookkeeping ------------------------

  const recordCommits = async (ctx: ExtensionContext, sid: string, dirs: string[]) => {
    const tops = new Set<string>();
    for (const d of new Set([ctx.cwd, ...dirs])) {
      const top = await git(d, ["rev-parse", "--show-toplevel"]);
      if (top) tops.add(top);
    }
    const known = new Set(commits.map((c) => c.sha));
    let added = false;
    for (const top of tops) {
      const out = await git(top, ["log", "-n", "30", "-F", `--grep=Langfuse-Session: ${sid}`, "--format=%H"]);
      if (!out) continue;
      const origin = await git(top, ["config", "--get", "remote.origin.url"]);
      const repo = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(origin ?? "")?.[1] ?? basename(top);
      for (const sha of out.split("\n").reverse()) {
        if (!sha || known.has(sha)) continue;
        const rec = { sha, repo, ts: new Date().toISOString() };
        known.add(sha);
        commits.push(rec);
        pi.appendEntry(COMMIT_ENTRY, rec);
        added = true;
      }
    }
    if (added) await postCommits();
  };

  const recordHeuristicBacktest = async (ctx: ExtensionContext, sid: string, command: string, dirs: string[]) => {
    const cwd = dirs[0] ?? ctx.cwd; // first `cd` target, else the session cwd
    const top = (await git(cwd, ["rev-parse", "--show-toplevel"])) ?? null;
    const head = top ? await git(top, ["rev-parse", "HEAD"]) : undefined;
    const diff = top ? await git(top, ["diff", "HEAD"]) : undefined;
    const untracked = top ? await git(top, ["ls-files", "--others", "--exclude-standard"]) : undefined;
    const codeState = createHash("sha256").update(JSON.stringify([head, diff, untracked])).digest("hex");
    const { variantHash, seeds } = heuristicVariant(command, codeState);
    appendLedger(sid, {
      v: 1,
      ts: new Date().toISOString(),
      session_id: sid,
      source: "bash-heuristic",
      variant_hash: variantHash,
      seeds: seeds.length ? seeds : null,
      repo: top,
      git_head: head ?? null,
      command: command.slice(0, 2000),
    });
  };

  const afterBash = async (
    ctx: ExtensionContext,
    sid: string,
    command: string,
    commitDirs: string[] | undefined,
    helperRunsBefore: number,
    looksLikeBacktest: boolean,
  ) => {
    try {
      if (commitDirs) await recordCommits(ctx, sid, commitDirs);
      if (looksLikeBacktest) {
        const helperRunsAfter = readLedger(sid).filter((r) => r.source === "helper").length;
        if (helperRunsAfter === helperRunsBefore) {
          const dirs = rewriteGitCommits(command, { trailers: {}, cwd: ctx.cwd }).dirs;
          await recordHeuristicBacktest(ctx, sid, command, dirs);
        }
      }
      if (looksLikeBacktest || readLedger(sid).length) await postVariants();
    } catch (err) {
      logTelemetry(`post-bash bookkeeping failed: ${(err as Error).message}`);
    }
  };

  /** Single-quote for bash. */
  const sq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
  const pending = new Map<
    string,
    { sid: string; command: string; commitDirs?: string[]; helperRunsBefore: number; looksLikeBacktest: boolean }
  >();

  // Mutating tool_call input changes only what executes: pi validates into a
  // structuredClone, so the model's history and the plugin's traced tool input
  // (captured earlier, at tool_execution_start) keep the original command. This
  // composes with any bash implementation (built-in or another extension's).
  pi.on("tool_call", (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    const original = event.input.command ?? "";
    try {
      const sid = resolveSessionId(ctx);
      const rewrite = rewriteGitCommits(original, {
        trailers: gitHasTrailers ? { "Langfuse-Session": sid, "Zen-Work-Type": resolveWorkType(ctx).workType } : {},
        cwd: ctx.cwd,
      });
      const looksLikeBacktest = backtestPatterns.some((re) => re.test(original));
      pending.set(event.toolCallId, {
        sid,
        command: original,
        commitDirs: rewrite.commits > 0 ? rewrite.dirs : undefined,
        helperRunsBefore: looksLikeBacktest ? readLedger(sid).filter((r) => r.source === "helper").length : 0,
        looksLikeBacktest,
      });
      const exports = `export ZEN_SESSION_ID=${sq(sid)} ZEN_LEDGER_PY=${sq(LEDGER_HELPER)} ZEN_LEDGER_DIR=${sq(ledgerDir())}`;
      event.input.command = `${exports}\n${rewrite.commits > 0 ? rewrite.command : original}`;
    } catch (err) {
      event.input.command = original;
      logTelemetry(`bash pre-processing failed, running command unchanged: ${(err as Error).message}`);
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const p = pending.get(event.toolCallId);
    if (!p) return;
    pending.delete(event.toolCallId);
    // A failed command (e.g. argparse error) is not a variant tried; helper
    // records written before a later failure are still counted from the ledger.
    void afterBash(ctx, p.sid, p.command, p.commitDirs, p.helperRunsBefore, p.looksLikeBacktest && !event.isError);
  });
}
