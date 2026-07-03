You are working on a Python package called "textkit".

Your task: Use the comet workflow to refactor duplicated counting functions into a shared dispatcher.

This task is adapted from `skills-benchmarks/lc-basic`.

## Requirements

- Add `count(text, unit)` supporting `"words"`, `"lines"`, and `"chars"`.
- Keep existing wrappers `count_words`, `count_lines`, and `count_chars`.
- Update the CLI helper to use the shared dispatcher.
- Preserve existing behavior and tests.

Run `python -m pytest test_textkit.py -q`, follow the comet workflow, and archive the completed change.

When the workflow asks for confirmation, assume "yes, proceed with the recommended option".
