/**
 * Session work type: research | conversion | ops | platform (else "unknown").
 *
 * Resolution order: `/zen type <value>` (persisted as a session entry, so it
 * survives restart/resume) > ZEN_WORK_TYPE > per-repo default in
 * zen.config.json ({"workType": "..."}, nearest one walking up from the cwd,
 * stopping at the git root) > "unknown".
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const WORK_TYPES = ["research", "conversion", "ops", "platform"] as const;
export type WorkType = (typeof WORK_TYPES)[number] | "unknown";
export type WorkTypeSource = "command" | "env" | "repo" | "default";

/** customType of the session entry written by `/zen type`. */
export const WORK_TYPE_ENTRY = "zen-work-type";
export const REPO_CONFIG_FILE = "zen.config.json";

export function isWorkType(value: unknown): value is (typeof WORK_TYPES)[number] {
  return typeof value === "string" && (WORK_TYPES as readonly string[]).includes(value);
}

/** Nearest zen.config.json from cwd up to (and including) the git root. */
export function readRepoConfig(cwd: string): { workType?: unknown } {
  let dir = cwd;
  for (;;) {
    const path = join(dir, REPO_CONFIG_FILE);
    if (existsSync(path)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        return parsed && typeof parsed === "object" ? (parsed as { workType?: unknown }) : {};
      } catch {
        return {};
      }
    }
    const parent = dirname(dir);
    if (existsSync(join(dir, ".git")) || parent === dir) return {};
    dir = parent;
  }
}

export function resolveWorkType(
  ctx: Pick<ExtensionContext, "sessionManager" | "cwd">,
  env: NodeJS.ProcessEnv = process.env,
): { workType: WorkType; source: WorkTypeSource } {
  try {
    const entries = ctx.sessionManager.getBranch();
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as { type?: string; customType?: string; data?: { workType?: unknown } };
      if (e.type === "custom" && e.customType === WORK_TYPE_ENTRY && isWorkType(e.data?.workType)) {
        return { workType: e.data.workType, source: "command" };
      }
    }
  } catch {
    // fall through to env/repo defaults
  }
  const fromEnv = env.ZEN_WORK_TYPE?.trim().toLowerCase();
  if (isWorkType(fromEnv)) return { workType: fromEnv, source: "env" };
  const fromRepo = readRepoConfig(ctx.cwd).workType;
  if (isWorkType(fromRepo)) return { workType: fromRepo, source: "repo" };
  return { workType: "unknown", source: "default" };
}
