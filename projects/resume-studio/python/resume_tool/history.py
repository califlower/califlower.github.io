from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from resume_tool.errors import ResumeError
from resume_tool.models import JsonMapping, ResolvedResume
from resume_tool.provenance import sha256_mapping
from resume_tool.repository import ResumeRepository, UniqueKeyLoader


SCHEMA_VERSION = 1
RELEASE_PATTERN = re.compile(r"^r(?P<number>\d{4})$")
SUBMISSION_PATTERN = re.compile(r"^s(?P<number>\d{4})$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def next_release_id(repository: ResumeRepository, git_tags: Iterable[str]) -> str:
    values = [path.stem for path in repository.releases_path.glob("r*.yaml")]
    values.extend(tag.removeprefix("resume/") for tag in git_tags)
    return _next_id(values, RELEASE_PATTERN, "r")


def next_submission_id(repository: ResumeRepository) -> str:
    values = [path.stem for path in repository.submissions_path.glob("s*.yaml")]
    return _next_id(values, SUBMISSION_PATTERN, "s")


def release_path(repository: ResumeRepository, release_id: str) -> Path:
    validate_release_id(release_id)
    return repository.releases_path / f"{release_id}.yaml"


def submission_path(repository: ResumeRepository, submission_id: str) -> Path:
    validate_submission_id(submission_id)
    return repository.submissions_path / f"{submission_id}.yaml"


def create_release_snapshot(
    release_id: str,
    overlay_id: str,
    description: str,
    created_at: str,
    source_commit: str,
    typst_version: str,
    pdf_standard: str,
    lock_sha256: str,
    template_sha256: str,
    pdf_sha256: str,
    document: Mapping[str, Any],
    resume: ResolvedResume,
    renderer: str = "native-python-typst",
) -> dict[str, Any]:
    resume_data = resume.to_mapping()
    return {
        "schema": SCHEMA_VERSION,
        "release": {
            "id": release_id,
            "description": description,
            "overlay": overlay_id,
            "created_at": created_at,
            "source_commit": source_commit,
            "typst_version": typst_version,
            "pdf_standard": pdf_standard,
            "lock_sha256": lock_sha256,
            "template_sha256": template_sha256,
            "resolved_sha256": sha256_mapping(resume_data),
            "pdf_sha256": pdf_sha256,
            "renderer": renderer,
        },
        "document": dict(document),
        "resume": resume_data,
    }


def create_submission_record(
    submission_id: str,
    release_id: str,
    submitted_at: str,
    destination: str,
    purpose: str,
    context: str | None,
    url: str | None,
    note: str | None,
) -> dict[str, Any]:
    submission: dict[str, Any] = {
        "id": submission_id,
        "release": release_id,
        "submitted_at": submitted_at,
        "destination": destination,
        "purpose": purpose,
    }
    if context is not None:
        submission["context"] = context
    if url is not None:
        submission["url"] = url
    if note is not None:
        submission["note"] = note
    return {"schema": SCHEMA_VERSION, "submission": submission}


def load_release_text(
    text: str,
    expected_release_id: str,
) -> tuple[JsonMapping, JsonMapping, ResolvedResume]:
    loaded = _load_yaml_text(text, "Release snapshot")
    _validate_schema(loaded, "Release snapshot")
    _require_only_keys(loaded, {"schema", "release", "document", "resume"}, "Release snapshot")

    release_data = _required_mapping(loaded, "release", "Release snapshot")
    document_data = _required_mapping(loaded, "document", "Release snapshot")
    resume_data = _required_mapping(loaded, "resume", "Release snapshot")
    _require_only_keys(
        release_data,
        {
            "id",
            "description",
            "overlay",
            "created_at",
            "source_commit",
            "typst_version",
            "pdf_standard",
            "lock_sha256",
            "template_sha256",
            "resolved_sha256",
            "pdf_sha256",
            "renderer",
        },
        "Release metadata",
    )
    _require_only_keys(document_data, {"title", "description", "keywords"}, "Document metadata")

    actual_release_id = release_data.get("id")
    if actual_release_id != expected_release_id:
        raise ResumeError(
            f"Release snapshot ID is {actual_release_id}, expected {expected_release_id}."
        )

    if "renderer" in release_data:
        _required_text(release_data, "renderer", "Release snapshot")

    for key in (
        "description",
        "overlay",
        "created_at",
        "source_commit",
        "typst_version",
        "pdf_standard",
    ):
        _required_text(release_data, key, "Release snapshot")

    _validate_timestamp(release_data, "created_at", "Release snapshot")
    _validate_hash(release_data, "lock_sha256")
    _validate_hash(release_data, "template_sha256")
    _validate_hash(release_data, "pdf_sha256")
    resolved_hash = _validate_hash(release_data, "resolved_sha256")
    actual_resolved_hash = sha256_mapping(resume_data)
    if actual_resolved_hash != resolved_hash:
        raise ResumeError("Release snapshot content does not match resolved_sha256.")

    _validate_document(document_data)

    try:
        resume = ResolvedResume.from_mapping(resume_data)
    except ValueError as error:
        raise ResumeError(f"Invalid resolved resume content: {error}") from error
    return release_data, document_data, resume


def load_submission_text(text: str, expected_submission_id: str) -> JsonMapping:
    loaded = _load_yaml_text(text, "Submission record")
    _validate_schema(loaded, "Submission record")
    _require_only_keys(loaded, {"schema", "submission"}, "Submission record")
    submission = _required_mapping(loaded, "submission", "Submission record")
    _require_only_keys(
        submission,
        {"id", "release", "submitted_at", "destination", "purpose", "context", "url", "note"},
        "Submission metadata",
    )

    actual_submission_id = submission.get("id")
    if actual_submission_id != expected_submission_id:
        raise ResumeError(
            f"Submission record ID is {actual_submission_id}, expected {expected_submission_id}."
        )

    release_id = _required_text(submission, "release", "Submission record")
    validate_release_id(release_id)

    for key in ("submitted_at", "destination", "purpose"):
        _required_text(submission, key, "Submission record")
    _validate_timestamp(submission, "submitted_at", "Submission record")

    return submission


def validate_release_id(release_id: str) -> None:
    if RELEASE_PATTERN.fullmatch(release_id) is None:
        raise ResumeError("Release IDs look like r0001.")


def validate_submission_id(submission_id: str) -> None:
    if SUBMISSION_PATTERN.fullmatch(submission_id) is None:
        raise ResumeError("Submission IDs look like s0001.")


def _require_only_keys(data: Mapping[str, Any], allowed: set[str], label: str) -> None:
    unknown = sorted(set(data) - allowed)
    if unknown:
        names = ", ".join(unknown)
        raise ResumeError(f"{label} has unknown keys: {names}")


def _validate_schema(data: JsonMapping, label: str) -> None:
    schema = data.get("schema")
    if schema != SCHEMA_VERSION:
        raise ResumeError(
            f"{label} uses schema {schema}; this version supports schema {SCHEMA_VERSION}."
        )


def _validate_document(data: JsonMapping) -> None:
    _required_text(data, "title", "Release document")
    _required_text(data, "description", "Release document")

    keywords = data.get("keywords")
    if not isinstance(keywords, list):
        raise ResumeError("Release document has invalid keywords.")
    for keyword in keywords:
        if not isinstance(keyword, str) or not keyword.strip():
            raise ResumeError("Release document has invalid keywords.")


def _validate_timestamp(data: Mapping[str, Any], key: str, label: str) -> None:
    value = _required_text(data, key, label)
    try:
        timestamp = datetime.fromisoformat(value)
    except ValueError as error:
        raise ResumeError(f"{label} has an invalid {key}.") from error
    if timestamp.tzinfo is None:
        raise ResumeError(f"{label} {key} must include a timezone.")


def _validate_hash(data: Mapping[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
        raise ResumeError(f"Release snapshot has an invalid {key}.")
    return value


def _required_mapping(data: JsonMapping, key: str, label: str) -> JsonMapping:
    value = data.get(key)
    if not isinstance(value, Mapping):
        raise ResumeError(f"{label} is missing {key} metadata.")
    return value


def _required_text(data: Mapping[str, Any], key: str, label: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ResumeError(f"{label} has an invalid {key}.")
    return value


def _load_yaml_text(text: str, label: str) -> JsonMapping:
    try:
        loaded = yaml.load(text, Loader=UniqueKeyLoader)
    except yaml.YAMLError as error:
        raise ResumeError(f"Invalid {label.lower()} YAML: {error}") from error
    if not isinstance(loaded, Mapping):
        raise ResumeError(f"{label} must contain a YAML mapping.")
    return loaded


def _next_id(values: Iterable[str], pattern: re.Pattern[str], prefix: str) -> str:
    highest = 0
    for value in values:
        match = pattern.fullmatch(value)
        if match is None:
            continue
        number = int(match.group("number"))
        highest = max(highest, number)
    return f"{prefix}{highest + 1:04d}"
