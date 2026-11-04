/**
 * zen-coding modes: /zen <mode> switches how the agent behaves.
 *
 *   normal  — default pi behavior
 *   clarify — ask clarifying questions first when the request is ambiguous
 *   plan    — read-only: explore and produce a plan, no file mutations
 *
 * The mode applies per session and resets to normal on restart.
 *
 * `/zen type <research|conversion|ops|platform>` sets the session's work type
 * instead (persisted in the session, so it survives restart/resume); `/zen type`
 * shows the current value. See zen-process/work-type.ts.
 *
 * The mode instructions go into a structured system-prompt section rather than
 * a replacement prompt, so pi records a transcript delta when the mode changes
 * and keeps the cached prompt prefix (pi >= 0.86 mid-conversation system messages).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isWorkType, resolveWorkType, WORK_TYPE_ENTRY, WORK_TYPES } from "./zen-process/work-type";

type ZenMode = "normal" | "clarify" | "plan";

const MODES: ZenMode[] = ["normal", "clarify", "plan"];

/** Tag of the XML-wrapped system-prompt section that carries the mode instructions. */
const MODE_SECTION = "zen_mode";

const MODE_PROMPTS: Record<ZenMode, string | null> = {
  normal: null,
  clarify: [
    "zen-coding: clarify mode",
    "Before planning or editing: if the request is ambiguous, underspecified, or could be",
    "interpreted in multiple ways, first ask the user concise clarifying questions and wait",
    "for answers. Only proceed to planning and implementation once the goal is unambiguous.",
  ].join("\n"),
  plan: [
    "zen-coding: plan mode",
    "You are in read-only planning mode. Do NOT modify any files or run state-changing",
    "commands. Explore the codebase, then produce a concrete step-by-step implementation",
    "plan (files to touch, order of changes, risks, how to verify) and stop.",
  ].join("\n"),
};

const MUTATING_FILE_TOOLS = new Set(["write", "edit"]);

export default function (pi: ExtensionAPI) {
  let mode: ZenMode = "normal";

  pi.registerCommand("zen", {
    description: "Switch zen-coding mode (normal | clarify | plan), or set the work type: /zen type <value>",
    getArgumentCompletions: (prefix: string) => {
      if (prefix.startsWith("type ")) {
        const rest = prefix.slice(5).trim();
        const types = WORK_TYPES.filter((t) => t.startsWith(rest)).map((t) => ({ value: `type ${t}`, label: t }));
        return types.length > 0 ? types : null;
      }
      const items = [...MODES, "type"].filter((m) => m.startsWith(prefix)).map((m) => ({
        value: m,
        label: m,
      }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const [sub, value, ...extra] = (args ?? "").trim().split(/\s+/);
      if (sub === "type") {
        const current = resolveWorkType(ctx);
        if (!value) {
          ctx.ui.notify(`zen work type: ${current.workType} (from ${current.source})`, "info");
          return;
        }
        const requestedType = value.toLowerCase();
        if (extra.length > 0 || !isWorkType(requestedType)) {
          ctx.ui.notify(`Usage: /zen type <${WORK_TYPES.join(" | ")}> — current: ${current.workType}`, "warning");
          return;
        }
        pi.appendEntry(WORK_TYPE_ENTRY, { workType: requestedType });
        pi.events.emit("zen:work-type", requestedType);
        ctx.ui.notify(`zen work type: ${requestedType}`, "info");
        return;
      }
      const requested = (args ?? "").trim() as ZenMode;
      if (!MODES.includes(requested)) {
        ctx.ui.notify(`Usage: /zen <${MODES.join(" | ")}> — current: ${mode}`, "warning");
        return;
      }
      mode = requested;
      pi.events.emit("zen:mode", mode);
      ctx.ui.setStatus("zen-mode", mode === "normal" ? "" : `zen: ${mode}`);
      ctx.ui.notify(`zen mode: ${mode}`, "info");
    },
  });

  pi.on("before_agent_start", async (event) => {
    const options = event.systemPromptOptions;
    const extra = MODE_PROMPTS[mode];
    if (extra) {
      options.sections = { ...options.sections, [MODE_SECTION]: extra };
    } else if (options.sections && MODE_SECTION in options.sections) {
      const { [MODE_SECTION]: _dropped, ...rest } = options.sections;
      options.sections = rest;
    }
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
