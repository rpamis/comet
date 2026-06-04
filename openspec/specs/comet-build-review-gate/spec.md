## Purpose

Ensure the `comet-build` `executing-plans` path cannot transition to verify without at least one independent code review.

## Requirements

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
