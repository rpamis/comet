import subprocess
import sys

from comet_checks import run_comet_checks, write_results, _passed, _failed, WORKSPACE


def check_cross_file_refactor() -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_textkit.py", "-q"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    if result.returncode != 0:
        return _failed("cross_file_count_dispatcher", (result.stdout + result.stderr)[-600:])
    return _passed("cross_file_count_dispatcher", "dispatcher, wrappers, and CLI all work")


if __name__ == "__main__":
    write_results([*run_comet_checks(), check_cross_file_refactor()])
