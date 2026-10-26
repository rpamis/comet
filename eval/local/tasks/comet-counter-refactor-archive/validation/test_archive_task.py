"""独立验证业务行为及当前 SDK 归档。"""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from scaffold.python.validation.current_archive import inspect_completed_archive

WORKSPACE = Path("/workspace")


def check_feature(workspace):
    try:
        spec = importlib.util.spec_from_file_location(
            "subject_counter", workspace / "text_processor.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for text in ["", "a b", "a  b\n", "a\r\nb\r\n", "中文🙂", "\n\n", "a\tb"]:
            expected = dict(words=len(text.split()), lines=len(text.splitlines()), chars=len(text))
            assert module.analyze(text) == expected
            for unit, value in expected.items():
                assert module.count(text, unit) == value
                assert getattr(module, "count_" + unit)(text) == value
        try:
            module.count("abc", "unknown")
        except ValueError:
            pass
        else:
            raise AssertionError("Unsupported unit did not raise ValueError")
        import ast

        tree = ast.parse((workspace / "text_processor.py").read_text(encoding="utf-8"))
        for name in ("count_words", "count_lines", "count_chars"):
            node = next(
                node
                for node in tree.body
                if isinstance(node, ast.FunctionDef) and node.name == name
            )
            assert any(
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Name)
                and call.func.id == "count"
                for call in ast.walk(node)
            )
        subprocess.run(
            [sys.executable, "-m", "pytest", "test_text_processor.py", "-q"],
            cwd=workspace,
            capture_output=True,
            text=True,
            check=True,
            timeout=60,
        )
        return {"check": "business_behavior", "status": "passed"}
    except (
        OSError,
        ValueError,
        AssertionError,
        AttributeError,
        StopIteration,
        subprocess.SubprocessError,
    ) as error:
        return {"check": "business_behavior", "status": "failed", "reason": str(error)}


def main():
    context = json.loads(
        (WORKSPACE / os.environ.get("BENCH_TEST_CONTEXT", "_test_context.json")).read_text(
            encoding="utf-8"
        )
    )
    results = [check_feature(WORKSPACE)]
    evidence = {}
    try:
        inspect_completed_archive(
            WORKSPACE, "counter-dispatch", context.get("treatment_name", ""), evidence=evidence
        )
        results.append({"check": "current_sdk_archive", "status": "passed"})
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        results.append({"check": "current_sdk_archive", "status": "failed", "reason": str(error)})
    output = {
        "validation_evidence": evidence,
        "passed": [r["check"] for r in results if r["status"] == "passed"],
        "failed": [
            r["check"] + ": " + r.get("reason", "") for r in results if r["status"] == "failed"
        ],
    }
    (WORKSPACE / os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")).write_text(
        json.dumps(output), encoding="utf-8"
    )
    print(json.dumps(output))
    return 0 if not output["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
