"""Unit tests for the eval regression gate wrapper."""

import subprocess
import sys
from pathlib import Path


def test_regression_check_help_imports_from_eval_working_directory():
    eval_root = Path(__file__).resolve().parents[3]

    result = subprocess.run(
        [sys.executable, "local/scripts/regression_check.py", "--help"],
        cwd=eval_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "--count" in result.stdout
