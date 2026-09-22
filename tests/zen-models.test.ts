import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import zenModels from "../.pi/extensions/zen-models.ts";

const originalCap = process.env.ZEN_OPENROUTER_MAX_TOKENS;
afterEach(() => {
  if (originalCap === undefined) delete process.env.ZEN_OPENROUTER_MAX_TOKENS;
  else process.env.ZEN_OPENROUTER_MAX_TOKENS = originalCap;
});

function request(maxTokens: number, provider = "openrouter", cap?: string, modelMaxTokens = maxTokens) {
  if (cap === undefined) delete process.env.ZEN_OPENROUTER_MAX_TOKENS;
  else process.env.ZEN_OPENROUTER_MAX_TOKENS = cap;

  let handler: ((event: { payload: unknown }, ctx: { model: { provider: string; maxTokens: number } }) => unknown) | undefined;
  zenModels({
    on(event: string, callback: typeof handler) {
      if (event === "before_provider_request") handler = callback;
    },
  } as unknown as ExtensionAPI);
  assert.ok(handler);

  const payload = { max_tokens: maxTokens, messages: [] };
  const ctx = { model: { provider, maxTokens: modelMaxTokens } };
  return { first: handler({ payload }, ctx) ?? payload, second: handler({ payload }, ctx) ?? payload, payload };
}

test("caps every OpenRouter request at 12288", () => {
  const { first, second } = request(16000);
  assert.deepEqual(first, { max_tokens: 12288, messages: [] });
  assert.deepEqual(second, first);
});

test("preserves lower OpenRouter model limits", () => {
  assert.equal((request(16000, "openrouter", undefined, 4096).first as { max_tokens: number }).max_tokens, 4096);
});

test("accepts a custom OpenRouter cap", () => {
  assert.equal((request(16000, "openrouter", "8192").first as { max_tokens: number }).max_tokens, 8192);
});

test("leaves other providers unchanged", () => {
  const { first, payload } = request(16000, "deepseek");
  assert.equal(first, payload);
});

test("invalid caps fall back to 12288", () => {
  for (const cap of ["0", "-1", "1.5", "1e4", "garbage", "Infinity", "9007199254740992"]) {
    assert.equal((request(16000, "openrouter", cap).first as { max_tokens: number }).max_tokens, 12288);
  }
});
