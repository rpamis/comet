from __future__ import annotations

import cli
import counting


def test_new_dispatcher_counts_all_units():
    assert counting.count("hello world", "words") == 2
    assert counting.count("a\nb", "lines") == 2
    assert counting.count("abc", "chars") == 3


def test_wrappers_remain_compatible():
    assert counting.count_words("hello world") == 2
    assert counting.count_lines("a\nb") == 2
    assert counting.count_chars("abc") == 3


def test_cli_uses_dispatcher():
    assert cli.run("hello world", "words") == 2
    assert cli.run("abc", "chars") == 3
