# Issue #298 Task 2 report

## Files

- `app/commands/eval.ts`: package-safe static collection, strict packaged schema validation, normalized task catalogue, and Python-compatible generated-cache lookup.
- `eval/schemas/comet.eval/v1alpha1.schema.json`: versioned strict editor/runtime schema.
- `eval/scaffold/python/{eval_schema,generated_task_cache,task_resolution}.py`: schema-first validation and the sole Python task-selection authority.
- `eval/scaffold/python/manifests.py` and task collection wiring: strict manifest diagnostics and resolver-backed selection.
- Tests under `eval/local/tests/scaffold/` and `test/app/`: precedence, unknown fields, packaged static collection, cache/corruption, and release-package inclusion.

## RED → GREEN evidence

- RED: resolver/static-collection tests initially failed because the resolver and static collector modules did not exist.
- RED: a real fresh-owner `uv run --offline --no-sync` collect path required the owner-local venv/harness and could not serve first use.
- GREEN: `--collect` now exits before `uv`, dotenv, optional Langfuse extras, credential handling, Docker, agents, plugins, or network operations; the packaged-NPM test asserts exact `Tasks: pending generation` and no venv creation.
- RED: JS cache hashing used ordinary `JSON.stringify` and `null` for the default model, which cannot match Python's canonical hash.
- GREEN: the packaged test calls Python `ensure_generated_manifest` with a local fake generator, then the installed package lists the same frozen tasks. A mismatched metadata file falls back to `Tasks: pending generation`.
- GREEN: the same packaged boundary rejects a root unknown field with `unknownTopLevel: unknown field`, rejects an invalid explicit task, and resolves a source task name from `task.toml`.

## Verification

- `npx vitest run test/app/eval-command.test.ts test/app/eval-static-collect.integration.test.ts test/scripts/prepublish-check.test.ts` — 36 passed.
- `uv run pytest local/tests/scaffold/test_task_resolution.py local/tests/scaffold/test_manifests.py local/tests/scaffold/test_auto_tasks.py` — 34 passed.
- `uv run pytest --collect-only local/tests/tasks/test_tasks.py` — 71 task-runner cases collected without starting an Agent.
- `uv run --extra dev ruff check ...` — passed.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm lint` — passed.
- `pnpm build` — passed; generated Classic/Native/Entry bundle side effects were restored before commit.
- JSON Schema parse, release-package schema inclusion test, lockfile scope check (32 added lock lines), and `git diff --check` — passed.

## Residual concerns

- The task-runner module is not executed locally because its autouse environment gate intentionally requires real Agent credentials; only collection-safe resolver tests were run. No remote Agent was started.
- Node static collection deliberately mirrors only static syntax/catalogue/cache semantics. Python remains the execution and generation authority.
