/**
 * zen-coding research tools.
 *
 * exa_search — neural web/code/paper search via the Exa API.
 * Requires EXA_API_KEY in the environment.
 *
 * GitHub access needs no custom tool for now: the agent uses the `gh` CLI
 * through the built-in bash tool. Proprietary data connectors get added
 * here as further tools.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const EXA_CATEGORIES = ["github", "research paper", "news", "company", "pdf"];

interface ExaResult {
  title?: string;
  url: string;
  publishedDate?: string;
  text?: string;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "exa_search",
    label: "Exa Search",
    description:
      "Neural web search via Exa; returns URLs with page excerpts. " +
      "Set category='github' to search code repositories, 'research paper' for papers.",
    promptSnippet: "exa_search: web/code/paper search via Exa",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      numResults: Type.Optional(
        Type.Number({ description: "Number of results (default 5)", minimum: 1, maximum: 10 }),
      ),
      category: Type.Optional(StringEnum(EXA_CATEGORIES)),
    }),
    async execute(_toolCallId, params, signal) {
      const apiKey = process.env.EXA_API_KEY;
      if (!apiKey) {
        throw new Error("exa_search unavailable: set EXA_API_KEY in the environment.");
      }

      const response = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          query: params.query,
          numResults: Math.min(params.numResults ?? 5, 10),
          ...(params.category ? { category: params.category } : {}),
          contents: { text: { maxCharacters: 1500 } },
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Exa API error ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as { results?: ExaResult[] };
      const results = data.results ?? [];
      const text =
        results.length === 0
          ? "No results."
          : results
              .map((r, i) =>
                [
                  `${i + 1}. ${r.title ?? r.url}`,
                  `   ${r.url}`,
                  r.publishedDate ? `   published: ${r.publishedDate}` : undefined,
                  r.text ? `   ${r.text.replaceAll("\n", " ").slice(0, 1200)}` : undefined,
                ]
                  .filter(Boolean)
                  .join("\n"),
              )
              .join("\n\n");

      return {
        content: [{ type: "text", text }],
        details: { count: results.length },
      };
    },
  });
}
