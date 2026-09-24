/**
 * Shared secret redaction for zen-coding: used by the observability extension
 * (JSONL traces) and the Slack backend (thread status lines) so the same
 * secrets never reach either surface.
 *
 * Intent: over-redaction is acceptable, leaks are not.
 */

export const SECRET_KEY_RE =
  /^(?:[a-z0-9_-]*[_-])?(?:tokens?|secrets?|passwords?|passwd|api[_-]?keys?|access[_-]?keys?|private[_-]?keys?|authorization|credentials?|cookies?)$/i;

export const SECRET_VALUE_RE =
  /(sk[_-][A-Za-z0-9_-]{16,}|(?:xox[bpare]|xapp)-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth-limited]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const text = value.replace(SECRET_VALUE_RE, "[redacted]");
    // Redact everything after key= or key: to end of line; values are
    // untrusted after all (over-redaction in traces is acceptable).
    // Lookbehind (not \b) so underscore-prefixed keys (MY_SECRET=) match.
    return text.replace(
      /(?<![A-Za-z0-9])((?:tokens?|secrets?|passwords?|passwd|api[_-]?keys?|access[_-]?keys?|private[_-]?keys?|authorization|credentials?|cookies?)\s*[:=]\s*).*/gi,
      "$1[redacted]",
    );
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    // Leave non-plain objects (Date, Buffer, class instances) intact.
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Normalize camelCase humps (botToken -> bot_token) before matching so
      // camelCase keys are covered, not just snake/kebab ones.
      const norm = k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      out[k] = SECRET_KEY_RE.test(norm) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
