import subprocess
import sys

from comet_checks import WORKSPACE, _failed, _passed, run_comet_checks, write_results


def check_langsmith_env_template() -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_env_writer.py", "-q"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    if result.returncode != 0:
        return _failed("langsmith_env_template", (result.stdout + result.stderr)[-600:])

    env_example = WORKSPACE / ".env.example"
    if not env_example.exists():
        run_result = subprocess.run(
            [sys.executable, "env_writer.py"],
            capture_output=True,
            text=True,
            cwd=str(WORKSPACE),
        )
        if run_result.returncode != 0:
            return _failed(
                "langsmith_env_template",
                (run_result.stdout + run_result.stderr)[-600:],
            )
    content = env_example.read_text(encoding="utf-8")
    expected = [
        "ANTHROPIC_API_KEY=",
        "LANGSMITH_API_KEY=",
        "LANGSMITH_PROJECT=agent-template",
        "LANGSMITH_TRACING=true",
    ]
    missing = [item for item in expected if item not in content]
    if missing:
        return _failed("langsmith_env_template", f"missing entries: {missing}")
    if "TRACE_TO_LANGSMITH" in content:
        return _failed("langsmith_env_template", "TRACE_TO_LANGSMITH should not be emitted")
    return _passed("langsmith_env_template", "LangSmith .env.example template is correct")


if __name__ == "__main__":
    write_results([*run_comet_checks(), check_langsmith_env_template()])
