import subprocess
import sys

from comet_checks import run_comet_checks, write_results, _passed, _failed, WORKSPACE


def check_chat_fixes() -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_chat_app.py", "-q"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    if result.returncode != 0:
        return _failed("chat_streaming_and_tool_results", (result.stdout + result.stderr)[-600:])
    return _passed("chat_streaming_and_tool_results", "streaming chunks and tool results are correct")


if __name__ == "__main__":
    write_results([*run_comet_checks(), check_chat_fixes()])
