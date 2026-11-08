"""Office plan → Hermes profiles + BOTS roster (local + lab gateway)."""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from plan import list_plan_bots, sorted_departments
from profile_ui_meta import ui_meta_payload_entries, write_local_profile_bots_ui_meta

from store import GATEWAY_PROFILES_PATH, LOCAL_PROFILES_PATH, ROOT, write_json

SCRIPTS = ROOT / "scripts"
REMOTE_UI_META_SCRIPT = SCRIPTS / "sync-profile-bots-ui-meta-remote.py"


def sync_profiles_from_plan(plan: dict[str, Any]) -> dict[str, Any]:
    bots = list_plan_bots(plan)
    gateway = {
        "updatedAt": plan.get("updatedAt"),
        "company": plan.get("company"),
        "profiles": [
            {
                "name": b["profile"],
                "agentId": b["id"],
                "displayName": b["name"],
                "model": b.get("model"),
                "ui_meta": {
                    "hermes-bots": {
                        "sectionId": b["sectionId"],
                        "sectionName": b["sectionName"],
                        "officePlanId": b["id"],
                    }
                },
            }
            for b in bots
        ],
    }
    local = {
        "updatedAt": plan.get("updatedAt"),
        "hermesHome": str(_hermes_home()),
        "profiles": [b["profile"] for b in bots],
    }
    write_json(GATEWAY_PROFILES_PATH, gateway)
    write_json(LOCAL_PROFILES_PATH, local)

    roster = sync_office_roster_from_plan(plan)
    _notify_hermes_bots_refresh()
    return {
        "gatewayWritten": len(gateway["profiles"]),
        "localManifestWritten": len(local["profiles"]),
        **roster,
    }


def sync_office_roster_from_plan(plan: dict[str, Any]) -> dict[str, Any]:
    """Create/update/delete office-* profiles so BOTS matches company-office.json."""
    keep = {f"office-{a['id']}" for dept in plan.get("departments") or [] for a in dept.get("agents") or [] if a.get("id")}
    created: list[str] = []
    existing: list[str] = []
    removed: list[str] = []
    created_remote: list[str] = []
    existing_remote: list[str] = []
    removed_remote: list[str] = []
    failed: list[dict[str, str]] = []

    for dept in sorted_departments(plan):
        for agent in dept.get("agents") or []:
            profile = f"office-{str(agent.get('id') or '').strip().lower()}"
            if not profile or profile == "office-":
                continue
            desc = f"{agent.get('name', '')} · {agent.get('role', '')}".strip(" ·")[:200]
            _ensure_one_profile(profile, desc, created, existing, failed, agent)
            write_local_profile_bots_ui_meta(
                _hermes_home(), profile, agent, str(dept.get("id") or ""), str(dept.get("name") or "")
            )
            if _lab_host():
                _ensure_one_profile_remote(profile, desc, created_remote, existing_remote, failed, agent)

    for name in _list_local_profiles():
        if not name.startswith("office-") or name in keep:
            continue
        if _delete_local_profile(name):
            removed.append(name)
        else:
            failed.append({"profile": name, "error": "local delete failed", "scope": "local"})

    if _lab_host():
        for name in _list_remote_profiles():
            if not name.startswith("office-") or name in keep:
                continue
            if _delete_remote_profile(name):
                removed_remote.append(name)
            else:
                failed.append({"profile": name, "error": "remote delete failed", "scope": "remote"})
        _sync_remote_ui_meta(plan, failed)

    return {
        "localHermes": f"+{len(created)} ~{len(existing)} -{len(removed)}",
        "remote": (
            f"lab {_lab_host()}: +{len(created_remote)} ~{len(existing_remote)} -{len(removed_remote)}"
            if _lab_host()
            else "skipped (LAB_SSH_HOST unset)"
        ),
        "botsRoster": "call POST :9122/gateway-bots-proxy-refresh after Hermes uses gateway front 9122",
        "removed": removed,
        "removedRemote": removed_remote,
        "failed": failed[:12],
    }


def _hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes")))


def _hermes_bin() -> str:
    return os.environ.get("HERMES_BIN", "").strip() or os.path.expanduser("~/.local/bin/hermes")


def _lab_host() -> str:
    return os.environ.get("LAB_SSH_HOST", "").strip()


def _remote_home() -> str:
    return os.environ.get("HERMES_REMOTE_HOME", "").strip()


def _list_local_profiles() -> list[str]:
    bin_path = _hermes_bin()
    if not os.path.isfile(bin_path):
        return []
    try:
        proc = subprocess.run(
            [bin_path, "profile", "list"],
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
        out = proc.stdout or ""
        names: list[str] = []
        for line in out.splitlines():
            tok = line.strip().split()[0] if line.strip() else ""
            if tok and tok != "─" and tok != "default":
                names.append(tok)
        return names
    except (OSError, subprocess.TimeoutExpired):
        return []


def _ensure_one_profile(
    profile: str,
    desc: str,
    created: list[str],
    existing: list[str],
    failed: list[dict[str, str]],
    agent: dict[str, Any],
) -> None:
    bin_path = _hermes_bin()
    prof_dir = _hermes_home() / "profiles" / profile
    if prof_dir.is_dir():
        existing.append(profile)
        _sync_local_model_from_template(profile)
        return
    if not os.path.isfile(bin_path):
        failed.append({"profile": profile, "error": "HERMES_BIN missing", "scope": "local"})
        return
    try:
        proc = subprocess.run(
            [bin_path, "profile", "create", profile, "--no-alias"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if proc.returncode != 0 and "unknown" in (proc.stderr or "").lower():
            subprocess.run(
                [bin_path, "profile", "create", profile],
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
    except (OSError, subprocess.TimeoutExpired) as e:
        failed.append({"profile": profile, "error": str(e)[:200], "scope": "local"})
        return
    if prof_dir.is_dir():
        created.append(profile)
        _sync_local_model_from_template(profile)
    else:
        failed.append({"profile": profile, "agentId": str(agent.get("id") or ""), "error": "create failed", "scope": "local"})


def _sync_local_model_from_template(profile: str) -> None:
    template = os.environ.get("OFFICE_PROFILE_TEMPLATE", "office-sarah").strip()
    tmpl_dir = _hermes_home() / "profiles" / template
    dest = _hermes_home() / "profiles" / profile
    if not tmpl_dir.is_dir() or not dest.is_dir():
        return
    for fname in ("config.yaml", "config.yml", "hermes.yaml", "model.yaml", ".env"):
        src = tmpl_dir / fname
        if src.is_file() and not (dest / fname).exists():
            shutil.copy2(src, dest / fname)


def _delete_local_profile(profile: str) -> bool:
    bin_path = _hermes_bin()
    if not os.path.isfile(bin_path):
        return False
    try:
        proc = subprocess.run(
            [bin_path, "profile", "delete", profile, "--yes"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        blob = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode == 0 or "deleted" in blob.lower()
    except (OSError, subprocess.TimeoutExpired):
        return False


def _shell_quote(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"


def _ssh_lab(inner: str, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    host = _lab_host()
    home = _remote_home()
    home_export = f"export HERMES_HOME={_shell_quote(home)}; " if home else ""
    cmd = f"{home_export}export PATH=\"$HOME/.local/bin:$PATH\"; {inner}"
    return subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", host, "bash", "-lc", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _list_remote_profiles() -> list[str]:
    if not _lab_host():
        return []
    try:
        proc = _ssh_lab("hermes profile list 2>/dev/null | awk 'NF && $1 !~ /^─/ {print $1}'")
        return [l.strip() for l in (proc.stdout or "").splitlines() if l.strip() and l.strip() != "default"]
    except (OSError, subprocess.TimeoutExpired):
        return []


def _ensure_one_profile_remote(
    profile: str,
    desc: str,
    created: list[str],
    existing: list[str],
    failed: list[dict[str, str]],
    agent: dict[str, Any],
) -> None:
    known = _list_remote_profiles()
    if profile in known:
        existing.append(profile)
        _sync_remote_model_access(profile)
        return
    q_desc = desc.replace("'", "'\\''")
    q_prof = profile.replace("'", "'\\''")
    proc = _ssh_lab(f"hermes profile create '{q_prof}' --no-alias --description '{q_desc}'")
    blob = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode == 0 or "already exist" in blob.lower():
        if profile in known:
            existing.append(profile)
        else:
            created.append(profile)
        _sync_remote_model_access(profile)
    else:
        failed.append(
            {
                "profile": profile,
                "agentId": str(agent.get("id") or ""),
                "error": blob[:200] or "remote create failed",
                "scope": "remote",
            }
        )


def _sync_remote_model_access(profile: str) -> None:
    if not _lab_host():
        return
    home = _remote_home() or "~/.hermes"
    fallback_base = os.environ.get("GATEWAY_MODEL_BASE_URL", "http://10.80.0.1:18083/v1")
    fallback_model = os.environ.get("GATEWAY_MODEL_DEFAULT", "vllm/company-ai-auto")
    q_home = home.replace("'", "'\\''")
    q_prof = profile.replace("'", "'\\''")
    q_base = fallback_base.replace("'", "'\\''")
    q_model = fallback_model.replace("'", "'\\''")
    inner = (
        f"H='{q_home}'; P='{q_prof}'; mkdir -p \"$H/profiles/$P\"; touch \"$H/profiles/$P/.env\"; "
        f"if ! grep -q HERMES_CUSTOM_CUSTOM_API_KEY \"$H/profiles/$P/.env\" 2>/dev/null; then "
        f"for src in \"$H/.env\" \"$H/profiles/office-sarah/.env\" \"$H/profiles/office-sam/.env\"; do "
        f"if [ -f \"$src\" ] && grep -q HERMES_CUSTOM_CUSTOM_API_KEY \"$src\" 2>/dev/null; then "
        f"grep HERMES_CUSTOM_CUSTOM_API_KEY \"$src\" >> \"$H/profiles/$P/.env\"; break; fi; done; fi; "
        f"hermes -p \"$P\" config set model.provider custom >/dev/null 2>&1; "
        f"hermes -p \"$P\" config set model.base_url '{q_base}' >/dev/null 2>&1; "
        f"hermes -p \"$P\" config set model.default '{q_model}' >/dev/null 2>&1"
    )
    _ssh_lab(inner, timeout=90)


def _delete_remote_profile(profile: str) -> bool:
    q = profile.replace("'", "'\\''")
    proc = _ssh_lab(f"hermes profile delete '{q}' --yes")
    blob = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode == 0 or "deleted" in blob.lower() or "dihapus" in blob.lower()


def _sync_remote_ui_meta(plan: dict[str, Any], failed: list[dict[str, str]]) -> None:
    if not _lab_host() or not REMOTE_UI_META_SCRIPT.is_file():
        return
    entries = ui_meta_payload_entries(plan)
    if not entries:
        return
    script_b64 = base64.b64encode(REMOTE_UI_META_SCRIPT.read_bytes()).decode("ascii")
    payload_b64 = base64.b64encode(json.dumps(entries).encode("utf-8")).decode("ascii")
    home = _remote_home() or "~/.hermes"
    q_home = home.replace("'", "'\\''")
    inner = (
        f"H='{q_home}'; export HERMES_HOME=\"$H\"; "
        f"echo '{script_b64}' | base64 -d > /tmp/office-sync-bots-ui-meta.py; "
        f"echo '{payload_b64}' | base64 -d | python3 /tmp/office-sync-bots-ui-meta.py"
    )
    proc = _ssh_lab(inner, timeout=180)
    if proc.returncode != 0:
        failed.append(
            {
                "profile": "*",
                "error": f"remote ui_meta: {(proc.stderr or proc.stdout or '')[:200]}",
                "scope": "remote",
            }
        )


def _notify_hermes_bots_refresh() -> None:
    import urllib.error
    import urllib.request

    for url in (
        "http://127.0.0.1:9122/gateway-bots-proxy-refresh",
        "http://127.0.0.1:9120/gateway-bots-proxy-refresh",
    ):
        try:
            req = urllib.request.Request(url, method="POST", data=b"")
            urllib.request.urlopen(req, timeout=2.5)
            return
        except (urllib.error.URLError, OSError, TimeoutError):
            continue
