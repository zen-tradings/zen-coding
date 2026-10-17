/**
 * zen-coding models: register DigitalOcean GenAI Serverless Inference.
 *
 * DigitalOcean's GenAI platform exposes an OpenAI-compatible endpoint
 * (/chat/completions, Bearer auth) that serves many models behind one base URL
 * + Model Access Key. When configured, this becomes the default provider (see
 * .pi/settings.json); other providers (pi built-ins and zen-local) stay untouched.
 *
 * Configure via environment:
 *
 *   ZEN_DIGITALOCEAN_API_KEY          Model Access Key from the DO GenAI console (required)
 *   ZEN_DIGITALOCEAN_BASE_URL         optional, defaults to https://inference.do-ai.run/v1
 *   ZEN_DIGITALOCEAN_MODELS           optional manual model list ("id1,id2"); overrides discovery,
 *                                     also used as fallback if /models discovery fails
 *   ZEN_DIGITALOCEAN_REASONING_MODELS optional comma-separated ids overriding the baked-in
 *                                     default reasoning list (probed via scripts/check-do-reasoning.sh)
 *   ZEN_DIGITALOCEAN_CONTEXT_WINDOW   optional, defaults to 128000
 *   ZEN_DIGITALOCEAN_MAX_TOKENS       optional, defaults to 8192
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_BASE_URL = "https://inference.do-ai.run/v1";

// Reasoning-capable models on the DO endpoint, verified live with scripts/check-do-reasoning.sh
// probe. ZEN_DIGITALOCEAN_REASONING_MODELS overrides this whole list when set.
const DEFAULT_REASONING_MODELS = "anthropic-claude-4.5-sonnet,anthropic-claude-4.6-sonnet,anthropic-claude-5-sonnet,anthropic-claude-5.5-haiku,anthropic-claude-fable-5,anthropic-claude-fable-5.1,anthropic-claude-haiku-4.5,anthropic-claude-opus-4.5,anthropic-claude-opus-4.6,anthropic-claude-opus-4.8,anthropic-claude-opus-5,anthropic-claude-sonnet-5.5,arcee-trinity-large-thinking,deepseek-3.2,deepseek-4-flash,deepseek-v4-flash-0731,deepseek-v4-pro,deepseek-v4-pro-0813,deepseek-v4.1-flash,glm-5.2,glm-5.3,glm-5.3-flash,kimi-k2.6,kimi-k3,llama-4-maverick,mistral-3-14B,nemotron-3-nano-omni,nemotron-3-ultra-550b,nemotron-3.5-super-vl,openai-gpt-4.1,openai-gpt-4o,openai-gpt-5,openai-gpt-5-mini,openai-gpt-5.2,openai-gpt-5.3-codex,openai-gpt-5.4-mini,openai-gpt-5.4-nano,openai-gpt-5.4-pro,openai-gpt-5.5,openai-gpt-5.6-luna,openai-gpt-5.6-sol,openai-gpt-5.6-terra,openai-gpt-6-luna,openai-gpt-6-sol,openai-gpt-oss-120b,openai-gpt-oss-20b,openai-o1,openai-o3,openai-o3-mini,qwen3.5-397b-a17b,qwen3.8-max,router:general,router:knowledge-base-document,router:software-engineering";

// Non-chat models returned by the DO /models endpoint (embeddings, rerankers, image, audio, video).
// They cannot serve chat/completions requests, so they are filtered out of the /model list.
const NON_CHAT_PATTERNS = [
  "embedding",
  "rerank",
  "bge-",
  "e5-large",
  "gte-",
  "mini-lm",
  "mpnet",
  "image",
  "stable-diffusion",
  "tts",
  "diarization",
  "wan",
  "t2v",
  "i2v",
  "whisper",
]

function isNonChat(id: string): boolean {
  const lower = id.toLowerCase();
  return NON_CHAT_PATTERNS.some((pattern) => lower.includes(pattern));
}

interface ModelsResponse {
  data?: { id?: unknown }[];
}

function splitIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function discoverModelIds(baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const res = await fetch(`${cleanBase}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as ModelsResponse;
    const all = (body.data ?? [])
      .map((m) => (typeof m.id === "string" ? m.id : null))
      .filter((id): id is string => !!id);
    const chat = all.filter((id) => !isNonChat(id));
    console.error(
      `[zen-models-do] filtered ${all.length - chat.length} non-chat model(s) (embeddings/image/audio/video)`,
    );
    return chat;
  } catch (err) {
    console.error(
      `[zen-models-do] model discovery from ${baseUrl}/models failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

export default async function (pi: ExtensionAPI) {
  const apiKey = process.env.ZEN_DIGITALOCEAN_API_KEY;
  if (!apiKey) return;

  const baseUrl = process.env.ZEN_DIGITALOCEAN_BASE_URL ?? DEFAULT_BASE_URL;

  const manualIds = splitIds(process.env.ZEN_DIGITALOCEAN_MODELS);
  const modelIds = manualIds.length > 0 ? manualIds : await discoverModelIds(baseUrl, apiKey);
  if (modelIds.length === 0) {
    console.error(
      "[zen-models-do] no models available — set ZEN_DIGITALOCEAN_MODELS manually or " +
        "check the endpoint. digitalocean provider not registered.",
    );
    return;
  }

  // Reasoning-capable models come from the baked-in probed default;
  // the env var overrides the whole list when set.
  const reasoningIds = new Set(splitIds(process.env.ZEN_DIGITALOCEAN_REASONING_MODELS ?? DEFAULT_REASONING_MODELS));
  const contextWindow = Number(process.env.ZEN_DIGITALOCEAN_CONTEXT_WINDOW ?? 128000);
  const maxTokens = Number(process.env.ZEN_DIGITALOCEAN_MAX_TOKENS ?? 8192);

  pi.registerProvider("digitalocean", {
    baseUrl,
    apiKey,
    api: "openai-completions",
    // Real DO pricing varies per model; cost is tracked as 0 like zen-local.
    models: modelIds.map((id) => {
      const reasoning = reasoningIds.has(id);
      return {
        id,
        name: id,
        reasoning,
        input: ["text" as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
        compat: {
          supportsDeveloperRole: false,
          ...(reasoning ? { thinkingFormat: "deepseek" as const } : {}),
        },
      };
    }),
  });

  console.error(`[zen-models-do] registered digitalocean provider with ${modelIds.length} model(s) from ${baseUrl}`);
}