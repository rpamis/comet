# 01 — Fan out every submitted task

**What to build:** A pipeline submission processes the complete task list it is given, end to end. When the submitter opts out of review, the run finalizes immediately: every task appears in the results, the summary reports the true task count, and the submitting thread's stored state reflects the whole batch. Nothing is silently dropped.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A non-reviewed run over a multi-task batch returns one result per submitted task, each carrying its own task (AC-1)
- [ ] The finalized summary reflects the full submitted task count
- [ ] The thread's stored state records the complete task list and results
- [ ] An empty submission finalizes immediately with a zero-task summary
