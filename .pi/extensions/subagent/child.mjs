/** Trusted subprocess bootstrap for the official Pi subagent adaptation.
 * Uses the parent's resolved Pi SDK, including when the parent is the Slack service.
 * Fails before prompting if any trusted extension cannot load or initialize.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [sdkPath, ...args] = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const extensions = args.flatMap((arg, i) => arg === "-e" ? [args[i + 1]] : []);
let session;
try {
  const { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, resolveCliModel, SessionManager, SettingsManager } = await import(pathToFileURL(sdkPath).href);
  const cwd = process.cwd();
  const agentDir = getAgentDir();
  // Credentials/models remain available, but arbitrary user/project package code does not.
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: extensions,
    appendSystemPrompt: args.includes("--append-system-prompt") ? [readFileSync(value("--append-system-prompt"), "utf8")] : [],
  });
  await loader.reload();
  const errors = loader.getExtensions().errors;
  if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.error}`).join("\n"));
  const modelRuntime = await ModelRuntime.create();
  const resolved = args.includes("--model") ? resolveCliModel({ cliModel: value("--model"), modelRuntime }) : {};
  if (resolved.error) throw new Error(resolved.error);
  if (resolved.warning) process.stderr.write(resolved.warning + "\n");
  const result = await createAgentSession({
    cwd, agentDir, resourceLoader: loader, settingsManager, modelRuntime,
    model: resolved.model,
    ...(args.includes("--thinking") ? { thinkingLevel: value("--thinking") } : resolved.thinkingLevel ? { thinkingLevel: resolved.thinkingLevel } : {}),
    tools: value("--tools").split(","),
    sessionManager: SessionManager.inMemory(cwd),
  });
  session = result.session;
  const startupErrors = [];
  await session.bindExtensions({ mode: "json", onError: (error) => {
    startupErrors.push(`${error.extensionPath} (${error.event}): ${error.error}`);
    void session.abort();
  } });
  if (startupErrors.length) throw new Error(startupErrors.join("\n"));
  const abort = () => { void session.abort(); };
  process.on("SIGTERM", abort);
  process.on("SIGINT", abort);
  session.subscribe((event) => {
    if (event.type === "message_end") process.stdout.write(JSON.stringify(event) + "\n");
  });
  await session.prompt(args.at(-1));
  if (startupErrors.length) throw new Error(startupErrors.join("\n"));
  process.off("SIGTERM", abort);
  process.off("SIGINT", abort);
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
} finally {
  session?.dispose();
}
