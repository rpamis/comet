---
generated_from_state_version: 11
---

# Verification

## Current result

- Result: **Failed**
- Assurance: **skill-coordinated**
- Goal cycle: 1
- Iteration: 3
- Verifier attempt: 1
- Completed: 2026-08-14T14:37:08.670Z
- Summary: 代码与静态检查通过，但 A3/A6/A7/A8/A10 仍有可达产品缺口；不建议将 child 标为通过或归档。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | 用户只在 Comet Skill 中完成一个普通任务时，任务开始能得到个人画像和当前项目相关的规则片段；任务结束自动记录成功结果，且不会要求用户打开 Dashboard 或手动执行 CLI。 | /comet resolver 将原请求传给 workflow resolve --task；Native/Classic/Hotfix/Tweak Skill 通过公开 comet task 与工作流 facade 使用同一 bridge，Skill fallback 可在无 Hook/Dashboard 时完成开始上下文和结束 checkpoint。 |
| A2 | passed | brief.md | Native、Classic、Hotfix、Tweak 的成功完成、验证和归档都产生有来源的生命周期事件；个人记忆和项目规则分别消费事件，不把个人偏好写成团队规则。 | Native facade 支持 next/archive/check/handoff 生命周期映射，Native check 已注册；Classic facade 支持 state/guard/handoff/archive/workspace，并从 change state 读取 full/hotfix/tweak；dispatchLifecycle 携带 workflow/changeId/source，memory/rules 各自消费。 |
| A3 | failed | brief.md | 用户关闭个人记忆学习/检索或暂停某个项目后，项目规则和基础 workflow 仍工作；停用项目规则后，个人记忆和基础 workflow 仍工作；卸载只移除入口，不删除已有数据或仓库规则。 | 普通任务的 cometTaskCommand --complete 未隔离项目规则插件：直接 await collectCometProjectRuleCandidates；规则插件被停用/缺失时 runtime.invoke 抛错，任务完成命令失败，不能保证基础 workflow 继续。 |
| A4 | passed | brief.md | 个人记忆存储在专用 Git repository；完成节点自动提交并按配置同步，另一会话、设备、同仓库 worktree 或重新克隆可以通过稳定 project identity 读取相同内容。 | 既有 FileMemoryRepository + GitMemorySync 专用仓库、稳定 project identity 与完成节点 sync 逻辑保留；相关测试/本轮未见回归。 |
| A5 | passed | brief.md | 项目规则上下文按任务、目标路径和验证阶段路由，固定保守上限；没有 Hook 时由 Skill 使用同一 selector，不复制整份规则到宿主配置。 | 公开 context/selector 透传 task/path/phase，project-rules plugin 将 stage 传入 selector；固定 maxSections=5/maxBytes=8KiB；Skill fallback 与 CLI 共用 bridge，不全量复制规则。 |
| A6 | failed | brief.md | 两次独立成功任务形成同一规则候选后，Skill 在任务结束只显示一条可读摘要；用户可以一次加入、忽略或稍后，不创建规则专用 Comet change。 | comet task 返回候选摘要和操作，但 Native/Classic facade 在每个成功命令后都 emitCandidates，不限于任务结束，可能重复显示；普通 task action 需另发 rules action，未形成一次任务结束编排。 |
| A7 | failed | brief.md | 用户明确添加规则时，若已有可用 linter、测试、编译器、构建插件或 CI，Comet 生成/定位对应原生配置或测试改动；无法确定性检查的要求写入最相关的 Agent 指令或普通 Markdown 规则。 | 已有 package/Maven/Gradle 等验证入口时 adoptCandidate 仅写 .comet/rules/proposals/<entrypoint>.md 提案；该 proposals 子目录不被 readSources 选择，也未生成/修改原生 linter/test/build 配置，采用后规则不会实际约束。 |
| A8 | failed | brief.md | Agent 修改代码后，项目规则服务能够运行实际可用的仓库验证入口；只有命令失败才进入修复循环，warning 且命令成功不被误报为阻塞。 | 默认 CLI/Dashboard bridge 未提供 repairProjectRules/runProjectRuleVerification；rules verify 即使 --max-attempts=3 失败也不会调用 Agent 修复再验证，只有测试显式注入 callback 才闭环。 |
| A9 | passed | brief.md | Dashboard、Skill 和 CLI 调用同一插件 runtime、service、状态和存储；Dashboard 失效时 Skill/CLI 仍可完成上下文、候选、规则和记忆操作。 | Dashboard default host、Skill/CLI 均通过 createDefaultCometPluginBridge 使用同一 plugin runtime/service/storage；已有 Dashboard/插件隔离测试通过。 |
| A10 | failed | brief.md | 缺少或失败的一个插件只产生带插件标识的诊断，健康插件和基础 workflow 继续运行；相关集成测试覆盖跨项目、跨插件和旧请求不回写。 | 普通 comet task 的候选调用未 try/catch，项目规则插件 missing/failure 会阻断任务完成；虽 runtime 的 context/event 有诊断隔离，公共 task host 仍违反单插件失败不阻断基础 workflow。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| targeted Vitest | run test/app/comet-task-command.test.ts test/app/native-command.test.ts test/app/classic-command.test.ts test/app/personal-memory-command.test.ts test/app/project-rules-command.test.ts test/app/workflow-command.test.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/project-rules/project-rules.test.ts test/domains/project-rules/plugin.test.ts test/domains/comet-entry/comet-entry-skill.test.ts test/domains/skill/skills.test.ts test/domains/comet-native/native-cli.test.ts | . | passed | 0 | 82594 ms |
| TypeScript | --noEmit | . | passed | 0 | 7576 ms |
| generated asset check | run check:generated | . | passed | 0 | 2016 ms |
| architecture lint | run lint:architecture | . | passed | 0 | 966 ms |
| affected formatting | --check app/cli/index.ts app/commands/classic.ts app/commands/comet-task.ts app/commands/native.ts app/commands/personal-memory.ts app/commands/project-rules.ts app/commands/workflow.ts domains/comet-entry/plugin-context.ts domains/comet-memory/plugin.ts domains/comet-native/native-cli-help.ts domains/comet-native/native-cli.ts domains/comet-plugin/integration.ts domains/project-rules/plugin.ts domains/project-rules/project-rules.ts domains/project-rules/types.ts test/app/comet-task-command.test.ts test/app/native-command.test.ts test/app/personal-memory-command.test.ts test/domains/comet-native/native-cli.test.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/project-rules/plugin.test.ts test/domains/project-rules/project-rules.test.ts assets/skills/comet/SKILL.md assets/skills/comet-native/SKILL.md assets/skills/comet-classic/SKILL.md assets/skills/comet-hotfix/SKILL.md assets/skills/comet-tweak/SKILL.md assets/skills-zh/comet/SKILL.md assets/skills-zh/comet-native/SKILL.md assets/skills-zh/comet-classic/SKILL.md assets/skills-zh/comet-hotfix/SKILL.md assets/skills-zh/comet-tweak/SKILL.md assets/skills/comet-native/scripts/comet-native-runtime.mjs assets/skills/comet-native/scripts/comet-native-archive.mjs assets/skills/comet-native/scripts/comet-native-doctor.mjs assets/skills/comet-native/scripts/comet-native-hook-guard.mjs assets/skills/comet-native/scripts/comet-native-init.mjs assets/skills/comet-native/scripts/comet-native-new.mjs assets/skills/comet-native/scripts/comet-native-next.mjs assets/skills/comet-native/scripts/comet-native-root.mjs assets/skills/comet-native/scripts/comet-native-select.mjs assets/skills/comet-native/scripts/comet-native-show.mjs assets/skills/comet-native/scripts/comet-native-spec.mjs assets/skills/comet-native/scripts/comet-native-status.mjs | . | passed | 0 | 1411 ms |
| affected ESLint | app/cli/index.ts app/commands/classic.ts app/commands/comet-task.ts app/commands/native.ts app/commands/personal-memory.ts app/commands/project-rules.ts app/commands/workflow.ts domains/comet-entry/plugin-context.ts domains/comet-memory/plugin.ts domains/comet-native/native-cli-help.ts domains/comet-native/native-cli.ts domains/comet-plugin/integration.ts domains/project-rules/plugin.ts domains/project-rules/project-rules.ts domains/project-rules/types.ts test/app/comet-task-command.test.ts test/app/native-command.test.ts test/app/personal-memory-command.test.ts test/domains/comet-native/native-cli.test.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/project-rules/plugin.test.ts test/domains/project-rules/project-rules.test.ts | . | passed | 0 | 2264 ms |

## Blockers

- **builder**: Native verification has not made reliable progress twice; use a different repair hypothesis before resubmitting. (acceptance: A3, A6, A7, A8, A10) — next: `return-build`

## Risks and skipped work

- 本轮目标测试 12 files/215 tests 全通过；tsc、architecture、check:generated、Prettier、ESLint 全通过。产品缺口不是环境失败。
- A1 的完成动作仍依赖 Skill 文字执行 comet task --complete，但 brief 明确允许 Skill fallback；若要求宿主会话级自动结束 hook，A1 也应降为 failed。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A1, A2, A5, A6, A7, A8 | Runtime/domain 局部能力通过，但普通 Skill 自动上下文、完整 workflow 事件、阶段路由、候选交互、原生规则 carrier 和失败修复循环仍缺真实宿主接线；A1/A2/A5/A6/A7/A8 阻塞，返回 Build 修复。 | 2026-08-14T13:25:22.376Z |
| 1 | 2 | 1 | fail | A1, A2, A5, A6, A7, A8 | 最小测试、TypeScript、架构、生成物和格式检查均通过，但上一轮指出的宿主自动接线、完整生命周期事件、阶段 fallback、候选交互、原生 carrier 和失败修复闭环仍未真实修复，因此候选不接受。 | 2026-08-14T13:57:13.826Z |
| 1 | 3 | 1 | fail | A3, A6, A7, A8, A10 | 代码与静态检查通过，但 A3/A6/A7/A8/A10 仍有可达产品缺口；不建议将 child 标为通过或归档。 | 2026-08-14T14:37:08.670Z |

## Conclusion

代码与静态检查通过，但 A3/A6/A7/A8/A10 仍有可达产品缺口；不建议将 child 标为通过或归档。
