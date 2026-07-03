import subprocess
import sys

from comet_checks import run_comet_checks, write_results, _passed, _failed, WORKSPACE


def check_approval_flow() -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_approvals.py", "-q"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    if result.returncode != 0:
        return _failed("human_approval_flow", (result.stdout + result.stderr)[-600:])
    return _passed("human_approval_flow", "dangerous deletes require pending approval")


if __name__ == "__main__":
    write_results([*run_comet_checks(), check_approval_flow()])
