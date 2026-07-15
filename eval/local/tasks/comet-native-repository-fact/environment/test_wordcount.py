import subprocess
import sys


def run_cli(*args: str, input_text: str) -> str:
    return subprocess.run(
        [sys.executable, "wordcount.py", *args],
        input=input_text,
        capture_output=True,
        text=True,
        check=True,
    ).stdout


def test_count_words():
    assert "Words: 3" in run_cli(input_text="hello world foo")


def test_count_lines():
    assert "Lines: 3" in run_cli("--lines", input_text="hello\nworld\nfoo")
