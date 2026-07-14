#!/usr/bin/env python3
"""Create a bounded, sanitized review corpus from Pi primary or subagent sessions."""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any, Iterable

HOME = Path.home()
DEFAULT_SESSIONS = HOME / ".pi" / "agent" / "sessions"
DEFAULT_SUBAGENTS = Path(os.environ.get("XDG_STATE_HOME", HOME / ".local" / "state")) / "pi" / "subagents"
SECRET_RE = re.compile(r"(?i)\b(token|secret|password|api[_-]?key|authorization)\b(\s*[:=]\s*|\s+)([^\s,;]+)")
BEARER_RE = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+")
PEM_RE = re.compile(r"-----BEGIN [^-]+-----.*?-----END [^-]+-----", re.S)
MAX_TEXT = 4000


def redact(text: str) -> str:
    text = PEM_RE.sub("[REDACTED PRIVATE MATERIAL]", text)
    text = BEARER_RE.sub("Bearer [REDACTED]", text)
    text = SECRET_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}[REDACTED]", text)
    if len(text) > MAX_TEXT:
        return text[:MAX_TEXT] + f"\n… [truncated {len(text) - MAX_TEXT} chars]"
    return text


def text_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(str(part.get("text", "")) for part in content if isinstance(part, dict) and part.get("type") == "text")


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def child_session_files(root: Path) -> set[str]:
    files: set[str] = set()
    if not root.exists():
        return files
    for state_path in root.glob("*/state.json"):
        state = load_json(state_path)
        if state and isinstance(state.get("sessionFile"), str):
            files.add(str(Path(state["sessionFile"]).resolve()))
    return files


def parse_primary(path: Path) -> dict[str, Any] | None:
    result: dict[str, Any] = {"path": str(path), "messages": [], "tool_errors": [], "tools": {}, "models": []}
    try:
        for line in path.read_text(errors="replace").splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("type") == "session":
                result.update(id=row.get("id"), timestamp=row.get("timestamp"), cwd=row.get("cwd"))
            if row.get("type") == "model_change":
                model = "/".join(str(x) for x in (row.get("provider"), row.get("modelId")) if x)
                if model and model not in result["models"]:
                    result["models"].append(model)
            if row.get("type") != "message":
                continue
            message = row.get("message", {})
            role = message.get("role")
            if role in ("user", "assistant"):
                text = text_content(message.get("content"))
                if text.strip():
                    result["messages"].append((role, redact(text.strip())))
                for part in message.get("content", []) if isinstance(message.get("content"), list) else []:
                    if isinstance(part, dict) and part.get("type") == "toolCall":
                        name = str(part.get("name", "unknown"))
                        result["tools"][name] = result["tools"].get(name, 0) + 1
            elif role == "toolResult" and message.get("isError"):
                result["tool_errors"].append(redact(text_content(message.get("content"))))
    except OSError:
        return None
    return result if result.get("id") else None


def primary_sessions(root: Path, cwd: str | None, child_files: set[str], excluded: set[str]) -> Iterable[dict[str, Any]]:
    for path in root.rglob("*.jsonl") if root.exists() else []:
        if str(path.resolve()) in child_files:
            continue
        session = parse_primary(path)
        if session and str(session.get("id")) not in excluded and (not cwd or Path(str(session.get("cwd", ""))).resolve() == Path(cwd).resolve()):
            yield session


def subagent_sessions(root: Path, cwd: str | None) -> Iterable[dict[str, Any]]:
    if not root.exists():
        return
    for state_path in root.glob("*/state.json"):
        state = load_json(state_path)
        if not state or (cwd and Path(str(state.get("cwd", ""))).resolve() != Path(cwd).resolve()):
            continue
        result = state.get("result") if isinstance(state.get("result"), dict) else {}
        yield {
            "id": state.get("id"), "timestamp": state.get("startedAt"), "cwd": state.get("cwd"),
            "agent": state.get("agent"), "model": state.get("model"), "thinking": state.get("thinking"),
            "status": state.get("status"), "task": redact(str(state.get("task", ""))),
            "summary": redact(str(result.get("summary", ""))), "error": redact(str(state.get("error", ""))),
            "warnings": [redact(str(x)) for x in state.get("warnings", [])],
            "usage": result.get("usage", {}), "tool_calls": result.get("toolCalls", []),
            "parent_session": (state.get("owner") or {}).get("sessionId"), "path": str(state_path),
        }


def sort_key(item: dict[str, Any]) -> str:
    return str(item.get("timestamp") or "")


def render_primary(items: list[dict[str, Any]]) -> str:
    out = ["# Primary-session review corpus", "", "> Read-only extraction. Hidden reasoning and successful tool payloads are excluded. Potential secrets are redacted.", ""]
    for s in items:
        out += [f"## {s.get('timestamp', 'unknown')} · `{s.get('id', 'unknown')}`", f"- Model(s): {', '.join(s.get('models', [])) or 'unknown'}", f"- CWD: `{s.get('cwd', '')}`", f"- Source: `{s.get('path', '')}`", f"- Tool calls: {json.dumps(s.get('tools', {}), sort_keys=True)}", ""]
        for role, text in s.get("messages", []):
            out += [f"### {role.title()}", text, ""]
        if s.get("tool_errors"):
            out += ["### Tool errors"] + [f"- {x}" for x in s["tool_errors"]] + [""]
    return "\n".join(out)


def render_subagents(items: list[dict[str, Any]]) -> str:
    out = ["# Subagent-session review corpus", "", "> Read-only extraction from the subagent job store. Review both delegation quality and child execution. Potential secrets are redacted.", ""]
    for s in items:
        calls = s.get("tool_calls", [])
        failures = [c for c in calls if isinstance(c, dict) and c.get("status") == "failed"]
        out += [f"## {s.get('timestamp', 'unknown')} · `{s.get('id', 'unknown')}` · {s.get('agent', 'unknown')}", f"- Model: {s.get('model') or 'unknown'} · thinking: {s.get('thinking') or 'unknown'}", f"- Status: {s.get('status')} · parent: `{s.get('parent_session')}` · CWD: `{s.get('cwd')}`", f"- Usage: {json.dumps(s.get('usage', {}), sort_keys=True)}", f"- Tool calls: {len(calls)} total, {len(failures)} failed", "", "### Parent task", s.get("task", ""), "", "### Child result", s.get("summary", "") or "[no summary]", ""]
        if s.get("error") or s.get("warnings") or failures:
            out += ["### Execution issues"]
            if s.get("error"): out += [f"- Error: {s['error']}"]
            out += [f"- Warning: {w}" for w in s.get("warnings", [])]
            out += [f"- Failed tool `{c.get('name')}`: {redact(str(c.get('error', 'unknown error')))}" for c in failures]
            out += [""]
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("primary", "subagents"), default="primary")
    parser.add_argument("--cwd", help="Include only sessions whose recorded CWD exactly matches this path")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--sessions-root", type=Path, default=DEFAULT_SESSIONS)
    parser.add_argument("--subagents-root", type=Path, default=DEFAULT_SUBAGENTS)
    parser.add_argument("--exclude-session", action="append", default=[], help="Session or job ID to exclude; repeatable")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--manifest", type=Path, help="Write machine-readable metadata for the selected sessions")
    args = parser.parse_args()
    if args.limit < 1 or args.limit > 200:
        parser.error("--limit must be between 1 and 200")
    excluded = set(args.exclude_session)
    if args.mode == "primary":
        items = list(primary_sessions(args.sessions_root, args.cwd, child_session_files(args.subagents_root), excluded))
        rendered = render_primary(sorted(items, key=sort_key, reverse=True)[:args.limit])
    else:
        items = [item for item in subagent_sessions(args.subagents_root, args.cwd) if str(item.get("id")) not in excluded]
        rendered = render_subagents(sorted(items, key=sort_key, reverse=True)[:args.limit])
    selected = sorted(items, key=sort_key, reverse=True)[:args.limit]
    if args.manifest:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        fields = ("id", "timestamp", "cwd", "path", "models", "model", "thinking", "agent", "status", "parent_session")
        manifest = {"schema_version": 1, "mode": args.mode, "cwd": args.cwd, "limit": args.limit,
                    "excluded_ids": sorted(excluded), "sessions": [{k: item[k] for k in fields if k in item} for item in selected]}
        args.manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n")
        print(f"Wrote {len(selected)} {args.mode} sessions to {args.output}")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
