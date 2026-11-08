"""Read agent tokens / finished chats from Hermes profile state.db (same for every tenant install).

Configure once per deployment:
  KYAANI_HERMES_PROFILES_DIR  — directory containing `office-<agentId>/state.db`
  (optional) KYAANI_LAB_HOST + KYAANI_HERMES_REMOTE_PROFILES for SSH read on lab gateway
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

from plan import office_profile_name


def profiles_dir() -> Path | None:
    remote = os.environ.get("KYAANI_HERMES_REMOTE_PROFILES", "").strip()
    host = os.environ.get("KYAANI_LAB_HOST", "").strip()
    if host and remote:
        return None  # handled via SSH
    raw = os.environ.get("KYAANI_HERMES_PROFILES_DIR", "").strip()
    if raw:
        return Path(os.path.expanduser(raw))
    default = Path.home() / ".hermes" / "profiles"
    return default if default.is_dir() else None


def _read_db_file(db_path: Path) -> dict[str, Any]:
    """Match hermes-virtual-office profile-usage + jobs = successful model replies."""
    out = {"found": False, "tokens": 0, "chat_sessions_finished": 0}
    if not db_path.is_file():
        return out
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return out
    try:
        out["found"] = True
        tables = {
            r[0]
            for r in conn.execute(
                "select name from sqlite_master where type='table'"
            ).fetchall()
        }
        if "session_model_usage" in tables and "sessions" in tables:
            row = conn.execute(
                """
                SELECT COALESCE(SUM(COALESCE(smu.input_tokens, 0) + COALESCE(smu.output_tokens, 0)), 0)
                FROM session_model_usage smu
                INNER JOIN sessions s ON s.id = smu.session_id
                WHERE s.parent_session_id IS NULL
                  AND COALESCE(s.archived, 0) = 0
                """
            ).fetchone()
            out["tokens"] = int(row[0] or 0)
        elif "sessions" in tables:
            row = conn.execute(
                """
                SELECT COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)
                FROM sessions
                WHERE parent_session_id IS NULL
                  AND message_count >= 1
                  AND COALESCE(archived, 0) = 0
                """
            ).fetchone()
            out["tokens"] = int(row[0] or 0)
        elif "session_model_usage" in tables:
            row = conn.execute(
                """
                select coalesce(sum(input_tokens), 0) + coalesce(sum(output_tokens), 0)
                from session_model_usage
                """
            ).fetchone()
            out["tokens"] = int(row[0] or 0)

        if "session_model_usage" in tables and "sessions" in tables:
            row = conn.execute(
                """
                SELECT COALESCE(SUM(smu.api_call_count), 0)
                FROM session_model_usage smu
                INNER JOIN sessions s ON s.id = smu.session_id
                WHERE s.parent_session_id IS NULL
                  AND COALESCE(s.archived, 0) = 0
                  AND COALESCE(smu.output_tokens, 0) > 0
                """
            ).fetchone()
            out["chat_sessions_finished"] = int(row[0] or 0)
        elif "sessions" in tables:
            row = conn.execute(
                """
                SELECT COUNT(*)
                FROM sessions
                WHERE parent_session_id IS NULL
                  AND message_count >= 2
                  AND COALESCE(archived, 0) = 0
                """
            ).fetchone()
            out["chat_sessions_finished"] = int(row[0] or 0)
    except sqlite3.Error:
        return {"found": False, "tokens": 0, "chat_sessions_finished": 0}
    finally:
        conn.close()
    return out


def _ssh_run_python(host: str, script: str, *, timeout: int = 30) -> dict[str, Any] | None:
    """Run a Python script on host via stdin (multiline `-c` breaks over ssh)."""
    try:
        proc = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, "python3"],
            input=script,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return None
        data = json.loads(proc.stdout.strip().splitlines()[-1])
        return data if isinstance(data, dict) else None
    except (subprocess.TimeoutExpired, OSError, ValueError, json.JSONDecodeError):
        return None


def _read_via_ssh(profile: str) -> dict[str, Any]:
    host = os.environ.get("KYAANI_LAB_HOST", "").strip()
    remote_root = os.environ.get("KYAANI_HERMES_REMOTE_PROFILES", "").strip()
    if not host or not remote_root:
        return {"found": False, "tokens": 0, "chat_sessions_finished": 0}
    db = f"{remote_root.rstrip('/')}/{profile}/state.db"
    script = (
        "import sqlite3, json\n"
        f"db={db!r}\n"
        "out={'found':False,'tokens':0,'chat_sessions_finished':0}\n"
        "try:\n"
        "  c=sqlite3.connect('file:'+db+'?mode=ro', uri=True)\n"
        "  out['found']=True\n"
        "  cols={r[1] for r in c.execute('pragma table_info(messages)')}\n"
        "  tables={r[0] for r in c.execute(\"select name from sqlite_master where type='table'\")}\n"
        "  if 'session_model_usage' in tables:\n"
        "    out['tokens']=int(c.execute('select coalesce(sum(input_tokens),0)+coalesce(sum(output_tokens),0) from session_model_usage').fetchone()[0] or 0)\n"
        "  elif 'total_tokens' in cols:\n"
        "    out['tokens']=int(c.execute('select coalesce(sum(total_tokens),0) from messages').fetchone()[0] or 0)\n"
        "  elif 'prompt_tokens' in cols and 'completion_tokens' in cols:\n"
        "    out['tokens']=int(c.execute('select coalesce(sum(prompt_tokens),0)+coalesce(sum(completion_tokens),0) from messages').fetchone()[0] or 0)\n"
        "  if 'session_id' in cols:\n"
        "    out['chat_sessions_finished']=int(c.execute(\"select count(*) from (select session_id from messages group by session_id having sum(case when role='user' then 1 else 0 end)>=1 and sum(case when role='assistant' then 1 else 0 end)>=1)\").fetchone()[0] or 0)\n"
        "  c.close()\n"
        "except Exception:\n"
        "  out={'found':False,'tokens':0,'chat_sessions_finished':0}\n"
        "print(json.dumps(out))\n"
    )
    data = _ssh_run_python(host, script, timeout=25)
    if not data:
        return {"found": False, "tokens": 0, "chat_sessions_finished": 0}
    return {
        "found": bool(data.get("found")),
        "tokens": int(data.get("tokens") or 0),
        "chat_sessions_finished": int(data.get("chat_sessions_finished") or 0),
    }


def _tokens_for_session_ids_db(db_path: Path, session_ids: list[str]) -> int:
    ids = [s.strip() for s in session_ids if s and s.strip()]
    if not ids or not db_path.is_file():
        return 0
    placeholders = ",".join("?" for _ in ids)
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        row = conn.execute(
            f"""
            SELECT COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)
            FROM session_model_usage
            WHERE session_id IN ({placeholders})
            """,
            ids,
        ).fetchone()
        conn.close()
        return int(row[0] or 0)
    except sqlite3.Error:
        return 0


def _tokens_for_session_ids_remote(profile: str, session_ids: list[str]) -> int:
    host = os.environ.get("KYAANI_LAB_HOST", "").strip()
    if not host:
        return 0
    ids = [s.strip() for s in session_ids if s and s.strip()]
    if not ids:
        return 0
    remote_home = (
        os.environ.get("KYAANI_HERMES_REMOTE_HOME", "").strip()
        or os.environ.get("KYAANI_HERMES_REMOTE_PROFILES", "").strip()
        or "~/.hermes"
    )
    db = f"{remote_home.rstrip('/')}/profiles/{profile}/state.db"
    ids_json = json.dumps(ids)
    script = (
        "import json,sqlite3,os\n"
        f"db=os.path.expanduser({db!r})\n"
        f"ids=json.loads({ids_json!r})\n"
        "total=0\n"
        "try:\n"
        " c=sqlite3.connect(f'file:{db}?mode=ro',uri=True)\n"
        " ph=','.join('?'*len(ids))\n"
        " row=c.execute(\n"
        "  'SELECT COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) "
        "FROM session_model_usage WHERE session_id IN ('+ph+')', ids).fetchone()\n"
        " total=int(row[0] or 0)\n"
        " c.close()\n"
        "except Exception:\n"
        " pass\n"
        "print(json.dumps({'tokens':total}))\n"
    )
    data = _ssh_run_python(host, script, timeout=25)
    if not data:
        return 0
    return int(data.get("tokens") or 0)


def tokens_for_session_ids(profile: str, session_ids: list[str]) -> int:
    """Sum session_model_usage tokens for Kanban worker sessions (local + lab gateway)."""
    ids = [s.strip() for s in session_ids if s and s.strip()]
    if not ids:
        return 0
    local = 0
    root = profiles_dir()
    if root:
        local = _tokens_for_session_ids_db(root / profile / "state.db", ids)
    remote = _tokens_for_session_ids_remote(profile, ids)
    return max(local, remote)


def _read_remote_home_profile(profile: str) -> dict[str, Any]:
    """Gateway BOTS state on lab host (e.g. /home/emine/.hermes/profiles/office-sarah)."""
    host = os.environ.get("KYAANI_LAB_HOST", "").strip()
    if not host:
        return {"found": False, "tokens": 0, "chat_sessions_finished": 0}
    remote_home = (
        os.environ.get("KYAANI_HERMES_REMOTE_HOME", "").strip()
        or os.environ.get("KYAANI_HERMES_REMOTE_PROFILES", "").strip()
    )
    if not remote_home:
        remote_home = "~/.hermes"
    db = f"{remote_home.rstrip('/')}/profiles/{profile}/state.db"
    script = (
        "import json,sqlite3,os\n"
        f"db=os.path.expanduser({db!r})\n"
        "out={'found':False,'tokens':0,'chat_sessions_finished':0}\n"
        "try:\n"
        " c=sqlite3.connect(f'file:{db}?mode=ro',uri=True)\n"
        " out['found']=True\n"
        " row=c.execute(\"SELECT COALESCE(SUM(COALESCE(smu.input_tokens,0)+COALESCE(smu.output_tokens,0)),0) "
        "FROM session_model_usage smu INNER JOIN sessions s ON s.id=smu.session_id "
        "WHERE s.parent_session_id IS NULL AND COALESCE(s.archived,0)=0\").fetchone()\n"
        " out['tokens']=int(row[0] or 0)\n"
        " row=c.execute(\"SELECT COALESCE(SUM(smu.api_call_count),0) FROM session_model_usage smu "
        "INNER JOIN sessions s ON s.id=smu.session_id WHERE s.parent_session_id IS NULL "
        "AND COALESCE(s.archived,0)=0 AND COALESCE(smu.output_tokens,0)>0\").fetchone()\n"
        " out['chat_sessions_finished']=int(row[0] or 0)\n"
        " c.close()\n"
        "except Exception:\n"
        " pass\n"
        "print(json.dumps(out))\n"
    )
    data = _ssh_run_python(host, script, timeout=30)
    if not data:
        return {"found": False, "tokens": 0, "chat_sessions_finished": 0}
    return {
        "found": bool(data.get("found")),
        "tokens": int(data.get("tokens") or 0),
        "chat_sessions_finished": int(data.get("chat_sessions_finished") or 0),
    }


def profile_metrics(agent_id: str) -> dict[str, Any]:
    profile = office_profile_name(agent_id)
    if os.environ.get("KYAANI_LAB_HOST", "").strip() and os.environ.get(
        "KYAANI_HERMES_REMOTE_PROFILES", ""
    ).strip():
        legacy = _read_via_ssh(profile)
        if legacy.get("found"):
            return legacy
    root = profiles_dir()
    local = (
        _read_db_file(root / profile / "state.db")
        if root
        else {"found": False, "tokens": 0, "chat_sessions_finished": 0}
    )
    remote = _read_remote_home_profile(profile)
    if remote.get("found"):
        return {
            "found": True,
            "tokens": max(int(local.get("tokens") or 0), int(remote.get("tokens") or 0)),
            "chat_sessions_finished": max(
                int(local.get("chat_sessions_finished") or 0),
                int(remote.get("chat_sessions_finished") or 0),
            ),
        }
    return local
