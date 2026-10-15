// Verifier for the dashboard-sortino-ratio case. Runs in the Strategy_Dashboard checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const m = await import(pathToFileURL(resolve("frontend/lib/strategy-metrics.ts")).href);
const { calculateRiskMetrics } = m;

const equityFrom = (returns) => returns.reduce((s, r) => [...s, s.at(-1) * (1 + r)], [100]);
const sortinoOf = (returns) => {
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downside = Math.sqrt(returns.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / (returns.length - 1));
  return (mean / downside) * Math.sqrt(252);
};

test("sortinoRatio exists alongside the unchanged fields", () => {
  const r = calculateRiskMetrics([100, 120, 90, 110, 88, 125]);
  assert.deepEqual(Object.keys(r).sort(), ["maxDrawdown", "sharpeRatio", "sortinoRatio"]);
  assert.ok(Math.abs(r.maxDrawdown - (88 / 120 - 1)) < 1e-10);
  assert.equal(r.sharpeRatio, null);
  assert.equal(r.sortinoRatio, null); // fewer than 20 returns
});

test("sortino uses downside deviation over all returns, annualized", () => {
  const returns = Array.from({ length: 30 }, (_, i) => (i % 2 ? -0.005 : 0.015));
  const r = calculateRiskMetrics(equityFrom(returns));
  assert.ok(Math.abs(r.sortinoRatio - sortinoOf(returns)) < 1e-9, `got ${r.sortinoRatio}, want ${sortinoOf(returns)}`);
  assert.ok(r.sortinoRatio > r.sharpeRatio, "sortino must exceed sharpe when upside dominates");
});

test("sortino on a skewed series matches the definition", () => {
  const returns = Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? -0.03 : 0.004));
  const r = calculateRiskMetrics(equityFrom(returns));
  assert.ok(Math.abs(r.sortinoRatio - sortinoOf(returns)) < 1e-9);
});

test("guards: no downside, too few returns, flat series", () => {
  assert.equal(calculateRiskMetrics(equityFrom(Array(30).fill(0.01))).sortinoRatio, null);
  assert.equal(calculateRiskMetrics(equityFrom(Array(10).fill(0.01))).sortinoRatio, null);
  assert.equal(calculateRiskMetrics(Array(25).fill(100)).sortinoRatio, null);
  assert.deepEqual(calculateRiskMetrics([]), { maxDrawdown: null, sharpeRatio: null, sortinoRatio: null });
});
