import subprocess
import sys

from comet_checks import WORKSPACE, _failed, _passed, run_comet_checks, write_results


def _tail(result: subprocess.CompletedProcess) -> str:
    return "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip())[-600:]


def check_agent_memory_routing() -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_agent_system.py", "-q"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    if result.returncode != 0:
        return _failed("agent_memory_routing", _tail(result))
    return _passed("agent_memory_routing", "preferences persist, researcher has docs, and deployment approval is checkpointed")


if __name__ == "__main__":
    write_results([*run_comet_checks(), check_agent_memory_routing()])
