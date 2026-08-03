/**
 * Best-effort conversion between the agent's markdown and Slack mrkdwn,
 * plus normalization of Slack's message encoding into plain text prompts.
 */

/** Markdown → Slack mrkdwn. Fenced code blocks pass through untouched. */
export function toMrkdwn(markdown: string): string {
  const segments = markdown.split(/(```[\s\S]*?(?:```|$))/);
  return segments
    .map((segment, i) => {
      if (i % 2 === 1) return segment; // inside a fenced code block
      return segment
        .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
        .replace(/\*\*(.+?)\*\*/g, "*$1*")
        .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "<$2|$1>");
    })
    .join("");
}

/**
 * Slack event text → plain prompt text: unwrap <url|label> links, drop
 * user mentions (the bot's own @-mention included), unescape entities.
 */
export function slackTextToPlain(text: string): string {
  return text
    .replace(/<(https?:[^>|]+)\|[^>]*>/g, "$1")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Split long text into Slack-sized chunks, preferring paragraph boundaries. */
export function chunkForSlack(text: string, limit = 3800): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks.length > 0 ? chunks : [text];
}
