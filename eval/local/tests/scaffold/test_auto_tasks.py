"""Tests for automatic task generation and its cache contract."""

import json
from pathlib import Path

import pytest
import yaml

from scaffold.python.auto_tasks import (
    AutoTaskError,
    GenerationOutput,
    build_skill_snapshot,
    ensure_generated_manifest,
    _generation_prompt,
)


def _write_skill(tmp_path: Path) -> Path:
    skill = tmp_path / "my-skill"
    (skill / "references").mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "Use the reference in `references/format.md` and write result.md.\n", encoding="utf-8"
    )
    (skill / "references" / "format.md").write_text("# Format\n", encoding="utf-8")
    (tmp_path / "unrelated.txt").write_text("do not include\n", encoding="utf-8")
    return skill


def _generated_payload():
    return {
        "tasks": [
            {
                "name": "normal-flow",
                "prompt": "Use the Skill to create result.md.",
                "expect": {"files": ["result.md"]},
            },
            {
                "name": "boundary-flow",
                "prompt": "Use the Skill with an invalid input and document recovery.",
                "expect": {"contains": {"result.md": ["recovery"]}},
                "rubric": ["The recovery is clear."],
            },
        ]
    }


def test_generator_prompt_explains_supported_expect_shapes_and_relative_paths(tmp_path):
    prompt = _generation_prompt(build_skill_snapshot(_write_skill(tmp_path)), profile="generic")
    for contract in (
        "workspace-relative paths", "CONTEXT.md", "src/calculator.py",
        '"contains": {"CONTEXT.md": ["confirmed requirement"]}',
        '"json": [{"file": "result.json", "path": "$.status", "equals": "completed"}]',
        '"commands": [{"run": "python -m pytest", "timeout": 120}]',
        "1..3600", "Do not prefix artifact paths with /workspace",
        "Rubric alone does not satisfy", "Do not infer new workflow files",
    ):
        assert contract in prompt
    from scaffold.python.manifests import _parse_inline_expect
    start = prompt.index('{\n  "files"')
    end = prompt.index("\n}", start) + 2
    example = json.loads(prompt[start:end])
    assert _parse_inline_expect(example, "example") == example


def test_generator_prompt_keeps_every_snapshot_file_and_all_content():
    from scaffold.python.auto_tasks import SkillSnapshot, SnapshotFile
    first = "long Skill content\n" + "x" * 20000 + "\nEND OF SKILL"
    second = "full application implementation\n" + "y" * 20000 + "\nEND OF MODULE"
    snapshot = SkillSnapshot((SnapshotFile("SKILL.md", first, "first-hash"), SnapshotFile("scripts/application/application.mjs", second, "second-hash")), "snapshot-hash")
    prompt = _generation_prompt(snapshot, profile="generic")
    assert first in prompt
    assert second in prompt


@pytest.mark.parametrize("expect", [
    {"files": ["/workspace/eval-grill-normal/CONTEXT.md"]},
    {"contains": {"/workspace/CONTEXT.md": ["confirmed"]}},
    {"json": [{"file": "/workspace/result.json", "path": "$.status", "equals": "completed"}]},
])
def test_generation_rejects_absolute_expect_paths_instead_of_converting_them_to_success(tmp_path, expect):
    skill = _write_skill(tmp_path)
    calls = []
    def generate(prompt):
        calls.append(prompt)
        payload = _generated_payload()
        payload["tasks"][0]["expect"] = expect
        return payload
    with pytest.raises(AutoTaskError, match=r"expect.*does not match"):
        ensure_generated_manifest(skill, tmp_path, agent="codex", model="test", profile="generic", interaction={"mode": "none"}, generate=generate)
    assert len(calls) == 2
    assert "does not match" in calls[1]
    assert not list(tmp_path.rglob("eval.yaml"))


def test_skill_snapshot_is_bounded_to_relevant_package_files(tmp_path: Path):
    skill = _write_skill(tmp_path)

    snapshot = build_skill_snapshot(skill)

    paths = {item.path for item in snapshot.files}
    assert paths == {"SKILL.md", "references/format.md"}
    assert "unrelated.txt" not in paths
    assert snapshot.content_hash.startswith("sha256:")


def _write_sdk_snapshot(tmp_path):
    skill = _write_skill(tmp_path)
    (skill / "scripts/application/skills/dependency").mkdir(parents=True)
    (skill / "scripts/application/application.json").write_text('{"id":"fixed-app"}', encoding="utf-8")
    (skill / "references/workflows.json").write_text('{"workflows":[]}', encoding="utf-8")
    return skill


def test_sdk_snapshot_includes_all_fixed_dependency_text_without_generic_limits(tmp_path):
    skill = _write_sdk_snapshot(tmp_path)
    dependency = skill / "scripts/application/skills/dependency"
    resources = {}
    for index in range(140):
        content = f"Resource {index}\n" + "完整说明" * 1024 + f"\nEND {index}"
        file = dependency / f"resource-{index:03}.md"
        file.write_bytes(content.encode("utf-8"))
        resources[file.relative_to(skill).as_posix()] = content
    (skill / "RULE.md").write_text("Entire application Rule", encoding="utf-8")
    snapshot = build_skill_snapshot(skill)
    actual = {item.path: item for item in snapshot.files}
    assert len(snapshot.files) > 128
    assert sum(len(item.content.encode("utf-8")) for item in snapshot.files) > 512 * 1024
    for path, content in resources.items():
        assert actual[path].content == content
    assert actual["RULE.md"].content == "Entire application Rule"
    original = snapshot.content_hash
    (dependency / "resource-139.md").write_text("Changed last fixed resource", encoding="utf-8")
    assert build_skill_snapshot(skill).content_hash != original
    calls = []
    def generate(prompt):
        calls.append(prompt)
        return _generated_payload()
    options = {"agent": "codex", "model": "test", "profile": "generic", "interaction": {"mode": "none"}, "generate": generate}
    first = ensure_generated_manifest(skill, tmp_path, **options)
    second = ensure_generated_manifest(skill, tmp_path, **options)
    assert first.manifest_path == second.manifest_path
    assert second.reused
    assert len(calls) == 1
    assert resources["scripts/application/skills/dependency/resource-138.md"] in calls[0]


def test_sdk_snapshot_records_binary_identity_without_decoding_it_into_prompt_text(tmp_path):
    from scaffold.python.generated_task_cache import sha256
    skill = _write_sdk_snapshot(tmp_path)
    resource = skill / "scripts/application/skills/dependency/image.bin"
    payload = b"\x00\xff\x80binary resource"
    resource.write_bytes(payload)
    snapshot = build_skill_snapshot(skill)
    item = next(item for item in snapshot.files if item.path.endswith("image.bin"))
    metadata = json.loads(item.content)
    assert metadata == {"type": "binary", "path": item.path, "size_bytes": len(payload), "sha256": sha256(payload)}
    assert item.content_hash == sha256(payload)
    resource.write_bytes(payload + b"changed")
    assert build_skill_snapshot(skill).content_hash != snapshot.content_hash


def test_sdk_snapshot_refuses_linked_fixed_resources(tmp_path):
    import os
    import subprocess
    skill = _write_sdk_snapshot(tmp_path)
    target = tmp_path / "outside"
    target.mkdir()
    (target / "resource.txt").write_text("outside resource", encoding="utf-8")
    link = skill / "scripts/application/skills/dependency/linked"
    if os.name == "nt":
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True, capture_output=True)
    else:
        link.symlink_to(target, target_is_directory=True)
    with pytest.raises(ValueError, match="link"):
        build_skill_snapshot(skill)


def test_sdk_snapshot_reports_unreadable_resource_instead_of_omitting_it(tmp_path, monkeypatch):
    skill = _write_sdk_snapshot(tmp_path)
    resource = skill / "scripts/application/skills/dependency/resource.md"
    resource.write_text("full resource", encoding="utf-8")
    original = Path.read_bytes
    def read_bytes(path):
        if path == resource:
            raise PermissionError("Cannot read fixed resource")
        return original(path)
    monkeypatch.setattr(Path, "read_bytes", read_bytes)
    with pytest.raises(PermissionError, match="fixed resource"):
        build_skill_snapshot(skill)


def test_generic_snapshot_keeps_its_existing_resource_budget(tmp_path):
    skill = _write_skill(tmp_path)
    for index in range(140):
        (skill / "references" / f"resource-{index}.md").write_text("generic resource", encoding="utf-8")
    snapshot = build_skill_snapshot(skill)
    assert len(snapshot.files) == 128
    assert {item.path for item in snapshot.files}.issuperset({"SKILL.md", "references/format.md"})


def test_generated_manifest_is_cached_and_reused(tmp_path: Path):
    skill = _write_skill(tmp_path)
    calls = []

    def generate(_prompt):
        calls.append(True)
        return _generated_payload()

    first = ensure_generated_manifest(
        skill,
        tmp_path,
        agent="claude-code",
        model=None,
        profile="generic",
        interaction={"mode": "none", "max_turns": 12},
        generate=generate,
    )
    second = ensure_generated_manifest(
        skill,
        tmp_path,
        agent="claude-code",
        model=None,
        profile="generic",
        interaction={"mode": "none", "max_turns": 12},
        generate=generate,
    )

    assert first.manifest_path == second.manifest_path
    assert first.generation_hash == second.generation_hash
    assert calls == [True]
    assert first.manifest_path == (
        tmp_path
        / ".comet"
        / "eval"
        / "generated"
        / "my-skill"
        / first.generation_hash
        / "eval.yaml"
    )
    metadata = json.loads(first.metadata_path.read_text(encoding="utf-8"))
    assert metadata["manifest_hash"].startswith("sha256:")
    assert metadata["generation_overhead"]["attempt_count"] == 1


def test_generated_cache_uses_owner_locks_atomic_replacement_and_redacted_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    skill = _write_skill(tmp_path)
    replacements = []
    import scaffold.python.auto_tasks as auto_tasks

    original_replace = auto_tasks.os.replace
    monkeypatch.setattr(
        auto_tasks.os,
        "replace",
        lambda source, target: (replacements.append((Path(source), Path(target))), original_replace(source, target))[1],
    )
    result = ensure_generated_manifest(
        skill,
        tmp_path,
        agent="codex",
        model=None,
        profile="generic",
        interaction={"mode": "none", "api_key": "must-not-persist"},
        generate=lambda _prompt: _generated_payload(),
    )

    metadata = result.metadata_path.read_text(encoding="utf-8")
    lock_dir = tmp_path / ".comet" / "eval" / "locks"
    assert lock_dir.is_dir()
    assert "must-not-persist" not in metadata
    assert "api_key" not in metadata
    assert any(target == result.manifest_path.parent for _, target in replacements)


def test_cached_manifest_hash_mismatch_forces_regeneration(tmp_path: Path):
    skill = _write_skill(tmp_path)
    calls = []

    def generate(_prompt):
        calls.append(True)
        return _generated_payload()

    first = ensure_generated_manifest(
        skill,
        tmp_path,
        agent="codex",
        model="gpt-test",
        profile="generic",
        interaction={"mode": "none", "max_turns": 12},
        generate=generate,
    )
    first.manifest_path.write_text("tasks: []\n", encoding="utf-8")

    second = ensure_generated_manifest(
        skill,
        tmp_path,
        agent="codex",
        model="gpt-test",
        profile="generic",
        interaction={"mode": "none", "max_turns": 12},
        generate=generate,
    )

    assert calls == [True, True]
    assert "normal-flow" in second.manifest_path.read_text(encoding="utf-8")


@pytest.mark.parametrize("task_count", [1, 5])
def test_cached_generated_manifest_revalidates_task_count(
    tmp_path: Path, task_count: int
):
    skill = _write_skill(tmp_path)
    calls = []

    def generate(_prompt):
        calls.append(True)
        return _generated_payload()

    first = ensure_generated_manifest(
        skill,
        tmp_path,
        agent="codex",
        model="gpt-test",
        profile="generic",
        interaction={"mode": "none", "max_turns": 12},
        generate=generate,
    )
    data = yaml.safe_load(first.manifest_path.read_text(encoding="utf-8"))
    tasks = data["evaluation"]["tasks"]
    data["evaluation"]["tasks"] = (tasks * task_count)[:task_count]
    first.manifest_path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    from scaffold.python.generated_task_cache import write_cache_metadata

    write_cache_metadata(first.manifest_path.parent, first.generation_hash)

    second = ensure_generated_manifest(
        skill,
        tmp_path,
        agent="codex",
        model="gpt-test",
        profile="generic",
        interaction={"mode": "none", "max_turns": 12},
        generate=generate,
    )

    assert calls == [True, True]
    assert len(yaml.safe_load(second.manifest_path.read_text(encoding="utf-8"))["evaluation"]["tasks"]) == 2


def test_generation_overhead_is_persisted_in_cache_metadata(tmp_path: Path):
    skill = _write_skill(tmp_path)

    result = ensure_generated_manifest(
        skill,
        tmp_path,
        agent="codebuddy",
        model="codebuddy-test",
        profile="generic",
        interaction={"mode": "none", "max_turns": 12},
        generate=lambda _prompt: GenerationOutput(
            output=_generated_payload(),
            telemetry={
                "duration_seconds": 0.125,
                "input_tokens": 10,
                "output_tokens": 20,
                "total_tokens": 30,
                "total_cost_usd": 0.01,
                "model": "codebuddy-test",
            },
        ),
    )

    metadata = json.loads(result.metadata_path.read_text(encoding="utf-8"))
    overhead = metadata["generation_overhead"]
    assert overhead["attempt_count"] == 1
    assert overhead["duration_seconds"] == 0.125
    assert overhead["total_tokens"] == 30
    assert overhead["total_cost_usd"] == 0.01
    assert overhead["attempts"][0]["model"] == "codebuddy-test"


def test_collect_requires_a_valid_cache_and_never_calls_generator(tmp_path: Path):
    skill = _write_skill(tmp_path)
    calls = []

    with pytest.raises(AutoTaskError, match="run comet eval"):
        ensure_generated_manifest(
            skill,
            tmp_path,
            agent="codex",
            model="gpt-test",
            profile="generic",
            interaction={"mode": "none", "max_turns": 12},
            collect_only=True,
            generate=lambda _prompt: calls.append(True),
        )

    assert calls == []


def test_invalid_generation_gets_one_repair_attempt(tmp_path: Path):
    skill = _write_skill(tmp_path)
    responses = [{"tasks": [{"name": "only-one", "prompt": "No expect."}]}, _generated_payload()]

    def generate(_prompt):
        return responses.pop(0)

    result = ensure_generated_manifest(
        skill,
        tmp_path,
        agent="codebuddy",
        model="codebuddy-test",
        profile="generic",
        interaction={"mode": "none", "max_turns": 12},
        generate=generate,
    )

    assert result.manifest_path.is_file()
    assert responses == []


def test_invalid_generation_stops_after_one_repair_attempt(tmp_path: Path):
    skill = _write_skill(tmp_path)
    calls = []

    def generate(_prompt):
        calls.append(True)
        return {"tasks": [{"name": "only-one", "prompt": "No expect. api_key=sk-secret-value"}]}

    with pytest.raises(AutoTaskError, match="task_generation") as exc_info:
        ensure_generated_manifest(
            skill,
            tmp_path,
            agent="claude-code",
            model=None,
            profile="generic",
            interaction={"mode": "none", "max_turns": 12},
            generate=generate,
        )

    assert calls == [True, True]
    report_path = Path(str(exc_info.value).split("Partial report: ", 1)[1])
    metadata = json.loads((report_path.parent / "metadata.json").read_text(encoding="utf-8"))
    assert report_path.is_file()
    assert metadata["attribution"] == "task_generation"
    assert metadata["attempt_count"] == 2
    assert metadata["task_denominator"] == 0
    assert metadata["subject_metrics"] == {}
    assert metadata["report_path"] == str(report_path)
    assert "sk-secret-value" not in report_path.read_text(encoding="utf-8")
    assert "sk-secret-value" not in (report_path.parent / "metadata.json").read_text(encoding="utf-8")


def test_html_generation_failure_escapes_generator_controlled_error_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    skill = _write_skill(tmp_path)
    monkeypatch.setenv("COMET_EVAL_REPORT_HTML", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "environment-secret-value")

    def generate(_prompt):
        raise ValueError(
            "<script>globalThis.cometEvalInjected = true</script> "
            "api_key=sk-secret-value Authorization: Bearer bearer-secret-value "
            "x-api-key: header-secret-value environment-secret-value"
        )

    with pytest.raises(AutoTaskError) as exc_info:
        ensure_generated_manifest(
            skill,
            tmp_path,
            agent="claude-code",
            model=None,
            profile="generic",
            interaction={"mode": "none", "max_turns": 12},
            generate=generate,
        )

    report_path = Path(str(exc_info.value).split("Partial report: ", 1)[1])
    report = report_path.read_text(encoding="utf-8")
    assert report_path.suffix == ".html"
    assert "<script>" not in report
    assert "&lt;script&gt;globalThis.cometEvalInjected = true&lt;/script&gt;" in report
    assert "sk-secret-value" not in report
    metadata = (report_path.parent / "metadata.json").read_text(encoding="utf-8")
    for secret in (
        "sk-secret-value",
        "bearer-secret-value",
        "header-secret-value",
        "environment-secret-value",
    ):
        assert secret not in report
        assert secret not in metadata
