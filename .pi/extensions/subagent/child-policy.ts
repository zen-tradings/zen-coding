import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOLS } from "./policy.js";

// Explicitly loaded only in child processes. This file is not auto-discovered.
export default function (pi: ExtensionAPI) {
  const tools: unknown = JSON.parse(process.env.ZEN_SUBAGENT_TOOLS ?? "null");
  const mode = process.env.ZEN_SUBAGENT_MODE;
  if (!Array.isArray(tools) || !tools.length || tools.some((t) => typeof t !== "string" || !BUILTIN_TOOLS.includes(t))) {
    throw new Error("Invalid child tool policy");
  }
  if (!["normal", "clarify", "plan"].includes(mode ?? "")) throw new Error("Invalid child mode");
  const allowed = new Set(tools);
  pi.on("session_start", async () => { pi.setActiveTools(tools); });
  pi.on("tool_call", async (event) => {
    if (!allowed.has(event.toolName)) return { block: true, reason: "Tool is not allowed by the parent/profile" };
    if (mode === "plan" && ["bash", "edit", "write"].includes(event.toolName)) {
      return { block: true, reason: "Delegated planning is read-only" };
    }
  });
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: event.systemPrompt + "\nYou are a delegated child agent. Complete only your assigned task and return evidence and relevant file references. You cannot delegate further." +
      (mode === "plan" ? "\nThe parent is in read-only planning mode. Do not modify files or run state-changing commands." : "") +
      (mode === "clarify" ? "\nThe parent is in clarify mode. Report ambiguities and missing information rather than making consequential assumptions." : ""),
  }));
}
