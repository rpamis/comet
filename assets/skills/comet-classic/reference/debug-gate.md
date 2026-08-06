# Debug Gate Protocol

Canonical path: `comet-classic/reference/debug-gate.md`

This protocol is shared by comet sub-skills that directly modify code, including build, hotfix, and tweak. Enter the Debug Gate when a crash, unexpected behavior, test failure, or build failure appears while running the program, tests, build, or manual verification.

## Core Rules

- Immediately use the Skill tool to load the Superpowers `systematic-debugging` skill
- Do not propose or implement source fixes before the root cause investigation is complete

## Four-Stage Flow

1. Reproduce and locate the root cause first by reading the full error, checking recent changes, and tracing data flow
2. If the root cause is a source bug, first add a minimal failing test that reproduces the crash or unexpected behavior, then modify the source
3. After the fix, run that failing test, related tests, and the project's build or verification commands until all pass
4. Keep the test, the source fix, and the tasks.md checkoff in the current change; do not replace the current change verification loop by starting a separate “write test cases” change

## Parallel Investigation of Multiple Failures

Before entering the four-stage flow, run a failure-independence assessment to decide serial vs. parallel investigation:

- **No parallelism (keep existing serial `systematic-debugging`)**: ≤ 2 failures; failures are related (fixing one might fix others); shared state; would touch the same set of files; failure independence not yet established
- **Parallel (load the Superpowers `dispatching-parallel-agents` skill)**: ≥ 3 failures from distinct problem domains (different test files with different root causes, different subsystems broken independently), mutually independent and non-interfering

When parallel conditions are met:

1. Immediately use the Skill tool to load the Superpowers `dispatching-parallel-agents` skill
2. Dispatch one background investigation agent per independent failure, grouped by problem domain, with all dispatches in a single response for concurrent execution. Each agent prompt must be self-contained (specific failure, error messages, allowed investigation scope, prohibition on touching other problem domains' code)
3. All agents remain bound by this protocol's "no source changes before the root cause is identified" constraint; they only locate the root cause and return findings — **they do not submit fixes directly**
4. Once all investigations return, the main session serially consolidates findings and performs fixes; fixes still go through the current `review_mode` verification and review loop

> Parallelism applies only to **investigation**. Fixes are always serial, avoiding conflicts from multiple agents editing the same set of files at once — consistent with the `subagent-driven-development` red flag of "never dispatch multiple implementation subagents in parallel."
