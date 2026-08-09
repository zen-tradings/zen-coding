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
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
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
  protectedPaths: [".env", ".env.*", "**/*.pem", "**/*.key", ".zen/**", ".git/**"],
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

export default function (pi: ExtensionAPI) {
  // Loaded once at extension init; fails loudly if no rules file is found.
  const config = loadConfig();

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
