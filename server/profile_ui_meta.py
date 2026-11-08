"""BOTS sidebar sections — write ui_meta into Hermes profile.yaml (matches 3D plan)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from plan import section_meta


def yaml_scalar(value: str) -> str:
    v = str(value or "")
    if not v:
        return '""'
    if re.match(r"^[a-zA-Z0-9._-]+$", v):
        return v
    return json.dumps(v, ensure_ascii=False)


def build_ui_meta_block(agent: dict[str, Any], dept_id: str, dept_name: str) -> str:
    sec = section_meta(dept_id, dept_name)
    name = str(agent.get("name") or agent.get("id") or "")
    aid = str(agent.get("id") or "")
    role = str(agent.get("role") or "Agent")
    return (
        "ui_meta:\n"
        "  hermes-bots:\n"
        f"    title: {yaml_scalar(name)}\n"
        f"    sectionId: {yaml_scalar(sec['sectionId'])}\n"
        f"    sectionName: {yaml_scalar(sec['sectionName'])}\n"
        f"    officePlanId: {yaml_scalar(aid)}\n"
        "    officePlan: false\n"
    )


def merge_profile_yaml_ui_meta(existing: str, ui_block: str) -> str:
    lines = existing.replace("\r\n", "\n").split("\n")
    kept: list[str] = []
    in_ui = False
    for line in lines:
        if re.match(r"^ui_meta:\s*$", line):
            in_ui = True
            continue
        if in_ui:
            if re.match(r"^[A-Za-z_][\w-]*:\s*", line):
                in_ui = False
            else:
                continue
        kept.append(line)
    while kept and not kept[-1].strip():
        kept.pop()
    body = "\n".join(kept).rstrip()
    if body:
        return f"{body}\n{ui_block}"
    return ui_block


def write_local_profile_bots_ui_meta(
    hermes_home: Path,
    profile: str,
    agent: dict[str, Any],
    dept_id: str,
    dept_name: str,
) -> None:
    prof_dir = hermes_home / "profiles" / profile
    prof_dir.mkdir(parents=True, exist_ok=True)
    path = prof_dir / "profile.yaml"
    desc = f"{agent.get('name', '')} · {agent.get('role', '')}".strip(" ·")[:200]
    prior = ""
    if path.is_file():
        prior = path.read_text(encoding="utf-8")
    elif not prior:
        prior = f"description: {yaml_scalar(desc)}\ndescription_auto: false\n"
    block = build_ui_meta_block(agent, dept_id, dept_name)
    path.write_text(merge_profile_yaml_ui_meta(prior, block), encoding="utf-8")


def ui_meta_payload_entries(plan: dict[str, Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for dept in plan.get("departments") or []:
        did = str(dept.get("id") or "")
        dname = str(dept.get("name") or did)
        for agent in dept.get("agents") or []:
            aid = str(agent.get("id") or "").strip()
            if not aid:
                continue
            out.append(
                {
                    "profile": f"office-{aid}",
                    "name": str(agent.get("name") or aid),
                    "role": str(agent.get("role") or "Agent"),
                    "id": aid,
                    "departmentId": did,
                    "departmentName": dname,
                }
            )
    return out
