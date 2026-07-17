"""Baseline tests for the word-count CLI."""

import subprocess
import sys
from pathlib import Path


def run_cli(*args: str, input_text: str) -> str:
    result = subprocess.run(
        [sys.executable, "wordcount.py", *args],
        input=input_text,
        capture_output=True,
        text=True,
        check=True,
        cwd=Path(__file__).parent,
    )
    return result.stdout


def test_count_words():
    assert "Words: 3" in run_cli(input_text="hello world foo")


def test_count_lines():
    output = run_cli("--lines", input_text="hello\nworld\nfoo")
    assert "Words: 3" in output
    assert "Lines: 3" in output
