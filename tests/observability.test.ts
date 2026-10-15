import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSeed, detectSnapshot, detectUniverse, gitRevision } from "../.pi/extensions/observability.ts";

test("random seed is read from seed calls and keyword arguments", () => {
  assert.equal(detectSeed("np.random.seed(42)\nx = 1"), 42);
  assert.equal(detectSeed("rng = np.random.default_rng(7)"), 7);
  assert.equal(detectSeed("torch.manual_seed(1234)"), 1234);
  assert.equal(detectSeed("model = RandomForestRegressor(random_state=11)"), 11);
  assert.equal(detectSeed("def f(x):\n    return x + 1"), null);
});

test("data snapshot id is read from snapshot / as_of assignments", () => {
  assert.equal(detectSnapshot('snapshot = "2026-09-30"'), "2026-09-30");
  assert.equal(detectSnapshot("load(data_version='v3-clean')"), "v3-clean");
  assert.equal(detectSnapshot("as_of: '2026-01-01'"), "2026-01-01");
  assert.equal(detectSnapshot("x = 1"), null);
});

test("universe definition is captured from assignments and config lines", () => {
  assert.equal(detectUniverse('universe = ["SMH", "XLE", "XLI"]'), '["SMH", "XLE", "XLI"]');
  assert.equal(detectUniverse('UNIVERSE = "TOP3000"  # WorldQuant'), '"TOP3000"');
  assert.equal(detectUniverse("universe: SMH, XLE, XLI"), "SMH, XLE, XLI");
  assert.equal(detectUniverse("cfg.universe = load_universe()"), "load_universe()");
  assert.equal(detectUniverse("def rebalance(): pass"), null);
});

test("git revision reports a sha for a repo and null elsewhere", () => {
  const here = gitRevision(process.cwd());
  assert.ok(here === null || /^[0-9a-f]{12}(-dirty)?$/.test(here));
  assert.equal(gitRevision("/"), null);
});
