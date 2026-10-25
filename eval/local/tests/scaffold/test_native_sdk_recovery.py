"""Offline scripted Runtime protocol exercise; not a real-model Eval result."""

from __future__ import annotations

import copy
import importlib.util
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from scaffold.python.validation.native_recovery_boundary import capture

ROOT = Path(__file__).resolve().parents[4]
TASK = ROOT / "eval/local/tasks/comet-native-sdk-recovery"


def validator():
    spec = importlib.util.spec_from_file_location(
        "native_recovery_validator", TASK / "validation/test_native_sdk_recovery.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_one_shot_receipt_accepts_only_the_bound_direct_or_fixed_path_command():
    module = validator()
    direct = dict(executable="python3", argv=["recovery_once.py"], cwdRef=".", repeatable=False)
    fixed = dict(
        direct,
        executable="/usr/bin/env",
        argv=["PATH=/usr/local/bin:/usr/bin:/bin", "python3", "recovery_once.py"],
    )
    for plan in (direct, fixed):
        receipt = dict(argvDisplay=plan["argv"], cwdRef=".")
        module.assert_once_check(plan, receipt)
        for field, value in (
            ("executable", "sh"),
            ("argv", ["other.py"]),
            ("cwdRef", "other"),
            ("repeatable", True),
        ):
            with pytest.raises(AssertionError):
                module.assert_once_check(dict(plan, **{field: value}), receipt)
        with pytest.raises(AssertionError):
            module.assert_once_check(plan, dict(receipt, argvDisplay=["other.py"]))
    for prefix in ("PATH=", "PATH=.", "PATH=/usr/bin:", "HOME=/tmp"):
        invalid = dict(fixed, argv=[prefix, "python3", "recovery_once.py"])
        with pytest.raises(AssertionError):
            module.assert_once_check(invalid, dict(argvDisplay=invalid["argv"], cwdRef="."))


class Driver:
    def __init__(self, root, monkeypatch, *, explicit_path=False):
        self.root = root
        self.explicit_path = explicit_path
        self.name = "sentence-counting"
        self.sequence = 0
        monkeypatch.setenv("COMET_DATA_DIR", str(root.parent / "data"))
        self.env = {
            key: value
            for key, value in os.environ.items()
            if key in {"PATH", "COMET_DATA_DIR", "SYSTEMROOT", "WINDIR"}
        }
        self.env.update(HOME=str(root.parent / "home"), USERPROFILE=str(root.parent / "home"))
        Path(self.env["HOME"]).mkdir()
        root.mkdir()
        self.cli = ["node", str(ROOT / "bin/comet.js")]
        self.run(["git", "init", "-q", "-b", "main"])
        self.run(["git", "config", "user.email", "fixture@example.test"])
        self.run(["git", "config", "user.name", "Offline SDK fixture"])
        for file in ["wordcount.py", "test_wordcount.py", "recovery_once.py", ".gitignore"]:
            shutil.copyfile(TASK / "environment" / file, root / file)
        self.run(["git", "add", "."])
        self.run(["git", "commit", "-qm", "fixture baseline"])

    def run(self, args, *, ok=True):
        result = subprocess.run(
            args,
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=90,
        )
        if ok:
            assert result.returncode == 0, (args, result.stdout, result.stderr)
        return result

    def native(self, *args, ok=True):
        return json.loads(
            self.run(
                [*self.cli, "native", *args, "--project-root", str(self.root), "--json"], ok=ok
            ).stdout
        )

    def dispatch(self, request, *, ok=True):
        self.sequence += 1
        file = self.root.parent / f"request-{self.sequence}.json"
        file.write_text(json.dumps({"runId": self.name, **request}))
        return json.loads(
            self.run(
                [
                    *self.cli,
                    "runtime",
                    "dispatch",
                    "--application",
                    "native",
                    "--project-root",
                    str(self.root),
                    "--request",
                    str(file),
                    "--details",
                ],
                ok=ok,
            ).stdout
        )

    def inspect(self):
        return self.dispatch({"operation": "inspect"})["data"]

    def record(self, action, session, output):
        self.dispatch(
            {
                "operation": "claim",
                "actionId": action["id"],
                "attempt": action["attempt"],
                "inputHash": action["inputHash"],
                "executorId": "native-host",
                "sessionId": session,
                "claimToken": session,
            }
        )
        if session == "independent-verifier":
            status = self.native("status", self.name, "--details")["data"]
            active = next(a for a in status["activeActions"] if a["id"] == action["id"])
            command = active["contextRequest"]["commandArgs"]
            command = [
                "Offline sentence counting task" if a == "<original-task>" else a for a in command
            ]
            self.run([*self.cli, *command[1:]])
        return self.dispatch(
            {
                "operation": "record-outcome",
                "outcome": {
                    "actionId": action["id"],
                    "attempt": action["attempt"],
                    "inputHash": action["inputHash"],
                    "claimToken": session,
                    "outcomeId": session + "-result",
                    "status": "succeeded",
                    "output": output,
                },
            }
        )["data"]

    def alternative(self, name):
        status = self.native("status", self.name)["data"]
        choice = next(c for c in status["continuation"]["commandAlternatives"] if c["name"] == name)
        # The test is the simulated user. Production tasks use auto_user answers.
        args = [
            "Offline fixture explicitly selects this recovery." if a == "<summary>" else a
            for a in choice["commandArgs"]
        ]
        return json.loads(self.run([*self.cli, *args[1:]]).stdout)


def pending(run, step):
    return next(a for a in run["actions"] if a["stepId"] == step and a["status"] == "pending")


def build_recovery(driver):
    driver.native("new", driver.name)
    change = driver.root / "docs/comet/changes" / driver.name
    brief = """# Outcome
Add sentence counting.
# Scope
Preserve words and lines.
## Directory structure
### Modified
- wordcount.py: add sentence counting.
- test_wordcount.py: verify sentence counting.
# Non-goals
Other features.
# Acceptance examples
- Count sentences and preserve existing behavior.
# Verification expectations
Run test_wordcount.py.
## Spec → 测试名与断言计划
| Test | Assertion | 计划行号 |
| --- | --- | --- |
| test_sentence_count | result equals three | planned |
"""
    (change / "brief.md").write_text(brief, encoding="utf-8")
    (change / "specs/sentence-counting").mkdir(parents=True)
    (change / "specs/sentence-counting/spec.md").write_text(
        "# Sentences\nSplit on punctuation; ignore empty segments.\n"
    )
    driver.native("next", driver.name)
    with pytest.raises(ValueError, match="blocked Verify boundary"):
        capture(driver.root, "premature-subject", package=ROOT, cli=driver.cli)
    run = driver.inspect()
    driver.native(
        "next",
        driver.name,
        "--confirmed",
        "--summary",
        "Offline fixture approves Shape.",
        "--expected-state-version",
        str(run["state"]["state_version"]),
        "--expected-action",
        "confirm-shape",
    )
    run = driver.inspect()
    builder = pending(run, "build.builder")
    (change / "brief.md").write_text(brief.replace("| planned |", "| 28-29 |"), encoding="utf-8")
    source = (
        (driver.root / "wordcount.py")
        .read_text()
        .replace("import argparse", "import argparse\nimport re")
    )
    source = source.replace(
        "args = parser.parse_args()",
        'parser.add_argument("--sentences", action="store_true")\n    args = parser.parse_args()',
    )
    source = source.replace(
        "if args.lines:",
        'if args.sentences:\n        print("Sentences:", len([s for s in re.split(r"[.!?]+", text) if s.strip()]))\n    if args.lines:',
    )
    (driver.root / "wordcount.py").write_text(source)
    test = driver.root / "test_wordcount.py"
    test.write_text(
        test.read_text()
        + '\n\ndef test_sentence_count():\n    assert "Sentences: 3" in run_cli("--sentences", input_text="Hello. Why?! Fine!")\n'
    )
    ids = [a["id"] for a in run["state"]["acceptance"]]
    plans = [
        dict(
            id="business-tests",
            name="business tests",
            executable="python3",
            argv=["-m", "pytest", "-q", "test_wordcount.py"],
            cwdRef=".",
            timeoutMs=30000,
            repeatable=True,
        ),
        dict(
            id="recovery-once",
            name="recovery-once",
            executable="python3",
            argv=["recovery_once.py"],
            cwdRef=".",
            timeoutMs=10000,
            repeatable=False,
        ),
    ]
    if driver.explicit_path:
        for plan in plans:
            plan["argv"] = ["PATH=" + driver.env["PATH"], plan["executable"], *plan["argv"]]
            plan["executable"] = "/usr/bin/env"
    run = driver.record(
        builder,
        "builder-session",
        dict(
            summary="Implemented sentence counting.",
            addressedAcceptanceIds=ids,
            acceptanceReview=[
                dict(
                    id=i,
                    status="implemented-with-evidence",
                    evidence=["test_sentence_count"],
                    note="Implemented and tested.",
                )
                for i in ids
            ],
            checks=[],
            knownLimits=[],
            submittedAt="2026-10-24T00:00:00.000Z",
            verificationChecks=plans,
        ),
    )
    check = pending(run, "verify.checks")
    run = driver.dispatch(
        dict(operation="execute", actionId=check["id"], executorId="comet-native-checks")
    )["data"]
    original_check = next(a for a in run["actions"] if a["id"] == check["id"])
    original_handoff = run["state"]["builder_handoff"]

    def result(run, verdict, session):
        return dict(
            candidateId=run["state"]["builder_handoff"]["candidate_id"],
            verifierExecutionRef=session,
            response=dict(
                kind="final-result",
                result=dict(
                    iteration=run["state"]["loop"]["iteration"],
                    attempt=run["state"]["loop"]["attempt"],
                    verdict=verdict,
                    acceptance=[
                        dict(
                            id=i,
                            result="blocked" if verdict == "blocked" else "passed",
                            reason="Offline verifier unavailable."
                            if verdict == "blocked"
                            else "Independently ran business oracle.",
                        )
                        for i in ids
                    ],
                    risks=[],
                    summary="Offline protocol exercise.",
                ),
            ),
        )

    run = driver.record(
        pending(run, "verify.verifier"),
        "blocked-verifier",
        result(run, "blocked", "blocked-verifier"),
    )
    state_path = change / "comet-state.yaml"
    before_capture = state_path.read_bytes()
    before_run = driver.inspect()
    driver.boundary = capture(driver.root, "subject-before", package=ROOT, cli=driver.cli)
    assert state_path.read_bytes() == before_capture and driver.inspect() == before_run
    driver.alternative("resolve-verifier-blocker")
    run = driver.inspect()
    assert (
        next(a for a in run["actions"] if a["id"] == check["id"])["outcome"]
        == original_check["outcome"]
    )
    assert run["state"]["builder_handoff"] == original_handoff
    action = pending(run, "verify.verifier")
    # Separate CLI processes and independent shell execution, no inherited JS Runtime object.
    driver.run(["python3", "-m", "pytest", "-q", "test_wordcount.py"])
    driver.env["TEMP"] = str(driver.root.parent / "verifier-temp")
    driver.env["HTTP_PROXY"] = "http://offline-verifier.invalid:3128"
    run = driver.record(action, "independent-verifier", result(run, "pass", "independent-verifier"))
    driver.native("next", driver.name)
    driver.alternative("accept-result")
    driver.native("archive", driver.name)
    return driver.inspect()


def test_current_cli_recovery_to_archive(tmp_path, monkeypatch):
    exercise_cli_recovery_to_archive(tmp_path, monkeypatch, explicit_path=False)


def test_current_cli_recovery_fixed_path_to_archive(tmp_path, monkeypatch):
    exercise_cli_recovery_to_archive(tmp_path, monkeypatch, explicit_path=True)


def exercise_cli_recovery_to_archive(tmp_path, monkeypatch, *, explicit_path):
    assert (ROOT / "dist/app/cli/index.js").is_file(), (
        "Build the current candidate first; no skipped release coverage"
    )
    provided = {
        "environment_file_hashes": {
            "recovery_once.py": hashlib.sha256(
                (TASK / "environment/recovery_once.py").read_bytes()
            ).hexdigest()
        }
    }
    driver = Driver(tmp_path / "project", monkeypatch, explicit_path=explicit_path)
    run = build_recovery(driver)
    assert run["status"] == "completed"
    module = validator()
    module.WORKSPACE, module.PACKAGE, module.CLI = driver.root, ROOT, driver.cli
    archived = next((driver.root / "docs/comet/archive").glob("*-" + driver.name))
    module.assert_recovery(run, archived, provided)
    # This metadata only unit-tests the harness boundary predicate. No model was called.
    context = driver.root / "_test_context.json"
    context.write_text(
        json.dumps(
            {
                **provided,
                "interaction": {
                    "fresh_resume_boundaries": 1,
                    "sdk_recovery_boundaries": [driver.boundary],
                    "role_sessions": {"subject": ["subject-before", "subject-after"]},
                },
            }
        )
    )
    assert module.check_recovery() == {"check": "sdk_recovery", "status": "passed"}
    assert module.check_feature()["status"] == "passed"
    context.write_text(json.dumps({**provided, "interaction": {"fresh_resume_boundaries": 0}}))
    assert module.check_recovery()["status"] == "failed"
    context.write_text(
        json.dumps(
            {
                **provided,
                "interaction": {
                    "fresh_resume_boundaries": 1,
                    "sdk_recovery_boundaries": [driver.boundary],
                    "role_sessions": {"subject": ["subject-before", "subject-after"]},
                },
            }
        )
    )
    changes = [
        lambda r: r.update(status="running"),
        lambda r: r["state"]["loop"].update(goal_cycle=2),
        lambda r: r["actions"].append(
            copy.deepcopy(next(a for a in r["actions"] if a["stepId"] == "verify.checks"))
        ),
        lambda r: next(a for a in r["actions"] if a["stepId"] == "verify.verifier")["outcome"][
            "output"
        ]["response"]["result"].update(verdict="pass"),
        lambda r: next(a for a in reversed(r["actions"]) if a["stepId"] == "verify.verifier")[
            "claim"
        ].update(sessionId="builder-session"),
        lambda r: next(a for a in reversed(r["actions"]) if a["stepId"] == "verify.verifier")[
            "outcome"
        ]["output"].update(candidateId="foreign"),
        lambda r: next(a for a in r["actions"] if a["stepId"] == "verify.checks")["outcome"][
            "output"
        ]["inputSnapshot"].update(complete=False),
        lambda r: next(a for a in r["actions"] if a["stepId"] == "archive.finalize").update(
            status="pending"
        ),
    ]
    for mutate in changes:
        invalid = copy.deepcopy(run)
        mutate(invalid)
        with pytest.raises((AssertionError, KeyError, ValueError)):
            module.assert_recovery(invalid, archived, provided)
    for field, value in [("executable", "echo"), ("argv", ["other.py"]), ("cwdRef", "other")]:
        invalid = copy.deepcopy(run)
        plans = next(a for a in invalid["actions"] if a["stepId"] == "build.builder")["outcome"][
            "output"
        ]["verificationChecks"]
        next(p for p in plans if p["id"] == "recovery-once")[field] = value
        with pytest.raises(AssertionError):
            module.assert_recovery(invalid, archived, provided)
    valid_interaction = json.loads(context.read_text())["interaction"]
    for field in ["waitId", "candidateId", "handoffHash", "counterHash", "shapeHash"]:
        invalid = copy.deepcopy(valid_interaction)
        invalid["sdk_recovery_boundaries"][0][field] = "forged"
        with pytest.raises(AssertionError):
            module.assert_boundary(run, invalid)
    invalid = copy.deepcopy(valid_interaction)
    invalid["sdk_recovery_boundaries"][0]["actions"][0]["outcomeHash"] = "forged"
    with pytest.raises(AssertionError):
        module.assert_boundary(run, invalid)
    invalid = copy.deepcopy(valid_interaction)
    invalid["role_sessions"]["subject"] = ["subject-after", "subject-before"]
    with pytest.raises(AssertionError):
        module.assert_boundary(run, invalid)
    state_file = archived / "comet-state.yaml"
    original = state_file.read_text()
    state_file.write_text(
        original.replace("# comet-execution: managed-run", "# forged compat state")
    )
    assert module.check_recovery()["status"] == "failed"
    state_file.write_text(original)
    assert module.check_recovery()["status"] == "passed"
