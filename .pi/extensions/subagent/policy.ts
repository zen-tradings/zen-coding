import { realpathSync } from "node:fs";

export const BUILTIN_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

export function childTools(profile: string[] | undefined, parent: string[], mode: string): string[] {
  if (!profile?.length) throw new Error("Agent profile must declare a non-empty tools allowlist");
  if (profile.some((tool) => !BUILTIN_TOOLS.includes(tool))) {
    throw new Error("Subagent profiles may only use built-in tools; recursive delegation is disabled");
  }
  const tools = [...new Set(profile)].filter((tool) => parent.includes(tool) && (mode !== "plan" || READ_ONLY_TOOLS.has(tool)));
  if (!tools.length) throw new Error("Profile has no tools permitted by the parent session/mode");
  return tools;
}

export function validateTaskCwd(parent: string, requested?: string): void {
  if (requested && realpathSync(requested) !== realpathSync(parent)) {
    throw new Error("Subagents must use the parent's workspace; cwd overrides are not supported");
  }
}

export function readSettings(env: NodeJS.ProcessEnv = process.env): { concurrency: number; timeoutMs: number } {
  const integer = (key: string, fallback: number, max: number) => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) {
      throw new Error(`${key} must be an integer from 1 to ${max}`);
    }
    return value;
  };
  return {
    concurrency: integer("ZEN_SUBAGENT_CONCURRENCY", 4, 4),
    timeoutMs: integer("ZEN_SUBAGENT_TIMEOUT_SECONDS", 600, 3600) * 1000,
  };
}

/** One budget shared by all delegation calls in a parent session. */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error("Subagent cancelled before launch");
    if (active >= limit) {
      await new Promise<void>((resolve, reject) => {
        const ready = () => { signal?.removeEventListener("abort", abort); resolve(); };
        const abort = () => {
          const index = waiting.indexOf(ready);
          if (index >= 0) waiting.splice(index, 1);
          reject(new Error("Subagent cancelled while queued"));
        };
        waiting.push(ready);
        signal?.addEventListener("abort", abort, { once: true });
      });
    } else active++;
    try {
      if (signal?.aborted) throw new Error("Subagent cancelled before launch");
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next(); // Transfer this slot directly to the next waiter.
      else active--;
    }
  };
}
