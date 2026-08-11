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
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { minimatch } from "minimatch";

interface GuardrailsConfig {
  denyBashPatterns: string[];
  protectedPaths: string[];
  allowWritesOutsideCwd: boolean;
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
};

const MUTATING_FILE_TOOLS = new Set(["write", "edit"]);

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
  };
}

export default function (pi: ExtensionAPI) {
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
