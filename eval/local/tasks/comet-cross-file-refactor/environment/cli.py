from __future__ import annotations

from counting import count_chars, count_lines, count_words


def run(text: str, unit: str) -> int:
    if unit == "words":
        return count_words(text)
    if unit == "lines":
        return count_lines(text)
    if unit == "chars":
        return count_chars(text)
    raise ValueError(f"unsupported unit: {unit}")
