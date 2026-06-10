"""Khmer name parsing and PMRS field normalization."""

from __future__ import annotations

import re
import unicodedata

ZWSP = "\u200b"


def normalize_khmer_string(value) -> str:
    if value is None or value == "NULL":
        return ""
    text = unicodedata.normalize("NFC", str(value))
    text = text.replace(ZWSP, "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_alias(raw_name: str) -> tuple[str, str]:
    name = normalize_khmer_string(raw_name)
    alias = ""

    paren_match = re.match(r"^(.+?)\((.+)\)$", name)
    if paren_match:
        return normalize_khmer_string(paren_match.group(1)), normalize_khmer_string(paren_match.group(2))

    bracket_match = re.match(r"^(.+?)\[(.+)\]$", name)
    if bracket_match:
        return normalize_khmer_string(bracket_match.group(1)), normalize_khmer_string(bracket_match.group(2))

    return name, alias


def split_family_given(full_name: str) -> tuple[str, list[str]]:
    normalized = normalize_khmer_string(full_name)
    if not normalized:
        return "", []

    parts = [part for part in normalized.split(" ") if part]
    if not parts:
        return "", []
    if len(parts) == 1:
        return parts[0], []

    return parts[0], parts[1:]


def build_name_entry(family: str, given: list[str], use: str) -> dict | None:
    entry: dict = {"use": use}
    if family:
        entry["family"] = family
    if given:
        entry["given"] = given
    if not entry.get("family") and not entry.get("given"):
        return None
    return entry


def parse_khmer_name(raw_name: str) -> list[dict]:
    name, alias = extract_alias(raw_name)
    official = split_family_given(name)
    names: list[dict] = []

    official_entry = build_name_entry(official[0], official[1], "official")
    if official_entry:
        names.append(official_entry)

    if alias:
        alias_parts = split_family_given(alias)
        alias_entry = build_name_entry(alias_parts[0], alias_parts[1], "old")
        if alias_entry:
            names.append(alias_entry)

    return names


def is_placeholder_dob(dob: str) -> bool:
    value = normalize_khmer_string(dob)
    if not value:
        return True
    return value.endswith("-01-01")


def normalize_dob(dob: str) -> str:
    value = normalize_khmer_string(dob)
    if not value or is_placeholder_dob(value):
        return ""
    return value


def normalize_phone(phone: str) -> str:
    value = normalize_khmer_string(phone)
    if not value or value == "0000000000":
        return ""
    return value


def normalize_gender(sex: str) -> str:
    value = normalize_khmer_string(sex).upper()
    if value in {"F", "FEMALE"}:
        return "female"
    if value in {"M", "MALE"}:
        return "male"
    return "unknown"
