"""Plan writer — HTTP to PLAN_CHAT_URL (Qwen via lab tunnel)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from plan import (
    compose_instruction,
    compose_instruction_fitted,
    extract_json,
    parse_plan,
    plans_materially_changed,
)


def chat_url() -> str:
    return os.environ.get("PLAN_CHAT_URL", "http://127.0.0.1:8790/v1/chat").rstrip("/")


def host_label() -> str:
    from urllib.parse import urlparse

    u = urlparse(chat_url())
    return f"{u.hostname}:{u.port}" if u.port else (u.hostname or chat_url())


def plan_writer_reachable() -> tuple[bool, str]:
    from urllib.parse import urlparse

    u = urlparse(chat_url())
    health = f"{u.scheme}://{u.netloc}/healthz"
    try:
        req = urllib.request.Request(health, method="GET")
        with urllib.request.urlopen(req, timeout=3.5) as res:
            return res.status == 200, host_label()
    except Exception:
        return False, host_label()


def _read_sse_or_json(body: bytes, content_type: str) -> str:
    text = body.decode("utf-8", errors="replace")
    if "text/event-stream" not in content_type:
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return text
        if isinstance(data.get("text"), str):
            return data["text"]
        choices = data.get("choices") or []
        if choices and isinstance(choices[0].get("message"), dict):
            c = choices[0]["message"].get("content")
            if isinstance(c, str):
                return c
        return text

    out: list[str] = []
    for block in text.split("\n\n"):
        for line in block.split("\n"):
            if not line.startswith("data:"):
                continue
            raw = line[5:].strip()
            if raw == "[DONE]":
                continue
            try:
                payload = json.loads(raw)
                if isinstance(payload.get("text"), str):
                    out.append(payload["text"])
                delta = (payload.get("choices") or [{}])[0].get("delta") or {}
                if isinstance(delta.get("content"), str):
                    out.append(delta["content"])
            except json.JSONDecodeError:
                out.append(raw)
    return "".join(out)


def ask_qwen_chat(
    messages: list[dict[str, str]], locale: str = "en", timeout: float = 170.0
) -> tuple[str | None, str | None]:
    """POST user/assistant turns to lab /v1/chat (SSE)."""
    payload = json.dumps({"messages": messages, "locale": locale}).encode("utf-8")
    req = urllib.request.Request(
        chat_url(),
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "X-Office-Client": "web"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            text = _read_sse_or_json(res.read(), res.headers.get("Content-Type") or "")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            return None, "Qwen is busy. Try again in a moment."
        return None, f"Qwen HTTP {e.code}."
    except Exception:
        return None, f"Could not reach Qwen at {host_label()}. Start PLAN_CHAT_URL tunnel (desk:up)."
    if not text.strip():
        return None, "Qwen returned an empty reply."
    return text, None


def ask_qwen(instruction: str, timeout: float = 170.0) -> tuple[str | None, str | None]:
    payload = json.dumps(
        {"messages": [{"role": "user", "content": instruction}], "locale": "en"}
    ).encode("utf-8")
    # Lab chat-gateway (8790) accepts only user/assistant and X-Office-Client: web.
    req = urllib.request.Request(
        chat_url(),
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "X-Office-Client": "web"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            text = _read_sse_or_json(res.read(), res.headers.get("Content-Type") or "")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            return None, "Qwen is busy. Try again in a moment."
        if e.code == 400:
            return None, (
                "Qwen HTTP 400 — update too long for chat gateway (max ~4000 chars per message). "
                "Use a shorter prompt; the server auto-compresses the plan snapshot."
            )
        return None, f"Qwen HTTP {e.code}."
    except Exception:
        return None, f"Could not reach Qwen at {host_label()}. Start PLAN_CHAT_URL tunnel (desk:up)."
    if not text.strip():
        return None, "Qwen returned an empty reply."
    return text, None


def build_office_plan(
    prompt: str, current: dict[str, Any] | None
) -> tuple[dict[str, Any] | None, str | None]:
    instruction, fit_err = compose_instruction_fitted(prompt, current)
    if fit_err:
        return None, fit_err
    last_err = "Qwen did not return a readable office plan."

    for attempt in range(5):
        text, err = ask_qwen(instruction)
        if err:
            return None, err
        assert text
        try:
            raw = extract_json(text)
        except (ValueError, json.JSONDecodeError):
            last_err = "Qwen reply was not JSON."
            instruction = f"{instruction}\n\nReply with JSON only."
            continue
        plan, perr = parse_plan(raw)
        if plan:
            note = str(plan.get("note") or "").lower()
            unchanged = current and not plans_materially_changed(current, plan)
            if unchanged and ("no change" in note or attempt < 2):
                if attempt < 3:
                    last_err = "Model returned an unchanged plan."
                    instruction, fit_err = compose_instruction_fitted(prompt, current)
                    if fit_err:
                        return None, fit_err
                    tail = (
                        "\n\nIMPORTANT: Apply the user request. "
                        "Add new agents/departments with new lowercase ids. "
                        "Return the full revised JSON."
                    )
                    if len(instruction) + len(tail) <= 3900:
                        instruction += tail
                    continue
                return None, (
                    "Qwen did not add or change agents. Use a short prompt, e.g. "
                    "'Add Legal department with agent Zoe, role Legal Counsel.'"
                )
            return plan, None
        last_err = perr or last_err
        extra = f"\n\nRejected: {last_err}. Reply with JSON only."
        if len(instruction) + len(extra) <= 3900:
            instruction = f"{instruction}{extra}"
        else:
            instruction = f"{compose_instruction(prompt, current, compact=3)}\n\nReply with JSON only."
    return None, last_err
