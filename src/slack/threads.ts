/**
 * Slack-thread → pi-session registry.
 *
 * Live sessions are held in memory and disposed after idling; the durable
 * thread → {workdir, sessionFile} mapping is persisted to .zen/slack/threads.json
 * so a thread picks its session back up across evictions and restarts.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ThreadStreamer } from "./streamer";
import type { RepoRef } from "./workspace";

export interface PersistedThread {
  workdir: string;
  sessionFile?: string;
  repo?: RepoRef;
}

export interface LiveThread {
  session: AgentSession;
  unsubscribe: () => void;
  /** Streamer of the currently running prompt, if any. */
  streamer?: ThreadStreamer;
  /** Serializes prompt runs within one thread. */
  queue: Promise<void>;
  lastActivity: number;
}

export class ThreadRegistry {
  private persisted: Record<string, PersistedThread> = {};
  private live = new Map<string, LiveThread>();

  constructor(private readonly stateFile: string) {
    try {
      this.persisted = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      this.persisted = {};
    }
  }

  getPersisted(key: string): PersistedThread | undefined {
    return this.persisted[key];
  }

  persist(key: string, state: PersistedThread): void {
    this.persisted[key] = state;
    // Write-then-rename so a crash mid-write can't corrupt the registry, and
    // fsync the tmp file so power loss can't rename an empty file over a good
    // one. The PID in the name keeps concurrent bot instances from colliding.
    const tmpFile = `${this.stateFile}.${process.pid}.tmp`;
    let fd: number | undefined;
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true });
      fd = openSync(tmpFile, "w");
      writeFileSync(fd, `${JSON.stringify(this.persisted, null, 2)}\n`);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(tmpFile, this.stateFile);
    } catch (err) {
      console.error("[zen-slack] failed to persist thread state:", err);
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // Best-effort cleanup.
        }
      }
      try {
        unlinkSync(tmpFile);
      } catch {
        // Nothing to clean up.
      }
    }
  }

  getLive(key: string): LiveThread | undefined {
    return this.live.get(key);
  }

  setLive(key: string, thread: LiveThread): void {
    this.live.set(key, thread);
  }

  touch(key: string): void {
    const thread = this.live.get(key);
    if (thread) thread.lastActivity = Date.now();
  }

  /** Dispose sessions idle longer than maxIdleMs (persisted mapping survives). */
  evictIdle(maxIdleMs: number): void {
    const now = Date.now();
    for (const [key, thread] of this.live) {
      const idle = now - thread.lastActivity;
      if (idle < maxIdleMs || thread.session.isStreaming) continue;
      try {
        thread.unsubscribe();
        thread.session.dispose();
      } catch (err) {
        console.error(`[zen-slack] error disposing session for ${key}:`, err);
      }
      this.live.delete(key);
      console.log(`[zen-slack] evicted idle session for ${key}`);
    }
  }

  disposeAll(): void {
    for (const [, thread] of this.live) {
      try {
        thread.unsubscribe();
        thread.session.dispose();
      } catch {
        // Shutting down anyway.
      }
    }
    this.live.clear();
  }
}
