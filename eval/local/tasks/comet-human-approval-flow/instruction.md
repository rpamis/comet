You are working on a Python project called "doc-ops".

Your task: Use the comet workflow to add a human approval step before dangerous document operations execute.

This task is adapted from `skills-benchmarks/oss-fix-lc-hitl`.

## Requirements

- `delete_document(doc_id)` should return a pending approval record, not delete immediately.
- `approve(approval_id)` should execute the pending delete exactly once.
- Safe operations such as `read_document(doc_id)` should remain immediate.

Run `python -m pytest test_approvals.py -q`, follow the comet workflow, and archive the completed change.

When the workflow asks for confirmation, assume "yes, proceed with the recommended option".
