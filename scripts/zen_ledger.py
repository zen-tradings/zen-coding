"""zen-coding backtest ledger helper (stdlib only).

Backtest entry points call record() once per run. When the run happens inside
a zen-coding agent session (ZEN_SESSION_ID is set in every agent bash call) it
appends one JSONL line to ~/.zen/ledger/<ZEN_SESSION_ID>.jsonl (override:
ZEN_LEDGER_DIR); zen-coding turns the ledger into the Langfuse session score
process.variants_tried. Outside agent sessions it does nothing.

One-line hook for an entry point (zen-coding exports ZEN_LEDGER_PY too):

    import os, runpy; os.environ.get("ZEN_LEDGER_PY") and runpy.run_path(os.environ["ZEN_LEDGER_PY"])["record"](configs=[...], seeds=...)

variant_hash = sha256(script + git HEAD + uncommitted-diff hash + config
contents + CLI args), EXCLUDING seeds. Seeds are recorded separately so
re-running one variant under many seeds (best-seed picking) is visible.

Never raises: a ledger problem must not break a backtest.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SEED_FLAGS = ("--seed", "--seeds", "--random-seed", "--random_seed", "--random-state",
              "--random_state", "--rng-seed", "--rng_seed")
CONFIG_FLAGS = ("--config", "-c", "--cfg", "--params")
MAX_HASH_BYTES = 50 * 1024 * 1024  # larger untracked files hash by path+size+mtime
SCHEMA_VERSION = 1


def _git(cwd: Path, *args: str) -> bytes | None:
    try:
        r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, timeout=20)
        return r.stdout if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _file_hash(path: Path) -> str:
    try:
        st = path.stat()
        if st.st_size > MAX_HASH_BYTES:
            return f"large:{st.st_size}:{int(st.st_mtime)}"
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return "missing"


def _code_state(script: Path) -> dict:
    """git HEAD + hash of the uncommitted diff (tracked changes + untracked files)."""
    top_raw = _git(script.parent, "rev-parse", "--show-toplevel")
    if not top_raw:
        return {"repo": None, "git_head": None, "diff_hash": None, "script_hash": _file_hash(script)}
    top = Path(top_raw.decode().strip())
    head = (_git(top, "rev-parse", "HEAD") or b"").decode().strip() or None
    h = hashlib.sha256()
    h.update(_git(top, "diff", "HEAD", "--binary") or b"")
    for rel in sorted((_git(top, "ls-files", "--others", "--exclude-standard", "-z") or b"").split(b"\0")):
        if rel:
            h.update(b"\0untracked\0" + rel + b"\0" + _file_hash(top / rel.decode(errors="replace")).encode())
    return {"repo": str(top), "git_head": head, "diff_hash": h.hexdigest(), "script_hash": _file_hash(script)}


def _split_args(argv: list[str]) -> tuple[list[str], list[str], list[str]]:
    """-> (args without seed flags, seed values, config paths found in args)."""
    args: list[str] = []
    seeds: list[str] = []
    configs: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        flag, eq, val = a.partition("=")
        if flag in SEED_FLAGS:
            if eq:
                seeds.append(val)
            elif i + 1 < len(argv):
                seeds.append(argv[i + 1])
                i += 1
        elif flag in CONFIG_FLAGS:
            path = val if eq else (argv[i + 1] if i + 1 < len(argv) else "")
            if not eq:
                i += 1
            configs.append(path)
            args.append(f"{flag}=@config")  # contents are hashed, not the path
        else:
            args.append(a)
        i += 1
    return args, seeds, configs


def record(configs=(), seeds=None, args=None, script=None) -> str | None:
    """Append one ledger record for this backtest run; returns the variant hash."""
    try:
        session_id = os.environ.get("ZEN_SESSION_ID", "").strip()
        if not session_id or not re.fullmatch(r"[\w.-]+", session_id):
            return None
        argv = list(sys.argv[1:] if args is None else args)
        script_path = Path(script or sys.argv[0] or "<stdin>").resolve()
        clean_args, argv_seeds, argv_configs = _split_args(argv)
        state = _code_state(script_path)
        repo = Path(state["repo"]) if state["repo"] else script_path.parent
        config_paths = list(dict.fromkeys([*map(str, configs), *argv_configs]))
        config_hashes = {}
        for c in config_paths:
            p = Path(c)
            p = p if p.is_absolute() else Path.cwd() / p
            config_hashes[os.path.relpath(p.resolve(), repo)] = _file_hash(p)
        try:
            script_rel = os.path.relpath(script_path, repo)
        except ValueError:
            script_rel = str(script_path)
        if seeds is None:
            seeds = argv_seeds or None
        variant = {
            "script": script_rel,
            "script_hash": state["script_hash"] if not state["git_head"] else None,
            "git_head": state["git_head"],
            "diff_hash": state["diff_hash"],
            "configs": dict(sorted(config_hashes.items())),
            "args": clean_args,
        }
        variant_hash = hashlib.sha256(json.dumps(variant, sort_keys=True).encode()).hexdigest()
        rec = {
            "v": SCHEMA_VERSION,
            "ts": datetime.now(timezone.utc).isoformat(),
            "session_id": session_id,
            "source": "helper",
            "variant_hash": variant_hash,
            "seeds": seeds,
            "repo": state["repo"],
            "cwd": os.getcwd(),
            **variant,
        }
        ledger_dir = Path(os.environ.get("ZEN_LEDGER_DIR") or Path.home() / ".zen" / "ledger")
        ledger_dir.mkdir(parents=True, exist_ok=True)
        with open(ledger_dir / f"{session_id}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, default=str) + "\n")
        return variant_hash
    except Exception as exc:  # never break the backtest
        print(f"[zen-ledger] not recorded: {exc}", file=sys.stderr)
        return None


if __name__ == "__main__":
    # Manual/testing use: python3 zen_ledger.py [args...] records a run for "this" script.
    print(record() or "skipped (ZEN_SESSION_ID unset)")
