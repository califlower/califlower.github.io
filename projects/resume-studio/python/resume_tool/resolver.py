from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from resume_tool.errors import ResumeError
from resume_tool.models import (
    MasterResume,
    Overlay,
    ResolvedEducation,
    ResolvedExperience,
    ResolvedResume,
    ResolvedSkillGroup,
)
from resume_tool.repository import ResumeRepository


@dataclass(frozen=True, slots=True)
class OverlaySelection:
    summary: str | None
    experience_order: tuple[str, ...] | None
    experience_bullets: Mapping[str, tuple[str, ...]]
    education: tuple[str, ...] | None
    skill_groups: tuple[str, ...] | None


class ResumeResolver:
    def __init__(self, repository: ResumeRepository) -> None:
        self.repository = repository

    def resolve(self, overlay_id: str) -> ResolvedResume:
        master = self.repository.load_master()
        selection = self._resolve_selection(overlay_id, ())
        return _resolve_resume(master, selection, overlay_id)

    def overlay_chain(self, overlay_id: str) -> tuple[Overlay, ...]:
        return self._overlay_chain(overlay_id, ())

    def _resolve_selection(
        self,
        overlay_id: str,
        active: tuple[str, ...],
    ) -> OverlaySelection:
        chain = self._overlay_chain(overlay_id, active)
        selection = OverlaySelection(
            summary=None,
            experience_order=None,
            experience_bullets={},
            education=None,
            skill_groups=None,
        )
        for overlay in chain:
            selection = _merge(selection, overlay)
        return selection

    def _overlay_chain(
        self,
        overlay_id: str,
        active: tuple[str, ...],
    ) -> tuple[Overlay, ...]:
        if overlay_id in active:
            cycle = " -> ".join((*active, overlay_id))
            raise ResumeError(f"Circular overlay inheritance: {cycle}")

        overlay = self.repository.load_overlay(overlay_id)
        if overlay.extends is None:
            return (overlay,)

        parent_chain = self._overlay_chain(overlay.extends, (*active, overlay_id))
        return (*parent_chain, overlay)


def _merge(selection: OverlaySelection, overlay: Overlay) -> OverlaySelection:
    summary = selection.summary
    if overlay.summary is not None:
        summary = overlay.summary

    experience_order = selection.experience_order
    experience_bullets = dict(selection.experience_bullets)
    if overlay.experience_order is not None:
        experience_order = overlay.experience_order
        experience_bullets = {
            experience_id: bullet_ids
            for experience_id, bullet_ids in experience_bullets.items()
            if experience_id in experience_order
        }
    experience_bullets.update(overlay.experience_bullets)

    education = selection.education
    if overlay.education is not None:
        education = overlay.education

    skill_groups = selection.skill_groups
    if overlay.skill_groups is not None:
        skill_groups = overlay.skill_groups

    return OverlaySelection(
        summary=summary,
        experience_order=experience_order,
        experience_bullets=experience_bullets,
        education=education,
        skill_groups=skill_groups,
    )


def _resolve_resume(
    master: MasterResume,
    selection: OverlaySelection,
    overlay_id: str,
) -> ResolvedResume:
    if selection.experience_order is None:
        raise ResumeError(f"Overlay {overlay_id} does not define experience_order")
    if selection.education is None:
        raise ResumeError(f"Overlay {overlay_id} does not define education")
    if selection.skill_groups is None:
        raise ResumeError(f"Overlay {overlay_id} does not define skill_groups")

    _require_unique(selection.experience_order, "experience", overlay_id)
    _require_unique(selection.education, "education entry", overlay_id)
    _require_unique(selection.skill_groups, "skill group", overlay_id)

    selected_experience = set(selection.experience_order)
    unused_experience = sorted(set(selection.experience_bullets) - selected_experience)
    if unused_experience:
        names = ", ".join(unused_experience)
        raise ResumeError(f"Overlay {overlay_id} selects bullets for omitted experience: {names}")

    summary_text = None
    if selection.summary is not None:
        summary = master.summaries_by_id.get(selection.summary)
        if summary is None:
            raise ResumeError(f"Unknown summary ID: {selection.summary}")
        summary_text = summary.text

    resolved_experience: list[ResolvedExperience] = []
    for experience_id in selection.experience_order:
        experience = master.experiences_by_id.get(experience_id)
        if experience is None:
            raise ResumeError(f"Unknown experience ID: {experience_id}")

        bullet_ids = selection.experience_bullets.get(experience_id)
        if bullet_ids is None:
            raise ResumeError(
                f"No bullet selection for experience {experience_id} in overlay {overlay_id}"
            )

        if not bullet_ids:
            raise ResumeError(f"Experience {experience_id} has no selected bullets")
        _require_unique(bullet_ids, f"bullet in {experience_id}", overlay_id)

        bullet_lookup = experience.bullets_by_id
        bullets: list[str] = []
        for bullet_id in bullet_ids:
            bullet = bullet_lookup.get(bullet_id)
            if bullet is None:
                raise ResumeError(
                    f"Unknown bullet ID {experience_id}.{bullet_id} in overlay {overlay_id}"
                )
            bullets.append(bullet.text)

        resolved_experience.append(
            ResolvedExperience(
                company=experience.company,
                title=experience.title,
                location=experience.location,
                start=experience.start,
                end=experience.end,
                bullets=tuple(bullets),
            )
        )

    resolved_education: list[ResolvedEducation] = []
    for education_id in selection.education:
        entry = master.education_by_id.get(education_id)
        if entry is None:
            raise ResumeError(f"Unknown education ID: {education_id}")
        resolved_education.append(
            ResolvedEducation(
                school=entry.school,
                degree=entry.degree,
                location=entry.location,
                start=entry.start,
                end=entry.end,
                details=entry.details,
            )
        )

    resolved_skills: list[ResolvedSkillGroup] = []
    for group_id in selection.skill_groups:
        group = master.skill_groups_by_id.get(group_id)
        if group is None:
            raise ResumeError(f"Unknown skill group ID: {group_id}")
        resolved_skills.append(
            ResolvedSkillGroup(label=group.label, items=group.items)
        )

    return ResolvedResume(
        profile=master.profile,
        summary=summary_text,
        experience=tuple(resolved_experience),
        education=tuple(resolved_education),
        skills=tuple(resolved_skills),
    )


def _require_unique(values: tuple[str, ...], kind: str, overlay_id: str) -> None:
    seen: set[str] = set()
    duplicates: list[str] = []
    for value in values:
        if value in seen and value not in duplicates:
            duplicates.append(value)
        seen.add(value)

    if duplicates:
        names = ", ".join(duplicates)
        raise ResumeError(f"Overlay {overlay_id} repeats {kind}: {names}")
