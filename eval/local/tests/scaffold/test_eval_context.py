"""Tests for standalone Eval target resolution and user-owned state."""

import json
import os
from pathlib import Path
import subprocess

import pytest

from scaffold.python.eval_context import (
    EvalContextError,
    context_from_environment,
    resolve_managed_path,
    resolve_eval_context,
)
from scaffold.python.logging import ExperimentLogger


def _write_skill(root: Path, *, manifest_name: str | None = None) -> Path:
    skill = root / "skill"
    skill.mkdir()
    (skill / "SKILL.md").write_text("# Demo\n", encoding="utf-8")
    if manifest_name:
        manifest = skill / "comet" / manifest_name
        manifest.parent.mkdir()
        manifest.write_text(
            "\n".join(
                [
                    "apiVersion: comet.eval/v1alpha1",
                    "kind: SkillEvalManifest",
                    "metadata:",
                    "  name: demo",
                    "skill:",
                    "  name: demo",
                    "  source: ..",
                    "",
                ]
            ),
            encoding="utf-8",
        )
    return skill


@pytest.mark.parametrize("entry", ["directory", "skill-file"])
def test_skill_entries_auto_detect_only_the_skill_local_manifest(tmp_path: Path, entry: str):
    skill = _write_skill(tmp_path, manifest_name="eval.yml")
    (tmp_path / "comet").mkdir()
    (tmp_path / "comet" / "eval.yaml").write_text("unrelated", encoding="utf-8")

    context = resolve_eval_context(
        skill_path=skill if entry == "directory" else skill / "SKILL.md"
    )

    assert context.skill_root == skill.resolve()
    assert context.manifest_source == "auto-detected"
    assert context.manifest_path == (skill / "comet" / "eval.yml").resolve()
    assert context.artifact_owner_root == skill.resolve()
    assert context.artifact_root == skill / ".comet" / "eval"


def test_auto_detection_prefers_eval_yaml_before_eval_yml(tmp_path: Path):
    skill = _write_skill(tmp_path, manifest_name="eval.yml")
    yaml_manifest = skill / "comet" / "eval.yaml"
    yaml_manifest.write_text("kind: SkillEvalManifest\n", encoding="utf-8")

    context = resolve_eval_context(skill_path=skill)

    assert context.manifest_path == yaml_manifest.resolve()


def test_context_synthesizes_without_writing_into_the_skill_and_is_cwd_independent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    skill = _write_skill(tmp_path)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)

    context = resolve_eval_context(skill_path=Path("..") / "skill")

    assert context.manifest_source == "synthesized"
    assert context.manifest_path is None
    assert context.base_manifest["skill"]["source"] == str(skill.resolve())
    assert not (skill / "comet").exists()


def test_explicit_manifest_and_project_owner_are_authoritative(tmp_path: Path):
    skill = _write_skill(tmp_path)
    project = tmp_path / "project"
    project.mkdir()
    manifest = tmp_path / "outside" / "eval.yaml"
    manifest.parent.mkdir()
    manifest.write_text(
        "\n".join(
            [
                "apiVersion: comet.eval/v1alpha1",
                "kind: SkillEvalManifest",
                "metadata:",
                "  name: demo",
                "skill:",
                "  name: demo",
                f"  source: {skill.as_posix()}",
                "",
            ]
        ),
        encoding="utf-8",
    )

    context = resolve_eval_context(manifest_path=manifest, project_root=project)

    assert context.manifest_source == "explicit"
    assert context.manifest_path == manifest.resolve()
    assert context.skill_root == skill.resolve()
    assert context.artifact_owner_root == project.resolve()
    assert context.artifact_root == project.resolve() / ".comet" / "eval"


def test_context_rejects_manifest_paths_outside_the_skill_package(tmp_path: Path):
    skill = _write_skill(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    manifest = skill / "comet" / "eval.yaml"
    manifest.parent.mkdir()
    manifest.write_text(
        "kind: SkillEvalManifest\nskill:\n  source: ../../outside\n", encoding="utf-8"
    )

    with pytest.raises(EvalContextError, match="Skill package must contain SKILL.md"):
        resolve_eval_context(manifest_path=manifest)


def test_context_rejects_an_owner_comet_link_that_escapes_the_owner(tmp_path: Path):
    skill = _write_skill(tmp_path)
    owner = tmp_path / "owner"
    outside = tmp_path / "outside"
    owner.mkdir()
    outside.mkdir()
    link = owner / ".comet"
    if os.name == "nt":
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(outside)], check=True)
    else:
        link.symlink_to(outside, target_is_directory=True)

    with pytest.raises(EvalContextError, match="artifact root must stay within its owner root"):
        resolve_eval_context(skill_path=skill, project_root=owner)


@pytest.mark.parametrize(
    ("managed_root", "child"),
    [
        ("cache", "uv"),
        ("runs", "report"),
        ("generated", "demo"),
        ("locks", "generation.lock"),
    ],
)
def test_managed_paths_reject_owner_child_links_that_escape(
    tmp_path: Path, managed_root: str, child: str
):
    skill = _write_skill(tmp_path)
    owner = tmp_path / "owner"
    outside = tmp_path / "outside"
    owner.mkdir()
    outside.mkdir()
    context = resolve_eval_context(skill_path=skill, project_root=owner)
    link = context.artifact_root / managed_root
    link.parent.mkdir(parents=True)
    if os.name == "nt":
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(outside)], check=True)
    else:
        link.symlink_to(outside, target_is_directory=True)

    with pytest.raises(EvalContextError, match="managed path must stay within its owner root"):
        resolve_managed_path(context, managed_root, child)


def test_environment_context_preserves_user_owned_artifact_root_and_rejects_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    skill = _write_skill(tmp_path)
    context = resolve_eval_context(skill_path=skill)
    payload = context.to_payload()
    monkeypatch.setenv("COMET_EVAL_CONTEXT", json.dumps(payload))

    assert context_from_environment() == context

    payload["api_key"] = "secret"
    monkeypatch.setenv("COMET_EVAL_CONTEXT", json.dumps(payload))
    with pytest.raises(EvalContextError, match="credentials"):
        context_from_environment()


def test_run_layout_and_metadata_are_user_owned_and_written_atomically(tmp_path: Path, monkeypatch):
    skill = _write_skill(tmp_path)
    context = resolve_eval_context(skill_path=skill)
    monkeypatch.setenv("COMET_EVAL_CONTEXT", json.dumps(context.to_payload()))
    replacements = []
    import scaffold.python.logging as logging

    original_replace = logging.os.replace
    monkeypatch.setattr(
        logging.os,
        "replace",
        lambda source, target: (replacements.append((source, target)), original_replace(source, target))[1],
    )
    logger = ExperimentLogger(experiment_name="standalone", experiment_id="run-1")
    logger.finalize()

    assert logger.base_dir == context.artifact_root / "runs" / "run-1"
    assert {
        path.name
        for path in [logger.events_dir, logger.reports_dir, logger.raw_dir, logger.base_dir / "artifacts"]
    } == {"events", "reports", "raw", "artifacts"}
    assert (logger.base_dir / "summary.md").is_file()
    assert (logger.base_dir / "metadata.json").is_file()
    assert replacements and replacements[-1][1] == logger.base_dir / "metadata.json"
    assert "secret" not in (logger.base_dir / "metadata.json").read_text(encoding="utf-8")
