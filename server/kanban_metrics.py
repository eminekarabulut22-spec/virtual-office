"""Hermes Kanban stats for plan agents (CLI on same host as office_server)."""

from __future__ import annotations

import json
import os
import subprocess
from typing import Any

WORK_TOKEN_STATUSES = frozenset({"done", "running", "review"})

# Avoid 3D/status flicker when `hermes kanban list` briefly fails on poll.
_live_overlay_cache: dict[str, tuple[str, str]] = {}


def _hermes_bin() -> str:
    return (
        os.environ.get("HERMES_BIN", "").strip()
        or os.path.expanduser("~/.local/bin/hermes")
    )


def assignee_keys_for_agent(agent_id: str, agent_name: str | None = None) -> set[str]:
    keys: set[str] = set()
    aid = agent_id.strip().lower()
    if aid:
        keys.add(aid)
        keys.add(f"office:{aid}")
        keys.add(f"office-{aid}")
    name = (agent_name or "").strip().lower()
    if name:
        keys.add(name)
    return keys


def _kanban_list() -> list[dict[str, Any]]:
    bin_path = _hermes_bin()
    if not os.path.isfile(bin_path):
        return []
    try:
        proc = subprocess.run(
            [bin_path, "kanban", "list", "--json"],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return []
        start = proc.stdout.find("[")
        if start < 0:
            return []
        data = json.loads(proc.stdout[start:])
        return data if isinstance(data, list) else []
    except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError):
        return []


def kanban_stats_for_agent(agent_id: str, agent_name: str, tasks: list[dict[str, Any]]) -> dict[str, Any]:
    keys = assignee_keys_for_agent(agent_id, agent_name)
    out = {"done": 0, "running": 0, "waiting": 0, "open": 0, "session_ids": []}
    session_ids: set[str] = set()
    open_statuses = {"running", "review", "blocked", "ready", "scheduled", "triage", "todo"}

    for t in tasks:
        assignee = str(t.get("assignee") or "").strip().lower()
        if not assignee or assignee not in keys:
            continue
        status = str(t.get("status") or "")
        if status == "done":
            out["done"] += 1
        elif status == "archived":
            continue
        elif status == "running":
            out["running"] += 1
        elif status in ("review", "blocked"):
            out["waiting"] += 1
        if status in open_statuses:
            out["open"] += 1
        if status in WORK_TOKEN_STATUSES:
            sid = str(t.get("session_id") or "").strip()
            if sid:
                session_ids.add(sid)

    out["session_ids"] = sorted(session_ids)
    return out


def _task_line_for_agent(agent_id: str, agent_name: str, tasks: list[dict[str, Any]]) -> str | None:
    keys = assignee_keys_for_agent(agent_id, agent_name)
    for t in tasks:
        assignee = str(t.get("assignee") or "").strip().lower()
        if assignee not in keys:
            continue
        if str(t.get("status") or "") == "running":
            title = str(t.get("title") or t.get("summary") or "").strip()
            if title:
                return title[:120]
    return None


def apply_kanban_live_overlay(plan: dict[str, Any]) -> dict[str, Any]:
    """Ephemeral status/doing from Kanban — does not write company-office.json."""
    from copy import deepcopy

    global _live_overlay_cache
    tasks = _kanban_list()
    if tasks:
        stats = kanban_stats_by_agent_id(plan)
        fresh: dict[str, tuple[str, str]] = {}
        for dept in plan.get("departments") or []:
            for agent in dept.get("agents") or []:
                aid = str(agent.get("id") or "")
                if not aid:
                    continue
                kb = stats.get(aid) or {}
                running = int(kb.get("running") or 0)
                waiting = int(kb.get("waiting") or 0)
                base_status = str(agent.get("status") or "idle")
                base_doing = str(agent.get("doing") or "")
                if running > 0:
                    st = "working"
                    line = _task_line_for_agent(aid, str(agent.get("name") or ""), tasks)
                    doing = line or base_doing
                elif waiting > 0 and base_status not in ("working", "problem"):
                    st = "waiting"
                    doing = base_doing
                else:
                    st = base_status
                    doing = base_doing
                fresh[aid] = (st, doing)
        _live_overlay_cache = fresh

    if not _live_overlay_cache:
        return plan

    out = deepcopy(plan)
    for dept in out.get("departments") or []:
        for agent in dept.get("agents") or []:
            aid = str(agent.get("id") or "")
            row = _live_overlay_cache.get(aid)
            if not row:
                continue
            agent["status"], agent["doing"] = row[0], row[1]
    return out


def kanban_stats_by_agent_id(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    tasks = _kanban_list()
    by_id: dict[str, dict[str, Any]] = {}
    for dept in plan.get("departments") or []:
        for agent in dept.get("agents") or []:
            aid = str(agent.get("id") or "").strip()
            if not aid:
                continue
            by_id[aid] = kanban_stats_for_agent(aid, str(agent.get("name") or ""), tasks)
    return by_id
