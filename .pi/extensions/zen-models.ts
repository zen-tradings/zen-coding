/**
 * zen-coding models: register self-hosted open-source model endpoints.
 *
 * Hosted open-source providers (DeepSeek, Groq, Fireworks, Together, OpenRouter,
 * Kimi, Qwen, ZAI/GLM, MiniMax, Hugging Face, ...) are built into pi — export the
 * provider's API key (e.g. DEEPSEEK_API_KEY) and pick a model with /model.
 *
 * This extension covers self-hosted OpenAI-compatible servers (vLLM, SGLang,
 * Ollama, LM Studio, llama.cpp). Configure via environment:
 *
 *   ZEN_LOCAL_BASE_URL        e.g. http://localhost:8000/v1 (vLLM) or http://localhost:11434/v1 (Ollama)
 *   ZEN_LOCAL_MODELS          comma-separated model ids, e.g. "qwen3-coder-30b,deepseek-r1:32b"
 *   ZEN_LOCAL_API_KEY         optional; keyless local servers ignore it (defaults to "local")
 *   ZEN_LOCAL_CONTEXT_WINDOW  optional, defaults to 128000
 *   ZEN_LOCAL_MAX_TOKENS      optional, defaults to 8192
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const baseUrl = process.env.ZEN_LOCAL_BASE_URL;
  if (!baseUrl) return;

  const modelIds = (process.env.ZEN_LOCAL_MODELS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (modelIds.length === 0) return;

  pi.registerProvider("zen-local", {
    baseUrl,
    apiKey: process.env.ZEN_LOCAL_API_KEY ?? "local",
    api: "openai-completions",
    models: modelIds.map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: Number(process.env.ZEN_LOCAL_CONTEXT_WINDOW ?? 128000),
      maxTokens: Number(process.env.ZEN_LOCAL_MAX_TOKENS ?? 8192),
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
    })),
  });
}
