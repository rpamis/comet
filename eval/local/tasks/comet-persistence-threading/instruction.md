You are working on a Python project called "session-store".

Your task: Use the comet workflow to fix state isolation and persistence.

This task is adapted from `skills-benchmarks/oss-fix-lg-persistence`.

## Bugs

- Values written for one `thread_id` leak into another thread.
- Creating a new `SessionStore` pointed at the same data file loses previously saved state.

Run `python -m pytest test_session_store.py -q`, follow the comet workflow, and keep the `SessionStore` API compatible.

When the workflow asks for confirmation, assume "yes, proceed with the recommended option".
