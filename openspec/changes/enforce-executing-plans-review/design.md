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

Update the Chinese skill first according to the repository dual-language rule. After user confirmation on 2026-06-04, synchronize the approved gate to the English skill.

## Risks

- If the wording is too vague, agents may treat review as optional. The update must use mandatory language and place the gate before the build guard.
- If the rule applies to every build mode, it may make lightweight or subagent-driven paths unnecessarily heavy. The gate is specific to `executing-plans`.

## Verification

- Run the focused Vitest shell-script suite to ensure baseline scripts remain healthy.
- Review the changed skill text to confirm the gate is placed before build -> verify and only targets `executing-plans`.
