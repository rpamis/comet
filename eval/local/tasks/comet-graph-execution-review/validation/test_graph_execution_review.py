import subprocess
import sys

from comet_checks import WORKSPACE, _failed, _passed, run_comet_checks, write_results


def _tail(result: subprocess.CompletedProcess) -> str:
    return "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip())[-600:]


def check_graph_execution_review() -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_pipeline.py", "-q"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    if result.returncode != 0:
        return _failed("graph_execution_review", _tail(result))
    return _passed("graph_execution_review", "fan-out, review interruption, resume, and thread isolation pass")


if __name__ == "__main__":
    write_results([*run_comet_checks(), check_graph_execution_review()])
