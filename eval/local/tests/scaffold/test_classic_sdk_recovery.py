"""用真实当前 CLI 验证三条 SDK 交付；仅 OpenSpec 外部进程使用离线替身。"""

import importlib.util
import json
import hashlib
import os
import sys
from pathlib import Path
import shutil
import subprocess

import pytest

REPO = Path(__file__).resolve().parents[4]
TASK = REPO / "eval/local/tasks/comet-classic-sdk-recovery"


def load_validator():
    spec = importlib.util.spec_from_file_location(
        "classic_sdk_recovery_validator", TASK / "validation/test_classic_sdk_recovery.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_post_archive_repair_selects_cache_regenerated_by_original_command(tmp_path):
    instruction = (TASK / "instruction.md").read_text(encoding="utf-8")
    assert "__pycache__/test_wordcount.*.pyc" in instruction
    assert "Do not create a different cache" in instruction
    for name in ("wordcount.py", "test_wordcount.py", "verify_coexistence.py"):
        shutil.copyfile(TASK / "environment" / name, tmp_path / name)
    proposal = tmp_path / "docs/openspec/changes/parked-format/proposal.md"
    proposal.parent.mkdir(parents=True)
    proposal.write_bytes(b"# Parked format\nKeep this unrelated formatting request pending.\n")
    for _ in range(2):
        result = subprocess.run(
            [sys.executable, "-I", "verify_coexistence.py"],
            cwd=tmp_path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        caches = list((tmp_path / "__pycache__").glob("test_wordcount.*.pyc"))
        assert len(caches) == 1
        assert not list((tmp_path / "__pycache__").glob("wordcount.*.pyc"))
        caches[0].unlink()


def test_scoped_verify_requires_bound_coexistence_observation(tmp_path):
    module = load_validator()
    script = (TASK / "environment/verify_coexistence.py").read_bytes()
    expected = hashlib.sha256(script).hexdigest()
    context = {"environment_file_hashes": {"verify_coexistence.py": expected}}
    script_blob = hashlib.sha1(b"blob " + str(len(script)).encode() + b"\0" + script).hexdigest()
    manifest = json.dumps({"p": "verify_coexistence.py", "h": "git:" + script_blob})
    observation = {
        "path": "docs/openspec/changes/parked-format/proposal.md",
        "sha256": hashlib.sha256(module.PARKED_PROPOSAL.encode()).hexdigest(),
    }
    record = {
        "schema": "comet.eval.classic-coexistence.v1",
        "before": observation,
        "after": observation,
        "exitCode": 0,
    }
    log = "pytest passed\nCOMET_EVAL_COEXISTENCE " + json.dumps(record) + "\n"
    evidence = {
        "argv": ["/usr/bin/python3", "-I", "verify_coexistence.py"],
        "cwd": ".",
        "exitCode": 0,
        "inputBefore": "same",
        "inputAfter": "same",
        "contentHash": hashlib.sha256(log.encode()).hexdigest(),
    }
    module.assert_scoped_coexistence(manifest, evidence, context, log, script)
    for corrupted in (
        {"argv": ["python3", "other.py"]},
        {"argv": ["python3", "verify_coexistence.py"]},
        {"argv": ["python3", "-I", "verify_coexistence.py"]},
        {"argv": ["./python3", "-I", "verify_coexistence.py"]},
        {"cwd": "subdir"},
        {"exitCode": 1},
        {"contentHash": "wrong"},
        {"inputAfter": "changed"},
    ):
        with pytest.raises(ValueError):
            module.assert_scoped_coexistence(
                manifest, {**evidence, **corrupted}, context, log, script
            )
    for bad_log in (
        "",
        log + log,
        log.replace(observation["sha256"], "changed"),
        log.replace('"exitCode": 0', '"exitCode": 1'),
    ):
        with pytest.raises(ValueError):
            module.assert_scoped_coexistence(
                manifest,
                {**evidence, "contentHash": hashlib.sha256(bad_log.encode()).hexdigest()},
                context,
                bad_log,
                script,
            )
    for bad_manifest, bad_source, bad_context in (
        ("", script, context),
        (manifest.replace(script_blob, "0" * 40), script, context),
        (manifest, script + b"# modified", context),
        (manifest, script, {}),
    ):
        with pytest.raises(ValueError):
            module.assert_scoped_coexistence(bad_manifest, evidence, bad_context, log, bad_source)


def test_coexistence_helper_isolates_workspace_modules_and_pythonpath(tmp_path):
    helper = tmp_path / "verify_coexistence.py"
    shutil.copyfile(TASK / "environment/verify_coexistence.py", helper)
    (tmp_path / "pathlib.py").write_text("raise RuntimeError('shadow-pathlib')\n")
    (tmp_path / "pytest.py").write_text("print('shadow-pytest'); raise SystemExit(0)\n")
    injection = tmp_path / "injection"
    injection.mkdir()
    (injection / "subprocess.py").write_text("raise RuntimeError('shadow-subprocess')\n")
    env = {**os.environ, "PYTHONPATH": str(injection)}

    def execute():
        return subprocess.run(
            [sys.executable, "-I", str(helper)],
            cwd=tmp_path,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )

    missing = execute()
    assert missing.returncode != 0 and "FileNotFoundError" in missing.stderr
    assert "shadow-pathlib" not in missing.stderr and "shadow-subprocess" not in missing.stderr
    proposal = tmp_path / "docs/openspec/changes/parked-format/proposal.md"
    proposal.parent.mkdir(parents=True)
    proposal.write_bytes(b"# Parked format\nKeep this unrelated formatting request pending.\n")
    (tmp_path / "test_failure.py").write_text("def test_actual_failure():\n    assert False\n")
    failed = execute()
    assert failed.returncode == 1 and "1 failed" in failed.stdout
    assert "shadow-pytest" not in failed.stdout
    marker = next(
        line for line in failed.stdout.splitlines() if line.startswith("COMET_EVAL_COEXISTENCE ")
    )
    assert json.loads(marker.removeprefix("COMET_EVAL_COEXISTENCE "))["exitCode"] == 1


@pytest.fixture(scope="module")
def completed(tmp_path_factory):
    if not (REPO / "dist/app/cli/index.js").is_file() or not shutil.which("node"):
        pytest.fail(
            "Current CLI build required: run pnpm build before this offline integration test"
        )
    root = tmp_path_factory.mktemp("classic-sdk-recovery")
    project = root / "project"
    project.mkdir()
    home = root / "home"
    home.mkdir()
    import os

    env = {
        **os.environ,
        "HOME": str(home),
        "USERPROFILE": str(home),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "GIT_CONFIG_NOSYSTEM": "1",
    }

    def put(ref, text):
        path = project / ref
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")

    def git(*args):
        result = subprocess.run(
            [
                "git",
                "-c",
                "user.name=Eval",
                "-c",
                "user.email=eval@example.invalid",
                "-c",
                "commit.gpgsign=false",
                *args,
            ],
            cwd=project,
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    def cli(*args):
        args = list(args)
        args.insert(args.index("--") if "--" in args else len(args), "--json")
        result = subprocess.run(
            ["node", str(REPO / "bin/comet.js"), *args],
            cwd=project,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, f"{args}: {result.stdout}\n{result.stderr}"
        response = json.loads(result.stdout)
        assert response.get("exitCode", 0) == 0, response
        return response.get("data")

    put(
        ".comet/config.yaml",
        "schema: comet.project.v1\ndefault_workflow: classic\n"
        "workflows: [classic]\nclassic:\n  artifact_layout: docs\n  language: en\n"
        "  context_compression: off\n  review_mode: off\n  auto_transition: true\n",
    )
    put("docs/openspec/config.yaml", "schema: spec-driven\n")
    put(".gitignore", "/.comet/\n__pycache__/\n.pytest_cache/\n")
    for name in ("wordcount.py", "test_wordcount.py"):
        put(name, (TASK / "environment" / name).read_text())
    shutil.copyfile(TASK / "environment/verify_coexistence.py", project / "verify_coexistence.py")
    put(
        "_test_context.json",
        json.dumps(
            {
                "environment_file_hashes": {
                    "verify_coexistence.py": hashlib.sha256(
                        (TASK / "environment/verify_coexistence.py").read_bytes()
                    ).hexdigest()
                }
            }
        ),
    )
    git("init", "-b", "main")
    git("add", ".")
    git("commit", "-m", "baseline")
    openspec = root / "openspec.mjs"
    openspec.write_text("""#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const [verb, name, yes] = process.argv.slice(2);
if (verb !== 'archive' || yes !== '--yes') throw new Error('Unexpected OpenSpec call');
const base = path.join(process.cwd(), 'openspec/changes');
const target = path.join(base, 'archive', new Date().toISOString().slice(0,10)+'-'+name);
fs.mkdirSync(path.dirname(target), {recursive:true});
fs.renameSync(path.join(base,name), target);
""")
    openspec.chmod(0o755)
    env["COMET_OPENSPEC"] = str(openspec)
    validator = load_validator()
    validator.WORKSPACE = project
    validator.RUNTIME_ROOT = REPO
    validator.CLI = ["node", str(REPO / "bin/comet.js")]
    validator.COEXISTENCE_PYTHON = sys.executable
    original_invoke = validator.invoke

    def invoke(args, *, source=None):
        result = subprocess.run(
            args, cwd=project, input=source, capture_output=True, text=True, timeout=60, env=env
        )
        if result.returncode:
            raise ValueError(result.stderr or result.stdout)
        return json.loads(result.stdout)

    validator.invoke = invoke
    cli("state", "init", validator.PARKED, "tweak", "--runtime", "sdk", "--isolation", "current")
    put(f"{validator.CHANGES}/{validator.PARKED}/proposal.md", validator.PARKED_PROPOSAL)
    parked_before = validator.validate_parked()
    for name, profile in validator.CASES.items():
        cli("state", "init", name, profile, "--runtime", "sdk", "--isolation", "current")
        cli("state", "select", name)
        change = f"docs/openspec/changes/{name}"
        put(f"{change}/proposal.md", f"# {name}\nImplement the requested CLI behavior.\n")
        put(f"{change}/design.md", "# Design\nPreserve existing CLI flags.\n")
        put(f"{change}/tasks.md", "- [ ] Implement and test CLI <!-- comet-task:impl -->\n")
        opened = cli("guard", name, "open")
        cli("guard", name, "open", "--apply", "--approval-hash", opened["approvalHash"])
        if profile == "full":
            proposed = cli("state", "propose-design", name, "--proposal", "Preserve all CLI flags.")
            approval = proposed["wait"]["proposalHash"]
            cli("state", "decide-design", name, "--proposal-hash", approval, "--choice", "approved")
            design = f"docs/superpowers/specs/{name}.md"
            put(
                design,
                f"---\ncomet_change: {name}\nrole: technical-design\n"
                "canonical_spec: openspec\n---\n# Design\nSplit on punctuation runs.\n",
            )
            cli(
                "state",
                "complete-design",
                name,
                "--design-doc",
                design,
                "--approval-hash",
                approval,
            )
            configuration = f"{change}/build-config.json"
            put(
                configuration,
                json.dumps(
                    {
                        "build_mode": "direct",
                        "tdd_mode": "direct",
                        "review_mode": "off",
                        "subagent_dispatch": None,
                        "direct_override": True,
                    }
                ),
            )
            proposed = cli("state", "propose-build", name, "--file", configuration)
            cli(
                "state",
                "decide-build",
                name,
                "--proposal-hash",
                proposed["wait"]["proposalHash"],
                "--choice",
                "approved",
            )
            plan = f"docs/superpowers/plans/{name}.md"
            put(
                plan,
                f"# Plan\n<!-- comet-task-authority: {change}/tasks.md -->\n"
                "<!-- comet-task-ref:impl -->\nImplement and test CLI.\n",
            )
            cli("state", "submit-plan", name, "--plan", plan)
        source = (project / "wordcount.py").read_text()
        if profile == "full":
            source = source.replace("import argparse", "import argparse\nimport re")
            source = source.replace(
                "    args = parser.parse_args()",
                '    parser.add_argument("--sentences", action="store_true")\n'
                "    args = parser.parse_args()",
            )
            source = source.replace(
                "    word_count = count_words(text)",
                "    if args.sentences:\n"
                '        count = sum(bool(s.strip()) for s in re.split(r"[.!?]+", text))\n'
                '        print(f"Sentences: {count}")\n'
                "    word_count = count_words(text)",
            )
        elif profile == "tweak":
            source = source.replace(
                "    args = parser.parse_args()",
                '    parser.add_argument("--characters", action="store_true")\n'
                "    args = parser.parse_args()",
            )
            source = source.replace(
                "    word_count = count_words(text)",
                "    if args.characters:\n"
                '        print(f"Characters: {len(text)}")\n'
                "    word_count = count_words(text)",
            )
        else:
            source = source.replace(
                "        with open(args.file) as f:\n            text = f.read()",
                "        try:\n            with open(args.file) as f:\n"
                "                text = f.read()\n        except OSError:\n"
                '            print("Error: cannot read input file", file=sys.stderr)\n'
                "            raise SystemExit(2)",
            )
        put("wordcount.py", source)
        flag, stdin, expected, status = {
            "full": ("--sentences", "One. Two?! Last", "Sentences: 3", 0),
            "tweak": ("--characters", "a b\n", "Characters: 4", 0),
            "hotfix": ("__eval_missing_input__.txt", "", "Error: cannot read input file", 2),
        }[profile]
        tests = (project / "test_wordcount.py").read_text()
        tests += (
            f"\ndef test_{profile}_feature():\n"
            f'    result = subprocess.run([sys.executable, "wordcount.py", {flag!r}], '
            f"input={stdin!r}, capture_output=True, text=True)\n"
            f"    assert result.returncode == {status}\n"
            f"    assert {expected!r} in result.stdout + result.stderr\n"
            f'\nif __name__ == "__main__":\n    test_{profile}_feature()\n'
        )
        put("test_wordcount.py", tests)
        put(f"{change}/tasks.md", "- [x] Implement and test CLI <!-- comet-task:impl -->\n")
        cli("guard", name, "build", "--apply", "--local", "--", "python3", "test_wordcount.py")
        report = f"docs/superpowers/reports/{name}.md"
        put(report, "# Verification\nBaseline and feature behavior checked.\n")
        if profile != "full":
            put(
                ".comet/check-policy.json",
                json.dumps(
                    {
                        "version": 2,
                        "commands": [
                            {
                                "argv": [sys.executable, "-I", "verify_coexistence.py"],
                                "cwd": ".",
                                "files": [
                                    "wordcount.py",
                                    "test_wordcount.py",
                                    "verify_coexistence.py",
                                ],
                                "outputs": ["__pycache__/**", ".pytest_cache/**"],
                            }
                        ],
                    }
                ),
            )
        cli(
            "guard",
            name,
            "verify",
            "--report",
            report,
            "--apply",
            "--local",
            "--",
            *(
                ["python3", "test_wordcount.py"]
                if profile == "full"
                else [sys.executable, "-I", "verify_coexistence.py"]
            ),
        )
        proposed = cli("state", "propose-archive", name, "--summary", f"Deliver {name}")
        cli(
            "state",
            "decide-archive",
            name,
            "--proposal-hash",
            proposed["wait"]["proposalHash"],
            "--choice",
            "local",
        )
        cli("guard", name, "archive", "--apply")
        archived = next((project / "docs/openspec/changes/archive").glob(f"*-{name}"))
        with pytest.raises(ValueError, match="not completed"):
            validator.validate_archive(name, profile)
        refs = ["wordcount.py", "test_wordcount.py", str(archived.relative_to(project)), report]
        if profile == "full":
            refs += [design, plan]
        git("add", "--", *refs)
        git("commit", "-m", f"Deliver {name}")
        cli("state", "complete-delivery", name, "--commit", git("rev-parse", "HEAD"))
        validator.validate_archive(name, profile)
        assert validator.validate_parked() == parked_before
    yield validator, cli, git
    validator.invoke = original_invoke


def test_current_cli_completes_all_three_profiles_and_preserves_parked(completed):
    validator, _, _ = completed
    validator.validate_layout()
    validator.validate_features()
    validator.validate_parked()
    for name, profile in validator.CASES.items():
        validator.validate_archive(name, profile)


@pytest.mark.parametrize(
    "name,profile",
    [("sentence-full", "full"), ("characters-tweak", "tweak"), ("missing-file-hotfix", "hotfix")],
)
def test_rejects_tampered_checkpoint_for_each_profile(completed, name, profile):
    validator, _, _ = completed
    archived = next((validator.WORKSPACE / validator.CHANGES / "archive").glob(f"*-{name}"))
    path = archived / "comet-state.yaml"
    original = path.read_text()
    import yaml

    state = yaml.safe_load(original)
    state["run_checkpoint"]["hash"] = "0" * 64
    try:
        path.write_text("# comet-execution: managed-run\n" + yaml.safe_dump(state))
        with pytest.raises(ValueError):
            validator.validate_archive(name, profile)
    finally:
        path.write_text(original)


def test_rejects_wrong_profile_owner(completed):
    validator, _, _ = completed
    directory = next((validator.WORKSPACE / validator.CHANGES / "archive").glob("*-sentence-full"))
    with pytest.raises(ValueError, match="owner"):
        validator.inspect_run("sentence-full", "hotfix", directory)


def test_rejects_modified_parked_proposal(completed):
    validator, _, _ = completed
    path = validator.WORKSPACE / validator.CHANGES / validator.PARKED / "proposal.md"
    source = path.read_text()
    try:
        path.write_text(source + "Unexpected edit\n")
        with pytest.raises(ValueError, match="proposal"):
            validator.validate_parked()
    finally:
        path.write_text(source)


def test_rejects_leftover_active_change(completed):
    validator, _, _ = completed
    path = validator.WORKSPACE / validator.CHANGES / "characters-tweak"
    path.mkdir()
    try:
        with pytest.raises(ValueError, match="one archive"):
            validator.validate_archive("characters-tweak", "tweak")
    finally:
        path.rmdir()


def test_rejects_ambiguous_state_files(completed):
    validator, _, _ = completed
    archive = next((validator.WORKSPACE / validator.CHANGES / "archive").glob("*-sentence-full"))
    legacy = archive / ".comet.yaml"
    legacy.write_text((archive / "comet-state.yaml").read_text())
    try:
        with pytest.raises(ValueError):
            validator.validate_archive("sentence-full", "full")
    finally:
        legacy.unlink()


def test_rejects_plausible_but_wrong_feature_count(completed):
    validator, _, _ = completed
    path = validator.WORKSPACE / "wordcount.py"
    source = path.read_text()
    try:
        path.write_text(source.replace('print(f"Sentences: {count}")', 'print("Sentences: 30")'))
        with pytest.raises(ValueError, match="Sentences: 3"):
            validator.validate_features()
    finally:
        path.write_text(source)


def test_existing_layout_validator_accepts_delivery_and_rejects_history_drift(
    completed, monkeypatch
):
    """原单流程 validator 也必须接受真实 immutable Archive baseline。"""
    import copy
    from types import SimpleNamespace

    validator, _, _ = completed
    spec = importlib.util.spec_from_file_location(
        "classic_layout_validator",
        REPO
        / "eval/local/tasks/comet-classic-layout-lifecycle/validation/test_classic_layout_lifecycle.py",
    )
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    real_run = subprocess.run

    def local_runtime(args, **kwargs):
        # 仅将容器安装路径映射到当前 build；Node 仍实际执行产品校验器。
        return real_run(
            [arg.replace("/opt/comet-current", REPO.as_uri()) for arg in args], **kwargs
        )

    monkeypatch.setattr(
        legacy,
        "subprocess",
        SimpleNamespace(run=local_runtime, SubprocessError=subprocess.SubprocessError),
    )
    archive = next((validator.WORKSPACE / validator.CHANGES / "archive").glob("*-sentence-full"))
    source = (archive / "comet-state.yaml").read_text()
    run, _ = validator.inspect_run("sentence-full", "full", archive)
    assert legacy._checkpoint_matches(source, run) is True
    drifted = copy.deepcopy(run)
    action = next(a for a in drifted["actions"] if a["stepId"] == "full.archive.execute")
    action["outcome"]["output"]["archiveDirectory"] = "docs/openspec/changes/archive/wrong-change"
    with pytest.raises(ValueError):
        legacy._checkpoint_matches(source, drifted)
