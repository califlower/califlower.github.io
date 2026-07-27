from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import yaml

from resume_tool.errors import ResumeError
from resume_tool.models import (
    Bullet,
    ContactLink,
    Education,
    Experience,
    JsonMapping,
    MasterResume,
    Overlay,
    Profile,
    SkillGroup,
    Summary,
)


ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class UniqueKeyLoader(yaml.SafeLoader):
    pass


def _construct_mapping(
    loader: UniqueKeyLoader,
    node: yaml.MappingNode,
    deep: bool = False,
) -> dict[Any, Any]:
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise ResumeError(f"Duplicate YAML key: {key}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_mapping,
)


class ResumeRepository:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.master_path = self.root / "master.yaml"
        self.lock_path = self.root / "uv.lock"
        self.overlays_path = self.root / "overlays"
        self.releases_path = self.root / "releases"
        self.submissions_path = self.root / "submissions"
        self.output_path = self.root / "output"
        self.template_path = self.root / "template" / "resume.typ"

    @classmethod
    def discover(cls, start: Path | None = None) -> ResumeRepository:
        current = Path.cwd()
        if start is not None:
            current = start
        current = current.resolve()

        for candidate in (current, *current.parents):
            if (candidate / "pyproject.toml").exists() and (candidate / "master.yaml").exists():
                return cls(candidate)

        raise ResumeError("Run this command inside the resume repository.")

    def load_master(self) -> MasterResume:
        data = self._load_yaml(self.master_path)
        return _parse_master(data)

    def load_overlay(self, overlay_id: str) -> Overlay:
        path = self.overlay_path(overlay_id)
        data = self._load_yaml(path)
        return _parse_overlay(overlay_id, path, data)

    def overlay_path(self, overlay_id: str) -> Path:
        normalized = overlay_id.replace("\\", "/").strip("/")
        path = self.overlays_path / f"{normalized}.yaml"
        resolved = path.resolve()
        if self.overlays_path.resolve() not in resolved.parents:
            raise ResumeError(f"Invalid overlay name: {overlay_id}")
        if not resolved.exists():
            raise ResumeError(f"Overlay not found: {overlay_id}")
        return resolved

    def overlay_ids(self) -> tuple[str, ...]:
        if not self.overlays_path.exists():
            return ()
        ids: list[str] = []
        for path in sorted(self.overlays_path.rglob("*.yaml")):
            relative = path.relative_to(self.overlays_path).with_suffix("")
            ids.append(relative.as_posix())
        return tuple(ids)

    def write_yaml(self, path: Path, data: Mapping[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        text = yaml.safe_dump(
            dict(data),
            allow_unicode=True,
            sort_keys=False,
            width=100,
        )
        path.write_text(text, encoding="utf-8")

    def _load_yaml(self, path: Path) -> JsonMapping:
        if not path.exists():
            raise ResumeError(f"File not found: {path.relative_to(self.root)}")
        try:
            loaded = yaml.load(path.read_text(encoding="utf-8"), Loader=UniqueKeyLoader)
        except yaml.YAMLError as error:
            raise ResumeError(f"Invalid YAML in {path.relative_to(self.root)}: {error}") from error
        if not isinstance(loaded, Mapping):
            raise ResumeError(f"{path.relative_to(self.root)} must contain a YAML mapping.")
        return loaded


def _parse_master(data: JsonMapping) -> MasterResume:
    _require_only_keys(
        data,
        {"profile", "summaries", "experience", "education", "skill_groups"},
        "master.yaml",
    )

    profile_data = _mapping(data, "profile")
    _require_only_keys(
        profile_data,
        {"name", "location", "email", "phone", "links"},
        "profile",
    )
    links = tuple(
        _parse_contact_link(item, index)
        for index, item in enumerate(
            _mapping_items(_sequence(profile_data, "links"), "profile.links")
        )
    )
    profile = Profile(
        name=_string(profile_data, "name"),
        location=_string(profile_data, "location"),
        email=_string(profile_data, "email"),
        phone=_optional_string(profile_data, "phone"),
        links=links,
    )

    summaries = tuple(
        _parse_summary(item, index)
        for index, item in enumerate(
            _mapping_items(_sequence(data, "summaries"), "summaries")
        )
    )

    experiences = tuple(
        _parse_experience(item, index)
        for index, item in enumerate(
            _mapping_items(_sequence(data, "experience"), "experience")
        )
    )

    education = tuple(
        _parse_education(item, index)
        for index, item in enumerate(
            _mapping_items(_sequence(data, "education"), "education")
        )
    )

    skill_groups = tuple(
        _parse_skill_group(item, index)
        for index, item in enumerate(
            _mapping_items(_sequence(data, "skill_groups"), "skill_groups")
        )
    )

    return MasterResume(
        profile=profile,
        summaries=summaries,
        experiences=experiences,
        education=education,
        skill_groups=skill_groups,
    )


def _parse_contact_link(data: JsonMapping, index: int) -> ContactLink:
    location = f"profile.links[{index}]"
    _require_only_keys(data, {"label", "value", "url"}, location)
    return ContactLink(
        label=_string(data, "label"),
        value=_string(data, "value"),
        url=_optional_string(data, "url"),
    )


def _parse_summary(data: JsonMapping, index: int) -> Summary:
    location = f"summaries[{index}]"
    _require_only_keys(data, {"id", "text"}, location)
    return Summary(
        id=_id(data, "id", location),
        text=_string(data, "text"),
    )


def _parse_experience(data: JsonMapping, index: int) -> Experience:
    location = f"experience[{index}]"
    _require_only_keys(
        data,
        {"id", "company", "title", "location", "start", "end", "bullets"},
        location,
    )
    bullets = tuple(
        _parse_bullet(item, bullet_index, location)
        for bullet_index, item in enumerate(
            _mapping_items(_sequence(data, "bullets"), f"{location}.bullets")
        )
    )
    return Experience(
        id=_id(data, "id", location),
        company=_string(data, "company"),
        title=_string(data, "title"),
        location=_string(data, "location"),
        start=_string(data, "start"),
        end=_string(data, "end"),
        bullets=bullets,
    )


def _parse_bullet(data: JsonMapping, index: int, parent: str) -> Bullet:
    location = f"{parent}.bullets[{index}]"
    _require_only_keys(data, {"id", "text"}, location)
    return Bullet(
        id=_id(data, "id", location),
        text=_string(data, "text"),
    )


def _parse_education(data: JsonMapping, index: int) -> Education:
    location = f"education[{index}]"
    _require_only_keys(
        data,
        {"id", "school", "degree", "location", "start", "end", "details"},
        location,
    )
    return Education(
        id=_id(data, "id", location),
        school=_string(data, "school"),
        degree=_string(data, "degree"),
        location=_string(data, "location"),
        start=_optional_string(data, "start"),
        end=_string(data, "end"),
        details=_string_tuple(data, "details"),
    )


def _parse_skill_group(data: JsonMapping, index: int) -> SkillGroup:
    location = f"skill_groups[{index}]"
    _require_only_keys(data, {"id", "label", "items"}, location)
    return SkillGroup(
        id=_id(data, "id", location),
        label=_string(data, "label"),
        items=_string_tuple(data, "items"),
    )


def _parse_overlay(overlay_id: str, source_path: Path, data: JsonMapping) -> Overlay:
    _require_only_keys(
        data,
        {"extends", "summary", "experience_order", "experience", "education", "skill_groups"},
        f"overlay {overlay_id}",
    )

    experience_data = data.get("experience", {})
    if not isinstance(experience_data, Mapping):
        raise ResumeError(f"experience in overlay {overlay_id} must be a mapping")

    experience_bullets: dict[str, tuple[str, ...]] = {}
    for experience_id, bullet_ids in experience_data.items():
        if not isinstance(experience_id, str) or not experience_id.strip():
            raise ResumeError(f"Experience IDs in overlay {overlay_id} must be strings")
        _validate_id(experience_id, f"overlay {overlay_id}.experience")
        experience_bullets[experience_id] = _plain_string_tuple(
            bullet_ids,
            f"experience.{experience_id}",
        )

    return Overlay(
        id=overlay_id,
        source_path=source_path,
        extends=_optional_string(data, "extends"),
        summary=_optional_string(data, "summary"),
        experience_order=_optional_string_tuple(data, "experience_order"),
        experience_bullets=experience_bullets,
        education=_optional_string_tuple(data, "education"),
        skill_groups=_optional_string_tuple(data, "skill_groups"),
    )


def _require_only_keys(data: JsonMapping, allowed: set[str], location: str) -> None:
    unknown = sorted(set(data) - allowed)
    if unknown:
        names = ", ".join(unknown)
        raise ResumeError(f"Unknown keys in {location}: {names}")


def _mapping(data: JsonMapping, key: str) -> JsonMapping:
    value = data.get(key)
    if not isinstance(value, Mapping):
        raise ResumeError(f"{key} must be a mapping")
    return value


def _sequence(data: JsonMapping, key: str) -> Sequence[Any]:
    value = data.get(key)
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise ResumeError(f"{key} must be a list")
    return value


def _mapping_items(values: Sequence[Any], location: str) -> tuple[JsonMapping, ...]:
    items: list[JsonMapping] = []
    for index, value in enumerate(values):
        if not isinstance(value, Mapping):
            raise ResumeError(f"{location}[{index}] must be a mapping")
        items.append(value)
    return tuple(items)


def _id(data: JsonMapping, key: str, location: str) -> str:
    value = _string(data, key)
    _validate_id(value, location)
    return value


def _validate_id(value: str, location: str) -> None:
    if ID_PATTERN.fullmatch(value) is None:
        raise ResumeError(f"ID in {location} must use lowercase kebab-case: {value}")


def _string(data: JsonMapping, key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ResumeError(f"{key} must be a non-empty string")
    return value.strip()


def _optional_string(data: JsonMapping, key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ResumeError(f"{key} must be a non-empty string when provided")
    return value.strip()


def _string_tuple(data: JsonMapping, key: str) -> tuple[str, ...]:
    return _plain_string_tuple(_sequence(data, key), key)


def _optional_string_tuple(data: JsonMapping, key: str) -> tuple[str, ...] | None:
    value = data.get(key)
    if value is None:
        return None
    return _plain_string_tuple(value, key)


def _plain_string_tuple(value: Any, location: str) -> tuple[str, ...]:
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise ResumeError(f"{location} must be a list")

    result: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            raise ResumeError(f"{location}[{index}] must be a non-empty string")
        result.append(item.strip())
    return tuple(result)
