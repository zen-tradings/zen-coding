/**
 * Optional Braintrust tracing for SDK-driven (Slack backend) sessions.
 *
 * Interactive TUI sessions are traced by the @braintrust/pi-extension package;
 * SDK sessions need the module wrapped with braintrust's wrapPiCodingAgentSDK().
 * Opt-in: tracing activates only when TRACE_TO_BRAINTRUST=true and
 * BRAINTRUST_API_KEY are set, so the `braintrust` package is never imported
 * (and no spans are emitted) otherwise.
 *
 * Env:
 *   TRACE_TO_BRAINTRUST=true   enable tracing
 *   BRAINTRUST_API_KEY=...     Braintrust API key
 *   BRAINTRUST_PROJECT=...     project name (default: "zen-coding")
 */
import type * as PiModule from "@earendil-works/pi-coding-agent";

type Pi = typeof PiModule;

let wrapped: Pi | null = null;

export async function maybeWrapPiForTracing(pi: Pi): Promise<Pi> {
  if (process.env.TRACE_TO_BRAINTRUST !== "true" || !process.env.BRAINTRUST_API_KEY) {
    return pi;
  }
  if (wrapped) return wrapped;

  const bt = await import("braintrust");
  bt.initLogger({
    projectName: process.env.BRAINTRUST_PROJECT ?? "zen-coding",
    apiKey: process.env.BRAINTRUST_API_KEY,
  });
  wrapped = bt.wrapPiCodingAgentSDK(pi) as Pi;
  console.log(`[zen-slack] Braintrust tracing enabled (project: ${process.env.BRAINTRUST_PROJECT ?? "zen-coding"})`);
  return wrapped;
}

/** Flush pending spans — call during graceful shutdown. */
export async function flushTracing(): Promise<void> {
  if (!wrapped) return;
  const bt = await import("braintrust");
  await bt.flush();
}
