/**
 * Slack event wiring: @-mentions in channels open a thread bound to a pi
 * session; replies in that thread (and DMs) continue it. Messages arriving
 * while the agent is streaming are delivered as steering input.
 */
import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { AgentSessionEvent, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { redact } from "../redact";
import { createThreadSession } from "./agent";
import type { SlackBackendConfig } from "./config";
import { slackTextToPlain } from "./markdown";
import { ThreadRegistry, type LiveThread } from "./threads";
import { ThreadStreamer } from "./streamer";
import { ensureWorkspace, parseRepoRef } from "./workspace";

export interface HandlerDeps {
  app: App;
  config: SlackBackendConfig;
  modelRuntime: ModelRuntime;
  registry: ThreadRegistry;
  botUserId: string;
}

interface Incoming {
  client: WebClient;
  channel: string;
  /** Thread to reply into; undefined for flat DM conversations. */
  replyThreadTs?: string;
  key: string;
  text: string;
  user?: string;
  /** ts of the triggering message (for reaction acks). */
  messageTs?: string;
}

/** Remember recently seen Slack event IDs (Slack redelivers on slow acks). */
class SeenEvents {
  private ids = new Set<string>();
  seen(id: string | undefined): boolean {
    if (!id) return false;
    if (this.ids.has(id)) return true;
    this.ids.add(id);
    if (this.ids.size > 500) {
      const oldest = this.ids.values().next().value;
      if (oldest) this.ids.delete(oldest);
    }
    return false;
  }
}

function extractAssistantText(message: unknown): { text: string; errorMessage?: string } {
  const m = message as {
    role?: string;
    content?: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
  if (m.role !== "assistant") return { text: "" };
  let text = "";
  if (typeof m.content === "string") text = m.content;
  else if (Array.isArray(m.content)) {
    text = m.content
      .filter(
        (b): b is { type: "text"; text: string } =>
          typeof b === "object" &&
          b !== null &&
          (b as { type?: string }).type === "text" &&
          typeof (b as { text?: unknown }).text === "string",
      )
      .map((b) => b.text)
      .join("\n");
  }
  return {
    text,
    errorMessage: m.stopReason === "error" ? (m.errorMessage ?? "agent error") : undefined,
  };
}

function describeToolCall(toolName: string, args: unknown): string {
  const input = args as Record<string, unknown> | undefined;
  const detail =
    typeof input?.command === "string"
      ? input.command
      : typeof input?.path === "string"
        ? input.path
        : typeof input?.pattern === "string"
          ? input.pattern
          : "";
  const compact = detail.replace(/\s+/g, " ").trim();
  const safe = redact(compact) as string;
  return compact ? `${toolName}: ${safe.slice(0, 90)}` : toolName;
}

export function routeSessionEvents(live: LiveThread): (event: AgentSessionEvent) => void {
  return (event) => {
    const streamer = live.streamer;
    if (!streamer) return;
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          streamer.appendDelta(event.assistantMessageEvent.delta);
        }
        break;
      case "message_end": {
        const { text, errorMessage } = extractAssistantText(event.message);
        if (text || errorMessage) streamer.completeMessage(text, errorMessage);
        break;
      }
      case "tool_execution_start":
        streamer.setStatus(describeToolCall(event.toolName, event.args));
        break;
      case "tool_execution_end":
        streamer.setStatus("");
        break;
      default:
        break;
    }
  };
}

export function registerHandlers(deps: HandlerDeps): void {
  const { app, config, modelRuntime, registry, botUserId } = deps;
  const seen = new SeenEvents();

  async function ensureLiveThread(
    incoming: Incoming,
    streamer: ThreadStreamer,
  ): Promise<{ live: LiveThread; note?: string }> {
    const existing = registry.getLive(incoming.key);
    if (existing) return { live: existing };

    let persisted = registry.getPersisted(incoming.key);
    let note: string | undefined;
    if (!persisted) {
      const repo = parseRepoRef(incoming.text);
      let workdir = config.defaultCwd;
      if (repo) {
        const safeKey = incoming.key.replace(/[^a-zA-Z0-9._-]/g, "_");
        workdir = join(config.workspacesDir, safeKey, repo.name);
        streamer.setStatus(`cloning ${repo.owner}/${repo.name}${repo.branch ? `@${repo.branch}` : ""}`);
        const fallback = await ensureWorkspace(repo, workdir, config.cloneDepth);
        // Status lines are transient (throttled chat.update); keep the note
        // for the final message instead.
        if (fallback) note = `${repo.owner}/${repo.name}: ${fallback}`;
      }
      persisted = { workdir, repo };
      registry.persist(incoming.key, persisted);
    } else if (persisted.repo) {
      // Refresh a resumed checkout best-effort before the agent works on it.
      const fallback = await ensureWorkspace(persisted.repo, persisted.workdir, config.cloneDepth);
      if (fallback) note = `${persisted.repo.owner}/${persisted.repo.name}: ${fallback}`;
    }

    streamer.setStatus("starting session");
    const session = await createThreadSession({
      cwd: persisted.workdir,
      zenRoot: config.zenRoot,
      modelRuntime,
      modelSpec: config.modelSpec,
      sessionFile: persisted.sessionFile,
    });

    const live: LiveThread = {
      session,
      unsubscribe: () => {},
      queue: Promise.resolve(),
      lastActivity: Date.now(),
    };
    live.unsubscribe = session.subscribe(routeSessionEvents(live));
    registry.setLive(incoming.key, live);

    if (session.sessionFile && session.sessionFile !== persisted.sessionFile) {
      registry.persist(incoming.key, { ...persisted, sessionFile: session.sessionFile });
    }
    return { live, note };
  }

  async function runPrompt(incoming: Incoming): Promise<void> {
    const streamer = new ThreadStreamer(incoming.client, incoming.channel, incoming.replyThreadTs);
    try {
      await streamer.start();
    } catch (err) {
      console.error("[zen-slack] cannot post to channel:", err);
      return;
    }

    let live: LiveThread;
    let note: string | undefined;
    try {
      ({ live, note } = await ensureLiveThread(incoming, streamer));
    } catch (err) {
      await streamer.finalize(`❌ workspace setup failed: ${(err as Error).message}`);
      return;
    }

    live.queue = live.queue.then(async () => {
      live.streamer = streamer;
      live.lastActivity = Date.now();
      try {
        await live.session.prompt(incoming.text);
        await streamer.finalize(note ? `⚠️ ${note}` : undefined);
      } catch (err) {
        const errText = `❌ ${(err as Error).message}`;
        await streamer.finalize(note ? `${errText}\n\n⚠️ ${note}` : errText);
      } finally {
        live.streamer = undefined;
        live.lastActivity = Date.now();
      }
    });
    await live.queue;
  }

  async function handleIncoming(incoming: Incoming): Promise<void> {
    if (config.allowedUsers.size > 0 && (!incoming.user || !config.allowedUsers.has(incoming.user))) {
      await incoming.client.chat.postMessage({
        channel: incoming.channel,
        thread_ts: incoming.replyThreadTs,
        text: "🔒 Sorry, you're not on this bot's allowlist (`ZEN_SLACK_ALLOWED_USERS`).",
      });
      return;
    }
    if (!incoming.text) return;

    const live = registry.getLive(incoming.key);
    if (live?.session.isStreaming) {
      // Agent is mid-run: deliver as steering input to the ongoing run.
      registry.touch(incoming.key);
      try {
        await live.session.prompt(incoming.text, { streamingBehavior: "steer" });
        if (incoming.messageTs) {
          await incoming.client.reactions
            .add({ channel: incoming.channel, timestamp: incoming.messageTs, name: "eyes" })
            .catch(() => {});
        }
      } catch (err) {
        console.error("[zen-slack] steer failed:", err);
      }
      return;
    }

    await runPrompt(incoming);
  }

  app.event("app_mention", async ({ event, body, client }) => {
    if (seen.seen(body.event_id)) return;
    const threadTs = event.thread_ts ?? event.ts;
    await handleIncoming({
      client,
      channel: event.channel,
      replyThreadTs: threadTs,
      key: `${event.channel}:${threadTs}`,
      text: slackTextToPlain(event.text ?? ""),
      user: event.user,
      messageTs: event.ts,
    });
  });

  app.message(async ({ message, body, client }) => {
    if (message.subtype !== undefined) return;
    if (seen.seen(body.event_id)) return;
    const { channel, channel_type, text, user, thread_ts } = message;
    if (!text || message.bot_id) return;
    // Mentions are handled by the app_mention listener; don't double-process.
    if (text.includes(`<@${botUserId}>`)) return;

    if (channel_type === "im") {
      await handleIncoming({
        client,
        channel,
        replyThreadTs: undefined,
        key: `dm:${channel}`,
        text: slackTextToPlain(text),
        user,
        messageTs: message.ts,
      });
      return;
    }

    // Channel reply inside a thread the bot already owns → continue the session.
    if (thread_ts) {
      const key = `${channel}:${thread_ts}`;
      if (registry.getLive(key) || registry.getPersisted(key)) {
        await handleIncoming({
          client,
          channel,
          replyThreadTs: thread_ts,
          key,
          text: slackTextToPlain(text),
          user,
          messageTs: message.ts,
        });
      }
    }
  });
}
