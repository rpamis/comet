# Spec: Fix the review-pipeline thread execution graph

Labels: ready-for-agent

## Problem Statement

Users of the data processing pipeline submit a list of tasks and expect the pipeline to fan out over every one of them, pause for human review before finalizing multi-task runs, and then continue the exact same reviewed thread after approval. Today the pipeline silently drops all but the first submitted task, finalizes reviewed runs immediately with a summary nobody approved, and loses all stored thread state on resume — returning an "approved" result with zero tasks processed. Threads also cannot be told apart after resume because state is not actually carried per thread, so concurrent submissions clobber each other's outcomes.

## Solution

Restore the intended graph-style execution semantics behind the existing public API. A run processes every submitted task, computes their results, and stores them in the per-thread state store under the submitting thread's identifier. When review is required and there is work to review, the run interrupts before the finalization summary with a self-describing interrupt payload and marks the thread as waiting for review. Resuming a thread continues that same thread: it looks up the stored state by thread identifier, flips the thread to approved, and returns the already-computed results with a finalized summary. Thread state is isolated by thread identifier, so runs and resumes on different threads never see each other's tasks or results. Non-reviewed runs and empty submissions finalize immediately.

## User Stories

1. As a pipeline user, I want every task I submit to be processed, so that no work is silently dropped from my batch.
2. As a pipeline user, I want multi-task runs to pause for my review before any summary is finalized, so that nothing is reported as done until I have approved it.
3. As a pipeline user, I want the interrupted result to carry a structured interrupt payload, so that I can tell why the run stopped and which thread and tasks are awaiting my decision.
4. As a pipeline user, I want the interrupted result to contain no summary, so that an unapproved run cannot be mistaken for a finalized one.
5. As a reviewer, I want the tasks processed and their results stored before the pause, so that approval finalizes instantly instead of re-running work.
6. As a reviewer, I want resume to continue the exact thread I reviewed, so that the approved results correspond to the tasks I actually saw.
7. As a reviewer, I want resume to return the full result set of that thread with a summary reflecting its task count, so that I can verify the batch completed.
8. As a pipeline user, I want thread state isolated by thread identifier, so that two threads submitting different batches each resume with their own results.
9. As a pipeline user, I want to run several threads concurrently and resume them in any order, so that thread completion does not depend on submission order.
10. As a pipeline user, I want resuming an unknown thread to fail loudly, so that a typo cannot silently produce an empty approval.
11. As a pipeline user, I want repeated resumes of an approved thread to keep returning the same results, so that idempotent re-checks are safe.
12. As a pipeline user, I want a non-reviewed run to finalize immediately with a summary over all submitted tasks, so that opt-out behavior stays fast and unchanged.
13. As a pipeline user, I want an empty submission to finalize immediately even when review is enabled, so that no run hangs waiting for a review of nothing.
14. As a maintainer, I want the public function names, signatures, and defaults to stay unchanged, so that existing callers keep working.
15. As a maintainer, I want the existing acceptance suite to keep driving the module at its public boundary, so that the fixes are pinned by external behavior only.
16. As a maintainer, I want per-thread state kept inspectable after approval, so that I can audit what each thread produced.

## Implementation Decisions

- The review gate is uniform: whenever review is requested and at least one task is submitted, the run pauses; review opt-out and empty submissions finalize immediately (grilling Q1, Q7).
- The interrupt result carries a dictionary payload describing the review reason, the thread identifier, and the pending tasks, under the interrupt key callers already observe; the paused result exposes the waiting status and deliberately omits any summary (grilling Q2).
- Execution happens before the pause: all submitted tasks are processed and their results stored in the per-thread state store first; the interrupt stops finalization, not execution (grilling Q3).
- Resume looks the thread up by identifier in the per-thread store and fails with a missing-key error for unknown threads instead of returning an empty approval (grilling Q4).
- After resume, the thread's state is retained and its status flips to approved; subsequent resumes of the same thread return the same stored results idempotently (grilling Q5).
- Starting a new run on an existing thread identifier overwrites that thread's state, treating a new submission as a new run (grilling Q6).
- The state store remains the module-level thread-keyed mapping that callers already clear between scenarios; thread isolation is achieved by carrying per-thread state through it rather than replacing it.
- Module-private helpers may be introduced to shape the interrupt payload and shared finalize logic; no new public API is added (grilling Q8).
- The public function names, parameter names, and defaults of the two entry points stay exactly as they are.

## Testing Decisions

- A good test exercises only external behavior through the public module boundary — the two entry points' return shapes and the observable per-thread state — never internal helpers.
- The modules under test are the pipeline module alone, driven by the existing unchanged acceptance suite at the public-function seam; no new seams are introduced and internals are not over-tested (seam confirmation in session).
- Prior art: the existing suite's four scenarios already pin fan-out completeness, review interruption before summary, same-thread resume, and per-thread isolation; the fixed verification command is the pytest run over that suite.
- Acceptance mapping: AC-1 fan-out processes every task; AC-2 multi-task review pauses before summary; AC-3 resume continues the same reviewed thread; AC-4 thread identifiers isolate state.

## Out of Scope

- Any change to the acceptance suite or to the fixed verification command.
- Concurrency-safety guarantees beyond per-key isolation of the module-level store (no locking, no async execution).
- Persistence of thread state across processes or restarts.
- New public API, renaming, or signature changes to the entry points.
- Real-time or streaming task execution; batches remain finite lists.

## Further Notes

- The four confirmed grilling decisions (uniform gate, dict payload, compute-then-pause, fail-loud resume, retain-and-flip, overwrite-on-rerun, empty-finalize, private helpers) were all explicitly agreed by the user in session and are recorded here as the authoritative understanding.
- The only consumer of the module today is the acceptance suite; no other callers constrain behavior.
