from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from resume_tool.errors import ResumeError
from resume_tool.history import create_release_snapshot
from resume_tool.linting import ResumeLinter
from resume_tool.repository import ResumeRepository
from resume_tool.resolver import ResumeResolver


def inspect_project(root: str, overlay: str | None = None) -> str:
    repository = ResumeRepository(Path(root))
    diagnostics = ResumeLinter(repository).lint(overlay)
    payload = {
        "overlays": list(repository.overlay_ids()),
        "diagnostics": [
            {
                "severity": diagnostic.severity.value,
                "location": diagnostic.location,
                "message": diagnostic.message,
            }
            for diagnostic in diagnostics
        ],
    }
    return json.dumps(payload, ensure_ascii=False)


def resolve_project(root: str, overlay: str) -> str:
    repository = ResumeRepository(Path(root))
    resume = ResumeResolver(repository).resolve(overlay)
    return json.dumps(resume.to_mapping(), ensure_ascii=False)


def create_browser_release(
    root: str,
    overlay: str,
    release_id: str,
    description: str,
    created_at: str,
    source_commit: str,
    renderer_version: str,
    pdf_sha256: str,
) -> str:
    repository = ResumeRepository(Path(root))
    resume = ResumeResolver(repository).resolve(overlay)
    document = {
        "title": f"{resume.profile.name} Resume",
        "description": f"{description}; {release_id}; source {source_commit[:12]}",
        "keywords": ["resume", release_id, overlay, source_commit[:12]],
    }
    template_text = repository.template_path.read_text(encoding="utf-8")
    lock_text = ""
    if repository.lock_path.exists():
        lock_text = repository.lock_path.read_text(encoding="utf-8")

    snapshot = create_release_snapshot(
        release_id=release_id,
        overlay_id=overlay,
        description=description,
        created_at=created_at,
        source_commit=source_commit,
        typst_version=renderer_version,
        pdf_standard="browser-default",
        lock_sha256=_sha256_text(lock_text),
        template_sha256=_sha256_text(template_text),
        pdf_sha256=pdf_sha256,
        document=document,
        resume=resume,
        renderer="typst.ts-web",
    )
    return yaml.safe_dump(snapshot, allow_unicode=True, sort_keys=False, width=100)


def create_submission_yaml(
    submission_id: str,
    release_id: str,
    submitted_at: str,
    destination: str,
    purpose: str,
    context: str | None,
    url: str | None,
    note: str | None,
) -> str:
    from resume_tool.history import create_submission_record

    record = create_submission_record(
        submission_id=submission_id,
        release_id=release_id,
        submitted_at=submitted_at,
        destination=destination,
        purpose=purpose,
        context=_clean_optional(context),
        url=_clean_optional(url),
        note=_clean_optional(note),
    )
    return yaml.safe_dump(record, allow_unicode=True, sort_keys=False, width=100)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
