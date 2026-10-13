# 04 — Thread isolation and regression hardening

**What to build:** Threads are told apart by their identifier everywhere state is read or written. Two threads submitting different batches each resume with their own results, in any resume order, and neither sees the other's tasks. A new submission on an existing thread identifier starts a fresh run for that thread, overwriting its previous state. The confirmed edge behaviors — unknown-thread failure, idempotent re-resume, overwrite-on-rerun, empty-submission finalize — are pinned by additional regression tests that run alongside the unchanged existing acceptance suite.

**Blocked by:** 03 — Resume continues the same reviewed thread (isolation is observed across resumed threads, so resume must be correct first).

**Status:** ready-for-agent

- [ ] Two threads with different batches each resume with their own result counts and contents (AC-4)
- [ ] Resume order across threads does not change any thread's outcome
- [ ] Running a new batch on an existing thread identifier overwrites that thread's state
- [ ] Added regression tests pass together with the unchanged original acceptance suite
