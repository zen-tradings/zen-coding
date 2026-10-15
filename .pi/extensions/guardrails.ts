/**
 * zen-coding guardrails: gate every tool call before it executes.
 *
 * Two layers of rules, both loaded from guardrails.json next to this
 * extension (.pi/guardrails.json in the zen-coding package):
 *
 *   Global rules apply in every repository, to every file:
 *     - denyBashPatterns   destructive shell commands
 *     - protectedPaths     secrets and state that must never be written
 *     - allowWritesOutsideCwd (always false in the shipped rules)
 *
 *   Research rules apply only to files matched by research.paths and not by
 *   research.exclude (Python/notebooks/R/Julia, minus frontend, deploy and
 *   service directories). They never fire on JS/TS UI files or deploy
 *   scripts. Each rule has an `action`:
 *     - block  the write/edit is refused with the rule's message
 *     - warn   the write/edit goes through; the message is appended to the
 *              tool result so the model sees it at edit time, and shown in the UI
 *   Shipped rules: negative shift / centered windows (lookahead), fit before
 *   train_test_split, inplace=True, production data / model artifact /
 *   live-trading paths (block); backtests without a cost model and
 *   survivorship-prone universes (warn).
 *
 * The rules file is resolved relative to this extension file's own location
 * (not the cwd), so guardrails work when pi runs in any repo — e.g. after a
 * global `pi install`. Set ZEN_GUARDRAILS_CONFIG to point at a different
 * rules file. Missing/unreadable rules are a hard error: guardrails never
 * silently run disabled.
 *
 * A repo being worked in may add its own rules via <cwd>/.pi/guardrails.json.
 * These merge TIGHTEN-ONLY: deny patterns, protected paths, research paths
 * and research rules are unioned; allowWritesOutsideCwd can only be narrowed
 * to false; a research rule can only be raised from warn to block; and
 * research.exclude cannot be extended by a repo. A repo can add protections
 * but never weaken the base rules.
 *
 * Events on pi.events (consumed by observability.ts):
 *   zen:guardrail      { toolCallId, toolName, path, findings }  on block or warn
 *   zen:research-file  { toolCallId, path }  when a write/edit targets research code
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { minimatch } from "minimatch";

export type RuleAction = "block" | "warn";

export interface ResearchRule {
  id: string;
  action: RuleAction;
  message: string;
  /** Regexes tested line by line against the resulting file content. */
  patterns?: string[];
  /** The rule only applies when the file matches this regex (e.g. imports pandas). */
  requires?: string;
  /** Structural checks that need more than a regex. */
  check?: "fit-before-split" | "backtest-without-costs";
  /** A line carrying `# <allowMarker>` is exempt from this rule. */
  allowMarker?: string;
  backtestMarkers?: string[];
  costMarkers?: string[];
}

export interface ResearchConfig {
  paths: string[];
  exclude: string[];
  protectedPaths: string[];
  rules: ResearchRule[];
}

export interface GuardrailsConfig {
  denyBashPatterns: string[];
  protectedPaths: string[];
  allowWritesOutsideCwd: boolean;
  research: ResearchConfig;
}

export interface Finding {
  rule: string;
  action: RuleAction;
  message: string;
  path: string;
  /** 1-indexed line in the resulting file, when the rule points at one. */
  line: number | null;
}

const DEFAULTS: GuardrailsConfig = {
  denyBashPatterns: [
    "rm\\s+-[rRfF]+\\s+(/|~)(\\s|$)",
    "git\\s+push\\b.*--force(?!-with-lease)",
    "git\\s+reset\\s+--hard",
  ],
  protectedPaths: [
    ".env",
    ".env.*",
    "**/*.pem",
    "**/*.key",
    ".zen/**",
    ".git/**",
    ".pi/guardrails.json", // the agent must not edit its own rules
  ],
  allowWritesOutsideCwd: false,
  // No research scope unless the rules file defines one.
  research: { paths: [], exclude: [], protectedPaths: [], rules: [] },
};

const MUTATING_FILE_TOOLS = new Set(["write", "edit"]);

/** Shell operators/commands that write to (or remove) a path named on the command line. */
const BASH_WRITE_OPERATOR =
  /(^|[\s;&|(])(tee|cp|mv|rm|rsync|truncate|dd|ln|shred|unlink|install)\b|(^|[\s;&|(])sed\s+-[A-Za-z]*i|(^|[^<>&])>{1,2}(?!&)/;

function defaultConfigPath(): string {
  // <pkg>/.pi/extensions/guardrails.ts -> <pkg>/.pi/guardrails.json
  return join(dirname(fileURLToPath(import.meta.url)), "..", "guardrails.json");
}

function parseResearch(raw: unknown, source: string, override = false): Partial<ResearchConfig> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`zen-guardrails: "research" in ${source} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const list = (key: string): string[] | undefined => {
    const v = r[key];
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new Error(`zen-guardrails: research.${key} in ${source} must be a string array`);
    }
    return v as string[];
  };
  const out: Partial<ResearchConfig> = {};
  for (const key of ["paths", "exclude", "protectedPaths"] as const) {
    const v = list(key);
    if (v) out[key] = v;
  }
  if (r.rules !== undefined) {
    if (!Array.isArray(r.rules)) throw new Error(`zen-guardrails: research.rules in ${source} must be an array`);
    out.rules = r.rules.map((rule, i) => validateRule(rule, `${source} research.rules[${i}]`, override));
  }
  return out;
}

function validateRule(raw: unknown, where: string, override = false): ResearchRule {
  if (!raw || typeof raw !== "object") throw new Error(`zen-guardrails: ${where} must be an object`);
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) throw new Error(`zen-guardrails: ${where} needs a string id`);
  if (r.action !== "block" && r.action !== "warn") {
    throw new Error(`zen-guardrails: ${where} (${r.id}) action must be "block" or "warn"`);
  }
  // A repo-local override of an existing rule may carry only { id, action }.
  const severityOnly = override && r.check === undefined && r.patterns === undefined;
  if (!severityOnly && (typeof r.message !== "string" || !r.message)) {
    throw new Error(`zen-guardrails: ${where} (${r.id}) needs a message`);
  }
  if (r.check !== undefined && r.check !== "fit-before-split" && r.check !== "backtest-without-costs") {
    throw new Error(`zen-guardrails: ${where} (${r.id}) has unknown check "${String(r.check)}"`);
  }
  if (!severityOnly && r.check === undefined && !Array.isArray(r.patterns)) {
    throw new Error(`zen-guardrails: ${where} (${r.id}) needs patterns or a check`);
  }
  for (const key of ["patterns", "backtestMarkers", "costMarkers"] as const) {
    const v = r[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new Error(`zen-guardrails: ${where} (${r.id}) ${key} must be a string array`);
    }
    for (const p of v as string[]) compileRegex(p, `${where} (${r.id}) ${key}`);
  }
  if (r.requires !== undefined) {
    if (typeof r.requires !== "string") throw new Error(`zen-guardrails: ${where} (${r.id}) requires must be a string`);
    compileRegex(r.requires, `${where} (${r.id}) requires`);
  }
  if (r.allowMarker !== undefined && typeof r.allowMarker !== "string") {
    throw new Error(`zen-guardrails: ${where} (${r.id}) allowMarker must be a string`);
  }
  return r as unknown as ResearchRule;
}

function compileRegex(pattern: string, where: string, flags = ""): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw new Error(`zen-guardrails: invalid regex in ${where}: /${pattern}/ (${(err as Error).message})`);
  }
}

export function parseConfig(raw: string, source: string): GuardrailsConfig {
  const parsed = JSON.parse(raw) as Partial<GuardrailsConfig> & { research?: unknown };
  const research = parseResearch(parsed.research, source);
  const config: GuardrailsConfig = {
    ...DEFAULTS,
    ...parsed,
    research: { ...DEFAULTS.research, ...research },
  };
  for (const p of config.denyBashPatterns) compileRegex(p, `${source} denyBashPatterns`, "i");
  return config;
}

function loadConfig(): GuardrailsConfig {
  const path = process.env.ZEN_GUARDRAILS_CONFIG ?? defaultConfigPath();
  try {
    return parseConfig(readFileSync(path, "utf8"), path);
  } catch (err) {
    throw new Error(
      `zen-guardrails: failed to load rules from ${path} (${(err as Error).message}). ` +
        "Refusing to run with guardrails disabled; fix the file or set ZEN_GUARDRAILS_CONFIG.",
    );
  }
}

/**
 * Merge optional repo-local rules (<cwd>/.pi/guardrails.json) over the base
 * config, tighten-only. A malformed repo-local file is a hard error — silently
 * ignoring intended protections is worse than failing loudly.
 */
export function mergeLocalConfig(base: GuardrailsConfig, local: Partial<GuardrailsConfig>, source: string): GuardrailsConfig {
  const union = (a: string[], b: string[] | undefined) => [...new Set([...a, ...(b ?? [])])];
  const localResearch = parseResearch((local as { research?: unknown }).research, source, true);
  if (localResearch.exclude !== undefined) {
    throw new Error(
      `zen-guardrails: ${source} sets research.exclude, which would loosen the research scope. ` +
        "Excludes can only be set in the base rules file; a repository may only add research.paths.",
    );
  }
  const rules = base.research.rules.map((r) => ({ ...r }));
  for (const localRule of localResearch.rules ?? []) {
    const existing = rules.find((r) => r.id === localRule.id);
    if (!existing) {
      if (localRule.check === undefined && localRule.patterns === undefined) {
        throw new Error(`zen-guardrails: ${source} references unknown rule "${localRule.id}"; a new rule needs patterns or a check.`);
      }
      rules.push(localRule);
      continue;
    }
    if (existing.action === "block" && localRule.action === "warn") {
      throw new Error(`zen-guardrails: ${source} downgrades rule "${localRule.id}" from block to warn; rules can only be tightened.`);
    }
    // Same id: only the severity may change, and only upwards.
    existing.action = localRule.action;
  }
  return {
    denyBashPatterns: union(base.denyBashPatterns, local.denyBashPatterns),
    protectedPaths: union(base.protectedPaths, local.protectedPaths),
    allowWritesOutsideCwd: base.allowWritesOutsideCwd && (local.allowWritesOutsideCwd ?? true),
    research: {
      paths: union(base.research.paths, localResearch.paths),
      exclude: base.research.exclude,
      protectedPaths: union(base.research.protectedPaths, localResearch.protectedPaths),
      rules,
    },
  };
}

function loadLocalConfig(base: GuardrailsConfig, cwd: string): GuardrailsConfig {
  const localPath = join(cwd, ".pi", "guardrails.json");
  if (!existsSync(localPath)) return base;
  let local: Partial<GuardrailsConfig>;
  try {
    local = JSON.parse(readFileSync(localPath, "utf8")) as Partial<GuardrailsConfig>;
  } catch (err) {
    throw new Error(`zen-guardrails: failed to parse repo-local rules at ${localPath} (${(err as Error).message}).`);
  }
  return mergeLocalConfig(base, local, localPath);
}

// ---------------------------------------------------------------------------
// Pure rule evaluation (exported for tests)
// ---------------------------------------------------------------------------

const GLOB_OPTS = { dot: true };

export function matchGlobs(rel: string, globs: string[]): string | null {
  for (const glob of globs) if (minimatch(rel, glob, GLOB_OPTS)) return glob;
  return null;
}

/** Is this repo-relative path research code under the configured scope? */
export function isResearchPath(rel: string, research: ResearchConfig): boolean {
  return matchGlobs(rel, research.paths) !== null && matchGlobs(rel, research.exclude) === null;
}

/** Simulate pi's edit tool: every oldText is matched against the original content. */
export function applyEdits(original: string, edits: Array<{ oldText: string; newText: string }>): string {
  // Replace from the last occurrence to the first so earlier offsets stay valid.
  const located = edits
    .map((e) => ({ ...e, index: original.indexOf(e.oldText) }))
    .filter((e) => e.index >= 0 && e.oldText.length > 0)
    .sort((a, b) => b.index - a.index);
  let out = original;
  for (const e of located) out = out.slice(0, e.index) + e.newText + out.slice(e.index + e.oldText.length);
  return out;
}

function hasMarker(line: string, marker: string | undefined): boolean {
  return !!marker && new RegExp(`#\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line);
}

function firstLineMatching(lines: string[], re: RegExp, marker?: string): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]) && !hasMarker(lines[i], marker)) return i + 1;
  }
  return null;
}

function checkFitBeforeSplit(lines: string[], rule: ResearchRule): number | null {
  const fitRe = /\.fit(_transform)?\(/;
  const splitRe = /\btrain_test_split\(/;
  const importRe = /^\s*(from|import)\b/;
  let fitLine: number | null = null;
  let splitLine: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (importRe.test(line)) continue;
    if (fitLine === null && fitRe.test(line) && !hasMarker(line, rule.allowMarker)) fitLine = i + 1;
    if (splitLine === null && splitRe.test(line)) splitLine = i + 1;
  }
  return fitLine !== null && splitLine !== null && fitLine < splitLine ? fitLine : null;
}

function checkBacktestWithoutCosts(content: string, rule: ResearchRule): boolean {
  const markers = (rule.backtestMarkers ?? []).map((p) => compileRegex(p, rule.id, "i"));
  const costs = (rule.costMarkers ?? []).map((p) => compileRegex(p, rule.id, "i"));
  if (markers.length === 0 || !markers.some((re) => re.test(content))) return false;
  return !costs.some((re) => re.test(content));
}

/** Evaluate the research rules against the content a write/edit would leave on disk. */
export function evaluateResearchRules(rel: string, content: string, research: ResearchConfig): Finding[] {
  if (!isResearchPath(rel, research)) return [];
  const lines = content.split("\n");
  const findings: Finding[] = [];
  for (const rule of research.rules) {
    if (rule.requires && !compileRegex(rule.requires, rule.id).test(content)) continue;
    let line: number | null = null;
    let hit = false;
    if (rule.check === "fit-before-split") {
      line = checkFitBeforeSplit(lines, rule);
      hit = line !== null;
    } else if (rule.check === "backtest-without-costs") {
      hit = checkBacktestWithoutCosts(content, rule);
    } else {
      for (const pattern of rule.patterns ?? []) {
        line = firstLineMatching(lines, compileRegex(pattern, rule.id), rule.allowMarker);
        if (line !== null) break;
      }
      hit = line !== null;
    }
    if (hit) findings.push({ rule: rule.id, action: rule.action, message: rule.message, path: rel, line });
  }
  return findings;
}

/** Path tokens of a shell command, repo-relative when they point inside cwd. */
function commandPathTokens(command: string, cwd: string): string[] {
  const tokens = command
    .split(/[\s;&|()]+/)
    .map((t) => t.replace(/^['"]+|['"]+$/g, "").replace(/^\.\//, ""))
    .filter((t) => t && t !== ">" && t !== ">>" && !t.startsWith("-"));
  return tokens.map((t) => {
    if (!isAbsolute(t)) return t;
    const rel = relative(cwd, t);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : t;
  });
}

export function checkBashCommand(command: string, config: GuardrailsConfig, cwd: string): string | null {
  for (const pattern of config.denyBashPatterns) {
    if (new RegExp(pattern, "i").test(command)) return `zen-guardrails: command matches denied pattern /${pattern}/`;
  }
  if (!BASH_WRITE_OPERATOR.test(command)) return null;
  const protectedGlobs = [...config.protectedPaths, ...config.research.protectedPaths];
  for (const token of commandPathTokens(command, cwd)) {
    const glob = matchGlobs(token, protectedGlobs);
    if (glob) return `zen-guardrails: shell command writes to protected path (${glob}): ${token}`;
  }
  return null;
}

export function formatFinding(f: Finding): string {
  const where = f.line !== null ? `${f.path}:${f.line}` : f.path;
  return `zen-guardrails ${f.action === "block" ? "blocked" : "warning"} [${f.rule}] ${where}: ${f.message}`;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // Base rules loaded once at extension init; fails loudly if none are found.
  const base = loadConfig();
  let config = base;
  // Warnings collected at tool_call time, appended to the tool result once the edit succeeded.
  const pendingWarnings = new Map<string, Finding[]>();

  pi.on("session_start", async (_event, ctx) => {
    config = loadLocalConfig(base, ctx.cwd);
    pendingWarnings.clear();
  });

  pi.on("session_shutdown", async () => {
    pendingWarnings.clear();
  });

  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("bash", event)) {
      const reason = checkBashCommand(event.input.command ?? "", config, ctx.cwd);
      if (reason) {
        pi.events.emit("zen:guardrail", {
          toolCallId: event.toolCallId,
          toolName: "bash",
          path: null,
          findings: [{ rule: "bash", action: "block", message: reason, path: "", line: null }],
        });
        return { block: true, reason };
      }
      return;
    }

    if (!MUTATING_FILE_TOOLS.has(event.toolName)) return;

    const input = event.input as { path?: string; content?: string; edits?: Array<{ oldText: string; newText: string }> };
    const target = resolve(ctx.cwd, String(input.path ?? "").replace(/^@/, ""));
    const rel = relative(ctx.cwd, target);

    if (!config.allowWritesOutsideCwd && (rel.startsWith("..") || isAbsolute(rel))) {
      return { block: true, reason: `zen-guardrails: write outside workspace: ${target}` };
    }
    const protectedGlob = matchGlobs(rel, config.protectedPaths);
    if (protectedGlob) return { block: true, reason: `zen-guardrails: protected path (${protectedGlob}): ${rel}` };
    const researchGlob = matchGlobs(rel, config.research.protectedPaths);
    if (researchGlob) {
      return {
        block: true,
        reason: `zen-guardrails: protected research path (${researchGlob}): ${rel} — production data, model artifacts and live-trading configs are not edited by the agent`,
      };
    }

    if (!isResearchPath(rel, config.research)) return;
    pi.events.emit("zen:research-file", { toolCallId: event.toolCallId, path: rel });

    // Content the file will have after this call.
    let content: string | null = null;
    if (event.toolName === "write") {
      content = typeof input.content === "string" ? input.content : null;
    } else if (Array.isArray(input.edits)) {
      try {
        content = applyEdits(readFileSync(target, "utf8"), input.edits);
      } catch {
        content = null; // file missing or unreadable: the edit itself will fail
      }
    }
    if (content === null) return;

    const findings = evaluateResearchRules(rel, content, config.research);
    if (findings.length === 0) return;
    pi.events.emit("zen:guardrail", { toolCallId: event.toolCallId, toolName: event.toolName, path: rel, findings });

    const blocks = findings.filter((f) => f.action === "block");
    if (blocks.length > 0) {
      if (ctx.hasUI) ctx.ui.notify(formatFinding(blocks[0]), "warning");
      return { block: true, reason: blocks.map(formatFinding).join("\n") };
    }
    pendingWarnings.set(event.toolCallId, findings);
    if (ctx.hasUI) for (const f of findings) ctx.ui.notify(formatFinding(f), "warning");
  });

  pi.on("tool_result", async (event) => {
    const warnings = pendingWarnings.get(event.toolCallId);
    if (!warnings) return;
    pendingWarnings.delete(event.toolCallId);
    if (event.isError) return;
    const text = warnings.map(formatFinding).join("\n");
    return { content: [...event.content, { type: "text", text: `\n${text}` }] };
  });
}
