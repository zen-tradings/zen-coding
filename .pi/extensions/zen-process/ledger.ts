/**
 * Backtest ledger: ~/.zen/ledger/<sessionId>.jsonl (override: ZEN_LEDGER_DIR).
 *
 * Primary source: scripts/zen_ledger.py, called once per run by backtest entry
 * points (source "helper"). Fallback: bash commands matching backtest patterns
 * in repos that never wrote a helper record (source "bash-heuristic", written
 * here). Helper records always win for their repo, so a repo that has the
 * helper is never double-counted by the heuristic.
 *
 * Variant hash = code state + config contents + args, EXCLUDING seeds; seeds
 * are kept per variant so best-seed picking stays visible.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface LedgerRecord {
  v: number;
  ts: string;
  session_id: string;
  source: "helper" | "bash-heuristic";
  variant_hash: string;
  seeds?: unknown;
  repo?: string | null;
  [key: string]: unknown;
}

export function ledgerDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZEN_LEDGER_DIR?.trim() || join(homedir(), ".zen", "ledger");
}

const SAFE_ID = /^[\w.-]+$/;

export function ledgerPath(sessionId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return SAFE_ID.test(sessionId) ? join(ledgerDir(env), `${sessionId}.jsonl`) : undefined;
}

export function readLedger(sessionId: string, env: NodeJS.ProcessEnv = process.env): LedgerRecord[] {
  const path = ledgerPath(sessionId, env);
  if (!path || !existsSync(path)) return [];
  const out: LedgerRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as LedgerRecord;
      if (rec && typeof rec.variant_hash === "string") out.push(rec);
    } catch {
      // a torn/partial line must not break the count
    }
  }
  return out;
}

export function appendLedger(sessionId: string, rec: LedgerRecord, env: NodeJS.ProcessEnv = process.env): void {
  const path = ledgerPath(sessionId, env);
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(rec)}\n`);
}

export interface VariantSummary {
  distinct: number;
  total: number;
  metadata: Record<string, unknown>;
}

const MAX_VARIANTS_IN_METADATA = 50;

export function summarize(records: LedgerRecord[]): VariantSummary {
  const helperRepos = new Set(records.filter((r) => r.source === "helper").map((r) => r.repo ?? ""));
  const counted = records.filter((r) => r.source !== "bash-heuristic" || !helperRepos.has(r.repo ?? ""));
  const byVariant = new Map<string, { runs: number; seeds: Set<string>; source: string }>();
  for (const r of counted) {
    const v = byVariant.get(r.variant_hash) ?? { runs: 0, seeds: new Set<string>(), source: r.source };
    v.runs++;
    v.seeds.add(JSON.stringify(r.seeds ?? null));
    byVariant.set(r.variant_hash, v);
  }
  const helperRuns = counted.filter((r) => r.source === "helper").length;
  const heuristicRuns = counted.length - helperRuns;
  const source = heuristicRuns === 0 ? "ledger" : helperRuns === 0 ? "bash-heuristic" : "mixed";
  const variants = [...byVariant.entries()].map(([hash, v]) => ({
    variant: hash.slice(0, 16),
    runs: v.runs,
    distinct_seeds: v.seeds.size,
    seeds: [...v.seeds].map((s) => JSON.parse(s) as unknown),
    source: v.source,
  }));
  return {
    distinct: byVariant.size,
    total: counted.length,
    metadata: {
      total_runs: counted.length,
      source,
      helper_runs: helperRuns,
      heuristic_runs: heuristicRuns,
      max_seeds_per_variant: Math.max(0, ...variants.map((v) => v.distinct_seeds)),
      variants: variants.slice(0, MAX_VARIANTS_IN_METADATA),
      ...(variants.length > MAX_VARIANTS_IN_METADATA ? { variants_truncated: true } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Bash-pattern fallback
// ---------------------------------------------------------------------------

function defaultConfigPath(): string {
  // <pkg>/.pi/extensions/zen-process/ledger.ts -> <pkg>/.pi/zen-process.json
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "zen-process.json");
}

/** ZEN_BACKTEST_PATTERNS (JSON array, or one regex per line) replaces the config defaults. */
export function loadBacktestPatterns(env: NodeJS.ProcessEnv = process.env, configPath = defaultConfigPath()): RegExp[] {
  let sources: string[] = [];
  const raw = env.ZEN_BACKTEST_PATTERNS?.trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      sources = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    } catch {
      sources = raw.split("\n").map((s) => s.trim()).filter(Boolean);
    }
  } else {
    try {
      sources = (JSON.parse(readFileSync(configPath, "utf8")) as { backtestPatterns?: string[] }).backtestPatterns ?? [];
    } catch {
      sources = [];
    }
  }
  const out: RegExp[] = [];
  for (const s of sources) {
    try {
      out.push(new RegExp(s));
    } catch {
      // invalid user regex: skip rather than break bash
    }
  }
  return out;
}

const SEED_FLAG = /\s--(?:seeds?|random[-_]seed|random[-_]state|rng[-_]seed)(?:=|\s+)(\S+)/g;

/** Heuristic variant: same code state + same command (seed flags removed). */
export function heuristicVariant(command: string, codeState: string): { variantHash: string; seeds: string[] } {
  const seeds = [...command.matchAll(SEED_FLAG)].map((m) => m[1]);
  const normalized = command.replace(SEED_FLAG, "").replace(/\s+/g, " ").trim();
  const variantHash = createHash("sha256").update(JSON.stringify({ codeState, command: normalized })).digest("hex");
  return { variantHash, seeds };
}
