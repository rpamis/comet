"""Tests for text-processor. All pass; refactoring must keep them passing."""

import pytest

from text_processor import count_words, count_lines, count_chars, analyze


class TestCountWords:
    def test_basic(self):
        assert count_words("hello world foo") == 3

    def test_empty(self):
        assert count_words("") == 0

    def test_whitespace_only(self):
        assert count_words("   \t  ") == 0

    def test_single(self):
        assert count_words("hello") == 1

    def test_multiple_spaces(self):
        assert count_words("a  b   c") == 3


class TestCountLines:
    def test_basic(self):
        assert count_lines("line1\nline2\nline3") == 3

    def test_empty(self):
        assert count_lines("") == 0

    def test_single_no_newline(self):
        assert count_lines("hello") == 1

    def test_trailing_newline(self):
        assert count_lines("a\nb\n") == 2


class TestCountChars:
    def test_basic(self):
        assert count_chars("hello") == 5

    def test_empty(self):
        assert count_chars("") == 0

    def test_with_spaces(self):
        assert count_chars("a b c") == 5


class TestAnalyze:
    def test_combined(self):
        text = "hello world\nfoo bar"
        result = analyze(text)
        assert result == {"words": 4, "lines": 2, "chars": 19}

    def test_empty(self):
        assert analyze("") == {"words": 0, "lines": 0, "chars": 0}
