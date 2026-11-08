"""On-disk state for plan, jobs, profiles, metrics."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

PLAN_PATH = DATA / "company-office.json"
JOBS_PATH = DATA / "office-update-jobs.json"
GATEWAY_PROFILES_PATH = DATA / "gateway-profiles.json"
LOCAL_PROFILES_PATH = DATA / "local-profiles.json"
METRICS_PATH = DATA / "agent-metrics.json"

_lock = threading.Lock()


def _ensure_data() -> None:
    DATA.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default: Any) -> Any:
    _ensure_data()
    if not path.is_file():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    _ensure_data()
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)


def read_plan() -> dict[str, Any] | None:
    with _lock:
        raw = read_json(PLAN_PATH, None)
    return raw if isinstance(raw, dict) else None


def write_plan(plan: dict[str, Any]) -> None:
    with _lock:
        write_json(PLAN_PATH, plan)


def read_jobs() -> dict[str, Any]:
    with _lock:
        raw = read_json(JOBS_PATH, {})
    return raw if isinstance(raw, dict) else {}


def write_jobs(jobs: dict[str, Any]) -> None:
    with _lock:
        write_json(JOBS_PATH, jobs)


def read_metrics() -> dict[str, Any]:
    with _lock:
        raw = read_json(METRICS_PATH, {})
    return raw if isinstance(raw, dict) else {}


def write_metrics(data: dict[str, Any]) -> None:
    with _lock:
        write_json(METRICS_PATH, data)


def _metrics_row_from(data: dict[str, Any], agent_id: str) -> dict[str, int]:
    row = data.get(agent_id)
    if not isinstance(row, dict):
        row = {"tokens": 0, "chat_sessions_finished": 0, "kanban_done": 0}
    return {
        "tokens": int(row.get("tokens") or 0),
        "chat_sessions_finished": int(row.get("chat_sessions_finished") or 0),
        "kanban_done": int(row.get("kanban_done") or 0),
    }


def agent_metrics_row(agent_id: str) -> dict[str, int]:
    return _metrics_row_from(read_metrics(), agent_id)


def add_tokens(agent_id: str, delta: int) -> None:
    with _lock:
        data = read_json(METRICS_PATH, {})
        if not isinstance(data, dict):
            data = {}
        row = _metrics_row_from(data, agent_id)
        row["tokens"] = row["tokens"] + max(0, delta)
        data[agent_id] = row
        write_json(METRICS_PATH, data)


def finish_chat_job(agent_id: str, tokens_delta: int) -> None:
    """One finished chat (user + assistant) → +1 work completed for this agent."""
    with _lock:
        data = read_json(METRICS_PATH, {})
        if not isinstance(data, dict):
            data = {}
        row = _metrics_row_from(data, agent_id)
        row["tokens"] = row["tokens"] + max(0, tokens_delta)
        row["chat_sessions_finished"] = row["chat_sessions_finished"] + 1
        data[agent_id] = row
        write_json(METRICS_PATH, data)
