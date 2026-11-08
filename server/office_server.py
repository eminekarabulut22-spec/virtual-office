#!/usr/bin/env python3
"""Virtual Office — UI + API from virtual-office (Hermes iframe → :3001)."""

from __future__ import annotations

import json
import mimetypes
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from plan import list_plan_bots, section_meta, sorted_departments
from profiles import sync_profiles_from_plan
from qwen import build_office_plan, host_label, plan_writer_reachable
from hermes_metrics import profile_metrics, tokens_for_session_ids
from kanban_metrics import apply_kanban_live_overlay, kanban_stats_by_agent_id
from store import read_jobs, read_plan, write_jobs, write_plan

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "web" / "dist"
BUILD_ID = "virtual-office"
PORT = int(os.environ.get("OFFICE_PORT", "3001"))

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
}
FRAME = {"Content-Security-Policy": "frame-ancestors * http: https: app: file:"}
BUILD_HEADER = {"X-Office-Build": BUILD_ID, "X-Office-Repo": "virtual-office"}


def kpi_by_agent_id(plan: dict[str, Any] | None) -> dict[str, Any]:
    """Fast KPI (Kanban only) — no SSH; safe for Hermes iframe polling."""
    if not plan:
        return {}
    kanban_by_id = kanban_stats_by_agent_id(plan)
    by_agent: dict[str, Any] = {}
    for bot in list_plan_bots(plan):
        kb = kanban_by_id.get(bot["id"]) or {
            "done": 0,
            "running": 0,
            "waiting": 0,
            "open": 0,
            "session_ids": [],
        }
        by_agent[bot["id"]] = {
            "profile": bot["profile"],
            "tokens": 0,
            "workTokens": 0,
            "jobsCompleted": 0,
            "stateFound": False,
            "kanban": {
                "done": int(kb.get("done") or 0),
                "running": int(kb.get("running") or 0),
            },
        }
    return by_agent


def usage_by_agent_id(plan: dict[str, Any], *, include_chat: bool = False) -> dict[str, Any]:
    kanban_by_id = kanban_stats_by_agent_id(plan)
    bots = list_plan_bots(plan)

    def one(bot: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        kb = kanban_by_id.get(bot["id"]) or {
            "done": 0,
            "running": 0,
            "waiting": 0,
            "open": 0,
            "session_ids": [],
        }
        session_ids = kb.get("session_ids") or []
        work_tokens = tokens_for_session_ids(bot["profile"], session_ids)
        if include_chat:
            row = profile_metrics(bot["id"])
            chat_tokens = int(row["tokens"] or 0)
            state_found = bool(row["found"])
            jobs = int(row["chat_sessions_finished"] or 0)
        else:
            chat_tokens = 0
            state_found = bool(session_ids) or work_tokens > 0
            jobs = 0
        return bot["id"], {
            "tokens": chat_tokens,
            "profile": bot["profile"],
            "stateFound": state_found,
            "jobsCompleted": jobs,
            "workTokens": work_tokens,
            "kanban": {
                "done": int(kb.get("done") or 0),
                "running": int(kb.get("running") or 0),
            },
        }

    by_agent: dict[str, Any] = {}
    if len(bots) <= 1:
        for bot in bots:
            aid, payload = one(bot)
            by_agent[aid] = payload
    else:
        with ThreadPoolExecutor(max_workers=min(6, len(bots))) as pool:
            futures = [pool.submit(one, bot) for bot in bots]
            for fut in as_completed(futures, timeout=45):
                aid, payload = fut.result()
                by_agent[aid] = payload
    return by_agent


def send_headers(handler: BaseHTTPRequestHandler, extra: dict[str, str] | None = None) -> None:
    for k, v in {**CORS, **FRAME, **BUILD_HEADER, **(extra or {})}.items():
        handler.send_header(k, v)


def json_response(handler: BaseHTTPRequestHandler, status: int, body: Any) -> None:
    raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    send_headers(handler, {"Content-Type": "application/json; charset=utf-8", "Content-Length": str(len(raw))})
    handler.end_headers()
    handler.wfile.write(raw)


def read_body(handler: BaseHTTPRequestHandler) -> Any:
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return None
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def run_update_job(job_id: str, prompt: str) -> None:
    jobs = read_jobs()
    job = jobs.get(job_id)
    if not job:
        return

    def save(j: dict[str, Any]) -> None:
        jobs[job_id] = j
        write_jobs(jobs)

    job["phase"] = "calling_qwen"
    job["qwenEndpoint"] = host_label()
    save(job)

    current = read_plan()
    plan, err = build_office_plan(prompt, current)
    if err or not plan:
        job["status"] = "error"
        job["phase"] = "error"
        job["error"] = err or "Update failed."
        job["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        save(job)
        return

    job["phase"] = "applying_plan"
    save(job)

    write_plan(plan)
    profiles = sync_profiles_from_plan(plan)

    job["status"] = "done"
    job["phase"] = "done"
    job["plan"] = plan
    job["profiles"] = profiles
    job["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save(job)


def serve_static(handler: BaseHTTPRequestHandler, url_path: str) -> bool:
    if not STATIC_DIR.is_dir():
        return False
    rel = url_path.lstrip("/") or "index.html"
    candidate = (STATIC_DIR / rel).resolve()
    if not str(candidate).startswith(str(STATIC_DIR.resolve())):
        return False
    if candidate.is_file():
        data = candidate.read_bytes()
        ctype, _ = mimetypes.guess_type(str(candidate))
        cache = (
            "no-cache, must-revalidate"
            if rel == "index.html" or rel.endswith(".html")
            else "public, max-age=31536000, immutable"
            if "/assets/" in rel and len(Path(rel).stem.split("-")[-1]) >= 6
            else "no-cache, must-revalidate"
        )
        handler.send_response(200)
        send_headers(
            handler,
            {
                "Content-Type": ctype or "application/octet-stream",
                "Content-Length": str(len(data)),
                "Cache-Control": cache,
            },
        )
        handler.end_headers()
        handler.wfile.write(data)
        return True
    # SPA fallback
    index = STATIC_DIR / "index.html"
    if index.is_file():
        data = index.read_bytes()
        handler.send_response(200)
        send_headers(handler, {"Content-Type": "text/html; charset=utf-8", "Content-Length": str(len(data))})
        handler.end_headers()
        handler.wfile.write(data)
        return True
    return False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        send_headers(self)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        qs = parse_qs(urlparse(self.path).query)

        if path == "/api/office/health":
            json_response(
                self,
                200,
                {"ok": True, "build": BUILD_ID, "repo": "virtual-office", "port": PORT},
            )
            return

        if path == "/api/office":
            plan = read_plan()
            live = apply_kanban_live_overlay(plan) if plan else None
            json_response(
                self,
                200,
                {
                    "plan": live,
                    "planStored": plan,
                    "live": {"enabled": True, "source": "kanban"},
                    "kpiByAgentId": kpi_by_agent_id(plan),
                },
            )
            return

        if path == "/api/office/kpi":
            plan = read_plan()
            json_response(self, 200, {"kpiByAgentId": kpi_by_agent_id(plan)})
            return

        if path == "/api/office/plan-writer":
            ok, endpoint = plan_writer_reachable()
            json_response(self, 200, {"ok": ok, "endpoint": endpoint})
            return

        if path == "/api/office/inference":
            json_response(
                self,
                200,
                {
                    "modelId": "openai/vllm/company-ai-local",
                    "displayName": "Company Qwen",
                    "note": "Virtual Office virtual-office",
                    "parameterLabel": "vllm/company-ai-local",
                    "vramSource": "configured",
                    "estimatedVramMb": None,
                    "gpuMetricsUrlConfigured": False,
                    "gpuMetricsReachable": False,
                },
            )
            return

        if path == "/api/office/bots":
            plan = read_plan()
            if not plan:
                json_response(
                    self,
                    200,
                    {"company": None, "bots": [], "sections": [], "updatedAt": None},
                )
                return
            sections = [section_meta(d["id"], d["name"]) for d in sorted_departments(plan)]
            json_response(
                self,
                200,
                {
                    "company": plan.get("company"),
                    "updatedAt": plan.get("updatedAt"),
                    "sections": sections,
                    "bots": list_plan_bots(plan),
                    "authoritative": True,
                },
            )
            return

        if path == "/api/office/update-job":
            job_id = (qs.get("id") or [""])[0]
            job = read_jobs().get(job_id)
            if not job:
                json_response(self, 404, {"error": "Job not found."})
                return
            json_response(self, 200, job)
            return

        if path == "/api/office/usage":
            plan = read_plan()
            include_chat = (qs.get("chat") or ["0"])[0].lower() in ("1", "true", "yes")
            by_agent = usage_by_agent_id(plan, include_chat=include_chat) if plan else {}
            json_response(
                self,
                200,
                {
                    "usage": {
                        "byAgentId": by_agent,
                        "companyTokens": sum(r["tokens"] for r in by_agent.values()),
                    }
                },
            )
            return

        if serve_static(self, path):
            return
        json_response(self, 404, {"error": "Not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path

        if path == "/api/office/live-sync":
            plan = read_plan()
            if not plan:
                json_response(self, 404, {"error": {"message": "No office plan yet."}})
                return
            live = apply_kanban_live_overlay(plan)
            json_response(
                self,
                200,
                {"plan": live, "live": {"enabled": True, "source": "kanban"}},
            )
            return

        if path == "/api/office/update-job":
            body = read_body(self) or {}
            prompt = str(body.get("prompt") or "").strip()
            if not prompt:
                json_response(self, 400, {"error": {"message": "Prompt is required."}})
                return
            job_id = f"ouj-{uuid.uuid4().hex[:12]}"
            job = {
                "id": job_id,
                "status": "running",
                "phase": "starting",
                "qwenEndpoint": host_label(),
                "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            jobs = read_jobs()
            jobs[job_id] = job
            write_jobs(jobs)
            threading.Thread(target=run_update_job, args=(job_id, prompt), daemon=True).start()
            json_response(self, 200, {"jobId": job_id})
            return

        if path == "/api/office/ensure-profiles":
            plan = read_plan()
            if not plan:
                json_response(self, 400, {"error": "No plan on disk."})
                return
            json_response(self, 200, sync_profiles_from_plan(plan))
            return

        if path == "/api/office/chat":
            json_response(
                self,
                410,
                {
                    "error": "Use Hermes Desktop → BOTS → Bot Chat on the office-* profile. "
                    "Metrics are read from Hermes state.db for all tenants."
                },
            )
            return

        json_response(self, 404, {"error": "Not found"})


def main() -> None:
    if not STATIC_DIR.is_dir():
        print(f"WARN: {STATIC_DIR} missing — run: npm run build", flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Virtual Office ({BUILD_ID}) http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
