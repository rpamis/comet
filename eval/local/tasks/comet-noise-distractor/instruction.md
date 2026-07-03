You are working on a Python project called "invoice-lite".

Your task: Use the comet workflow to fix the invoice total calculation.

This task is adapted from `skills-benchmarks/lc-basic-noise`.

## Main bug

`calculate_total(subtotal, tax_rate)` currently adds the raw tax rate instead of applying it as a percentage. `calculate_total(100, 0.08)` should return `108.0`.

## Distractor

The file `distractor.md` contains unrelated ideas. Do not rewrite or "clean up" that file.

Run `python -m pytest test_invoice.py -q`, follow the comet workflow, and archive the completed change.

When the workflow asks for confirmation, assume "yes, proceed with the recommended option".
