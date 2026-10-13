# 02 — Interrupt reviewed runs before the summary

**What to build:** A run that requires review processes every task and stores the results first, then pauses before any summary is finalized. The paused result announces itself as waiting for review, carries a self-describing interrupt payload saying why it stopped, which thread is waiting, and which tasks await the decision, and deliberately contains no summary so an unapproved run can never be mistaken for a finalized one. Empty submissions do not pause — there is nothing to review.

**Blocked by:** 01 — Fan out every submitted task (the pause happens after full execution, so fan-out must be complete first).

**Status:** ready-for-agent

- [ ] A reviewed run with at least one task interrupts with an interrupt payload describing the review reason, the thread identifier, and the pending tasks (AC-2)
- [ ] The paused result's status reports waiting for review and exposes no summary
- [ ] Task results are computed and stored on the thread before the pause, so approval will not re-run work
- [ ] An empty submission finalizes immediately even when review is enabled
