/**
 * zen-coding modes: /zen <mode> switches how the agent behaves.
 *
 *   normal  — default pi behavior
 *   clarify — ask clarifying questions first when the request is ambiguous
 *   plan    — read-only: explore and produce a plan, no file mutations
 *
 * The mode applies per session and resets to normal on restart.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ZenMode = "normal" | "clarify" | "plan";

const MODES: ZenMode[] = ["normal", "clarify", "plan"];

const MODE_PROMPTS: Record<ZenMode, string | null> = {
  normal: null,
  clarify: [
    "",
    "## zen-coding: clarify mode",
    "Before planning or editing: if the request is ambiguous, underspecified, or could be",
    "interpreted in multiple ways, first ask the user concise clarifying questions and wait",
    "for answers. Only proceed to planning and implementation once the goal is unambiguous.",
  ].join("\n"),
  plan: [
    "",
    "## zen-coding: plan mode",
    "You are in read-only planning mode. Do NOT modify any files or run state-changing",
    "commands. Explore the codebase, then produce a concrete step-by-step implementation",
    "plan (files to touch, order of changes, risks, how to verify) and stop.",
  ].join("\n"),
};

const MUTATING_FILE_TOOLS = new Set(["write", "edit"]);

export default function (pi: ExtensionAPI) {
  let mode: ZenMode = "normal";

  pi.registerCommand("zen", {
    description: "Switch zen-coding mode (normal | clarify | plan)",
    getArgumentCompletions: (prefix: string) => {
      const items = MODES.filter((m) => m.startsWith(prefix)).map((m) => ({
        value: m,
        label: m,
      }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const requested = (args ?? "").trim() as ZenMode;
      if (!MODES.includes(requested)) {
        ctx.ui.notify(`Usage: /zen <${MODES.join(" | ")}> — current: ${mode}`, "warning");
        return;
      }
      mode = requested;
      ctx.ui.setStatus("zen-mode", mode === "normal" ? "" : `zen: ${mode}`);
      ctx.ui.notify(`zen mode: ${mode}`, "info");
    },
  });

  pi.on("before_agent_start", async (event) => {
    const extra = MODE_PROMPTS[mode];
    if (!extra) return;
    return { systemPrompt: event.systemPrompt + extra };
  });

  pi.on("tool_call", async (event) => {
    if (mode === "plan" && MUTATING_FILE_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: "zen plan mode is read-only; switch back with /zen normal",
      };
    }
  });
}
