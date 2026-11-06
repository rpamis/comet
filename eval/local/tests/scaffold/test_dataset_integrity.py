"""数据集执行不得从参考答案获得收益，模式证据必须来自原工作区。"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from scaffold.python.builtin_datasets import DatasetTask
from scaffold.python.tasks import TaskConfig


@pytest.mark.parametrize(
    "tool,arguments",
    [
        ("Bash", {"command": "cat /tmp/wb-dataset/tasks/example/tests/gold.patch"}),
        ("Read", {"file_path": "/opt/dataset-original/tasks/example/verifier/verifier.py"}),
        ("Read", {"file_path": "/workspace/tasks/example/solution/solve.sh"}),
        ("WebFetch", {
            "url": "https://huggingface.co/datasets/tencent/workbuddy-bench/resolve/main/data.zip"
        }),
        ("Bash", {"command": "git clone https://github.com/benchflow-ai/skillsbench"}),
    ],
)
def test_reference_guard_blocks_answer_access_before_tool_execution(tool, arguments):
    script = Path(__file__).resolve().parents[3] / "scaffold/python/dataset_integrity.py"
    result = subprocess.run(
        [sys.executable, "-I", str(script), "--hook"],
        input=json.dumps({"tool_name": tool, "tool_input": arguments}),
        text=True,
        capture_output=True,
    )
    assert result.returncode == 2
    assert "benchmark" in result.stderr.lower()


@pytest.mark.parametrize(
    "tool,arguments",
    [
        ("Bash", {"command": "python3 -B -m unittest discover -s tests -v"}),
        ("Read", {"file_path": "/workspace/tests/test_pipeline_reconnect.py"}),
        ("WebFetch", {"url": "https://docs.python.org/3/library/unittest.html"}),
        ("Agent", {"prompt": "Do not read gold.patch or download workbuddy-bench."}),
        ("Write", {"file_path": "/workspace/tests/test_policy.py", "content": "gold.patch"}),
    ],
)
def test_reference_guard_allows_business_tests_docs_and_verifier_handoff(tool, arguments):
    script = Path(__file__).resolve().parents[3] / "scaffold/python/dataset_integrity.py"
    result = subprocess.run(
        [sys.executable, "-I", str(script), "--hook"],
        input=json.dumps({"tool_name": tool, "tool_input": arguments}),
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr


def test_reference_access_excludes_sample_without_rewriting_original_reward(tmp_path, monkeypatch):
    task = DatasetTask(
        path=tmp_path,
        config=TaskConfig(name="example", description=""),
        instruction_template="task",
        dataset_plan={},
    )

    def score(candidate, outputs):
        outputs["dataset_result"] = {"reward": 1, "raw": {"tests_passed": 14}}
        return ["dataset_completed"], []

    monkeypatch.setattr(task, "_score_dataset", score)
    outputs = {
        "events": {
            "tool_calls": [
                {
                    "tool": "Read",
                    "input": {"file_path": "/tmp/wb-dataset/tasks/example/tests/gold.patch"},
                }
            ]
        }
    }
    passed, failed = task.validate_dataset(tmp_path, outputs)
    assert passed == ["dataset_completed"]
    assert any(f.startswith("dataset_reference_access:") for f in failed)
    assert outputs["dataset_result"]["reward"] == 1
    from scaffold.python.sample_quality import infer_sample_quality

    quality = infer_sample_quality(
        events={
            "dataset_result": outputs["dataset_result"],
            "telemetry_warnings": ["partial counters"],
        },
        checks_failed=failed,
    )
    assert quality.include_in_analysis is False
    assert quality.reason_code == "dataset_reference_access"


def test_reference_audit_includes_child_session_tools_and_ignores_discussion(tmp_path):
    from scaffold.python.dataset_integrity import audit_reference_access

    session = (
        tmp_path / ".dataset-state/home/agent/.claude/projects/-workspace/subagents/child.jsonl"
    )
    session.parent.mkdir(parents=True)
    session.write_text(
        "\n".join(
            json.dumps(x)
            for x in [
                {"type": "user", "message": {"content": "Do not read gold.patch"}},
                {
                    "type": "assistant",
                    "message": {
                        "content": [{"type": "text", "text": "I will not download the benchmark."}]
                    },
                },
                {
                    "type": "assistant",
                    "message": {
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "read-reference",
                                "name": "Read",
                                "input": {
                                    "file_path": "/tmp/wb-dataset/tasks/example/tests/gold.patch"
                                },
                            }
                        ]
                    },
                },
            ]
        )
    )
    hits = audit_reference_access(tmp_path, {})
    assert len(hits) == 1
    assert hits[0]["tool"] == "Read"
    assert "subagents" in hits[0]["source"]


def test_sdk_inspection_preserves_original_owner_and_rejects_copied_checkout(tmp_path, monkeypatch):
    import shutil
    from scaffold.python.validation.current_sdk import inspect_run

    package = Path(__file__).resolve().parents[4]
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("COMET_DATA_DIR", str(tmp_path / "runtime"))
    monkeypatch.setenv("COMET_ENABLE_IMPLICIT_PROJECT_KNOWLEDGE", "0")
    subprocess.run(["git", "init", str(workspace)], check=True, capture_output=True)
    cli = ["node", str(package / "bin/comet.js")]
    for args in (
        ["native", "init"],
        ["native", "new", "example", "--task", "repair reconnect behavior"],
    ):
        created = subprocess.run(
            [*cli, *args, "--project-root", str(workspace), "--json"],
            capture_output=True,
            text=True,
        )
        assert created.returncode == 0, created.stdout + created.stderr
    state = workspace / "docs/comet/changes/example/comet-state.yaml"

    def snapshot(root):
        import hashlib

        return {
            str(f.relative_to(root)): hashlib.sha256(f.read_bytes()).hexdigest()
            for f in root.rglob("*")
            if f.is_file()
        }

    before = snapshot(workspace), snapshot(tmp_path / "runtime")
    run = inspect_run(workspace, "native", "example", "native", state, package=package, cli=cli)
    assert run["input"]["task"] == "repair reconnect behavior"
    assert before == (snapshot(workspace), snapshot(tmp_path / "runtime"))
    copied = tmp_path / "score-copy"
    shutil.copytree(workspace, copied)
    with pytest.raises(ValueError, match="SDK owner does not match"):
        inspect_run(
            copied,
            "native",
            "example",
            "native",
            copied / state.relative_to(workspace),
            package=package,
            cli=cli,
        )


def test_reference_settings_match_all_tools_without_credential_literals():
    script = Path(__file__).resolve().parents[3] / "scaffold/python/dataset_integrity.py"
    result = subprocess.run(
        [sys.executable, "-I", str(script), "--settings"],
        capture_output=True,
        text=True,
        check=True,
    )
    settings = json.loads(result.stdout)
    hook = settings["hooks"]["PreToolUse"][0]
    assert hook["matcher"] == ".*"
    assert hook["hooks"][0]["command"] == "python3 -I /opt/python/dataset_integrity.py --hook"
    assert "TOKEN" not in result.stdout and "API_KEY" not in result.stdout


@pytest.mark.parametrize(
    "reason",
    ["dataset_reference_access",
     "dataset_input_changed", "dataset_environment_changed"],
)
def test_legacy_invalid_sample_flags_cannot_reenter_comparisons(reason):
    from scaffold.python.sample_quality import infer_sample_quality

    quality = infer_sample_quality(
        report={
            "sample_quality": {
                "status": "flagged",
                "reason_code": reason,
                "include_in_analysis": True,
            }
        }
    )
    assert quality.status == "excluded"
    assert quality.include_in_analysis is False


@pytest.mark.parametrize('reason', ['dataset_input_changed', 'dataset_environment_changed'])
@pytest.mark.parametrize('legacy_flag', [False, True])
def test_changed_dataset_inputs_are_excluded_without_rewriting_reward(reason, legacy_flag):
    import copy
    from scaffold.python.sample_quality import infer_sample_quality

    report = {'checks_failed': [reason + ': fixed input mismatch'],
              'events_summary': {'duration_seconds': 1, 'dataset_result': {'reward': 3 / 14}}}
    if legacy_flag:
        report['sample_quality'] = {'status': 'flagged', 'reason_code': 'harness_trigger_suspect',
                                    'include_in_analysis': True}
    before = copy.deepcopy(report)
    quality = infer_sample_quality(report=report)
    assert quality.status == 'excluded'
    assert quality.include_in_analysis is False
    assert quality.reason_code == reason
    assert report == before


def test_low_dataset_reward_without_input_mismatch_remains_in_analysis():
    from scaffold.python.sample_quality import infer_sample_quality

    quality = infer_sample_quality(report={
        'checks_failed': ['original task: 3/14'],
        'events_summary': {'duration_seconds': 1, 'dataset_result': {'reward': 3 / 14}},
    })
    assert quality.include_in_analysis is True
