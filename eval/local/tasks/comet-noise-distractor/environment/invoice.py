from __future__ import annotations


def calculate_total(subtotal: float, tax_rate: float) -> float:
    return round(subtotal + tax_rate, 2)
