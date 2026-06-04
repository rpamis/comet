---
astrolabe_change: enforce-executing-plans-review
role: technical-design
canonical_spec: openspec
archived-with: 2026-06-04-enforce-executing-plans-review
status: final
---

# Executing-Plans Review Gate Design

## Context

Issue #41 identifies a workflow gap in `comet-build`: when a user selects `executing-plans`, the implementation can reach the build -> verify transition without any mandatory independent review. The existing `subagent-driven-development` path already carries stronger review expectations, but `executing-plans` is lightweight and currently depends on the agent choosing to review rather than requiring it.

## Approach

The fix belongs in `comet-build` because the gap is created by a build-time execution-mode decision. The Chinese skill is the first implementation target per the repository rule for dual-language skill optimization.

Update `assets/skills-zh/comet-build/SKILL.md` in two places:

- In Step 3, immediately after the selected execution skill completes its tasks, add a mandatory `executing-plans` review gate.
- In the build exit conditions, state that `executing-plans` builds must have dispatched at least one code reviewer before running the build guard.

The gate is specific to `build_mode: executing-plans`. It must not make `direct` hotfix/tweak builds heavier, and it should not duplicate `subagent-driven-development`, which already uses review-oriented execution.

## Review Gate Semantics

When `build_mode` is `executing-plans`:

- After all planned implementation tasks are completed and before `"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply`, the workflow must dispatch a code reviewer at least once.
- Critical findings, including implementation defects, failed tests, unsafe behavior, or workflow violations, must be resolved before the build -> verify transition.
- Non-critical findings can be accepted only when the agent records the accepted finding and rationale in the build notes, task update, commit body, or another durable change artifact.

This keeps verification focused on validating the completed change. Verify can still catch missing review evidence as a consistency issue, but it is not the primary enforcement point.

## Testing Strategy

Use a focused skill prose regression test in `test/ts/skills.test.ts`. The test should fail before the skill text is updated and pass once the Chinese `comet-build` skill includes:

- the `executing-plans` condition,
- the required code reviewer dispatch,
- the requirement that review happens before build -> verify,
- handling for critical and accepted non-critical findings.

Run `npx vitest run test/ts/skills.test.ts` for the new regression and `npx vitest run test/ts/comet-scripts.test.ts` to confirm existing shell workflow tests remain healthy.

## Scope Boundaries

The Chinese skill remains the first implementation target. After user confirmation on 2026-06-04, the same review gate is synchronized to the English `comet-build` skill with matching regression assertions.
