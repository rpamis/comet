You are working on a Python project called "review-pipeline".

Your task: Use the comet workflow to fix a graph-style data processing pipeline.

This task is adapted from `skills-benchmarks/oss-fix-lg-execution`.

## Bugs

1. `run_pipeline()` only processes part of the submitted task list.
2. Multi-task runs finalize immediately instead of pausing for human review.
3. `resume_after_review()` restarts or loses state instead of continuing the reviewed thread.
4. Thread state must be isolated by `thread_id`.

## What to do

1. Run `python -m pytest test_pipeline.py -q` to confirm the failures.
2. Follow the comet workflow phases from open through archive.
3. Fix the pipeline while keeping the public function names unchanged.
4. Verify that fan-out, review interruption, resume, and thread isolation all pass.

When the workflow asks for confirmation, assume "yes, proceed with the recommended option".
