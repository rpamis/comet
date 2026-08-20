# Supervisor Parent Auto-Advance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当 Supervisor 的最后一个可信 Child 完成时，由 Native Runtime 幂等地把父级从 Build 推进到最终 Verify，并让 continuation 与中英文 Skill 明确通知宿主继续派发最终 Verifier，同时保留最终 Archive、merge、push 和 PR 的现有授权边界。

**Architecture:** 在 `domains/comet-native/` 增加一个共享的父级自动推进 seam，复用 `completeNativePortableParentBuild` 的 acceptance drift、Shape confirmation、repair 和 all-done 检查。v2 `supervisor-integrate` 在写入 Child `integrated` 后调用该 seam；v1 Child Archive 在 `finish=merge` 成功后解析唯一、绑定一致的 v1 父级并调用同一 seam；恢复只重算事实并在父级仍处于 active Build 时重试。自动推进结果以结构化 `parentAdvance` 返回，父级状态先持久化为 Verify，再由现有 continuation 派发最终 Verifier。

**Tech Stack:** TypeScript, Native Portable Runtime, Vitest, Native runtime bundle generation, bilingual Markdown Skill contracts.

## Global Constraints

- 保留 v2 `verified -> integrated` 和父级最终 Verify 的现有状态机；不把 v1 数据迁移为 v2。
- 不在 Child 完成事件中自动 Archive、workspace finish、merge target、push 或创建 PR；最终交付继续遵循配置和用户确认。
- 不猜测歧义父级、detached/mismatch 工作区、未合入归档、repair blocker 或分支漂移；返回可恢复诊断。
- 不修改主 worktree 中已有的 `project-knowledge-dashboard` 删除；只提交本 change worktree 的目标文件。
- 采用 TDD：每项行为先在最小相关测试中建立失败断言，再实现并运行该测试。
- 中文 Skill 先完成并验证，再同步英文 Skill；源码修改后必须重建 Native 生成资产。

---

## Task 1: Add the shared idempotent parent-advance Runtime seam

**Files:**

- Modify `domains/comet-native/native-portable-runtime.ts`
- Modify `domains/comet-native/native-children.ts`
- Add focused tests in `test/domains/comet-native/native-children.test.ts` and `test/domains/comet-native/native-supervisor.test.ts`

- [ ] 先为 `tryAutoAdvanceNativeSupervisorParent`（或等价的明确导出函数）补充失败测试：active Build + confirmed children + all v2 children `integrated` 会生成一次父级候选并进入 `verify`；再次调用在 `verify`/`archive`/`done` 时返回 `advanced: false`，不创建第二候选。
- [ ] 为 v1 父级解析补充测试 fixture：只接受 `children.yaml` 为 v1、唯一确认父级、`workspace.change_branch`/实际 worktree branch/Child archive `target_branch` 一致且 archive state 已在父级 branch 可见；未合入、detached、branch mismatch、多个父级和零父级均返回结构化 blocker，不写父级状态。
- [ ] 在 `native-children.ts` 暴露最小的 v1 parent discovery API（不暴露现有扫描细节），复用 `workspaceSources`、active state、children contract、Git branch 事实，返回候选父级的 `NativeProjectPaths`、state 和 blocker evidence；只扫描已确认、仍 active Build 的 v1 父级。
- [ ] 在 `native-portable-runtime.ts` 实现共享 seam：重新读取 Portable State 与 `inspectNativeChildren`，仅在 active Build、confirmed、`allDone`、非 repair-failed 时调用现有 `completeNativePortableParentBuild`；对已进入后续 phase 做幂等 no-op；不吞掉写入错误，保留 Child 结果供下一次恢复重试。
- [ ] 让返回结构包含 `trigger`、`advanced`、`parent`、`message`、`blocker`（如有）以及最终 state，供 CLI/Skill 直接显示“全部 Child 已完成，Supervisor 父级正在进行最终验证”。
- [ ] 运行 `npx vitest run test/domains/comet-native/native-children.test.ts test/domains/comet-native/native-supervisor.test.ts`，确认新增测试先红后绿且既有断言不回归。

## Task 2: Wire v2 integration and recovery into the seam

**Files:**

- Modify `domains/comet-native/native-runner-input.ts`
- Modify `domains/comet-native/native-next-command.ts`
- Modify `domains/comet-native/native-portable-continuation.ts`
- Add/extend `test/domains/comet-native/native-supervisor.test.ts` and `test/domains/comet-native/native-cli-v4-surface.test.ts`

- [ ] 先增加 runner-input 回归测试：最后一个 `supervisor-integrate` 成功后，同一次调用返回 `parentAdvance.advanced === true`、父级 state.phase 为 `verify`、continuation 为最终 `dispatch-verifier`，并含用户可见通知；Child 未全 integrated 时保持 Build 和 `advance-children`。
- [ ] 先增加恢复测试：模拟 Child 状态已完成但父级仍 active Build，调用恢复/相关 Supervisor progression 时只补一次父级候选；父级已 Verify/Archive/done 时不重复写入。
- [ ] 在 `applyNativeRunnerInput` 的 `supervisor-integrate` 分支中先完成现有 Child integration 写入，再在锁外调用共享 seam，避免重入 mutation lock；读取最终 Portable State 一次并把 `parentAdvance`、`supervisorState` 和 continuation 放入同一 JSON envelope。
- [ ] 在 `native-next-command.ts` 的恢复/父级推进路径调用同一 seam，保证进程在 Child 完成与父级写入之间退出后，下一次 Native resume 能依据最新事实补齐状态；不让只读 status 修改状态。
- [ ] 调整 `nativePortableContinuation`：父级已经自动进入 Verify 时返回现有最终 Verifier continuation；在 Build 读到 v2 all-done 时返回明确 `advance-parent` 语义和可执行的父级 `next` 命令，而非要求用户说“推进”；保持其它 Child ready/blocked 语义不变。
- [ ] 运行 `npx vitest run test/domains/comet-native/native-supervisor.test.ts test/domains/comet-native/native-cli-v4-surface.test.ts test/domains/comet-native/native-loop-runtime.test.ts`。

## Task 3: Wire v1 Child Archive post-finish auto-advance

**Files:**

- Modify `domains/comet-native/native-archive-command.ts`
- Extend `test/domains/comet-native/native-children.test.ts` and `test/domains/comet-native/native-portable-archive.test.ts`

- [ ] 先增加端到端最小 fixture：Child Archive 使用 `finish=merge`，workspace finish 成功且归档 state 已提交到父级 target branch 后，唯一 v1 父级自动进入 Verify；archive 未 merge 或父级不唯一时，Child Archive 仍保持成功但返回 `parentAdvance.blocker`，不伪造父级推进。
- [ ] 在 `native-archive-command.ts` 中只在 `finishArchivedNativeWorkspace` 成功后调用 v1 discovery + 共享 seam；父级推进失败不得回滚已完成 Child Archive，也不得触发自动交付。
- [ ] 将 v1 自动推进结果与现有 archive result/workspaceFinishResult/continuation 合并返回，明确区分 Child 已归档与父级需要恢复的 blocker。
- [ ] 运行 `npx vitest run test/domains/comet-native/native-children.test.ts test/domains/comet-native/native-portable-archive.test.ts`。

## Task 4: Update the Native Skill contract (Chinese first, then English)

**Files:**

- Modify `assets/skills-zh/comet-native/SKILL.md`
- Modify `assets/skills/comet-native/SKILL.md`
- Extend `test/domains/skill/skills.test.ts` or the existing Native Skill contract test file

- [ ] 先在中文 Build 段落加入 Runtime 自动接回规则：v2 最后一个 Child integrated 或 v1 最后一个已合入 Archive 后，直接消费 `parentAdvance`/最新 continuation，通知用户父级进入最终 Verify，不新增范围确认。
- [ ] 明确恢复行为：如果宿主在 Child 完成边界退出，恢复时重新读取 continuation 并自动接回父级；不得停在“请用户再次说推进”。只读 status 仍不写状态。
- [ ] 明确阻塞行为：父级歧义、未合入、binding mismatch、repair 和分支漂移按 Runtime blocker 展示，不猜测；最终 Archive、merge、push、PR 仍按现有授权。
- [ ] 在中文语义通过契约测试和 Prettier 后，同步英文完全等价文本；两份 Skill 的自动推进、通知和 Archive 边界必须保持 parity。
- [ ] 运行 `npx vitest run test/domains/skill/skills.test.ts`（按当前仓库实际 Native Skill 契约测试路径调整）和受影响文件的 Prettier 检查。

## Task 5: Add release-facing changelog and regenerate Native assets

**Files:**

- Modify `CHANGELOG.md`
- Generated Native assets under `assets/skills/comet-native/scripts/` and any manifest/runtime files reported by the build
- Update repository asset/layout manifests only if the build requires a new runtime entry

- [ ] 先用 `git log <previous-tag>..HEAD --oneline`、当前 `package.json`、`origin/master` 和现有 top changelog entry 确认 beta20 版本与发布基线；只写升级用户可感知的自动 Supervisor 父级 Verify 行为，不记录实现过程或普通回归测试。
- [ ] 在中英文 Skill 完全同步且源码验证通过后，把用户视角条目追加到当前 beta20 的 `Changed` 分组；不无理由升级版本号。
- [ ] 运行 `pnpm build:native-runtime`，确认 `comet-native-runtime.mjs` 和各独立 Native command bundle 与源码同步；运行对应 runtime asset/repository contract tests。

## Task 6: Full risk-matched verification and Native handoff

**Files:**

- No new files; verify all changed paths and generated artifacts.

- [ ] 运行受影响 Native/Skill 测试、`pnpm format:check`、`pnpm lint` 和必要的 `pnpm build`；若跨 Runtime 全量测试有明确失败，先定位并修复原因再重跑。
- [ ] 重新核对 brief A1-A8、`supervisor-agents` A9-A24、`supervisor-integration` A25-A49：每项都映射到实现或测试，检查计划中没有未决占位词或泛化测试指令。
- [ ] 使用 Native 最新 `builder-handoff` continuation 提交精简摘要，列出实现、实际运行的检查、已知限制和全部 addressed acceptance IDs；不要手工改写 `comet-state.yaml`。
- [ ] Runtime 进入 Verify 后按最新 continuation 启动新的只读 Verifier，逐项返回 49 个 acceptance 的 `passed`/`failed`/`blocked`；修复必要问题后重新提交候选。
- [ ] Verify 全绿后执行 Native Archive 流程，等待用户选择 worktree 的 merge/push/PR/保留方式；本请求未授权时不自动 push 或清理 worktree。
