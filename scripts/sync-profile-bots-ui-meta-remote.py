#!/usr/bin/env python3
"""Apply BOTS department sections to gateway profile.yaml (stdin: JSON array)."""
import base64
import json
import os
import re
import sys
from pathlib import Path

DEPT_LABEL = {
    "knowledge": "Knowledge",
    "hr": "Human Resources",
    "engineering": "Engineering",
    "executive": "Executive",
    "sales": "Sales",
    "marketing": "Marketing",
    "customer-support": "Customer Support",
    "finance": "Finance",
    "operations": "Operations",
    "research": "Research",
    "policy": "Policy",
    "email": "Email",
    "media": "Media",
    "legal": "Legal",
    "compliance-risk": "Compliance & Risk",
    "procurement": "Procurement",
    "human-resources": "Human Resources",
}


def section(dept_id: str, fallback: str) -> tuple[str, str]:
    did = (dept_id or "").strip() or "unknown"
    return f"office-dept-{did}", DEPT_LABEL.get(did, fallback)


def yaml_scalar(v: str) -> str:
    v = str(v or "")
    if not v:
        return '""'
    if re.match(r"^[a-zA-Z0-9._-]+$", v):
        return v
    return json.dumps(v)


def merge_ui(text: str, block: str) -> str:
    lines = text.replace("\r\n", "\n").split("\n")
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
    return "\n".join(kept).rstrip() + "\n" + block + "\n"


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        print("no stdin", file=sys.stderr)
        sys.exit(1)
    entries = json.loads(raw)
    home = Path(os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes")))
    for e in entries:
        prof = e["profile"]
        p = home / "profiles" / prof / "profile.yaml"
        sid, sname = section(e["departmentId"], e["departmentName"])
        block = (
            "ui_meta:\n  hermes-bots:\n"
            f"    title: {yaml_scalar(e['name'])}\n"
            f"    sectionId: {yaml_scalar(sid)}\n"
            f"    sectionName: {yaml_scalar(sname)}\n"
            f"    officePlanId: {yaml_scalar(e['id'])}\n"
            "    officePlan: false\n"
        )
        desc = f"{e['name']} · {e['role']}"
        prior = (
            p.read_text(encoding="utf-8")
            if p.is_file()
            else f"description: {yaml_scalar(desc)}\ndescription_auto: false\n"
        )
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(merge_ui(prior, block), encoding="utf-8")
    print(f"OK {len(entries)} profile.yaml ui_meta")


if __name__ == "__main__":
    main()
