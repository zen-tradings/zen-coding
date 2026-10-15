/**
 * The package manifest (`pi` key in package.json) is the only distribution
 * mechanism: whatever it does not declare does not reach other repositories.
 * Load this checkout as a pi package from an unrelated working directory and
 * check that extensions, prompts and skills are all discovered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const ROOT = resolve(import.meta.dirname, "..");

test("pi package manifest exposes extensions, prompts and skills outside this repo", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "zen-pkg-agent-"));
  const cwd = mkdtempSync(join(tmpdir(), "zen-pkg-cwd-"));
  try {
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [ROOT] }));
    const loader = new DefaultResourceLoader({ cwd, agentDir, noContextFiles: true });
    await loader.reload();

    const { extensions, errors } = loader.getExtensions();
    assert.deepEqual(errors, []);
    const extensionFiles = extensions.map((e) => e.path.split("/").pop()).sort();
    assert.deepEqual(extensionFiles, ["guardrails.ts", "modes.ts", "observability.ts"]);

    const prompts = loader.getPrompts();
    assert.deepEqual(
      prompts.prompts.map((p) => p.name).sort(),
      ["alpha", "audit", "backtest", "beta-audit", "eval", "fundamental", "paper-replicate", "portfolio"],
    );

    const skills = loader.getSkills();
    const names = skills.skills.map((s) => s.name).sort();
    for (const expected of ["alpha-research", "backtest", "beta-audit", "paper-replication", "wq-alpha-research", "mintlify-docs"]) {
      assert.ok(names.includes(expected), `skill ${expected} missing from ${names.join(", ")}`);
    }
    assert.deepEqual([...prompts.diagnostics, ...skills.diagnostics], []);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});
