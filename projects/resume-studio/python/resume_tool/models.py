from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any


JsonMapping = Mapping[str, Any]


class Severity(StrEnum):
    ERROR = "error"
    WARNING = "warning"


@dataclass(frozen=True, slots=True)
class Diagnostic:
    severity: Severity
    message: str
    location: str


@dataclass(frozen=True, slots=True)
class ContactLink:
    label: str
    value: str
    url: str | None = None


@dataclass(frozen=True, slots=True)
class Profile:
    name: str
    location: str
    email: str
    phone: str | None
    links: tuple[ContactLink, ...]


@dataclass(frozen=True, slots=True)
class Summary:
    id: str
    text: str


@dataclass(frozen=True, slots=True)
class Bullet:
    id: str
    text: str


@dataclass(frozen=True, slots=True)
class Experience:
    id: str
    company: str
    title: str
    location: str
    start: str
    end: str
    bullets: tuple[Bullet, ...]

    @property
    def bullets_by_id(self) -> dict[str, Bullet]:
        return {bullet.id: bullet for bullet in self.bullets}


@dataclass(frozen=True, slots=True)
class Education:
    id: str
    school: str
    degree: str
    location: str
    start: str | None
    end: str
    details: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SkillGroup:
    id: str
    label: str
    items: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class MasterResume:
    profile: Profile
    summaries: tuple[Summary, ...]
    experiences: tuple[Experience, ...]
    education: tuple[Education, ...]
    skill_groups: tuple[SkillGroup, ...]

    @property
    def summaries_by_id(self) -> dict[str, Summary]:
        return {summary.id: summary for summary in self.summaries}

    @property
    def experiences_by_id(self) -> dict[str, Experience]:
        return {experience.id: experience for experience in self.experiences}

    @property
    def education_by_id(self) -> dict[str, Education]:
        return {entry.id: entry for entry in self.education}

    @property
    def skill_groups_by_id(self) -> dict[str, SkillGroup]:
        return {group.id: group for group in self.skill_groups}


@dataclass(frozen=True, slots=True)
class Overlay:
    id: str
    source_path: Path
    extends: str | None
    summary: str | None
    experience_order: tuple[str, ...] | None
    experience_bullets: Mapping[str, tuple[str, ...]]
    education: tuple[str, ...] | None
    skill_groups: tuple[str, ...] | None


@dataclass(frozen=True, slots=True)
class ResolvedExperience:
    company: str
    title: str
    location: str
    start: str
    end: str
    bullets: tuple[str, ...]

    def to_mapping(self) -> dict[str, Any]:
        return {
            "company": self.company,
            "title": self.title,
            "location": self.location,
            "start": self.start,
            "end": self.end,
            "bullets": list(self.bullets),
        }


@dataclass(frozen=True, slots=True)
class ResolvedEducation:
    school: str
    degree: str
    location: str
    start: str | None
    end: str
    details: tuple[str, ...]

    def to_mapping(self) -> dict[str, Any]:
        return {
            "school": self.school,
            "degree": self.degree,
            "location": self.location,
            "start": self.start,
            "end": self.end,
            "details": list(self.details),
        }


@dataclass(frozen=True, slots=True)
class ResolvedSkillGroup:
    label: str
    items: tuple[str, ...]

    def to_mapping(self) -> dict[str, Any]:
        return {"label": self.label, "items": list(self.items)}


@dataclass(frozen=True, slots=True)
class ResolvedResume:
    profile: Profile
    summary: str | None
    experience: tuple[ResolvedExperience, ...]
    education: tuple[ResolvedEducation, ...]
    skills: tuple[ResolvedSkillGroup, ...]

    def to_mapping(self) -> dict[str, Any]:
        return {
            "profile": {
                "name": self.profile.name,
                "location": self.profile.location,
                "email": self.profile.email,
                "phone": self.profile.phone,
                "links": [
                    {"label": link.label, "value": link.value, "url": link.url}
                    for link in self.profile.links
                ],
            },
            "summary": self.summary,
            "experience": [item.to_mapping() for item in self.experience],
            "education": [item.to_mapping() for item in self.education],
            "skills": [item.to_mapping() for item in self.skills],
        }

    @classmethod
    def from_mapping(cls, data: JsonMapping) -> ResolvedResume:
        profile_data = _mapping(data, "profile")
        links_data = _sequence(profile_data, "links")
        links = tuple(
            ContactLink(
                label=_string(item, "label"),
                value=_string(item, "value"),
                url=_optional_string(item, "url"),
            )
            for item in _mapping_items(links_data, "profile.links")
        )
        profile = Profile(
            name=_string(profile_data, "name"),
            location=_string(profile_data, "location"),
            email=_string(profile_data, "email"),
            phone=_optional_string(profile_data, "phone"),
            links=links,
        )

        experience = tuple(
            ResolvedExperience(
                company=_string(item, "company"),
                title=_string(item, "title"),
                location=_string(item, "location"),
                start=_string(item, "start"),
                end=_string(item, "end"),
                bullets=_string_tuple(item, "bullets"),
            )
            for item in _mapping_items(_sequence(data, "experience"), "experience")
        )
        education = tuple(
            ResolvedEducation(
                school=_string(item, "school"),
                degree=_string(item, "degree"),
                location=_string(item, "location"),
                start=_optional_string(item, "start"),
                end=_string(item, "end"),
                details=_string_tuple(item, "details"),
            )
            for item in _mapping_items(_sequence(data, "education"), "education")
        )
        skills = tuple(
            ResolvedSkillGroup(
                label=_string(item, "label"),
                items=_string_tuple(item, "items"),
            )
            for item in _mapping_items(_sequence(data, "skills"), "skills")
        )

        return cls(
            profile=profile,
            summary=_optional_string(data, "summary"),
            experience=experience,
            education=education,
            skills=skills,
        )


def _mapping(data: JsonMapping, key: str) -> JsonMapping:
    value = data.get(key)
    if not isinstance(value, Mapping):
        raise ValueError(f"{key} must be a mapping")
    return value


def _sequence(data: JsonMapping, key: str) -> Sequence[Any]:
    value = data.get(key)
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise ValueError(f"{key} must be a list")
    return value


def _mapping_items(values: Sequence[Any], location: str) -> tuple[JsonMapping, ...]:
    items: list[JsonMapping] = []
    for index, value in enumerate(values):
        if not isinstance(value, Mapping):
            raise ValueError(f"{location}[{index}] must be a mapping")
        items.append(value)
    return tuple(items)


def _string(data: JsonMapping, key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _optional_string(data: JsonMapping, key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string when provided")
    return value


def _string_tuple(data: JsonMapping, key: str) -> tuple[str, ...]:
    values = _sequence(data, key)
    result: list[str] = []
    for index, value in enumerate(values):
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{key}[{index}] must be a non-empty string")
        result.append(value)
    return tuple(result)
