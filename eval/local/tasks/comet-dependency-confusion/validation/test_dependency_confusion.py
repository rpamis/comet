import subprocess
import sys

from comet_checks import run_comet_checks, write_results, _passed, _failed, WORKSPACE


def _tail(result: subprocess.CompletedProcess) -> str:
    return "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip())[-600:]


def check_dependency_compatibility() -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_settings_service.py", "-q"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    if result.returncode != 0:
        return _failed("dependency_compatibility", _tail(result))
    return _passed("dependency_compatibility", "old and new settings imports both work")


if __name__ == "__main__":
    write_results([*run_comet_checks(), check_dependency_compatibility()])
