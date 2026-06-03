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
