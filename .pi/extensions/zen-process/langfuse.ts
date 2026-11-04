/**
 * Minimal Langfuse REST client for session scores (POST /api/public/scores —
 * still available on v4 events_only deployments).
 *
 * Credentials and kill switch follow the plugin exactly: LANGFUSE_TRACING_ENABLED
 * =false disables everything; env vars win over <agentDir>/langfuse.json.
 *
 * Fails open: every request has a timeout, errors are logged to
 * ~/.zen/telemetry.log (and stderr when ZEN_TELEMETRY_DEBUG=1), never thrown.
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LangfuseApiConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  environment?: string;
}

export function loadLangfuseApiConfig(env: NodeJS.ProcessEnv = process.env): LangfuseApiConfig | undefined {
  if ((env.LANGFUSE_TRACING_ENABLED ?? "").trim().toLowerCase() === "false") return undefined;
  let file: Record<string, unknown> = {};
  try {
    const path = join(getAgentDir(), "langfuse.json");
    if (existsSync(path)) file = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    file = {};
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim() || str(file.publicKey);
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim() || str(file.secretKey);
  if (!publicKey || !secretKey) return undefined;
  const baseUrl =
    env.LANGFUSE_BASE_URL?.trim() || env.LANGFUSE_HOST?.trim() || str(file.baseUrl) || "https://cloud.langfuse.com";
  return {
    publicKey,
    secretKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
    environment: env.LANGFUSE_TRACING_ENVIRONMENT?.trim() || str(file.environment),
  };
}

export function logTelemetry(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (process.env.ZEN_TELEMETRY_DEBUG === "1") console.error(`[zen-telemetry] ${message}`);
  try {
    const dir = join(homedir(), ".zen");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "telemetry.log"), line);
  } catch {
    // logging must never break the session either
  }
}

export interface SessionScore {
  sessionId: string;
  name: string;
  dataType: "NUMERIC" | "CATEGORICAL" | "TEXT";
  value: number | string;
  metadata?: Record<string, unknown>;
}

/** Idempotent score id: re-posting replaces the score instead of duplicating it. */
export const sessionScoreId = (sessionId: string, name: string) => `${sessionId}-${name}`;

export class ScoreClient {
  private configIds: Promise<Map<string, string>> | undefined;
  /** Per score name: serialize posts so a stale value never lands last. */
  private chains = new Map<string, Promise<void>>();

  constructor(private readonly cfg: LangfuseApiConfig, private readonly timeoutMs = 5000) {}

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const auth = Buffer.from(`${this.cfg.publicKey}:${this.cfg.secretKey}`).toString("base64");
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : undefined;
  }

  /** Id of the non-archived score config with this name, if one exists. */
  private async configId(name: string): Promise<string | undefined> {
    this.configIds ??= this.request("GET", "/api/public/score-configs?limit=100").then(
      (r) => {
        const map = new Map<string, string>();
        for (const c of ((r as { data?: Array<{ id: string; name: string; isArchived?: boolean }> })?.data ?? [])) {
          if (!c.isArchived) map.set(c.name, c.id);
        }
        return map;
      },
      (err) => {
        this.configIds = undefined; // retry on the next post
        logTelemetry(`score-config lookup failed: ${(err as Error).message}`);
        return new Map<string, string>();
      },
    );
    return (await this.configIds).get(name);
  }

  /**
   * Queue an upsert. `build` runs when the post actually starts, so a burst of
   * updates always sends the latest state. Resolves (never rejects) when done.
   */
  upsert(name: string, build: () => SessionScore | undefined): Promise<void> {
    const prev = this.chains.get(name) ?? Promise.resolve();
    const next = prev.then(async () => {
      const score = build();
      if (!score) return;
      try {
        const configId = await this.configId(score.name);
        await this.request("POST", "/api/public/scores", {
          id: sessionScoreId(score.sessionId, score.name),
          sessionId: score.sessionId,
          name: score.name,
          value: score.value,
          dataType: score.dataType,
          ...(configId ? { configId } : {}),
          ...(this.cfg.environment ? { environment: this.cfg.environment } : {}),
          ...(score.metadata ? { metadata: score.metadata } : {}),
        });
      } catch (err) {
        logTelemetry(`score ${score.name} for session ${score.sessionId} not sent: ${(err as Error).message}`);
      }
    });
    this.chains.set(name, next);
    return next;
  }
}

/** Resolve after `promise` or `ms`, whichever first; never rejects. */
export async function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    promise.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);
}
