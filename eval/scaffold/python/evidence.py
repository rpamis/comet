"""Evidence references for eval reports."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

TREATMENT_NAME_ALIASES = {
    "COMET-FULL": "COMET_FULL_040_BETA",
}


@dataclass(frozen=True)
class EvalArtifactReference:
    kind: str
    path: str


def stable_treatment_name(treatment_name: str) -> str:
    alias = TREATMENT_NAME_ALIASES.get(treatment_name)
    if alias:
        return alias
    return treatment_name.replace("-", "_")


def build_eval_artifact_references(
    base_dir: Path,
    treatment_name: str,
    rep: int,
) -> dict[str, str]:
    name = stable_treatment_name(treatment_name)
    return {
        "events": str(base_dir / "events" / f"{name}_rep{rep}.json"),
        "raw_stdout": str(base_dir / "raw" / f"{name}_rep{rep}_stdout.json"),
        "raw_stderr": str(base_dir / "raw" / f"{name}_rep{rep}_stderr.txt"),
        "report": str(base_dir / "reports" / f"{name}_rep{rep}_report.json"),
        # Snapshots retain the original treatment spelling, lowercased by the writer.
        "artifacts": str(base_dir / "artifacts" / f"{treatment_name.lower()}_rep{rep}"),
    }
