#!/usr/bin/env python3
"""Verifier for deploy-dry-run: deploy-plan.json must be derived from docker-compose.yml and the checkout."""
import json
import os
import sys

import yaml

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


with open("docker-compose.yml") as fh:
    compose = yaml.safe_load(fh)
with open("deploy-plan.json") as fh:
    plan = json.load(fh)

services = {s["name"]: s for s in plan.get("services", [])}
check(set(services) == set(compose["services"]), f"services {sorted(services)} != compose {sorted(compose['services'])}")
for name, svc in compose["services"].items():
    p = services.get(name)
    if not p:
        continue
    build = svc.get("build", {})
    check(p.get("dockerfile") == build.get("dockerfile"), f"{name}: dockerfile {p.get('dockerfile')!r} != {build.get('dockerfile')!r}")
    arg = (build.get("args") or {}).get("STRATEGY")
    check(p.get("build_arg_strategy") == arg, f"{name}: build_arg_strategy {p.get('build_arg_strategy')!r} != {arg!r}")
    check(p.get("env_file") == svc.get("env_file"), f"{name}: env_file {p.get('env_file')!r} != {svc.get('env_file')!r}")
    present = os.path.exists(svc["env_file"])
    check(p.get("env_file_present") is present, f"{name}: env_file_present {p.get('env_file_present')!r}, file exists: {present}")
    state = [v for v in svc.get("volumes", []) if isinstance(v, str) and v.startswith(f"./state/{name}")]
    check(bool(state) and str(p.get("state_volume", "")).startswith(f"./state/{name}"),
          f"{name}: state_volume {p.get('state_volume')!r} should be the ./state/{name} mount")

script = plan.get("deploy_script") or {}
steps = " ".join(str(s) for s in script.get("steps", []))
check(script.get("path") == "deploy.sh", f"deploy_script.path {script.get('path')!r}")
check("git pull" in steps, "deploy_script.steps must include the git pull step")
check("docker compose up" in steps, "deploy_script.steps must include the docker compose up step")

blockers = " ".join(str(b) for b in plan.get("blockers", []))
for name, svc in compose["services"].items():
    if not os.path.exists(svc["env_file"]):
        check(svc["env_file"] in blockers or os.path.basename(svc["env_file"]) in blockers,
              f"missing {svc['env_file']} must be listed in blockers")

for f in fails:
    print("FAIL:", f)
print(f"{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
