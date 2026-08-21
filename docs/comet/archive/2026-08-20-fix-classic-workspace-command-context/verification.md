---
generated_from_state_version: 7
---

# Verification

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 1
- Iteration: 1
- Verifier attempt: 1
- Completed: 2026-08-20T06:02:16.705Z
- Summary: classicWorkspaceCommand (issue #335) and five sibling Classic command handlers now share the withProjectContext wrapper, which always establishes the command context before the handler body runs. All 7 acceptance criteria are met by targeted tests plus a manual end-to-end CLI repro; two pre-existing, unrelated repo issues are called out as risks rather than blockers.

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1: 在 Classic 项目根目录运行 `comet classic workspace prepare <name> --isolation current --json`，返回 `exitCode: 0` 且包含 `projectRoot`，不再返回 `exitCode: 70` / `Classic command project context is unavailable`。 | Manual CLI repro in a fresh temp Classic project: `node comet-runtime.mjs workspace prepare probe-current --isolation current --json` returns exitCode 0 with a populated projectRoot; no longer exitCode 70 / 'Classic command project context is unavailable'. |
| A2 | passed | brief.md | A2: 同样命令分别用 `--isolation branch` 和 `--isolation worktree` 运行，均返回 `exitCode: 0`（不要求真实创建 branch/worktree 全部成功，但不得因 context 缺失而失败）。 | Same manual repro with --isolation branch and --isolation worktree both return exitCode 0 (branch created, worktree created and registered). |
| A3 | passed | brief.md | A3: 运行 `comet classic workspace resolve <name> --json`，返回 `exitCode: 0` 且 `projectRoot` 与实际项目根目录一致。 | classic-workspace-command.test.ts 'resolves a workspace without a caller-established context' seeds a change and asserts classicWorkspaceCommand(['resolve', name], options) returns exitCode 0 with projectRoot equal to the project root. |
| A4 | passed | brief.md | A4: `classicWorkspaceCommand` 新增的单元测试覆盖 A1-A3 对应的 `resolve`/`prepare` × `current`/`branch`/`worktree` 组合，且全部通过。 | test/domains/comet-classic/classic-workspace-command.test.ts covers prepare x {current,branch,worktree} and resolve, calling the handler directly with no context pre-established by the caller (reproducing the original bug's call shape). All 5 tests pass. |
| A5 | passed | brief.md | A5: `withProjectContext` 新增单元测试验证两种路径都成立：外部未建立 context 时调用会现场建立一次；已经处于 `withClassicCommandContext` 建立的 context 中再调用会直接复用而不重复解析。 | test/domains/comet-classic/classic-command-context.test.ts covers both withProjectContext paths: establishing a context when none is active, and reusing an already-active outer context instead of re-resolving from the inner call's own options. Both tests pass. |
| A6 | passed | brief.md | A6: `guard`/`state`/`handoff`/`validate`/`resume-probe` 五个已迁移到 `withProjectContext` 的 handler，其既有测试套件（`test/domains/comet-classic/`）在改写后无需修改断言即可继续通过，证明这次重构没有改变它们的行为。 | classic-guard.test.ts, classic-handoff.test.ts, classic-state.test.ts, classic-resume-probe-command.test.ts, and classic-resume-probe.test.ts all pass unmodified after migrating their handlers to withProjectContext, confirming no behavior change. |
| A7 | passed | brief.md | A7: `pnpm build:classic-runtime --check` 与 `npx vitest run test/domains/comet-classic/comet-scripts.test.ts` 通过。 | node scripts/build/build-classic-runtime.mjs --check passes (comet-runtime.mjs and sibling launchers regenerated and fresh); npx vitest run test/domains/comet-classic/comet-scripts.test.ts passes 220/221 (1 pre-existing skip). |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| vitest: handlers migrated to withProjectContext + their existing suites | vitest run test/domains/comet-classic/classic-guard.test.ts test/domains/comet-classic/classic-handoff.test.ts test/domains/comet-classic/classic-state.test.ts test/domains/comet-classic/classic-resume-probe-command.test.ts test/domains/comet-classic/classic-resume-probe.test.ts test/domains/comet-classic/classic-workspace-command.test.ts test/domains/comet-classic/classic-command-context.test.ts | . | passed | 0 | 7952 ms |
| vitest: Classic launcher smoke suite (comet-scripts.test.ts) | vitest run test/domains/comet-classic/comet-scripts.test.ts | . | passed | 0 | 41942 ms |
| Classic runtime bundle freshness check | scripts/build/build-classic-runtime.mjs --check | . | passed | 0 | 122 ms |
| ESLint app/ domains/ platform/ | eslint app/ domains/ platform/ | . | passed | 0 | 2996 ms |

## Blockers

_None._

## Risks and skipped work

- pnpm run lint:architecture fails on a pre-existing untracked top-level 'openspec' directory unrelated to this change (confirmed present on clean master before any edit); not addressed, per brief Non-goals.
- 6 pre-existing vitest failures in classic-contract.test.ts / classic-hook-guard.test.ts / classic-openspec-command.test.ts / classic-workspace.test.ts are unrelated to this change (confirmed present on clean master via git stash baseline) and were excluded from the targeted check plan for that reason.

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | pass | — | classicWorkspaceCommand (issue #335) and five sibling Classic command handlers now share the withProjectContext wrapper, which always establishes the command context before the handler body runs. All 7 acceptance criteria are met by targeted tests plus a manual end-to-end CLI repro; two pre-existing, unrelated repo issues are called out as risks rather than blockers. | 2026-08-20T06:02:16.705Z |

## Conclusion

classicWorkspaceCommand (issue #335) and five sibling Classic command handlers now share the withProjectContext wrapper, which always establishes the command context before the handler body runs. All 7 acceptance criteria are met by targeted tests plus a manual end-to-end CLI repro; two pre-existing, unrelated repo issues are called out as risks rather than blockers.
