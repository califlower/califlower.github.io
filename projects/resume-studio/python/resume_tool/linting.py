from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from datetime import datetime
from urllib.parse import urlparse

from resume_tool.errors import ResumeError
from resume_tool.history import load_release_text, load_submission_text
from resume_tool.models import Diagnostic, MasterResume, Overlay, ResolvedResume, Severity
from resume_tool.repository import ResumeRepository
from resume_tool.resolver import ResumeResolver


MAX_BULLET_CHARACTERS = 240
MAX_BULLETS_PER_JOB = 6
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
MONTH_YEAR_PATTERN = re.compile(
    r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$"
)
YEAR_PATTERN = re.compile(r"^\d{4}$")
PLACEHOLDER_PHRASES = (
    "replace this example",
    "your-name",
    "example.com",
    "prior company",
    "your university",
)


class ResumeLinter:
    def __init__(self, repository: ResumeRepository) -> None:
        self.repository = repository
        self.resolver = ResumeResolver(repository)

    def lint(self, overlay_id: str | None = None) -> tuple[Diagnostic, ...]:
        diagnostics: list[Diagnostic] = []
        try:
            master = self.repository.load_master()
        except ResumeError as error:
            return (
                Diagnostic(
                    severity=Severity.ERROR,
                    message=str(error),
                    location="master.yaml",
                ),
            )

        diagnostics.extend(_lint_master(master))
        diagnostics.extend(self._lint_overlays(overlay_id))
        diagnostics.extend(self._lint_history())
        return tuple(_deduplicate(diagnostics))

    def _lint_overlays(self, overlay_id: str | None) -> list[Diagnostic]:
        diagnostics: list[Diagnostic] = []
        overlay_ids = self.repository.overlay_ids()
        if overlay_id is not None:
            overlay_ids = (overlay_id,)

        for current_overlay_id in overlay_ids:
            try:
                chain = self.resolver.overlay_chain(current_overlay_id)
                for overlay in chain:
                    diagnostics.extend(_lint_overlay(overlay))
                resolved = self.resolver.resolve(current_overlay_id)
                diagnostics.extend(_lint_resolved(current_overlay_id, resolved))
            except ResumeError as error:
                diagnostics.append(
                    Diagnostic(
                        severity=Severity.ERROR,
                        message=str(error),
                        location=f"overlays/{current_overlay_id}.yaml",
                    )
                )
        return diagnostics

    def _lint_history(self) -> list[Diagnostic]:
        diagnostics: list[Diagnostic] = []
        release_ids: set[str] = set()

        for path in sorted(self.repository.releases_path.glob("r*.yaml")):
            release_ids.add(path.stem)
            try:
                load_release_text(path.read_text(encoding="utf-8"), path.stem)
            except ResumeError as error:
                diagnostics.append(
                    Diagnostic(
                        severity=Severity.ERROR,
                        message=str(error),
                        location=f"releases/{path.name}",
                    )
                )

        for path in sorted(self.repository.submissions_path.glob("s*.yaml")):
            try:
                submission = load_submission_text(path.read_text(encoding="utf-8"), path.stem)
                release_id = submission.get("release")
                if isinstance(release_id, str) and release_id not in release_ids:
                    diagnostics.append(
                        Diagnostic(
                            severity=Severity.ERROR,
                            message=f"Submission references missing release {release_id}.",
                            location=f"submissions/{path.name}",
                        )
                    )
                url = submission.get("url")
                if isinstance(url, str) and not _is_http_url(url):
                    diagnostics.append(
                        Diagnostic(
                            severity=Severity.ERROR,
                            message="Submission URL must start with http:// or https://.",
                            location=f"submissions/{path.name}",
                        )
                    )
            except ResumeError as error:
                diagnostics.append(
                    Diagnostic(
                        severity=Severity.ERROR,
                        message=str(error),
                        location=f"submissions/{path.name}",
                    )
                )

        return diagnostics


def has_errors(diagnostics: Iterable[Diagnostic]) -> bool:
    return any(item.severity is Severity.ERROR for item in diagnostics)


def _lint_master(master: MasterResume) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    diagnostics.extend(_duplicate_id_diagnostics("summary", [item.id for item in master.summaries]))
    diagnostics.extend(
        _duplicate_id_diagnostics("experience", [item.id for item in master.experiences])
    )
    diagnostics.extend(
        _duplicate_id_diagnostics("education", [item.id for item in master.education])
    )
    diagnostics.extend(
        _duplicate_id_diagnostics("skill group", [item.id for item in master.skill_groups])
    )

    if EMAIL_PATTERN.fullmatch(master.profile.email) is None:
        diagnostics.append(
            Diagnostic(
                severity=Severity.ERROR,
                message="Email address does not look valid.",
                location="master.yaml:profile.email",
            )
        )
    diagnostics.extend(_placeholder_diagnostics(master.profile.email, "master.yaml:profile.email"))

    for index, link in enumerate(master.profile.links):
        location = f"master.yaml:profile.links[{index + 1}]"
        if link.url is not None and not _is_http_url(link.url):
            diagnostics.append(
                Diagnostic(
                    severity=Severity.ERROR,
                    message="Link URL must start with http:// or https://.",
                    location=location,
                )
            )
        diagnostics.extend(_placeholder_diagnostics(link.value, location))
        if link.url is not None:
            diagnostics.extend(_placeholder_diagnostics(link.url, location))

    for summary in master.summaries:
        diagnostics.extend(
            _placeholder_diagnostics(summary.text, f"master.yaml:summaries.{summary.id}")
        )

    for experience in master.experiences:
        location = f"master.yaml:experience.{experience.id}"
        diagnostics.extend(
            _duplicate_id_diagnostics(
                f"bullet in {experience.id}",
                [bullet.id for bullet in experience.bullets],
            )
        )
        diagnostics.extend(_date_diagnostics(experience.start, experience.end, location))
        diagnostics.extend(_placeholder_diagnostics(experience.company, location))

        normalized_text = [" ".join(bullet.text.lower().split()) for bullet in experience.bullets]
        if _duplicates(normalized_text):
            diagnostics.append(
                Diagnostic(
                    severity=Severity.WARNING,
                    message="Two canonical bullets have identical text.",
                    location=location,
                )
            )

        for bullet in experience.bullets:
            diagnostics.extend(
                _placeholder_diagnostics(bullet.text, f"{location}.{bullet.id}")
            )

    for education in master.education:
        location = f"master.yaml:education.{education.id}"
        diagnostics.extend(_date_diagnostics(education.start, education.end, location))
        diagnostics.extend(_placeholder_diagnostics(education.school, location))

    return diagnostics


def _lint_overlay(overlay: Overlay) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    diagnostics.extend(
        _duplicate_selection_diagnostics(
            overlay.experience_order,
            "experience",
            f"overlays/{overlay.id}.yaml:experience_order",
        )
    )
    diagnostics.extend(
        _duplicate_selection_diagnostics(
            overlay.education,
            "education entry",
            f"overlays/{overlay.id}.yaml:education",
        )
    )
    diagnostics.extend(
        _duplicate_selection_diagnostics(
            overlay.skill_groups,
            "skill group",
            f"overlays/{overlay.id}.yaml:skill_groups",
        )
    )

    for experience_id, bullet_ids in overlay.experience_bullets.items():
        if not bullet_ids:
            diagnostics.append(
                Diagnostic(
                    severity=Severity.ERROR,
                    message="Selected experience must include at least one bullet.",
                    location=f"overlays/{overlay.id}.yaml:experience.{experience_id}",
                )
            )
        for duplicate in _duplicates(bullet_ids):
            diagnostics.append(
                Diagnostic(
                    severity=Severity.ERROR,
                    message=f"Bullet {duplicate} is selected more than once.",
                    location=f"overlays/{overlay.id}.yaml:experience.{experience_id}",
                )
            )

    return diagnostics


def _lint_resolved(overlay_id: str, resume: ResolvedResume) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []

    for experience in resume.experience:
        opening_words: list[str] = []
        if len(experience.bullets) > MAX_BULLETS_PER_JOB:
            diagnostics.append(
                Diagnostic(
                    severity=Severity.WARNING,
                    message=f"Role has {len(experience.bullets)} bullets; consider trimming it.",
                    location=f"overlay {overlay_id}:{experience.company}",
                )
            )

        for index, bullet in enumerate(experience.bullets):
            words = bullet.split()
            if words:
                opening_words.append(words[0].lower().rstrip(",.:;"))

            if len(bullet) > MAX_BULLET_CHARACTERS:
                diagnostics.append(
                    Diagnostic(
                        severity=Severity.WARNING,
                        message=f"Bullet is {len(bullet)} characters; consider tightening it.",
                        location=f"overlay {overlay_id}:{experience.company}.bullet[{index + 1}]",
                    )
                )

        for word in _duplicates(opening_words):
            diagnostics.append(
                Diagnostic(
                    severity=Severity.WARNING,
                    message=f"Multiple bullets begin with '{word}'.",
                    location=f"overlay {overlay_id}:{experience.company}",
                )
            )

    return diagnostics


def _placeholder_diagnostics(value: str, location: str) -> list[Diagnostic]:
    lowered = value.lower()
    for phrase in PLACEHOLDER_PHRASES:
        if phrase in lowered:
            return [
                Diagnostic(
                    severity=Severity.WARNING,
                    message="Replace example content before using this resume.",
                    location=location,
                )
            ]
    return []


def _date_diagnostics(
    start: str | None,
    end: str,
    location: str,
) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []

    if start is not None and not _is_supported_date(start):
        diagnostics.append(
            Diagnostic(
                severity=Severity.ERROR,
                message=f"Unsupported start date format: {start}",
                location=location,
            )
        )
    if end != "Present" and not _is_supported_date(end):
        diagnostics.append(
            Diagnostic(
                severity=Severity.ERROR,
                message=f"Unsupported end date format: {end}",
                location=location,
            )
        )

    if start is None or end == "Present":
        return diagnostics
    if not _is_supported_date(start) or not _is_supported_date(end):
        return diagnostics

    if _date_key(end) < _date_key(start):
        diagnostics.append(
            Diagnostic(
                severity=Severity.ERROR,
                message=f"End date {end} is before start date {start}.",
                location=location,
            )
        )

    return diagnostics


def _is_supported_date(value: str) -> bool:
    has_month_and_year = MONTH_YEAR_PATTERN.fullmatch(value) is not None
    has_year = YEAR_PATTERN.fullmatch(value) is not None
    return has_month_and_year or has_year


def _date_key(value: str) -> tuple[int, int]:
    if YEAR_PATTERN.fullmatch(value) is not None:
        return int(value), 12
    parsed = datetime.strptime(value, "%b %Y")
    return parsed.year, parsed.month


def _is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _duplicate_selection_diagnostics(
    values: tuple[str, ...] | None,
    kind: str,
    location: str,
) -> list[Diagnostic]:
    if values is None:
        return []
    return [
        Diagnostic(
            severity=Severity.ERROR,
            message=f"{kind.capitalize()} {duplicate} is selected more than once.",
            location=location,
        )
        for duplicate in _duplicates(values)
    ]


def _duplicate_id_diagnostics(kind: str, values: list[str]) -> list[Diagnostic]:
    return [
        Diagnostic(
            severity=Severity.ERROR,
            message=f"Duplicate {kind} ID: {duplicate}",
            location="master.yaml",
        )
        for duplicate in _duplicates(values)
    ]


def _duplicates(values: Iterable[str]) -> tuple[str, ...]:
    counts = Counter(values)
    return tuple(value for value, count in counts.items() if count > 1)


def _deduplicate(diagnostics: Iterable[Diagnostic]) -> list[Diagnostic]:
    seen: set[tuple[Severity, str, str]] = set()
    result: list[Diagnostic] = []
    for diagnostic in diagnostics:
        key = (diagnostic.severity, diagnostic.message, diagnostic.location)
        if key in seen:
            continue
        seen.add(key)
        result.append(diagnostic)
    return result
