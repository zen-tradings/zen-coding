/**
 * zen-coding guardrails: gate every tool call before it executes.
 *
 * Starter rules live in DEFAULTS below. Project- and domain-specific rules
 * (e.g. protecting production strategy configs or research datasets) belong
 * in guardrails.json next to this extension (.pi/guardrails.json in the
 * zen-coding package), which overrides the defaults field by field.
 *
 * The rules file is resolved relative to this extension file's own location
 * (not the cwd), so guardrails work when pi runs in any repo — e.g. after a
 * global `pi install`. Set ZEN_GUARDRAILS_CONFIG to point at a different
 * rules file. Missing/unreadable rules are a hard error: guardrails never
 * silently run disabled.
 *
 * A repo being worked in may add its own rules via <cwd>/.pi/guardrails.json.
 * These merge TIGHTEN-ONLY: deny patterns and protected paths are unioned,
 * and allowWritesOutsideCwd can only be narrowed to false — a repo can add
 * protections but never weaken the base rules.
 *
 * Secret hygiene (Langfuse traces upload tool inputs/outputs, and the plugin
 * only redacts Langfuse keys): denyReadPaths blocks the read tool on
 * credential files (allowReadPaths exempts templates like .env.example; repo
 * files cannot add exemptions), and denySecretBashPatterns blocks commands
 * that dump secrets (env/printenv, cat of env/key files, echo $*_KEY ...).
 * Sourcing an env file into a command (`set -a; . envs/x.env; ...`) stays
 * allowed — it uses secrets without printing them.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { minimatch } from "minimatch";
import { claimExtension } from "./shared/load-once";

interface GuardrailsConfig {
  denyBashPatterns: string[];
  protectedPaths: string[];
  allowWritesOutsideCwd: boolean;
  denyReadPaths: string[];
  allowReadPaths: string[];
  denySecretBashPatterns: string[];
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
  // Globs without "/" match the file name anywhere; "~/" expands to $HOME.
  denyReadPaths: [
    ".env",
    ".env.*",
    "*.env",
    "*.pem",
    "*.key",
    "id_rsa*",
    "id_ed25519*",
    ".netrc",
    ".pypirc",
    "credential.txt",
    "credentials",
    "~/.pi/agent/langfuse.json",
    "~/.pi/agent/auth.json",
  ],
  allowReadPaths: [".env.example", ".env.sample", ".env.template", "*.env.example", "*.env.sample", "*.env.template"],
  denySecretBashPatterns: [
    // bare env/printenv/export -p dumps (`env | grep KEY` too); `env FOO=1 cmd` stays allowed
    "(?:^|[;&|(\\n]\\s*)(?:env|printenv|export\\s+-p|declare\\s+-x)\\s*(?:$|[;&|)>])",
    "\\bprintenv\\s+\\w*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)",
    // printing / copying credential files
    "\\b(?:cat|less|more|head|tail|bat|nl|strings|xxd|od|hexdump|grep|egrep|rg|awk|sed|cut|sort|base64|cp|scp|curl)\\b[^\\n;&|]*?(?:^|[\\s/'\"=@])(?:\\.env(?!\\.(?:example|sample|template)\\b)(?:\\.[\\w-]+)?|[\\w.-]+\\.env|\\.netrc|credential\\.txt|langfuse\\.json|auth\\.json|[\\w.-]+\\.(?:pem|key)|id_(?:rsa|ed25519)[\\w.-]*)(?=$|[\\s'\";&|)])",
    // echo/printf of secret-looking variables (${#VAR} and ${VAR:+set} checks stay allowed)
    "\\b(?:echo|printf)\\b[^\\n;&|]*\\$(?:\\{(?![#!])\\w*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)\\w*\\}|\\w*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)\\w*\\b)",
  ],
};

const MUTATING_FILE_TOOLS = new Set(["write", "edit"]);
/** Tools whose `path` input is read and returned to the model (and the trace). */
const READING_TOOLS = new Set(["read", "grep"]);

/** Match a path against read globs: bare names match the basename, "~/" is $HOME. */
export function matchesReadGlob(absPath: string, cwd: string, globs: string[]): string | undefined {
  const rel = relative(cwd, absPath);
  for (const glob of globs) {
    const pattern = glob.startsWith("~/") ? join(homedir(), glob.slice(2)) : glob;
    const hit = !pattern.includes("/")
      ? minimatch(basename(absPath), pattern, { dot: true })
      : isAbsolute(pattern)
        ? minimatch(absPath, pattern, { dot: true })
        : minimatch(rel, pattern, { dot: true }) || minimatch(absPath, `**/${pattern}`, { dot: true });
    if (hit) return glob;
  }
  return undefined;
}

function defaultConfigPath(): string {
  // <pkg>/.pi/extensions/guardrails.ts -> <pkg>/.pi/guardrails.json
  return join(dirname(fileURLToPath(import.meta.url)), "..", "guardrails.json");
}

function loadConfig(): GuardrailsConfig {
  const path = process.env.ZEN_GUARDRAILS_CONFIG ?? defaultConfigPath();
  try {
    const raw = readFileSync(path, "utf8");
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GuardrailsConfig>) };
  } catch (err) {
    throw new Error(
      `zen-guardrails: failed to load rules from ${path} (${(err as Error).message}). ` +
        "Refusing to run with guardrails disabled; fix the file or set ZEN_GUARDRAILS_CONFIG.",
    );
  }
}

/**
 * Merge optional repo-local rules (<cwd>/.pi/guardrails.json) over the base
 * config, tighten-only: lists are unioned, allowWritesOutsideCwd can only
 * narrow to false. A malformed repo-local file is a hard error — silently
 * ignoring intended protections is worse than failing loudly.
 */
function mergeLocalConfig(base: GuardrailsConfig, cwd: string): GuardrailsConfig {
  const localPath = join(cwd, ".pi", "guardrails.json");
  if (!existsSync(localPath)) return base;
  let local: Partial<GuardrailsConfig>;
  try {
    local = JSON.parse(readFileSync(localPath, "utf8")) as Partial<GuardrailsConfig>;
  } catch (err) {
    throw new Error(
      `zen-guardrails: failed to parse repo-local rules at ${localPath} (${(err as Error).message}).`,
    );
  }
  return {
    denyBashPatterns: [...new Set([...base.denyBashPatterns, ...(local.denyBashPatterns ?? [])])],
    protectedPaths: [...new Set([...base.protectedPaths, ...(local.protectedPaths ?? [])])],
    allowWritesOutsideCwd: base.allowWritesOutsideCwd && (local.allowWritesOutsideCwd ?? true),
    denyReadPaths: [...new Set([...base.denyReadPaths, ...(local.denyReadPaths ?? [])])],
    allowReadPaths: base.allowReadPaths, // exemptions are base-only (tighten-only)
    denySecretBashPatterns: [...new Set([...base.denySecretBashPatterns, ...(local.denySecretBashPatterns ?? [])])],
  };
}

export default function (pi: ExtensionAPI) {
  if (!claimExtension(pi, "guardrails")) return; // already loaded (project + global install)
  // Base rules loaded once at extension init; fails loudly if none are found.
  const base = loadConfig();
  let config = base;

  pi.on("session_start", async (_event, ctx) => {
    config = mergeLocalConfig(base, ctx.cwd);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command ?? "";
      for (const pattern of config.denyBashPatterns) {
        if (new RegExp(pattern, "i").test(command)) {
          return {
            block: true,
            reason: `zen-guardrails: command matches denied pattern /${pattern}/`,
          };
        }
      }
      for (const pattern of config.denySecretBashPatterns) {
        if (new RegExp(pattern, "i").test(command)) {
          return {
            block: true,
            reason:
              `zen-guardrails: command would print secrets (/${pattern}/). Tool output is traced to Langfuse. ` +
              "Load credentials into the command instead (e.g. `set -a; . envs/x.env; set +a; python run.py`), " +
              "or check presence without printing (e.g. `[ -n \"$X_KEY\" ] && echo set`).",
          };
        }
      }
      return;
    }

    if (READING_TOOLS.has(event.toolName)) {
      const input = event.input as { path?: string };
      if (!input.path) return;
      const target = resolve(ctx.cwd, String(input.path).replace(/^@/, "").replace(/^~(?=\/|$)/, homedir()));
      if (matchesReadGlob(target, ctx.cwd, config.allowReadPaths)) return;
      const glob = matchesReadGlob(target, ctx.cwd, config.denyReadPaths);
      if (glob) {
        return {
          block: true,
          reason: `zen-guardrails: credential file (${glob}) is not readable by the agent (tool output is traced): ${target}`,
        };
      }
      return;
    }

    if (MUTATING_FILE_TOOLS.has(event.toolName)) {
      const input = event.input as { path?: string };
      const target = resolve(ctx.cwd, String(input.path ?? "").replace(/^@/, ""));
      const rel = relative(ctx.cwd, target);

      if (!config.allowWritesOutsideCwd && (rel.startsWith("..") || isAbsolute(rel))) {
        return {
          block: true,
          reason: `zen-guardrails: write outside workspace: ${target}`,
        };
      }
      for (const glob of config.protectedPaths) {
        if (minimatch(rel, glob, { dot: true })) {
          return {
            block: true,
            reason: `zen-guardrails: protected path (${glob}): ${rel}`,
          };
        }
      }
    }
  });
}
