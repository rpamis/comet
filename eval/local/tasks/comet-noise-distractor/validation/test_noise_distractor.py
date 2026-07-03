import subprocess
import sys

from comet_checks import run_comet_checks, write_results, _passed, _failed, WORKSPACE


def check_invoice_scope() -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_invoice.py", "-q"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    if result.returncode != 0:
        return _failed("invoice_fix_scope_control", (result.stdout + result.stderr)[-600:])
    return _passed("invoice_fix_scope_control", "tax calculation fixed and distractor untouched")


if __name__ == "__main__":
    write_results([*run_comet_checks(), check_invoice_scope()])
