/**
 * Append git trailers to the agent's own `git commit` invocations.
 *
 * A small, quote-aware shell scanner finds unquoted `git [global opts] commit`
 * simple commands and rewrites them to
 *
 *   git [global opts] -c trailer.ifexists=addIfDifferent commit \
 *     --trailer=Langfuse-Session=<sid> --trailer=Zen-Work-Type=<type> ...
 *
 * Only the command that is executed changes; the tool-call arguments the model
 * wrote (and the plugin traces) stay as they were. The inserted text contains
 * no spaces or quotes, so it is valid in any shell context. `addIfDifferent`
 * keeps `--amend` from stacking duplicate trailers.
 *
 * Deliberately NOT rewritten: anything quoted (`bash -c '...'`, commit
 * messages), heredoc bodies (scripts being written to disk), `git commit-tree`,
 * git aliases, and commits made by scripts/programs the agent runs.
 */
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

interface Word {
  text: string;
  start: number;
  end: number;
  quoted: boolean;
}

/** Split a command into simple commands (lists of words), skipping heredoc bodies and comments. */
export function scanSimpleCommands(command: string): Word[][] {
  const n = command.length;
  const segments: Word[][] = [];
  let cur: Word[] = [];
  let word: Word | null = null;
  let pending: Array<{ delim: string; strip: boolean }> = [];
  let i = 0;

  const endWord = () => {
    if (word) cur.push(word);
    word = null;
  };
  const endSeg = () => {
    endWord();
    if (cur.length) segments.push(cur);
    cur = [];
  };
  const skipHeredocBodies = (from: number): number => {
    let pos = from;
    for (const { delim, strip } of pending) {
      while (pos < n) {
        const nl = command.indexOf("\n", pos);
        const lineEnd = nl < 0 ? n : nl;
        let line = command.slice(pos, lineEnd);
        if (strip) line = line.replace(/^\t+/, "");
        pos = nl < 0 ? n : nl + 1;
        if (line === delim) break;
      }
    }
    pending = [];
    return pos;
  };

  while (i < n) {
    const c = command[i];
    if (c === "\n") {
      endSeg();
      i = pending.length ? skipHeredocBodies(i + 1) : i + 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i++;
      continue;
    }
    if (c === "#" && !word) {
      while (i < n && command[i] !== "\n") i++;
      continue;
    }
    if (c === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      endWord();
      i += 2;
      let strip = false;
      if (command[i] === "-") {
        strip = true;
        i++;
      }
      while (command[i] === " " || command[i] === "\t") i++;
      let delim = "";
      while (i < n && !/[\s;&|<>()]/.test(command[i])) {
        const ch = command[i];
        if (ch === "'" || ch === '"') {
          const close = command.indexOf(ch, i + 1);
          const e = close < 0 ? n : close;
          delim += command.slice(i + 1, e);
          i = e + 1;
        } else if (ch === "\\") {
          delim += command[i + 1] ?? "";
          i += 2;
        } else {
          delim += ch;
          i++;
        }
      }
      if (delim) pending.push({ delim, strip });
      continue;
    }
    if (c === "$" && command[i + 1] === "(") {
      endSeg(); // command substitution: its contents are commands too
      i += 2;
      continue;
    }
    if (";&|()`{}".includes(c) && !((c === "{" || c === "}") && word)) {
      endSeg();
      i++;
      continue;
    }
    if (!word) word = { text: "", start: i, end: i, quoted: false };
    const w: Word = word;
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      const e = close < 0 ? n : close;
      w.text += command.slice(i + 1, e);
      w.quoted = true;
      i = e + 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && command[j] !== '"') {
        if (command[j] === "\\" && j + 1 < n) {
          w.text += command[j + 1];
          j += 2;
        } else {
          w.text += command[j];
          j++;
        }
      }
      w.quoted = true;
      i = j + 1;
    } else if (c === "\\") {
      w.text += command[i + 1] ?? "";
      i += 2;
    } else if (c === "$" && command[i + 1] === "{") {
      const close = command.indexOf("}", i);
      const e = close < 0 ? n : close + 1;
      w.text += command.slice(i, e);
      i = e;
    } else {
      w.text += c;
      i++;
    }
    w.end = Math.min(i, n);
  }
  endSeg();
  return segments;
}

const WRAPPERS = new Set(["command", "exec", "time", "nohup", "env", "builtin", "sudo"]);
const GIT_OPTS_WITH_ARG = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
const SAFE_VALUE = /^[A-Za-z0-9._:-]+$/;

export interface CommitRewrite {
  command: string;
  /** Number of `git commit` invocations rewritten. */
  commits: number;
  /** Absolute directories the command cds/-Cs into (commit lookup candidates). */
  dirs: string[];
}

function expandDir(base: string, dir: string): string {
  const d = dir === "~" ? homedir() : dir.startsWith("~/") ? homedir() + dir.slice(1) : dir;
  return isAbsolute(d) ? d : resolve(base, d);
}

export function rewriteGitCommits(
  command: string,
  opts: { trailers: Record<string, string>; cwd: string },
): CommitRewrite {
  const trailerArgs = Object.entries(opts.trailers)
    .filter(([k, v]) => SAFE_VALUE.test(k) && SAFE_VALUE.test(v))
    .map(([k, v]) => `--trailer=${k}=${v}`);
  const inserts: Array<{ pos: number; text: string }> = [];
  const dirs = new Set<string>();
  let curDir = opts.cwd;
  let commits = 0;

  for (const seg of scanSimpleCommands(command)) {
    let k = 0;
    while (k < seg.length && !seg[k].quoted && (/^[A-Za-z_]\w*=/.test(seg[k].text) || WRAPPERS.has(seg[k].text))) k++;
    const head = seg[k];
    if (!head) continue;
    if (head.text === "cd" && seg[k + 1] && !seg[k + 1].text.startsWith("-")) {
      curDir = expandDir(curDir, seg[k + 1].text);
      dirs.add(curDir);
      continue;
    }
    if (head.text !== "git" || head.quoted) continue;
    let j = k + 1;
    let gitDir = curDir;
    while (j < seg.length && seg[j].text.startsWith("-")) {
      if (seg[j].text === "-C" && seg[j + 1]) gitDir = expandDir(gitDir, seg[j + 1].text);
      j += GIT_OPTS_WITH_ARG.has(seg[j].text) ? 2 : 1;
    }
    const sub = seg[j];
    if (!sub || sub.quoted || sub.text !== "commit") continue;
    dirs.add(gitDir);
    if (!trailerArgs.length) continue;
    const rest = seg.slice(j + 1).map((w) => w.text);
    if (rest.some((t, idx) => /^--trailer=Langfuse-Session[=:]/.test(t) || (t === "--trailer" && /^Langfuse-Session[=:]/.test(rest[idx + 1] ?? "")))) {
      continue; // already carries our trailer
    }
    inserts.push({ pos: sub.start, text: "-c trailer.ifexists=addIfDifferent " });
    inserts.push({ pos: sub.end, text: ` ${trailerArgs.join(" ")}` });
    commits++;
  }

  let out = command;
  for (const { pos, text } of inserts.sort((a, b) => b.pos - a.pos)) out = out.slice(0, pos) + text + out.slice(pos);
  return { command: out, commits, dirs: [...dirs] };
}
