#!/usr/bin/env node
/**
 * Install zen-coding's research connectors user-wide.
 *
 * `.pi/mcp.json` in this repository is the SOURCE LIST of connectors. pi only
 * reads a project's mcp.json while running inside that project, and pi
 * packages cannot ship MCP entries, so a connector that should follow you into
 * other repositories (Strategy_Dashboard, a deploy repo, ...) has to live in
 * the user-level file, ~/.pi/agent/mcp.json. This script merges the source
 * list into that file without touching unrelated entries.
 *
 *   node scripts/install-connectors.mjs                 # add every missing connector
 *   node scripts/install-connectors.mjs --only alpaca,github
 *   node scripts/install-connectors.mjs --skip paper-search
 *   node scripts/install-connectors.mjs --force          # overwrite entries that already exist
 *   node scripts/install-connectors.mjs --dry-run        # print the merged file, write nothing
 *   node scripts/install-connectors.mjs --migrate-legacy # move a top-level "servers" block
 *                                                        # (pi-mcp-support format) under mcpServers
 *
 * Credentials stay in the environment (${EXA_API_KEY}, ${ALPACA_API_KEY}, ...);
 * nothing secret is written. Run `pi mcp list` afterwards to validate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, ".pi", "mcp.json");
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const TARGET = join(AGENT_DIR, "mcp.json");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const listOpt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) fail(`${name} needs a comma-separated list`);
  return v.split(",").map((s) => s.trim()).filter(Boolean);
};
function fail(msg) {
  console.error(`install-connectors: ${msg}`);
  process.exit(1);
}
if (flag("--help") || flag("-h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*\n|^ \* ?/gm, ""));
  process.exit(0);
}

const only = listOpt("--only");
const skip = new Set(listOpt("--skip") ?? []);
const force = flag("--force");
const dryRun = flag("--dry-run");
const migrateLegacy = flag("--migrate-legacy");

const source = JSON.parse(readFileSync(SOURCE, "utf8")).mcpServers ?? {};
let target = {};
if (existsSync(TARGET)) {
  try {
    target = JSON.parse(readFileSync(TARGET, "utf8"));
  } catch (err) {
    fail(`${TARGET} is not valid JSON (${err.message}); fix it before merging`);
  }
}
if (!target.mcpServers || typeof target.mcpServers !== "object") target.mcpServers = {};

if (target.servers && typeof target.servers === "object") {
  if (migrateLegacy) {
    for (const [name, cfg] of Object.entries(target.servers)) {
      if (target.mcpServers[name]) {
        console.log(`  = ${name} (legacy entry skipped; already under mcpServers)`);
        continue;
      }
      const { transport, ...rest } = cfg;
      if (transport === "streamable-http" || transport === "http") rest.type = "http";
      target.mcpServers[name] = rest;
      console.log(`  ~ ${name} (migrated from legacy "servers" block)`);
    }
    delete target.servers;
  } else {
    console.warn(
      `warning: ${TARGET} has a top-level "servers" block (the @codella/pi-mcp-support format).\n` +
        `         pi's built-in MCP support reads "mcpServers" only. Re-run with --migrate-legacy to convert it.`,
    );
  }
}

const unknown = (only ?? []).filter((n) => !source[n]);
if (unknown.length) fail(`unknown connector(s): ${unknown.join(", ")}. Available: ${Object.keys(source).join(", ")}`);

let added = 0;
for (const [name, cfg] of Object.entries(source)) {
  if ((only && !only.includes(name)) || skip.has(name)) continue;
  if (target.mcpServers[name] && !force) {
    console.log(`  = ${name} (already configured; use --force to overwrite)`);
    continue;
  }
  target.mcpServers[name] = cfg;
  added += 1;
  console.log(`  + ${name}`);
}

const out = JSON.stringify(target, null, 2) + "\n";
if (dryRun) {
  console.log(`\n--- ${TARGET} (dry run, not written) ---\n${out}`);
} else {
  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, out);
  console.log(`\nwrote ${TARGET} (${added} connector${added === 1 ? "" : "s"} added)`);
}
const envHints = {
  exa: "EXA_API_KEY",
  alphaxiv: "ALPHAXIV_API_KEY",
  render: "RENDER_API_KEY",
  alpaca: "ALPACA_API_KEY, ALPACA_SECRET_KEY",
  github: "gh auth login",
  "paper-search": "uv installed",
};
const missing = Object.entries(envHints)
  .filter(([name, hint]) => target.mcpServers[name] && hint.includes("_KEY") && hint.split(", ").some((v) => !process.env[v]))
  .map(([name, hint]) => `${name}: ${hint}`);
if (missing.length) console.log(`\ncredentials not set in this shell (connectors without them are reported once and skipped):\n  ${missing.join("\n  ")}`);
console.log("\nnext: pi mcp list   # connects to every server and reports its state");
