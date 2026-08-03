/**
 * Streams one agent run into a single Slack message via throttled chat.update
 * edits, then finalizes with the full (chunked) response.
 *
 * Edit cadence stays under Slack's chat.update rate limits; edits only fire
 * when the rendered text actually changed.
 */
import type { WebClient } from "@slack/web-api";
import { chunkForSlack, toMrkdwn } from "./markdown";

const EDIT_INTERVAL_MS = 1500;
const PREVIEW_LIMIT = 3600;

export class ThreadStreamer {
  private completed = "";
  private partial = "";
  private status = "";
  private errorNote = "";
  private ts?: string;
  private rendered = "";
  private lastEdit = 0;
  private timer?: NodeJS.Timeout;
  private done = false;

  constructor(
    private readonly client: WebClient,
    private readonly channel: string,
    private readonly threadTs: string | undefined,
  ) {}

  /** Post the placeholder message this run will keep editing. */
  async start(initialText = "⏳ _working…_"): Promise<void> {
    const res = await this.client.chat.postMessage({
      channel: this.channel,
      thread_ts: this.threadTs,
      text: initialText,
    });
    this.ts = res.ts as string;
    this.lastEdit = Date.now();
  }

  appendDelta(delta: string): void {
    this.partial += delta;
    this.schedule();
  }

  /** An assistant message finished; prefer its authoritative text over deltas. */
  completeMessage(fullText: string, errorMessage?: string): void {
    const text = (fullText || this.partial).trim();
    if (text) this.completed += (this.completed ? "\n\n" : "") + text;
    if (errorMessage) this.errorNote = errorMessage;
    this.partial = "";
    this.schedule();
  }

  setStatus(status: string): void {
    this.status = status;
    this.schedule();
  }

  /** Replace the streamed preview with the final chunked response. */
  async finalize(extraNote?: string): Promise<void> {
    this.done = true;
    if (this.timer) clearTimeout(this.timer);
    if (!this.ts) return;

    let body = toMrkdwn((this.completed + (this.partial ? `\n\n${this.partial}` : "")).trim());
    const note = extraNote ?? (this.errorNote ? `⚠️ ${this.errorNote}` : undefined);
    if (!body) body = note ?? "✅ _done (no reply text)_";
    else if (note) body += `\n\n${note}`;

    const chunks = chunkForSlack(body);
    try {
      await this.client.chat.update({ channel: this.channel, ts: this.ts, text: chunks[0] });
      for (const chunk of chunks.slice(1)) {
        await this.client.chat.postMessage({
          channel: this.channel,
          thread_ts: this.threadTs,
          text: chunk,
        });
      }
    } catch (err) {
      console.error("[zen-slack] failed to finalize reply:", err);
    }
  }

  private schedule(): void {
    if (this.done || this.timer || !this.ts) return;
    const wait = Math.max(0, EDIT_INTERVAL_MS - (Date.now() - this.lastEdit));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, wait);
  }

  private async flush(): Promise<void> {
    if (this.done || !this.ts) return;
    const text = this.renderPreview();
    if (text === this.rendered) return;
    this.rendered = text;
    this.lastEdit = Date.now();
    try {
      await this.client.chat.update({ channel: this.channel, ts: this.ts, text });
    } catch {
      // Rate-limited or transient; the next flush retries with fresh content.
    }
  }

  private renderPreview(): string {
    let body = toMrkdwn(
      (this.completed + (this.partial ? (this.completed ? "\n\n" : "") + this.partial : "")).trim(),
    );
    if (body.length > PREVIEW_LIMIT) body = `…${body.slice(-PREVIEW_LIMIT)}`;
    const statusLine = this.status ? `⚙️ _${this.status}_` : "⏳ _working…_";
    return body ? `${body}\n\n${statusLine}` : statusLine;
  }
}
