# Astrolabe Design Handoff

- Change: enforce-executing-plans-review
- Phase: design
- Mode: compact
- Context hash: ba976507c61c79aae401daf776fd0b87897f434000e55a9006df02fa5abaccde

Generated-by: ast-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/enforce-executing-plans-review/proposal.md

- Source: openspec/changes/enforce-executing-plans-review/proposal.md
- Lines: 1-24
- SHA256: 54d8adcf0a92696297dd02daef92003aef50603e101d033f5322592ddcd2accc

```md
## Why

Issue #41 shows that the `comet-build + executing-plans` path can finish implementation without any mandatory review. That weakens the build workflow because a user can select the lightweight execution path and still transition to verify with no independent code review.

## What Changes

- Add a mandatory review gate for `comet-build` when `build_mode` is `executing-plans`.
- Require at least one code reviewer dispatch after all implementation tasks are complete and before the build -> verify transition.
- Keep the gate in the build workflow so `comet-verify` remains responsible for validation rather than compensating for skipped build-time review.
- Follow the repository dual-language rule by updating the Chinese skill first; English skill synchronization remains gated on user confirmation.

## Capabilities

### New Capabilities
- `comet-build-review-gate`: Covers the required code review gate for the `executing-plans` build path.

### Modified Capabilities
- None. There are no existing OpenSpec specs in this repository to modify.

## Impact

- Primary file: `assets/skills-zh/comet-build/SKILL.md`
- Follow-up after user confirmation: `assets/skills/comet-build/SKILL.md`
- Verification: focused script test baseline and build/lint checks appropriate to a skill text update.
```

## openspec/changes/enforce-executing-plans-review/design.md

- Source: openspec/changes/enforce-executing-plans-review/design.md
- Lines: 1-28
- SHA256: b6debfe2fd5a464126a3944ca92abff47fbdd1da76ffb4316a8b842be05aa972

```md
## Overview

The safest fix is to make `comet-build` itself enforce the review gate for `executing-plans`. The issue is caused by a build-time execution choice, so the constraint should be visible exactly where the user chooses and runs that path.

## Decision

Add the requirement to `assets/skills-zh/comet-build/SKILL.md` in the build execution flow and exit conditions:

- If the selected `build_mode` is `executing-plans`, the agent must dispatch a code reviewer at least once after all tasks are complete.
- The review must happen before `"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply`.
- Critical findings must be fixed before leaving build.
- Accepted non-critical findings must be recorded before continuing.

This deliberately does not move the primary control to `comet-verify`. Verify may still evaluate the result, but relying on verify to upgrade later leaves the weak path in build intact and broadens the change.

## Scope

In this pass, update the Chinese skill first according to the repository dual-language rule. The English skill should be synchronized only after user confirmation.

## Risks

- If the wording is too vague, agents may treat review as optional. The update must use mandatory language and place the gate before the build guard.
- If the rule applies to every build mode, it may make lightweight or subagent-driven paths unnecessarily heavy. The gate is specific to `executing-plans`.

## Verification

- Run the focused Vitest shell-script suite to ensure baseline scripts remain healthy.
- Review the changed skill text to confirm the gate is placed before build -> verify and only targets `executing-plans`.
```

## openspec/changes/enforce-executing-plans-review/tasks.md

- Source: openspec/changes/enforce-executing-plans-review/tasks.md
- Lines: 1-2
- SHA256: ae09b7b629a178bbbacf43da3ec8d2565ea8482e0869ca2c03e410ac62e6d64c

```md
- [ ] Update `assets/skills-zh/comet-build/SKILL.md` so `executing-plans` requires at least one code reviewer dispatch before build -> verify.
- [ ] Run focused verification and record that English synchronization is pending user confirmation.
```

## openspec/changes/enforce-executing-plans-review/specs/comet-build-review-gate/spec.md

- Source: openspec/changes/enforce-executing-plans-review/specs/comet-build-review-gate/spec.md
- Lines: 1-16
- SHA256: dc0f19a5176ec8bedf0b05d3baac44173fd0b9a7ec494ac4eb962748ff98ef01

```md
## ADDED Requirements

### Requirement: Executing-plans build review gate
When a Comet full build uses `build_mode: executing-plans`, the workflow SHALL require at least one code reviewer dispatch after all implementation tasks are complete and before the build phase transitions to verify.

#### Scenario: executing-plans tasks complete before verify transition
- **WHEN** `comet-build` is using `executing-plans` and all implementation tasks have been completed
- **THEN** the workflow MUST dispatch a code reviewer at least once before running the build -> verify guard

#### Scenario: review findings before build completion
- **WHEN** the required reviewer reports critical implementation, test, or workflow issues
- **THEN** the workflow MUST resolve those issues before the build -> verify transition

#### Scenario: non-critical review findings
- **WHEN** the required reviewer reports only non-critical findings that are intentionally accepted
- **THEN** the workflow MUST record the accepted findings and rationale before continuing to verify
```
