from pathlib import Path

from scaffold.python.evidence import build_eval_artifact_references


def test_build_eval_artifact_references_uses_stable_paths(tmp_path: Path):
    refs = build_eval_artifact_references(tmp_path, "COMET-FULL", 2)

    assert refs == {
        "events": str(tmp_path / "events" / "COMET_FULL_040_BETA_rep2.json"),
        "raw_stdout": str(tmp_path / "raw" / "COMET_FULL_040_BETA_rep2_stdout.json"),
        "raw_stderr": str(tmp_path / "raw" / "COMET_FULL_040_BETA_rep2_stderr.txt"),
        "report": str(tmp_path / "reports" / "COMET_FULL_040_BETA_rep2_report.json"),
        "artifacts": str(tmp_path / "artifacts" / "comet-full_rep2"),
    }
