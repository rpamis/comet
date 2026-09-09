from pathlib import Path

from scaffold.python.validation import comet_workflow, rubric


def configure(root: Path, workflow: str = "classic", layout: str = "docs") -> None:
    (root / ".comet").mkdir()
    (root / ".comet/config.yaml").write_text(
        f"default_workflow: {workflow}\nworkflows: [native, classic]\n"
        f"native:\n  artifact_root: docs\nclassic:\n  artifact_layout: {layout}\n",
        encoding="utf-8",
    )


def test_classic_config_is_not_native_even_when_both_are_enabled(tmp_path):
    configure(tmp_path)
    assert not rubric._is_native_eval({}, tmp_path)


def test_observed_classic_entry_overrides_default_native(tmp_path):
    configure(tmp_path, workflow="native")
    outputs = {"events": {"skills_invoked": ["comet-classic", "comet-open"]}}
    assert not rubric._is_native_eval(outputs, tmp_path)


def test_native_rubric_emits_all_dimensions_without_unpacking_error(tmp_path, monkeypatch):
    configure(tmp_path, workflow="native")
    monkeypatch.setenv("BENCH_LLM_JUDGE", "0")
    passed, failed = rubric.comet_rubric_validator(
        tmp_path, {"events": {"skills_invoked": ["comet-native"]}}
    )
    assert len([p for p in passed if p.startswith("[RUBRIC]")]) == len(rubric.RUBRIC_DIMENSIONS) + 1
    assert not failed


def test_docs_layout_comes_from_config_not_treatment_name(tmp_path, monkeypatch):
    configure(tmp_path)
    change = tmp_path / "docs/openspec/changes/archive/example"
    change.mkdir(parents=True)
    (change / "proposal.md").write_text("proposal", encoding="utf-8")
    (change / "tasks.md").write_text("tasks", encoding="utf-8")
    monkeypatch.setattr(comet_workflow, "WORKSPACE", tmp_path)
    assert comet_workflow.check_openspec_artifacts()["status"] == "passed"
    assert rubric._changes_root(tmp_path, {"treatment_name": "ANY_CLASSIC"}) == change.parent.parent


def test_explicit_legacy_layout_is_not_overridden_by_treatment(tmp_path):
    configure(tmp_path, layout="legacy")
    assert rubric._changes_root(tmp_path, {"treatment_name": "COMET_CLASSIC_DOCS_LAYOUT"}) == tmp_path / "openspec/changes"


def test_explicit_classic_entry_counts_without_generic_router(tmp_path, monkeypatch):
    configure(tmp_path)
    monkeypatch.setenv("BENCH_LLM_JUDGE", "0")
    events = {"skills_invoked": ["comet-classic", "comet-open", "openspec-new-change", "writing-plans"]}
    assert rubric._score_skill_invocation(events)[0] == 1.0
    _, failed = rubric.comet_rubric_validator(tmp_path, {"events": events})
    assert not failed
