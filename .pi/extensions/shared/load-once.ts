/**
 * Load-once guard for zen extensions.
 *
 * zen-coding can be loaded twice in one session: as project extensions (pi run
 * inside a zen-coding checkout) and as a globally installed pi package
 * (`pi install git:github.com/zen-tradings/zen-coding`). pi identifies those by
 * path, so both copies load — `/zen` splits into `/zen:1` / `/zen:2`, bash
 * commands are rewritten twice, traces are written twice.
 *
 * Each extension calls `claimExtension(pi, name)` first and returns early when
 * another copy already claimed `name`. The claim lives on the session's shared
 * extension event bus (not a process global), so it is scoped to one extension
 * runtime: separate sessions in one process and `/reload` each start fresh.
 * The first copy loaded wins; pi loads project extensions before packages, so
 * inside a zen-coding checkout the working-tree code is the one that runs.
 *
 * This directory has no index.ts, so pi does not load it as an extension.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROBE_CHANNEL = "zen:extension-probe";

interface Probe {
  name: string;
  loaded: boolean;
}

/** True if this copy should load; false if another copy of `name` already loaded. */
export function claimExtension(pi: ExtensionAPI, name: string): boolean {
  if (!pi.events) return true; // fail open (e.g. test doubles without an event bus)
  const probe: Probe = { name, loaded: false };
  // EventEmitter dispatch is synchronous, so an earlier copy's responder has
  // already set `loaded` when emit returns.
  pi.events.emit(PROBE_CHANNEL, probe);
  if (probe.loaded) return false;
  pi.events.on(PROBE_CHANNEL, (data) => {
    const p = data as Probe | undefined;
    if (p && p.name === name) p.loaded = true;
  });
  return true;
}
