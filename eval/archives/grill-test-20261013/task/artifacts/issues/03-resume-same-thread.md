# 03 — Resume continues the same reviewed thread

**What to build:** Approving a paused thread continues that exact thread. Resume looks the thread up by its identifier in the per-thread store, flips the thread to approved, and returns the already-computed results with a finalized summary reflecting that thread's task count. Resuming a thread that does not exist fails loudly instead of silently producing an empty approval; repeated resumes of an approved thread keep returning the same stored results.

**Blocked by:** 02 — Interrupt reviewed runs before the summary (resume consumes the paused state that the interrupt stores).

**Status:** ready-for-agent

- [ ] Resuming a paused thread returns that thread's full stored results with an approved summary containing its task count (AC-3)
- [ ] Resume does not re-run task processing; it finalizes the stored results
- [ ] Resuming an unknown thread identifier fails with a missing-key error rather than an empty approval
- [ ] Repeated resumes of an approved thread return the same results idempotently
