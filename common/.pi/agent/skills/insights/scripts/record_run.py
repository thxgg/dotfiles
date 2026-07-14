#!/usr/bin/env python3
"""Persist an insights corpus, report, and run metadata as an immutable run directory."""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_ROOT = Path.home() / ".local" / "state" / "pi" / "insights" / "runs"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("primary", "subagents"), required=True)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--investigator-model", required=True, help="Provider/model used to produce the findings")
    parser.add_argument("--investigator-session", help="Pi session ID that produced the findings")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--run-id", help="Defaults to UTC timestamp plus mode")
    args = parser.parse_args()
    for path in (args.corpus, args.manifest, args.report):
        if not path.is_file():
            parser.error(f"missing input: {path}")
    now = datetime.now(timezone.utc)
    run_id = args.run_id or f"{now.strftime('%Y%m%dT%H%M%SZ')}-{args.mode}"
    if "/" in run_id or run_id in (".", ".."):
        parser.error("invalid --run-id")
    target = args.root / run_id
    target.mkdir(parents=True, exist_ok=False)
    shutil.copy2(args.corpus, target / "corpus.md")
    shutil.copy2(args.manifest, target / "sessions.json")
    shutil.copy2(args.report, target / "report.md")
    metadata = {
        "schema_version": 1,
        "run_id": run_id,
        "created_at": now.isoformat(),
        "mode": args.mode,
        "investigator": {"model": args.investigator_model, "session_id": args.investigator_session},
        "files": {"corpus": "corpus.md", "sessions": "sessions.json", "report": "report.md"},
        "decisions": [],
        "experiments": [],
        "supersedes": None,
    }
    (target / "run.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
