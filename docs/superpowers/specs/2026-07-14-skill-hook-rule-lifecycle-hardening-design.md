# Skill, Hook, and Rule Lifecycle Hardening Design

## Goal

Make Comet Skill, Hook, and Rule installation behave as one reliable lifecycle: user configuration is never overwritten after a parse failure, every component failure reaches the CLI result, dependent Hook installation never points at missing Skill scripts, uninstall distinguishes “already absent” from a real filesystem failure, and Doctor detects partial installs.

## Findings

1. Skill copying returns `copied`, `skipped`, and `failed`, while Rule copying drops failures after logging them.
2. Codex and Qwen-style Hook installers reject malformed shared JSON, but Claude Code, Amazon Q, Gemini, and Windsurf replace malformed content with a new object. This can destroy user configuration.
3. Qwen-style, Gemini, and Windsurf uninstall paths report malformed canonical Hook configuration as successful cleanup.
4. `removeFile()` and `removeDir()` conflate missing paths with I/O failures; `removeDir()` also reports a missing directory as removed.
5. `init` derives Comet status only from Skill copying. `update` drops Skill copy failures and Rule/Hook failures. Both can record an apparently successful installation with missing files or a Hook command that targets a missing runtime script.
6. Doctor verifies managed Skill files but does not verify the Rule or Hook that enforce the documented workflow.
7. The Chinese and English phase Rules and the Classic Hook phase matrix are already covered by behavioral alignment tests. The intended Codex split remains valid: Skills under `.agents/skills`, configuration, Rules, and Hooks under `.codex`.

## Chosen Approach

Use contract consolidation without replacing the existing per-format Hook implementations.

- Rule copy returns the same counter shape as Skill copy: `{ copied, skipped, failed }`.
- Hook install returns an explicit discriminated status: `installed`, `skipped`, or `failed`, with a reason for non-installed outcomes.
- Every Hook format that merges into an existing user-owned JSON file uses one strict object reader. Invalid, non-object, or unreadable JSON fails closed and remains byte-for-byte unchanged. Dedicated Comet-owned Hook files may still be replaced.
- Canonical Hook uninstall parse/read failures count as failures on every platform. Codex historical compatibility files remain best-effort after canonical cleanup, as already designed.
- Filesystem removal returns `false` only for `ENOENT` and throws other errors. Domain removal functions catch per managed artifact, count failures, and continue safe cleanup.
- `init` and `update` aggregate Skill, Rule, and Hook outcomes. If Skill copying fails, Rule and Hook installation for that target is skipped and the target is failed. A failed target is not registered as successfully updated.
- A focused `platform-inspect.ts` module gives Doctor read-only Rule and Hook component checks for each detected Comet Skill installation. Hook inspection validates the managed command, not merely the configuration file’s existence.

## Data Flow

```text
manifest
  -> Skill copy result
      -> failure: target failed; do not install Rule/Hook
      -> success: Rule copy result + Hook install result
          -> aggregate target status
              -> init/update output and registry decision

Doctor
  -> detect canonical/legacy Skill installation
      -> verify all managed Skill files
      -> verify normalized Rule destination when supported
      -> verify managed Hook command when supported
```

## Error Handling

- Missing optional destinations are `skipped` or already absent, not failures.
- Missing manifest-owned source files, permission errors, invalid shared JSON, and unsupported declared Hook formats are failures.
- User-owned malformed JSON is never rewritten.
- Cleanup continues across independent artifacts, but follow-on project state removal and registry cleanup remain blocked when any canonical component fails.
- User-facing logs and JSON output include component failure counts and reasons; “complete” is emitted only when all required components succeeded.

## Testing

Use TDD for each behavior:

1. malformed Claude/Amazon Q/Gemini/Windsurf JSON remains unchanged and Hook install fails;
2. malformed Qwen/Gemini/Windsurf canonical Hook JSON makes uninstall fail;
3. Rule copy and filesystem removal failures are counted;
4. init/update fail the target and avoid Hook installation/registry success after Skill failure;
5. Doctor warns on missing Rule/Hook and passes after a complete lifecycle install;
6. existing cross-platform Hook merge/idempotency, bilingual Rule alignment, Classic runtime, and full repository suites remain green.

## Release Scope

The defects also exist on `origin/master`, so the final user-visible behavior belongs under the existing `0.4.0-beta.5` changelog entry. No version bump is needed.
