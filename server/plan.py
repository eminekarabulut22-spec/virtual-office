"""Company office plan — parse, sort, Qwen instruction (stdlib only)."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

WORK_STATUSES = ("working", "waiting", "problem", "idle", "offline")

PLAN_SCHEMA = """
Return ONE JSON object only (no markdown):
{
  "company": "string",
  "note": "optional one-line summary of what you changed",
  "departments": [
    {
      "id": "lowercase-slug",
      "name": "English department name",
      "agents": [
        {
          "id": "lowercase-slug",
          "name": "First name",
          "role": "short role title",
          "status": "working|waiting|problem|idle|offline",
          "doing": "one short English sentence",
          "model": "openai/vllm/company-ai-local"
        }
      ]
    }
  ]
}
Keep every existing agent unless the user removes them. Merge updates into the full plan.
If the user asks to add agents or departments, you MUST add them with new lowercase ids.
Never reply with an unchanged plan when the user requested structural changes.
"""


def plan_agent_index(plan: dict[str, Any]) -> dict[str, tuple[str, dict[str, Any]]]:
    """agent id -> (department id, agent dict)."""
    out: dict[str, tuple[str, dict[str, Any]]] = {}
    for dept in plan.get("departments") or []:
        did = str(dept.get("id") or "")
        for agent in dept.get("agents") or []:
            aid = str(agent.get("id") or "").strip()
            if aid:
                out[aid] = (did, agent)
    return out


def plans_same_structure(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return plan_agent_index(a).keys() == plan_agent_index(b).keys()


def plans_materially_changed(a: dict[str, Any], b: dict[str, Any]) -> bool:
    if str(a.get("company") or "") != str(b.get("company") or ""):
        return True
    idx_a = plan_agent_index(a)
    idx_b = plan_agent_index(b)
    if idx_a.keys() != idx_b.keys():
        return True
    for aid, (dept_a, ag_a) in idx_a.items():
        dept_b, ag_b = idx_b[aid]
        if dept_a != dept_b:
            return True
        for key in ("name", "role", "status", "doing", "model"):
            if str(ag_a.get(key) or "") != str(ag_b.get(key) or ""):
                return True
    return False


def shrink_user_for_budget(user: str, max_len: int) -> str:
    if len(user) <= max_len:
        return user
    if max_len < 120:
        return user[:max_len]
    head = max_len // 2 - 30
    tail = max_len - head - 50
    return f"{user[:head].rstrip()}\n…\n{user[-tail:].lstrip()}"


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def department_display_name(dept_id: str, name: str) -> str:
    return (name or dept_id).strip()


def sorted_departments(plan: dict[str, Any]) -> list[dict[str, Any]]:
    depts = []
    for d in plan.get("departments") or []:
        agents = sorted(d.get("agents") or [], key=lambda a: (a.get("name") or "").lower())
        depts.append({**d, "agents": agents})
    depts.sort(
        key=lambda d: (
            department_display_name(d.get("id", ""), d.get("name", "")).lower(),
            (d.get("id") or "").lower(),
        )
    )
    return depts


def normalize_plan(raw: dict[str, Any]) -> dict[str, Any]:
    company = str(raw.get("company") or "Company").strip() or "Company"
    note = raw.get("note")
    departments = sorted_departments({"departments": raw.get("departments") or []})
    out: dict[str, Any] = {
        "company": company,
        "departments": departments,
        "updatedAt": _utc_now(),
    }
    if isinstance(note, str) and note.strip():
        out["note"] = note.strip()
    return out


def parse_plan(raw: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(raw, dict):
        return None, "Plan must be a JSON object."
    if not raw.get("departments"):
        return None, "Plan must include at least one department."
    for dept in raw["departments"]:
        if not isinstance(dept, dict) or not dept.get("id") or not dept.get("name"):
            return None, "Each department needs id and name."
        for agent in dept.get("agents") or []:
            if not isinstance(agent, dict) or not agent.get("id") or not agent.get("name"):
                return None, "Each agent needs id and name."
            st = str(agent.get("status") or "idle").lower()
            if st not in WORK_STATUSES:
                agent["status"] = "idle"
            agent.setdefault("role", "Agent")
            agent.setdefault("doing", "Standing by.")
            agent.setdefault("model", "openai/vllm/company-ai-local")
    return normalize_plan(raw), None


def extract_json(text: str) -> Any:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("No JSON object in model reply.")
    return json.loads(text[start : end + 1])


def revision_snapshot(plan: dict[str, Any], compact: int = 0) -> str:
    if compact >= 3:
        minimal: dict[str, Any] = {
            "company": plan.get("company"),
            "departments": [],
        }
        for dept in plan.get("departments") or []:
            minimal["departments"].append(
                {
                    "id": dept.get("id"),
                    "name": dept.get("name"),
                    "agents": [
                        {
                            "id": a.get("id"),
                            "name": a.get("name"),
                            "role": a.get("role"),
                            "status": a.get("status"),
                            "model": a.get("model", "openai/vllm/company-ai-local"),
                        }
                        for a in dept.get("agents") or []
                    ],
                }
            )
        return json.dumps(minimal, ensure_ascii=False)

    slim = deepcopy(plan)
    doing_cap = 8 if compact >= 2 else 24 if compact >= 1 else 80
    for dept in slim.get("departments") or []:
        for agent in dept.get("agents") or []:
            agent["doing"] = str(agent.get("doing", ""))[:doing_cap]
    slim.pop("updatedAt", None)
    slim.pop("note", None)
    return json.dumps(slim, ensure_ascii=False)


# Chat gateway (8790) rejects user messages over 4000 chars — keep instruction under this.
PLAN_WRITER_CHAR_BUDGET = 3_900


def compose_instruction(prompt: str, current: dict[str, Any] | None, *, compact: int = 0) -> str:
    budget = " Max 6 words per doing." if compact >= 2 else ""
    schema = PLAN_SCHEMA if compact < 3 else (
        "Return ONE JSON object: company, note, departments[{id,name,agents[{id,name,role,status,doing,model}]}]. "
        "Merge updates; keep existing agents unless removed.\n"
    )
    if not current:
        return f"{schema}{budget}\n\nUser request:\n{prompt.strip()}"
    snap = revision_snapshot(current, compact=compact)
    return (
        f"{schema}{budget}\n\nCurrent office plan:\n{snap}\n\n"
        f"Apply this update and return the full revised plan:\n{prompt.strip()}"
    )


def compose_instruction_fitted(prompt: str, current: dict[str, Any] | None) -> tuple[str, str | None]:
    """Shrink snapshot (then user text) until the lab chat-gateway accepts the payload (~4k chars)."""
    user = prompt.strip()
    if not user:
        return "", "Update prompt is empty."
    compact = 1 if current and len(user) > 600 else 0
    instruction = compose_instruction(user, current, compact=compact)
    while len(instruction) > PLAN_WRITER_CHAR_BUDGET and compact < 3:
        compact += 1
        instruction = compose_instruction(user, current, compact=compact)
    if len(instruction) <= PLAN_WRITER_CHAR_BUDGET:
        return instruction, None
    overhead = len(compose_instruction("", current, compact=3)) if current else len(PLAN_SCHEMA) + 80
    user_budget = max(240, PLAN_WRITER_CHAR_BUDGET - overhead)
    trimmed = shrink_user_for_budget(user, user_budget)
    instruction = compose_instruction(trimmed, current, compact=3)
    if len(instruction) <= PLAN_WRITER_CHAR_BUDGET:
        return instruction, None
    return instruction, (
        f"Update text + office plan exceed the chat gateway limit ({PLAN_WRITER_CHAR_BUDGET} chars). "
        "Shorten your prompt or remove duplicate instructions."
    )


def office_profile_name(agent_id: str) -> str:
    return f"office-{agent_id.strip()}"


def section_meta(dept_id: str, dept_name: str) -> dict[str, str]:
    return {
        "sectionId": f"office-dept-{dept_id}",
        "sectionName": department_display_name(dept_id, dept_name).upper(),
    }


def list_plan_bots(plan: dict[str, Any]) -> list[dict[str, Any]]:
    bots: list[dict[str, Any]] = []
    for dept in sorted_departments(plan):
        sec = section_meta(dept["id"], dept["name"])
        for agent in dept.get("agents") or []:
            bots.append(
                {
                    "id": agent["id"],
                    "name": agent["name"],
                    "role": agent.get("role", ""),
                    "departmentId": dept["id"],
                    "department": department_display_name(dept["id"], dept["name"]),
                    "sectionId": sec["sectionId"],
                    "sectionName": sec["sectionName"],
                    "status": agent.get("status", "idle"),
                    "doing": agent.get("doing", ""),
                    "model": agent.get("model", ""),
                    "profile": office_profile_name(agent["id"]),
                }
            )
    return bots


def agent_count(plan: dict[str, Any]) -> int:
    return sum(len(d.get("agents") or []) for d in plan.get("departments") or [])

