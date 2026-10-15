import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyEdits,
  checkBashCommand,
  evaluateResearchRules,
  isResearchPath,
  mergeLocalConfig,
  parseConfig,
  type GuardrailsConfig,
} from "../.pi/extensions/guardrails.ts";

const RULES_PATH = resolve(import.meta.dirname, "../.pi/guardrails.json");
const config: GuardrailsConfig = parseConfig(readFileSync(RULES_PATH, "utf8"), RULES_PATH);
const research = config.research;
const CWD = "/repo";

const PANDAS = "import pandas as pd\nimport numpy as np\n";
const ids = (findings: { rule: string }[]) => findings.map((f) => f.rule).sort();

test("shipped rules file parses and defines the research scope", () => {
  assert.ok(research.paths.length > 0);
  assert.ok(research.rules.some((r) => r.id === "lookahead-shift" && r.action === "block"));
  assert.ok(research.rules.some((r) => r.id === "backtest-without-costs" && r.action === "warn"));
});

test("research scope is path-based: python research code in, frontend/deploy/service code out", () => {
  assert.equal(isResearchPath("research/momentum.py", research), true);
  assert.equal(isResearchPath("strategies/beta2/signals.py", research), true);
  assert.equal(isResearchPath("backtests/portfolio.py", research), true);
  assert.equal(isResearchPath("notebooks/alpha.ipynb", research), true);
  assert.equal(isResearchPath("frontend/lib/strategy-metrics.ts", research), false);
  assert.equal(isResearchPath("frontend/scripts/build.py", research), false);
  assert.equal(isResearchPath("app/services/market_data.py", research), false);
  assert.equal(isResearchPath("deploy/release.py", research), false);
  assert.equal(isResearchPath("deploy.sh", research), false);
  assert.equal(isResearchPath("docker-compose.yml", research), false);
});

test("negative shift and centered windows block in pandas research code", () => {
  const leaky = `${PANDAS}df["fwd"] = df["ret"].shift(-1)\n`;
  const findings = evaluateResearchRules("research/features.py", leaky, research);
  assert.deepEqual(ids(findings), ["lookahead-shift"]);
  assert.equal(findings[0].action, "block");
  assert.equal(findings[0].line, 3);

  const centered = `${PANDAS}df["ma"] = df["close"].rolling(20, center=True).mean()\n`;
  assert.deepEqual(ids(evaluateResearchRules("research/features.py", centered, research)), ["lookahead-shift"]);

  const variable = `${PANDAS}h = 5\ndf["fwd"] = df["close"].pct_change(-h)\n`;
  assert.deepEqual(ids(evaluateResearchRules("research/features.py", variable, research)), ["lookahead-shift"]);
});

test("positive shift is fine; the lookahead-ok marker exempts a labelled line", () => {
  const ok = `${PANDAS}df["lag"] = df["ret"].shift(1)\n`;
  assert.deepEqual(evaluateResearchRules("research/features.py", ok, research), []);
  const labelled = `${PANDAS}df["y"] = df["close"].shift(-5) / df["close"] - 1  # lookahead-ok: training label\n`;
  assert.deepEqual(evaluateResearchRules("research/features.py", labelled, research), []);
});

test("the same shift in a frontend or deploy file never fires", () => {
  const leaky = `${PANDAS}df["fwd"] = df["ret"].shift(-1)\n`;
  assert.deepEqual(evaluateResearchRules("frontend/tools/report.py", leaky, research), []);
  assert.deepEqual(evaluateResearchRules("app/services/market_data.py", leaky, research), []);
  assert.deepEqual(evaluateResearchRules("frontend/lib/metrics.ts", "x.shift(-1)", research), []);
});

test("lookahead rules need a dataframe import: pure-stdlib code with shift(-1) is not flagged", () => {
  const plain = "def f(xs):\n    return xs.shift(-1)\n";
  assert.deepEqual(evaluateResearchRules("research/plain.py", plain, research), []);
});

test("fit before train_test_split blocks; split first passes", () => {
  const leak = [
    "from sklearn.preprocessing import StandardScaler",
    "from sklearn.model_selection import train_test_split",
    "X_scaled = StandardScaler().fit_transform(X)",
    "X_train, X_test, y_train, y_test = train_test_split(X_scaled, y)",
  ].join("\n");
  const findings = evaluateResearchRules("research/model.py", leak, research);
  assert.deepEqual(ids(findings), ["fit-before-split"]);
  assert.equal(findings[0].line, 3);

  const fine = [
    "from sklearn.preprocessing import StandardScaler",
    "from sklearn.model_selection import train_test_split",
    "X_train, X_test, y_train, y_test = train_test_split(X, y, shuffle=False)",
    "scaler = StandardScaler().fit(X_train)",
  ].join("\n");
  assert.deepEqual(evaluateResearchRules("research/model.py", fine, research), []);
});

test("inplace=True blocks in pandas code and is exempt with inplace-ok", () => {
  const bad = `${PANDAS}df.dropna(inplace=True)\n`;
  const findings = evaluateResearchRules("research/clean.py", bad, research);
  assert.deepEqual(ids(findings), ["inplace-mutation"]);
  assert.equal(findings[0].action, "block");
  const ok = `${PANDAS}local = df.copy()\nlocal.dropna(inplace=True)  # inplace-ok: local copy\n`;
  assert.deepEqual(evaluateResearchRules("research/clean.py", ok, research), []);
});

test("backtest without a cost term warns, with one does not", () => {
  const gross = `${PANDAS}def backtest(w, r):\n    pnl = (w * r).sum(axis=1)\n    return pnl.mean() / pnl.std() * 252 ** 0.5  # sharpe\n`;
  const findings = evaluateResearchRules("backtests/run.py", gross, research);
  assert.deepEqual(ids(findings), ["backtest-without-costs"]);
  assert.equal(findings[0].action, "warn");
  const net = `${gross}COST_BPS = 5\n`;
  assert.deepEqual(evaluateResearchRules("backtests/run.py", net, research), []);
});

test("survivorship-prone universe warns", () => {
  const src = `${PANDAS}tickers = pd.read_html("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")[0]\n`;
  const findings = evaluateResearchRules("research/universe.py", src, research);
  assert.deepEqual(ids(findings), ["survivorship-universe"]);
  assert.equal(findings[0].action, "warn");
});

test("applyEdits simulates the edit tool against the original content", () => {
  const original = "a = 1\nb = 2\nc = 3\n";
  const out = applyEdits(original, [
    { oldText: "c = 3", newText: "c = 30" },
    { oldText: "a = 1", newText: "a = 10" },
  ]);
  assert.equal(out, "a = 10\nb = 2\nc = 30\n");
});

test("bash: destructive patterns and writes to protected paths block, reads and normal commands pass", () => {
  assert.match(checkBashCommand("rm -rf /", config, CWD) ?? "", /denied pattern/);
  assert.match(checkBashCommand("git push --force origin main", config, CWD) ?? "", /denied pattern/);
  assert.equal(checkBashCommand("git push --force-with-lease origin main", config, CWD), null);
  assert.match(checkBashCommand("cp envs/beta2.env.example envs/beta2.env", config, CWD) ?? "", /protected path/);
  assert.match(checkBashCommand("echo KEY=1 > .env", config, CWD) ?? "", /protected path/);
  assert.match(checkBashCommand(`echo x >> ${CWD}/envs/live.env`, config, CWD) ?? "", /protected path/);
  assert.match(checkBashCommand("mv model.pkl models/prod/model.pkl", config, CWD) ?? "", /protected path/);
  assert.equal(checkBashCommand("cat .env", config, CWD), null);
  assert.equal(checkBashCommand("python3 -m pytest tests/ > test.log 2>&1", config, CWD), null);
  assert.equal(checkBashCommand("cp envs/beta2.env.example /tmp/example", config, CWD), null);
  assert.equal(checkBashCommand("docker compose --dry-run up -d --build", config, CWD), null);
});

test("repo-local rules merge tighten-only", () => {
  const merged = mergeLocalConfig(
    config,
    {
      denyBashPatterns: ["curl\\s+.*\\|\\s*sh"],
      protectedPaths: ["strategies/*/config.yaml"],
      allowWritesOutsideCwd: true,
      research: { paths: ["**/lab/**/*.py"], rules: [{ id: "backtest-without-costs", action: "block" }] },
    } as Partial<GuardrailsConfig>,
    "local",
  );
  assert.ok(merged.denyBashPatterns.includes("curl\\s+.*\\|\\s*sh"));
  assert.ok(merged.protectedPaths.includes("strategies/*/config.yaml"));
  assert.equal(merged.allowWritesOutsideCwd, false);
  assert.ok(merged.research.paths.includes("**/lab/**/*.py"));
  assert.equal(merged.research.rules.find((r) => r.id === "backtest-without-costs")?.action, "block");

  assert.throws(
    () => mergeLocalConfig(config, { research: { exclude: ["**/research/**"] } } as Partial<GuardrailsConfig>, "local"),
    /loosen/,
  );
  assert.throws(
    () =>
      mergeLocalConfig(
        config,
        { research: { rules: [{ id: "lookahead-shift", action: "warn" }] } } as Partial<GuardrailsConfig>,
        "local",
      ),
    /downgrades/,
  );
  assert.throws(
    () => mergeLocalConfig(config, { research: { rules: [{ id: "nope", action: "block" }] } } as Partial<GuardrailsConfig>, "local"),
    /unknown rule/,
  );
  const added = mergeLocalConfig(
    config,
    {
      research: {
        rules: [{ id: "no-yfinance", action: "warn", message: "yfinance is survivorship-biased", patterns: ["\\byfinance\\b"] }],
      },
    } as Partial<GuardrailsConfig>,
    "local",
  );
  assert.ok(added.research.rules.some((r) => r.id === "no-yfinance"));
});

test("invalid regexes in a rules file fail loudly", () => {
  assert.throws(() => parseConfig(JSON.stringify({ denyBashPatterns: ["("] }), "x"), /invalid regex/);
  assert.throws(
    () => parseConfig(JSON.stringify({ research: { rules: [{ id: "r", action: "block", message: "m", patterns: ["["] }] } }), "x"),
    /invalid regex/,
  );
});
