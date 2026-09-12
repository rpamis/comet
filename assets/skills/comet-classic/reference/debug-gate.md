# Debug Gate Protocol

Canonical path: `comet-classic/reference/debug-gate.md`

This protocol is shared by comet sub-skills that directly modify code, including build, hotfix, and tweak. Enter the Debug Gate when a crash, unexpected behavior, test failure, or build failure appears while running the program, tests, build, or manual verification.

## Core Rules

Exception: a TDD RED whose verified failure cause is the not-yet-implemented target behavior is normal development evidence. Continue RED-GREEN-REFACTOR without loading debugging Skills. Environment errors, test-loading failures, unrelated regressions, and unexplained RED do not qualify.

- `build_mode: autonomous` investigates, repairs, and verifies through the steps below without mandatory external Skills. Other strategies immediately use the Skill tool to load Superpowers `systematic-debugging`.
- Do not propose or implement source fixes before completing the root-cause investigation.

## Four-Stage Flow

1. Reproduce and locate the root cause: read the full error, inspect recent changes, and trace data flow.
2. If the root cause is a source bug, add the smallest failing test that reproduces the crash or unexpected behavior before modifying the source.
3. After fixing, run that test, related tests, and the project's build/verification commands, and confirm they all pass.
4. Keep tests, source fixes, and tasks.md completion records in the current change. Complete repair and verification there; a separate “write test cases” change cannot replace them.

## Investigating and Fixing Multiple Failures

When several checks fail, first assess possible shared root causes, shared state, and overlapping files. Use those findings and investigation cost to choose sequential or parallel work. Failure count does not determine scheduling. If independence is not established, investigate enough to establish it before making concurrent changes.

- Related failures, shared state, or overlapping modification scope: investigate and integrate together to avoid repeatedly diagnosing the same cause.
- Confirmed independent problems, with enough time saved to offset dispatch and integration costs: parallel investigation is allowed. Autonomous can assign clearly scoped investigation tasks directly; other strategies load Superpowers `dispatching-parallel-agents` when a parallel method is needed.

Give every investigation agent the specific failure, error evidence, allowed investigation scope, and required findings. Investigation agents return root causes and evidence; **they do not submit fixes directly**. The main session checks conclusions and actual dependencies before assigning repairs.

Repairs follow the selected build_mode, each agent's permitted files, and `comet-classic/reference/subagent-dispatch.md`. Implement and integrate sequentially when repairs share state or modification scope. Autonomous may implement concurrently only when tasks are independent, file scopes do not overlap, and each result can be accepted separately. Other execution strategies retain their selected method; debugging does not authorize a strategy change. Do not edit source before the cause is known. Every repair still requires tests, review, and acceptance within the current change.
