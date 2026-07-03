import subprocess
import sys

from comet_checks import run_comet_checks, write_results, _passed, _failed, WORKSPACE


def check_persistence_threading() -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_session_store.py", "-q"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    if result.returncode != 0:
        return _failed("persistence_threading", (result.stdout + result.stderr)[-600:])
    return _passed("persistence_threading", "thread state is isolated and persisted")


if __name__ == "__main__":
    write_results([*run_comet_checks(), check_persistence_threading()])
