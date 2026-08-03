/**
 * Per-thread repo checkouts. A GitHub link in the first message of a thread
 * pins that thread to a clone under the workspaces directory; follow-up
 * messages in the same thread reuse the checkout.
 *
 * Private repos: set GITHUB_TOKEN (or GH_TOKEN). The token is passed per
 * git invocation via http.extraheader — it is never stored in .git/config.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface RepoRef {
  url: string;
  owner: string;
  name: string;
  branch?: string;
}

/** Find a GitHub repo reference in message text (Slack URL wrapping already stripped). */
export function parseRepoRef(text: string): RepoRef | undefined {
  const match = text.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)(?:\/tree\/([^\s|>]+))?/);
  if (!match) return undefined;
  const owner = match[1];
  const name = match[2].replace(/\.git$/, "");
  return {
    url: `https://github.com/${owner}/${name}.git`,
    owner,
    name,
    branch: match[3],
  };
}

function gitAuthArgs(): string[] {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

/** Clone the repo into checkoutDir (or fast-forward an existing checkout). */
export async function ensureWorkspace(
  ref: RepoRef,
  checkoutDir: string,
  cloneDepth: number,
): Promise<void> {
  if (existsSync(join(checkoutDir, ".git"))) {
    try {
      await run("git", [...gitAuthArgs(), "-C", checkoutDir, "pull", "--ff-only"], {
        timeout: 120_000,
      });
    } catch {
      // Dirty tree or diverged history: keep the checkout as the agent left it.
    }
    return;
  }

  mkdirSync(dirname(checkoutDir), { recursive: true });
  const args = [...gitAuthArgs(), "clone"];
  if (cloneDepth > 0) args.push("--depth", String(cloneDepth));
  if (ref.branch) args.push("--branch", ref.branch);
  args.push(ref.url, checkoutDir);
  await run("git", args, { timeout: 600_000 });
}
