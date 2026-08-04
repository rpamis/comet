# Native Ambient Resume

## Purpose

在不扫描所有活动 change 深层产物的前提下，识别 Native 恢复目标，并仅对明确目标执行完整安全检查。

## Requirements

### Lightweight candidate discovery

- Ambient Resume MUST enumerate Native change candidates with the configured Native root's existing bounded and path-protected directory rules.
- Candidate discovery MUST NOT read a candidate's Runtime directory, brief, specifications, verification evidence, repair state, or implementation scope.
- Candidate discovery MUST expose a readable current-state phase when available and MUST represent an unreadable or incompatible state document as `invalid` without failing another explicitly targeted change.

### Target resolution

- An explicitly named active change MUST take precedence over the project selection.
- Without an explicit name, a valid Native selection MUST identify the target.
- Without an explicit name or valid selection, exactly one active change MAY be inferred as the target.
- Multiple active changes without an explicit name or valid selection MUST require the caller to choose and MUST NOT trigger full artifact inspection for every candidate.
- Read-only target resolution MUST NOT create or mutate project selection.

### Target-only validation

- After target resolution, Ambient Resume MUST perform the existing complete state and artifact checks only for the resolved target.
- Ambient Resume MUST NOT perform complete status, Runtime, artifact, evidence, or repair checks for non-target changes.
- A target's own invalid state or artifacts MUST continue to fail closed with the target's blocking reason.
- A non-target change's missing or invalid Runtime artifacts MUST NOT change the resolved target's resume result.

### Compatibility

- Existing output actions for no active changes, unrelated requests, explicit targets, selected targets, unique targets, and ambiguous targets MUST remain compatible.
- This behavior MUST NOT weaken Build scope sealing, Verify evidence, Archive conflict inspection, or Hook Guard ownership.
