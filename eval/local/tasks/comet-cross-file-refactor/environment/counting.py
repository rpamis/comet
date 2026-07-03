from __future__ import annotations


def count_words(text: str) -> int:
    return len(text.split())


def count_lines(text: str) -> int:
    return len(text.splitlines())


def count_chars(text: str) -> int:
    return len(text)
