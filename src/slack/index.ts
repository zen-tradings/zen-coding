/**
 * zen-coding Slack backend entrypoint (design.md §User Interaction 1,
 * README roadmap #2).
 *
 *   npm run slack
 *
 * Requires SLACK_BOT_TOKEN + SLACK_APP_TOKEN (Socket Mode) plus at least one
 * model provider key. See src/slack/config.ts for all options.
 */
import { App } from "@slack/bolt";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerHandlers } from "./app";
import { loadConfig } from "./config";
import { ThreadRegistry } from "./threads";

const config = loadConfig();
const modelRuntime = await ModelRuntime.create();

const available = await modelRuntime.getAvailable();
if (available.length === 0) {
  throw new Error(
    "No model provider configured: export DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / … before starting.",
  );
}

const app = new App({
  token: config.botToken,
  appToken: config.appToken,
  socketMode: true,
});

const auth = await app.client.auth.test({ token: config.botToken });
const botUserId = auth.user_id as string;

const registry = new ThreadRegistry(config.stateFile);
registerHandlers({ app, config, modelRuntime, registry, botUserId });

setInterval(() => registry.evictIdle(config.idleMs), 60_000).unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n[zen-slack] ${signal} received, disposing sessions…`);
    registry.disposeAll();
    process.exit(0);
  });
}

await app.start();
console.log(
  `[zen-slack] ⚡ connected as ${auth.user ?? botUserId} (socket mode)` +
    `\n[zen-slack] model: ${config.modelSpec ?? "(default from pi settings)"}` +
    `\n[zen-slack] default cwd: ${config.defaultCwd}` +
    `\n[zen-slack] workspaces: ${config.workspacesDir}`,
);
