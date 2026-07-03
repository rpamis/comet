import subprocess
import sys

from comet_checks import WORKSPACE, _failed, _passed, run_comet_checks, write_results


def _tail(result: subprocess.CompletedProcess) -> str:
    return "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip())[-600:]


def check_framework_selection() -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_architecture.py", "-q"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    if result.returncode != 0:
        return _failed("framework_selection", _tail(result))
    return _passed("framework_selection", "hybrid deep-agent plus compiled sub-workflow blueprint passes")


if __name__ == "__main__":
    write_results([*run_comet_checks(), check_framework_selection()])
