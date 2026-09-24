/**
 * Per-thread repo checkouts. A GitHub link in the first message of a thread
 * pins that thread to a clone under the workspaces directory; follow-up
 * messages in the same thread reuse the checkout.
 *
 * Private repos: set GITHUB_TOKEN (or GH_TOKEN). The token is passed per
 * git invocation via http.extraheader — it is never stored in .git/config.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
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
  const match = text.match(
    /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=\/|$|[^\w.-])/i,
  );
  if (!match) return undefined;
  const owner = match[1];
  const name = match[2].replace(/\.git$/, "").replace(/\.+$/, "");
  if (!name) return undefined;
  const rest = text.slice(match.index! + match[0].length);
  const branchMatch = rest.match(/^\/(tree|blob)\/([^\s|>?#]+)/i);
  let branch = branchMatch?.[2]?.replace(/[.,;:!?()\[\]'"`*\\/]+$/u, "");
  // blob URLs are /blob/<branch>/<file path>: use only the branch segment.
  if (branch && branchMatch?.[1].toLowerCase() === "blob") branch = branch.split("/")[0];
  return {
    url: `https://github.com/${owner}/${name}.git`,
    owner,
    name,
    branch: branch || undefined,
  };
}

function gitAuthArgs(): string[] {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

/** Clone the repo into checkoutDir (or fast-forward an existing checkout).
 * Returns a status message if a branch-pinned clone fell back to the default
 * branch (mis-parsed /tree/<branch>/<path> URL), else undefined. */
export async function ensureWorkspace(
  ref: RepoRef,
  checkoutDir: string,
  cloneDepth: number,
): Promise<string | undefined> {
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

  const preExisted = existsSync(checkoutDir);
  mkdirSync(dirname(checkoutDir), { recursive: true });
  const args = [...gitAuthArgs(), "clone"];
  if (cloneDepth > 0) args.push("--depth", String(cloneDepth));
  if (ref.branch) args.push("--branch", ref.branch);
  args.push(ref.url, checkoutDir);
  try {
    await run("git", args, { timeout: 600_000 });
    return;
  } catch (err) {
    // /tree/<branch>/<path> URLs are ambiguous: the captured "branch" may
    // include a subdirectory. Retry on the default branch only when git
    // explicitly reports the branch as missing — never on network/auth
    // failures, which would silently switch the user to the wrong branch.
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (!ref.branch || !/remote branch .+ not found/i.test(stderr)) throw err;
    // git removes the destination itself on a failed branch clone; clean up
    // only leftovers we created, never a pre-existing directory.
    if (!preExisted) rmSync(checkoutDir, { recursive: true, force: true });
    const retry = [...gitAuthArgs(), "clone"];
    if (cloneDepth > 0) retry.push("--depth", String(cloneDepth));
    retry.push(ref.url, checkoutDir);
    await run("git", retry, { timeout: 600_000 });
    return `branch ${ref.branch} not found — cloned default branch`;
  }
}
