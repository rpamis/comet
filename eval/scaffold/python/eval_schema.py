"""Schema-first validation for public Eval YAML manifests."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker


_UNEXPECTED = re.compile(r"(?:'([^']+)'|\"([^\"]+)\") was unexpected")


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    schema_path = Path(__file__).resolve().parents[2] / "schemas" / "comet.eval" / "v1alpha1.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _path(parts: object) -> str:
    result = ""
    for part in parts:
        if isinstance(part, int):
            result += f"[{part}]"
        else:
            result += ("." if result else "") + str(part)
    return result or "manifest"


def validate_manifest_schema(data: Any) -> None:
    """Reject unknown/malformed fields before semantic normalization."""
    if not isinstance(data, dict):
        raise ValueError("manifest: must be a mapping")
    errors = sorted(_validator().iter_errors(data), key=lambda error: (list(error.absolute_path), error.message))
    if not errors:
        return
    error = errors[0]
    path = _path(error.absolute_path)
    if error.validator == "additionalProperties":
        match = _UNEXPECTED.search(error.message)
        field = next((part for part in (match.groups() if match else ()) if part), "unknown")
        raise ValueError(f"{field if path == 'manifest' else f'{path}.{field}'}: unknown field")
    if error.validator in {"format", "pattern"} and str(path).endswith(("baseUrl", "base_url")):
        raise ValueError(f"{path}: must be a valid absolute http(s) URL")
    raise ValueError(f"{path}: {error.message}")
