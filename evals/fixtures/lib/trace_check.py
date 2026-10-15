#!/usr/bin/env python3
"""Assertions over the zen trace of an eval attempt (JSONL in $ZEN_EVAL_TRACE_DIR).

Usage (from an eval assertion):
  python3 $ZEN_EVAL_LIB/trace_check.py forbid-bash REGEX        no bash call whose command matches
  python3 $ZEN_EVAL_LIB/trace_check.py require-event EVENT      at least one line with this event
  python3 $ZEN_EVAL_LIB/trace_check.py no-event EVENT           no line with this event
  python3 $ZEN_EVAL_LIB/trace_check.py no-guardrail-on REGEX    no guardrail line whose path matches
  python3 $ZEN_EVAL_LIB/trace_check.py research-field FIELD     last line's research[FIELD] is non-null
  python3 $ZEN_EVAL_LIB/trace_check.py research-null            every line has research == null
Exit 0 = assertion holds, 1 = violated, 2 = no trace found.
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys


def load_lines() -> list[dict]:
    trace_dir = os.environ.get("ZEN_EVAL_TRACE_DIR")
    if not trace_dir:
        print("ZEN_EVAL_TRACE_DIR not set")
        sys.exit(2)
    lines = []
    for path in sorted(glob.glob(os.path.join(trace_dir, "*.jsonl"))):
        with open(path) as fh:
            for raw in fh:
                raw = raw.strip()
                if raw:
                    lines.append(json.loads(raw))
    if not lines:
        print(f"no trace lines under {trace_dir}")
        sys.exit(2)
    return lines


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cmd, args = sys.argv[1], sys.argv[2:]
    lines = load_lines()
    if cmd == "forbid-bash":
        rx = re.compile(args[0])
        hits = [l for l in lines if l.get("event") == "tool_call_start" and l.get("toolName") == "bash"
                and isinstance(l.get("args"), dict) and rx.search(str(l["args"].get("command", "")))]
        for h in hits:
            print(f"forbidden bash command: {h['args'].get('command')}")
        print(f"{len(hits)} forbidden bash call(s)")
        return 1 if hits else 0
    if cmd == "require-event":
        n = sum(1 for l in lines if l.get("event") == args[0])
        print(f"{n} {args[0]} line(s)")
        return 0 if n else 1
    if cmd == "no-event":
        n = sum(1 for l in lines if l.get("event") == args[0])
        print(f"{n} {args[0]} line(s)")
        return 1 if n else 0
    if cmd == "no-guardrail-on":
        rx = re.compile(args[0])
        hits = [l for l in lines if l.get("event") == "guardrail" and rx.search(str(l.get("path") or ""))]
        for h in hits:
            print(f"guardrail fired on {h.get('path')}: {[f['rule'] for f in h.get('findings', [])]}")
        return 1 if hits else 0
    if cmd == "research-field":
        last = lines[-1].get("research") or {}
        value = last.get(args[0])
        print(f"research.{args[0]} = {value!r}")
        return 0 if value not in (None, "") else 1
    if cmd == "research-null":
        bad = [l for l in lines if l.get("research") is not None]
        print(f"{len(bad)} line(s) with a research context")
        return 1 if bad else 0
    print(f"unknown subcommand {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
