You are working on a Python project called "settings-service".

Your task: Use the comet workflow to fix a compatibility regression caused by a module rename.

This task is adapted from `skills-benchmarks/lc-deps-tavily`.

## Problem

The project used to expose `legacy_settings.load_settings()`, but the implementation moved to `settings_loader.py`. Existing callers still import the old module name, and the app also imports a stale helper name. The current tests in `test_settings_service.py` fail.

## What to do

1. Run `python -m pytest test_settings_service.py -q` to confirm the failure.
2. Follow the comet workflow phases from open through archive.
3. Restore compatibility without deleting the new `settings_loader.py` implementation.
4. Verify that both old and new import paths work and all tests pass.

When the workflow asks for confirmation, assume "yes, proceed with the recommended option".
