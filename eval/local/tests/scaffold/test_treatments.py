"""Unit tests for comet eval treatment loading."""

from pathlib import Path

import pytest

from scaffold.python.treatments import (
    TreatmentConfig,
    build_treatment_skills,
    list_treatments,
    load_treatments,
    load_treatments_yaml,
)
from scaffold.python.paths import get_skills_dir


BASIC_TREATMENT_YAML = """
_common_section: &common |
  Shared guidance.

CONTROL:
  description: "No skills baseline"
  skills: []

INLINE_COMET:
  description: "Inline skill treatment"
  claude_md: "Use the comet workflow."
  skills:
    - skill: inline_comet
      name: inline-comet
      content: *common
  noise_tasks:
    - DISTRACTOR
"""


@pytest.fixture
def treatment_file(tmp_path: Path) -> Path:
    path = tmp_path / "treatments.yaml"
    path.write_text(BASIC_TREATMENT_YAML)
    return path


def test_load_treatments_yaml_skips_anchor_keys(treatment_file: Path):
    treatments = load_treatments_yaml(treatment_file)

    assert list(treatments) == ["CONTROL", "INLINE_COMET"]
    assert treatments["INLINE_COMET"].noise_tasks == ["DISTRACTOR"]
    assert treatments["INLINE_COMET"].claude_md == "Use the comet workflow."


def test_build_treatment_skills_accepts_inline_content_and_generated_names():
    skills = build_treatment_skills(
        [
            {"skill": "snake_case_skill", "content": "Inline content"},
            {"skill": "ignored", "name": "explicit-name", "content": "Explicit content"},
        ]
    )

    assert "snake-case-skill" in skills
    assert "snake_case_skill" not in skills
    assert skills["snake-case-skill"]["sections"] == ["Inline content"]
    assert skills["explicit-name"]["sections"] == ["Explicit content"]


def test_build_treatment_skills_accepts_path_skill_source(tmp_path: Path):
    skill_dir = tmp_path / "local-skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "---\nname: local-skill\ndescription: Local test skill.\n---\n\nUse this skill.",
        encoding="utf-8",
    )
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir()
    (scripts_dir / "helper.py").write_text("print('ok')", encoding="utf-8")

    skills = build_treatment_skills(
        [{"name": "local-skill", "source": "path", "path": str(skill_dir)}]
    )

    assert skills["local-skill"]["sections"] == [
        "---\nname: local-skill\ndescription: Local test skill.\n---\n\nUse this skill."
    ]
    assert skills["local-skill"]["scripts_dir"] == scripts_dir
    assert skills["local-skill"]["script_filter"] is None
    assert skills["local-skill"]["source"]["source_type"] == "path"
    assert skills["local-skill"]["source"]["hash"].startswith("sha256:")


def test_build_treatment_skills_rejects_path_without_skill_md(tmp_path: Path):
    skill_dir = tmp_path / "broken-skill"
    skill_dir.mkdir()

    with pytest.raises(FileNotFoundError, match="SKILL.md"):
        build_treatment_skills([{"name": "broken-skill", "source": "path", "path": str(skill_dir)}])


def test_load_treatments_keeps_comet_core_categories_only():
    treatments = load_treatments()

    assert set(treatments) == {
        "CONTROL",
        "COMET_FULL_040_BETA",
        "COMET_FULL_039",
        "COMET_NATIVE_BATCH",
        "COMET_NATIVE_PHASE1",
        "COMET_NATIVE_SEQUENTIAL",
    }
    assert all(isinstance(treatment, TreatmentConfig) for treatment in treatments.values())


def _benchmark_child_names(*parts: str) -> set[str]:
    root = get_skills_dir() / "benchmarks"
    return {path.name for path in (root.joinpath(*parts)).iterdir() if path.is_dir()}


def test_comet_full_040_beta_includes_openspec_and_superpowers_dependencies():
    treatment = load_treatments()["COMET_FULL_040_BETA"]
    names = {skill["name"] for skill in treatment.skills}

    assert names.issuperset(
        {
            "comet",
            "comet-open",
            "comet-design",
            "comet-build",
            "comet-verify",
            "comet-archive",
            "comet-hotfix",
            "comet-tweak",
        }
    )
    assert names.issuperset(_benchmark_child_names("dependency", "openspec"))
    assert names.issuperset(_benchmark_child_names("dependency", "superpowers"))


def test_comet_full_039_includes_same_dependency_snapshot():
    treatment = load_treatments()["COMET_FULL_039"]
    names = {skill["name"] for skill in treatment.skills}

    assert names.issuperset(
        {
            "comet",
            "comet-open",
            "comet-design",
            "comet-build",
            "comet-verify",
            "comet-archive",
            "comet-hotfix",
            "comet-tweak",
        }
    )
    assert names.issuperset(_benchmark_child_names("dependency", "openspec"))
    assert names.issuperset(_benchmark_child_names("dependency", "superpowers"))


def test_comet_native_phase1_is_self_contained():
    treatment = load_treatments()["COMET_NATIVE_PHASE1"]

    assert {skill["name"] for skill in treatment.skills} == {"comet-native"}
    assert treatment.skills[0]["source"] == "path"
    assert "assets/skills/comet-native" in treatment.skills[0]["path"]
    assert treatment.skills[0]["profile"] == "generic"
    assert treatment.skills[0]["required_skills"] == ["comet-native"]
    assert treatment.skills[0]["require_skill_invocation"] is True
    assert "Shape, Build, Verify, and Archive" in treatment.claude_md
    assert "OpenSpec" in treatment.claude_md
    normalized_claude_md = " ".join(treatment.claude_md.split())
    assert "continue automatically while no user decision is unresolved" in normalized_claude_md
    assert "explicit execution boundary" in normalized_claude_md
    assert "takes priority over automatic progression" in normalized_claude_md
    assert "material user decision" not in normalized_claude_md

    skills = build_treatment_skills(treatment.skills)
    assert set(skills) == {"comet-native"}
    assert skills["comet-native"]["scripts_dir"].name == "scripts"
    assert skills["comet-native"]["source_dir"].name == "comet-native"


@pytest.mark.parametrize(
    ("name", "mode"),
    [
        ("COMET_NATIVE_SEQUENTIAL", "sequential"),
        ("COMET_NATIVE_BATCH", "batch"),
    ],
)
def test_comet_native_clarification_treatments_are_self_contained(name: str, mode: str):
    treatment = load_treatments()[name]

    assert {skill["name"] for skill in treatment.skills} == {"comet-native"}
    assert treatment.skills[0]["source"] == "path"
    assert treatment.skills[0]["profile"] == "generic"
    assert f"clarification_mode `{mode}`" in treatment.claude_md
    assert "Do not change the configured clarification mode" in treatment.claude_md


def test_comet_treatments_point_at_versioned_comet_snapshots():
    COMET_FULL_040_BETA = load_treatments()["COMET_FULL_040_BETA"]
    comet_039 = load_treatments()["COMET_FULL_039"]

    assert {
        skill["skill"] for skill in COMET_FULL_040_BETA.skills if skill["name"].startswith("comet")
    } == {
        "040-beta/comet",
        "040-beta/comet-open",
        "040-beta/comet-design",
        "040-beta/comet-build",
        "040-beta/comet-verify",
        "040-beta/comet-archive",
        "040-beta/comet-hotfix",
        "040-beta/comet-tweak",
    }
    assert {skill["skill"] for skill in comet_039.skills if skill["name"].startswith("comet")} == {
        "039-release/comet-classic-039",
        "039-release/comet-classic-039-open",
        "039-release/comet-classic-039-design",
        "039-release/comet-classic-039-build",
        "039-release/comet-classic-039-verify",
        "039-release/comet-classic-039-archive",
        "039-release/comet-classic-039-hotfix",
        "039-release/comet-classic-039-tweak",
    }


def test_comet_treatment_dependency_snapshots_are_loadable():
    for treatment_name in ["COMET_FULL_040_BETA", "COMET_FULL_039"]:
        treatment = load_treatments()[treatment_name]

        skills = build_treatment_skills(treatment.skills)

        assert {
            "openspec-new-change",
            "openspec-apply-change",
            "openspec-verify-change",
            "openspec-archive-change",
            "brainstorming",
            "executing-plans",
            "subagent-driven-development",
            "test-driven-development",
            "systematic-debugging",
            "verification-before-completion",
            "requesting-code-review",
            "writing-skills",
        }.issubset(skills)
        assert skills["comet"]["scripts_dir"].name == "scripts"
        assert skills["comet"]["source_dir"].name in {"comet", "comet-classic-039"}
        assert skills["openspec-new-change"]["sections"]
        assert skills["executing-plans"]["sections"]


def test_comet_treatment_main_skill_sources_include_rules_and_hooks():
    skills_040 = build_treatment_skills(load_treatments()["COMET_FULL_040_BETA"].skills)
    comet_040 = skills_040["comet"]
    comet_040_text = "\n\n".join(comet_040["sections"])
    assert "Skill 工具加载对应的 Comet 子 Skill" in comet_040_text
    assert "OpenSpec 或 Superpowers 技能" in comet_040_text
    assert (comet_040["source_dir"] / "rules" / "comet-phase-guard.md").exists()
    assert (comet_040["scripts_dir"] / "comet-hook-guard.mjs").exists()
    assert (comet_040["source_dir"] / "runtime" / "classic" / "skill.yaml").exists()

    skills_039 = build_treatment_skills(load_treatments()["COMET_FULL_039"].skills)
    comet_039 = skills_039["comet"]
    assert (comet_039["source_dir"] / "rules" / "comet-phase-guard.md").exists()
    assert (comet_039["scripts_dir"] / "comet-hook-guard.sh").exists()


def test_comet_full_040_beta_dependency_paths_are_loadable():
    treatment = load_treatments()["COMET_FULL_040_BETA"]

    skills = build_treatment_skills(treatment.skills)

    assert {
        "comet",
        "openspec-new-change",
        "brainstorming",
        "executing-plans",
    }.issubset(skills)
    assert "040-beta" in str(skills["comet"]["scripts_dir"])
    assert skills["openspec-new-change"]["sections"][0].startswith("---")


def test_list_treatments_is_sorted_for_stable_cli_output():
    assert list_treatments() == [
        "COMET_FULL_039",
        "COMET_FULL_040_BETA",
        "COMET_NATIVE_BATCH",
        "COMET_NATIVE_PHASE1",
        "COMET_NATIVE_SEQUENTIAL",
        "CONTROL",
    ]
