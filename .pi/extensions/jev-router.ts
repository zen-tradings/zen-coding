/**
 * Jev router - a virtual model that plans on a strong model and implements on a cheap one,
 * tuned for quant research & development.
 *
 * Registers `jev/auto`, which routes between three DigitalOcean GenAI models (see
 * zen-models-do.ts for provider registration):
 *
 * - Planning: a strong frontier model (default anthropic-claude-opus-5) for complex work, a
 *   mid-tier model (default glm-5.3) otherwise. The Jev classifier rates the first user message;
 *   planning stays on the chosen model.
 * - Implementation: a strong-but-cheap reasoner (default deepseek-v4-pro).
 *
 * Roles are overridable via ZEN_JEV_SOL / ZEN_JEV_TERRA / ZEN_JEV_LUNA (provider is always
 * digitalocean).
 *
 * The planning model explores, plans, and makes the first edit. After the first successful `edit`
 * or `write` tool call, the next request of the same turn goes to the implementation model, and
 * the session stays there. On a later substantial user message the complexity classifier re-rates
 * the work: demanding requests (quant backtests, subtle debugging, feature engineering) return to
 * the strong planner for that turn; short follow-ups ("continue", "fix the label") stay put to
 * avoid needless cache misses and classifier latency. Each turn therefore switches models at most
 * once, and only upward escalation is automatic — no churn back down.
 *
 * The phase is router state: Pi stores it on the session branch, so it follows the session tree
 * and survives compaction. The selected thinking level passes through and is clamped to the
 * chosen model's capabilities. Requests outside the agent loop, such as compaction summaries,
 * go to the implementation model.
 *
 * Requires ZEN_DIGITALOCEAN_API_KEY (digitalocean provider) and, for the complexity classifier,
 * TypeSafe credentials (TYPESAFE_API_KEY) — without them planning falls back to Terra.
 * Usage: pi -e ./jev-router.ts --model jev/auto
 */

import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ModelRoute, ModelRouteRequest } from "@earendil-works/pi-coding-agent";

const PROVIDER = "digitalocean";
// Quant-calibrated defaults: a frontier reasoner for hard planning, the usual default model for
// ordinary planning, and a strong-but-cheap reasoner for implementation, where most quant
// correctness risk lives (lookahead bugs, off-by-one lookbacks, data pipeline errors).
const SOL = process.env.ZEN_JEV_SOL ?? "anthropic-claude-opus-5";
const TERRA = process.env.ZEN_JEV_TERRA ?? "glm-5.3";
const LUNA = process.env.ZEN_JEV_LUNA ?? "deepseek-v4-pro";

/** User messages shorter than this are follow-ups; skip re-classification to protect the cache. */
const REESCALATE_MIN_CHARS = 120;

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

/** Planning model for a new session or an escalated turn: Sol for complex work, Terra otherwise
 *  or when Jev is unavailable. A previous model whose id matches either planning role is kept, so
 *  switching to jev/auto (or re-planning) costs no cache miss when it reuses that model. */
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
					instructions:
						"How demanding is the software engineering work requested in `prompt`? " +
						"Numerically or statistically delicate work counts as demanding.",
					criteria: {
						standard: "Ordinary features, fixes, reviews, or questions",
						complex:
							"Subtle design, cross-cutting changes, hard debugging, or correctness-sensitive " +
							"quantitative work: backtests, trading logic, feature engineering, statistics, " +
							"anything where lookahead, alignment, or off-by-one errors are plausible",
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
			// The planning model made the first edit: hand the rest of the work to the implementation
			// model.
			if (state.phase === "planning" && editedThisTurn(request.messages)) {
				return routeTo(request, ctx, LUNA, { phase: "implementation", model: LUNA });
			}
			// Escalation only: a substantial new user message during implementation gets re-rated, and
			// complex work returns to the strong planner for that turn. Simple follow-ups stay on the
			// implementation model; never churn back down mid-session.
			if (state.phase === "implementation" && request.reason === "user") {
				const text = lastUserText(request.messages);
				if (text.length >= REESCALATE_MIN_CHARS) {
					const model = await choosePlanningModel(request, ctx);
					if (model === SOL) return routeTo(request, ctx, SOL, { phase: "planning", model: SOL });
				}
			}
			return routeTo(request, ctx, state.model);
		},
	});
}
