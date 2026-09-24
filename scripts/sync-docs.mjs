#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = join(repositoryRoot, "docs");
const configPath = join(docsRoot, "sources.json");
const docsConfigPath = join(docsRoot, "docs.json");
const temporaryRoot = mkdtempSync(join(tmpdir(), "zen-docs-sync-"));
const sourceOverridesRoot = process.env.DOCS_SYNC_SOURCE_ROOT;

function safeTarget(target) {
  const resolved = resolve(docsRoot, target);
  if (!resolved.startsWith(`${resolve(docsRoot)}${sep}`)) {
    throw new Error(`Refusing unsafe docs target: ${target}`);
  }
  return resolved;
}

function listPages(directory, base = directory) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .flatMap((entry) => {
      const absolute = join(directory, entry);
      if (statSync(absolute).isDirectory()) return listPages(absolute, base);
      if (![".md", ".mdx"].includes(extname(entry))) return [];
      return [relative(base, absolute).replaceAll(sep, "/").replace(/\.mdx?$/, "")];
    })
    .sort((left, right) => {
      if (left === "index") return -1;
      if (right === "index") return 1;
      return left.localeCompare(right);
    });
}

function sourceNavigation(sourceDirectory) {
  const sourceConfigPath = join(sourceDirectory, "docs.json");
  if (!existsSync(sourceConfigPath)) return listPages(sourceDirectory);

  const sourceConfig = JSON.parse(readFileSync(sourceConfigPath, "utf8"));
  const configuredPages = (sourceConfig.navigation?.groups ?? []).flatMap(
    (group) => group.pages ?? [],
  );
  const discoveredPages = listPages(sourceDirectory);
  return [...new Set([...configuredPages, ...discoveredPages])];
}

function rewriteRootLinks(content, target) {
  const prefix = `/${target}/`;
  return content
    .replaceAll(/href="\/(?!\/)([^"#]+)"/g, (_match, path) => {
      if (path === target || path.startsWith(`${target}/`)) return `href="/${path}"`;
      return `href="${prefix}${path}"`;
    })
    .replaceAll(/\]\(\/(?!\/)([^\s)#]+)(#[^)]+)?\)/g, (_match, path, hash = "") => {
      if (path === target || path.startsWith(`${target}/`)) return `](/${path}${hash})`;
      return `](${prefix}${path}${hash})`;
    });
}

function copySource(sourceDirectory, targetDirectory, source) {
  rmSync(targetDirectory, { recursive: true, force: true });
  mkdirSync(targetDirectory, { recursive: true });

  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (entry.name === "docs.json" || entry.name === ".gitkeep") continue;
    const from = join(sourceDirectory, entry.name);
    const to = join(targetDirectory, entry.name);
    cpSync(from, to, { recursive: true });
  }

  if (!source.rewriteRootLinks) return;
  for (const page of listPages(targetDirectory)) {
    const extension = existsSync(join(targetDirectory, `${page}.mdx`)) ? ".mdx" : ".md";
    const pagePath = join(targetDirectory, `${page}${extension}`);
    const content = readFileSync(pagePath, "utf8");
    writeFileSync(pagePath, rewriteRootLinks(content, source.target));
  }
}

function checkoutSource(source) {
  if (sourceOverridesRoot) {
    const override = join(resolve(sourceOverridesRoot), source.id);
    if (!existsSync(override)) throw new Error(`Missing source override: ${override}`);
    return override;
  }

  const checkout = join(temporaryRoot, source.id);
  execFileSync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      source.ref,
      `https://github.com/${source.repository}.git`,
      checkout,
    ],
    { stdio: "inherit" },
  );
  return checkout;
}

function syncSource(source) {
  const checkout = checkoutSource(source);
  const sourceDirectory = resolve(checkout, normalize(source.path));
  if (!sourceDirectory.startsWith(`${resolve(checkout)}${sep}`) || !existsSync(sourceDirectory)) {
    throw new Error(`Missing docs path ${source.path} in ${source.repository}@${source.ref}`);
  }

  const pages = sourceNavigation(sourceDirectory);
  const targetDirectory = safeTarget(source.target);
  copySource(sourceDirectory, targetDirectory, source);

  if (pages.length === 0) {
    if (source.fallbackFile) {
      const fallbackSource = resolve(repositoryRoot, normalize(source.fallbackFile));
      if (
        !fallbackSource.startsWith(`${repositoryRoot}${sep}`) ||
        !existsSync(fallbackSource)
      ) {
        throw new Error(`Missing fallback file: ${source.fallbackFile}`);
      }
      cpSync(fallbackSource, join(targetDirectory, "index.mdx"));
      return { group: source.group, pages: [`${source.target}/index`] };
    }
    return { group: source.group, pages: source.fallbackPages ?? [] };
  }

  return {
    group: source.group,
    pages: pages.map((page) => `${source.target}/${page}`),
  };
}

try {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const syncedNavigation = config.sources.map(syncSource);
  const docsConfig = JSON.parse(readFileSync(docsConfigPath, "utf8"));
  docsConfig.navigation = {
    ...(docsConfig.navigation ?? {}),
    groups: [...config.staticNavigation, ...syncedNavigation],
  };
  writeFileSync(docsConfigPath, `${JSON.stringify(docsConfig, null, 2)}\n`);

  for (const source of config.sources) {
    console.log(`Synced ${source.repository}@${source.ref}/${source.path} -> docs/${source.target}`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
