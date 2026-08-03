/**
 * zen-coding guardrails: gate every tool call before it executes.
 *
 * Starter rules live in DEFAULTS below. Project- and domain-specific rules
 * (e.g. protecting production strategy configs or research datasets) belong
 * in .pi/guardrails.json, which overrides the defaults field by field.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
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

function loadConfig(cwd: string): GuardrailsConfig {
  try {
    const raw = readFileSync(join(cwd, ".pi", "guardrails.json"), "utf8");
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GuardrailsConfig>) };
  } catch {
    return DEFAULTS;
  }
}

export default function (pi: ExtensionAPI) {
  let config = DEFAULTS;

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);
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
