from __future__ import annotations

from pathlib import Path

from invoice import calculate_total


def test_tax_rate_is_applied_as_percentage():
    assert calculate_total(100, 0.08) == 108.0


def test_zero_tax_still_returns_subtotal():
    assert calculate_total(42.5, 0) == 42.5


def test_distractor_file_is_untouched():
    text = Path("distractor.md").read_text(encoding="utf-8")
    assert "Do not edit it during the task." in text
