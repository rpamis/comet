from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_env_example_contains_simplified_langsmith_config(tmp_path):
    script = Path.cwd() / "env_writer.py"
    result = subprocess.run([sys.executable, str(script)], cwd=tmp_path, capture_output=True, text=True)
    assert result.returncode == 0
    content = (tmp_path / ".env.example").read_text(encoding="utf-8")
    assert "ANTHROPIC_API_KEY=" in content
    assert "LANGSMITH_API_KEY=" in content
    assert "LANGSMITH_PROJECT=agent-template" in content
    assert "LANGSMITH_TRACING=true" in content
    assert "TRACE_TO_LANGSMITH" not in content
