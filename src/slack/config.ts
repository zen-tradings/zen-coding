/**
 * zen-coding Slack backend configuration, sourced from environment variables.
 *
 * Required:
 *   SLACK_BOT_TOKEN   xoxb-… bot token (chat:write, app_mentions:read, im:history, …)
 *   SLACK_APP_TOKEN   xapp-… app-level token with connections:write (Socket Mode)
 *
 * Optional:
 *   ZEN_SLACK_MODEL          "provider/model[:thinkingLevel]", e.g. "deepseek/deepseek-chat"
 *   ZEN_SLACK_DEFAULT_CWD    workdir when a message has no GitHub link (default: this repo)
 *   ZEN_SLACK_WORKSPACES     where per-thread checkouts live (default: .zen/slack/workspaces)
 *   ZEN_SLACK_CLONE_DEPTH    shallow-clone depth, 0 = full clone (default: 0)
 *   ZEN_SLACK_IDLE_MINUTES   dispose sessions idle longer than this (default: 60)
 *   ZEN_SLACK_ALLOWED_USERS  comma-separated Slack user IDs; empty = allow everyone
 *   GITHUB_TOKEN / GH_TOKEN  used for cloning private repos (never written to disk)
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SlackBackendConfig {
  botToken: string;
  appToken: string;
  /** Root of the zen-coding repo: extensions and guardrails are loaded from here. */
  zenRoot: string;
  /** Directory holding per-thread repo checkouts. */
  workspacesDir: string;
  /** JSON file persisting the Slack-thread → session mapping. */
  stateFile: string;
  /** Fallback working directory when no GitHub link is present. */
  defaultCwd: string;
  /** Optional model spec, resolved like the CLI --model flag. */
  modelSpec?: string;
  cloneDepth: number;
  idleMs: number;
  allowedUsers: Set<string>;
}

export function loadConfig(): SlackBackendConfig {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!botToken || !appToken) {
    throw new Error(
      "Missing Slack credentials: set SLACK_BOT_TOKEN (xoxb-…) and SLACK_APP_TOKEN (xapp-…, Socket Mode).",
    );
  }

  const zenRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
  const workspacesDir = process.env.ZEN_SLACK_WORKSPACES
    ? resolve(process.env.ZEN_SLACK_WORKSPACES)
    : resolve(zenRoot, ".zen", "slack", "workspaces");

  return {
    botToken,
    appToken,
    zenRoot,
    workspacesDir,
    stateFile: resolve(zenRoot, ".zen", "slack", "threads.json"),
    defaultCwd: process.env.ZEN_SLACK_DEFAULT_CWD
      ? resolve(process.env.ZEN_SLACK_DEFAULT_CWD)
      : zenRoot,
    modelSpec: process.env.ZEN_SLACK_MODEL || undefined,
    cloneDepth: Number(process.env.ZEN_SLACK_CLONE_DEPTH ?? 0) || 0,
    idleMs: (Number(process.env.ZEN_SLACK_IDLE_MINUTES ?? 60) || 60) * 60_000,
    allowedUsers: new Set(
      (process.env.ZEN_SLACK_ALLOWED_USERS ?? "")
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean),
    ),
  };
}
