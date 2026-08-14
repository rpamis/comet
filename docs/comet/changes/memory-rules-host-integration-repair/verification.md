---
generated_from_state_version: 8
---

# Verification

## Current result

- Result: **Failed**
- Assurance: **skill-coordinated**
- Goal cycle: 1
- Iteration: 2
- Verifier attempt: 1
- Completed: 2026-08-14T13:57:13.826Z
- Summary: 最小测试、TypeScript、架构、生成物和格式检查均通过，但上一轮指出的宿主自动接线、完整生命周期事件、阶段 fallback、候选交互、原生 carrier 和失败修复闭环仍未真实修复，因此候选不接受。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | failed | brief.md | 用户只在 Comet Skill 中完成一个普通任务时，任务开始能得到个人画像和当前项目相关的规则片段；任务结束自动记录成功结果，且不会要求用户打开 Dashboard 或手动执行 CLI。 | 普通 Skill 仍依赖 Skill 文本让 Agent 手动运行 comet memory context；没有普通任务宿主入口自动收集上下文或自动记录成功结果。Native/Classic facade 只有在显式传入 --comet-task 时才接线。 |
| A2 | failed | brief.md | Native、Classic、Hotfix、Tweak 的成功完成、验证和归档都产生有来源的生命周期事件；个人记忆和项目规则分别消费事件，不把个人偏好写成团队规则。 | Personal Memory 仅订阅 change.completed、task.completed、memory.observe，未消费 verification.completed/review.completed；Native facade 的 check 也未注册到 native-cli。Classic 默认 workflow 固定为 full，Hotfix/Tweak 只有显式 --comet-workflow 才能归类，且事件记录使用 process.cwd() 而非解析后的 projectRoot。 |
| A3 | passed | brief.md | 用户关闭个人记忆学习/检索或暂停某个项目后，项目规则和基础 workflow 仍工作；停用项目规则后，个人记忆和基础 workflow 仍工作；卸载只移除入口，不删除已有数据或仓库规则。 | 插件 Runtime 的停用、项目暂停、卸载数据保留和基础 workflow 隔离保持有效；相关集成测试通过。 |
| A4 | passed | brief.md | 个人记忆存储在专用 Git repository；完成节点自动提交并按配置同步，另一会话、设备、同仓库 worktree 或重新克隆可以通过稳定 project identity 读取相同内容。 | 默认 bridge 使用独立 Git memory repository、稳定 project identity，并在 lifecycle dispatch 后尝试 sync；同步失败被隔离，不阻塞 workflow。集成测试通过。 |
| A5 | failed | brief.md | 项目规则上下文按任务、目标路径和验证阶段路由，固定保守上限；没有 Hook 时由 Skill 使用同一 selector，不复制整份规则到宿主配置。 | 底层 service 和 provideContext 支持 stage，但普通 Skill 的 comet memory context CLI 没有 phase 选项；project-rules plugin 的 select capability 还丢弃 stage，导致 CLI/fallback 路径不能保证按验证阶段使用同一 selector。 |
| A6 | failed | brief.md | 两次独立成功任务形成同一规则候选后，Skill 在任务结束只显示一条可读摘要；用户可以一次加入、忽略或稍后，不创建规则专用 Comet change。 | candidateEnvelope 只返回摘要和操作名，facade 仅在每个成功 workflow 命令后打印摘要，没有任务结束的一次性编排，也没有 Skill 对 adopt/ignore/snooze（文本写作 defer）的用户回复处理。 |
| A7 | failed | brief.md | 用户明确添加规则时，若已有可用 linter、测试、编译器、构建插件或 CI，Comet 生成/定位对应原生配置或测试改动；无法确定性检查的要求写入最相关的 Agent 指令或普通 Markdown 规则。 | 虽然能发现 package/Maven/Gradle 等验证入口，但 adoptCandidate 在已有验证入口时仍把候选追加到 AGENTS.md（附验证入口说明），没有生成或定位对应原生配置、测试或构建插件改动。 |
| A8 | failed | brief.md | Agent 修改代码后，项目规则服务能够运行实际可用的仓库验证入口；只有命令失败才进入修复循环，warning 且命令成功不被误报为阻塞。 | verify 的 repairVerification 只是可选 service 注入；默认 bridge/plugin 未提供该回调，--max-attempts 只会重复执行命令，失败诊断没有宿主驱动的修复再验证闭环。 |
| A9 | passed | brief.md | Dashboard、Skill 和 CLI 调用同一插件 runtime、service、状态和存储；Dashboard 失效时 Skill/CLI 仍可完成上下文、候选、规则和记忆操作。 | Dashboard、CLI 和 Skill fallback 仍通过公开 plugin bridge/runtime/service 边界访问共享状态；目标集成测试通过。 |
| A10 | passed | brief.md | 缺少或失败的一个插件只产生带插件标识的诊断，健康插件和基础 workflow 继续运行；相关集成测试覆盖跨项目、跨插件和旧请求不回写。 | PluginRuntime 对缺失、停用和执行失败插件提供带 pluginId 的诊断并隔离失败，健康插件和基础 workflow 继续运行；相关测试通过。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| targeted host integration tests | run test/domains/comet-plugin/plugin-integration.test.ts test/app/personal-memory-command.test.ts test/app/project-rules-command.test.ts test/domains/project-rules/plugin.test.ts test/domains/project-rules/project-rules.test.ts test/app/native-command.test.ts test/app/classic-command.test.ts test/domains/skill/skills.test.ts test/domains/comet-entry/comet-entry-skill.test.ts | . | passed | 0 | 11835 ms |
| TypeScript | --noEmit | . | passed | 0 | 6829 ms |
| generated asset check | run check:generated | . | passed | 0 | 1779 ms |
| architecture lint | run lint:architecture | . | passed | 0 | 903 ms |
| affected files formatting | --check domains/comet-plugin/types.ts domains/comet-plugin/integration.ts domains/comet-entry/plugin-context.ts domains/project-rules/types.ts domains/project-rules/project-rules.ts domains/project-rules/plugin.ts app/commands/project-rules.ts app/cli/index.ts app/commands/native.ts app/commands/classic.ts test/domains/project-rules/project-rules.test.ts test/domains/project-rules/plugin.test.ts test/app/native-command.test.ts test/app/classic-command.test.ts assets/skills-zh/comet/SKILL.md assets/skills/comet/SKILL.md | . | passed | 0 | 1071 ms |
| affected files lint | domains/comet-plugin/types.ts domains/comet-plugin/integration.ts domains/comet-entry/plugin-context.ts domains/project-rules/types.ts domains/project-rules/project-rules.ts domains/project-rules/plugin.ts app/commands/project-rules.ts app/cli/index.ts app/commands/native.ts app/commands/classic.ts test/domains/project-rules/project-rules.test.ts test/domains/project-rules/plugin.test.ts test/app/native-command.test.ts test/app/classic-command.test.ts | . | passed | 0 | 1848 ms |

## Blockers

_None._

## Risks and skipped work

- 当前工作树仅有 Runtime 生成的 comet-state.yaml 修改和 verification.md 删除，未见实现代码外的手工改动；应视为验证环境状态。
- child 无本地依赖，使用根仓库 vitest、tsc、Prettier、ESLint 和生成检查；6 个目标测试文件共 163 个测试通过，但现有测试多为 facade mock，未覆盖真实普通 Skill、交互操作和 Native check CLI 路由。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A1, A2, A5, A6, A7, A8 | Runtime/domain 局部能力通过，但普通 Skill 自动上下文、完整 workflow 事件、阶段路由、候选交互、原生规则 carrier 和失败修复循环仍缺真实宿主接线；A1/A2/A5/A6/A7/A8 阻塞，返回 Build 修复。 | 2026-08-14T13:25:22.376Z |
| 1 | 2 | 1 | fail | A1, A2, A5, A6, A7, A8 | 最小测试、TypeScript、架构、生成物和格式检查均通过，但上一轮指出的宿主自动接线、完整生命周期事件、阶段 fallback、候选交互、原生 carrier 和失败修复闭环仍未真实修复，因此候选不接受。 | 2026-08-14T13:57:13.826Z |

## Conclusion

最小测试、TypeScript、架构、生成物和格式检查均通过，但上一轮指出的宿主自动接线、完整生命周期事件、阶段 fallback、候选交互、原生 carrier 和失败修复闭环仍未真实修复，因此候选不接受。
