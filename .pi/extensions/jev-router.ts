/**
 * Jev router - a virtual model that plans on a strong model and implements on a cheap one.
 *
 * Registers `jev/auto`, which routes between three DigitalOcean GenAI models (see
 * zen-models-do.ts for provider registration):
 *
 * - Planning: Sol for complex work, Terra otherwise. The Jev classifier rates the first user
 *   message; planning stays on the chosen model.
 * - Implementation: Luna.
 *
 * Defaults are the DO-hosted OpenAI 5.6 trio; each role can be pointed at any DigitalOcean model
 * via ZEN_JEV_SOL / ZEN_JEV_TERRA / ZEN_JEV_LUNA (provider is always digitalocean).
 *
 * The planning model explores, plans, and makes the first edit. After the first successful `edit`
 * or `write` tool call, the next request of the same turn goes to Luna, and the session stays
 * there. A session therefore switches models once and accepts a single prompt-cache miss.
 *
 * The phase is router state: Pi stores it on the session branch, so it follows the session tree
 * and survives compaction. The selected thinking level passes through and is clamped to the
 * chosen model's capabilities. Requests outside the agent loop, such as compaction summaries,
 * go to Luna.
 *
 * Requires ZEN_DIGITALOCEAN_API_KEY (digitalocean provider) and, for the complexity classifier,
 * TypeSafe credentials (TYPESAFE_API_KEY) — without them planning falls back to Terra.
 * Usage: pi -e ./jev-router.ts --model jev/auto
 */

import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ModelRoute, ModelRouteRequest } from "@earendil-works/pi-coding-agent";

const PROVIDER = "digitalocean";
const SOL = process.env.ZEN_JEV_SOL ?? "openai-gpt-5.6-sol";
const TERRA = process.env.ZEN_JEV_TERRA ?? "openai-gpt-5.6-terra";
const LUNA = process.env.ZEN_JEV_LUNA ?? "openai-gpt-5.6-luna";

/** Tools whose successful result means implementation has started. */
const EDIT_TOOLS = new Set(["edit", "write"]);

interface JevState {
	phase: "planning" | "implementation";
	/** OpenAI Codex model for this phase. */
	model: string;
}

type JevRequest = ModelRouteRequest<JevState>;

function routeTo(request: JevRequest, ctx: ExtensionContext, id: string, state?: JevState): ModelRoute<JevState> {
	const model = ctx.modelRegistry.find(PROVIDER, id);
	if (!model) {
		throw new Error(
			`Model ${PROVIDER}/${id} is not in the catalog. ` +
				"Is ZEN_DIGITALOCEAN_API_KEY set (zen-models-do.ts registered the provider)?",
		);
	}
	return { model, thinkingLevel: request.thinkingLevel, state };
}

function lastUserText(messages: readonly Message[]): string {
	const content = messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
	if (typeof content === "string") return content;
	return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

/** Whether a tool call since the last user message edited a file successfully. */
function editedThisTurn(messages: readonly Message[]): boolean {
	let lastUser = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			lastUser = i;
			break;
		}
	}
	return messages
		.slice(lastUser + 1)
		.some((message) => message.role === "toolResult" && EDIT_TOOLS.has(message.toolName) && !message.isError);
}

/** Planning model for a new session: Sol for complex work, Terra otherwise or when Jev is unavailable.
 *  A previous model on the digitalocean provider whose id matches either planning role is kept. */
async function choosePlanningModel(request: JevRequest, ctx: ExtensionContext): Promise<string> {
	// Keep a planning model the session already uses, so switching to jev/auto costs no cache miss.
	const previous = request.previous?.model;
	if (previous?.provider === PROVIDER && (previous.id === SOL || previous.id === TERRA)) return previous.id;

	const jev = ctx.modelRegistry.findOfType("classifier", "typesafe", "jev-latest");
	if (!jev) return TERRA;
	const result = await ctx.modelRegistry.classify(
		jev,
		{
			state: { prompt: lastUserText(request.messages).slice(0, 16_000) },
			questions: {
				complexity: {
					type: "choice",
					instructions: "How demanding is the software engineering work requested in `prompt`?",
					criteria: {
						standard: "Ordinary features, fixes, reviews, or questions",
						complex: "Subtle design, cross-cutting changes, or hard debugging",
					},
				},
			},
		},
		{ signal: request.signal },
	);
	const answer = result.stopReason === "stop" ? result.answers.complexity : undefined;
	return answer?.type === "choice" && (answer.probabilities.complex ?? 0) >= 0.5 ? SOL : TERRA;
}

export default function (pi: ExtensionAPI) {
	pi.registerVirtualModel<JevState>({
		provider: "jev",
		id: "auto",
		name: "Auto (Jev)",
		thinkingLevels: ["low", "medium", "high", "xhigh"],
		// Shared by all three models; shown before the first response. Kept in sync with the
		// digitalocean provider's declared limits (zen-models-do.ts).
		contextWindow: Number(process.env.ZEN_DIGITALOCEAN_CONTEXT_WINDOW ?? 128_000),
		maxTokens: Number(process.env.ZEN_DIGITALOCEAN_MAX_TOKENS ?? 8_192),
		async route(request, ctx) {
			if (request.reason === "direct") return routeTo(request, ctx, LUNA);
			const state = request.state;
			if (!state) {
				const model = await choosePlanningModel(request, ctx);
				return routeTo(request, ctx, model, { phase: "planning", model });
			}
			// The planning model made the first edit: hand the rest of the work to Luna.
			if (state.phase === "planning" && editedThisTurn(request.messages)) {
				return routeTo(request, ctx, LUNA, { phase: "implementation", model: LUNA });
			}
			return routeTo(request, ctx, state.model);
		},
	});
}
