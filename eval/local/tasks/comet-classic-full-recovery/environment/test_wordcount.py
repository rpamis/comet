"""Tests for wordcount CLI."""

import subprocess
import sys


def test_count_words():
    result = subprocess.run(
        [sys.executable, "wordcount.py"],
        input="hello world foo",
        capture_output=True, text=True
    )
    assert "Words: 3" in result.stdout


def test_count_lines():
    result = subprocess.run(
        [sys.executable, "wordcount.py", "--lines"],
        input="hello\nworld\nfoo",
        capture_output=True, text=True
    )
    assert "Words: 3" in result.stdout
    assert "Lines: 3" in result.stdout


if __name__ == "__main__":
    test_count_words()
    test_count_lines()
    print("All tests passed")
