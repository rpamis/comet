# Host capability check

On a new task, host change, or execution configuration change, perform this check before approving Shape/Open or starting implementation that depends on the configuration. Reuse capabilities already confirmed and still available in this host; do not probe at every phase.

Use the platform's actual tools, Skill inventory, and project rules. CLI cannot enumerate host tools: an installed command does not prove reviewer dispatch is available or an external Skill is permitted.

- Native needs a Verifier session separate from the Builder and a way to track the original task. Classic `review_mode: standard|thorough` requires an independent reviewer; delegated implementation also needs a trackable implementer. Read-only restrictions apply to implementation and requirements files. Reviewers must still be able to claim their Action, request checks, and submit outcomes through public Runtime commands; do not sandbox the entire session against Runtime writes.
- Classic creation and specification validation need the OpenSpec Skill and CLI required by the current phase. Full Design needs brainstorming. After choosing planning, implementation, TDD, or review strategies, check their specified Skills. Native adds no external Skill dependency. Check only selected strategies; dependencies of unused strategies do not block work.
- A Skill must be loadable and permitted by current user authorization and project rules. Report the specific gap and recovery condition for missing installation, explicit prohibition, unavailable independent sessions, or inability to report to Runtime, before affected implementation begins. Continue without extra confirmation when existing user choices cover the required capabilities.

For unknown capabilities, inspect available tool documentation before dispatching actual implementation or verification work. Preserve user choices. Explain installation, authorization, or host changes needed for a confirmed gap; do not silently disable independent review, change strategy, or treat unknown as passed. Apply an explicit later strategy change through the original Runtime decision path.
