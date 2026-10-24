"""text-processor: text analysis utilities.

This module has three near-identical counting functions with duplicated logic.
They should be refactored into a single `count(text, unit)` dispatcher while
preserving the exact same behavior (and the public names as thin wrappers).
"""

from __future__ import annotations


def count_words(text: str) -> int:
    """Count words (whitespace-separated tokens)."""
    if not text:
        return 0
    words = text.split()
    count = 0
    for word in words:
        count += 1
    return count


def count_lines(text: str) -> int:
    """Count lines (newline-separated)."""
    if not text:
        return 0
    lines = text.splitlines()
    count = 0
    for line in lines:
        count += 1
    return count


def count_chars(text: str) -> int:
    """Count characters."""
    if not text:
        return 0
    count = 0
    for char in text:
        count += 1
    return count


def analyze(text: str) -> dict:
    """Return a summary of all counts."""
    return {
        "words": count_words(text),
        "lines": count_lines(text),
        "chars": count_chars(text),
    }
