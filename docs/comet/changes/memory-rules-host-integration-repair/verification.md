---
generated_from_state_version: 5
---

# Verification

## Current result

- Result: **Failed**
- Assurance: **skill-coordinated**
- Goal cycle: 1
- Iteration: 1
- Verifier attempt: 1
- Completed: 2026-08-14T13:25:22.376Z
- Summary: Runtime/domain 局部能力通过，但普通 Skill 自动上下文、完整 workflow 事件、阶段路由、候选交互、原生规则 carrier 和失败修复循环仍缺真实宿主接线；A1/A2/A5/A6/A7/A8 阻塞，返回 Build 修复。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | failed | brief.md | 用户只在 Comet Skill 中完成一个普通任务时，任务开始能得到个人画像和当前项目相关的规则片段；任务结束自动记录成功结果，且不会要求用户打开 Dashboard 或手动执行 CLI。 | collectCometPluginContext 只有定义，没有接入普通 Skill 或 workflow 开始路径；Skill 文本要求模型运行 CLI，不能证明宿主自动注入。 |
| A2 | failed | brief.md | Native、Classic、Hotfix、Tweak 的成功完成、验证和归档都产生有来源的生命周期事件；个人记忆和项目规则分别消费事件，不把个人偏好写成团队规则。 | Native 仅记录 next/archive/handoff，Classic 仅记录 archive/handoff/workspace 且固定 full；verification、Hotfix、Tweak 和完整生命周期没有统一有来源事件。 |
| A3 | passed | brief.md | 用户关闭个人记忆学习/检索或暂停某个项目后，项目规则和基础 workflow 仍工作；停用项目规则后，个人记忆和基础 workflow 仍工作；卸载只移除入口，不删除已有数据或仓库规则。 | 插件 Runtime 的停用、项目暂停、卸载数据保留和基础 workflow 隔离已有实现与测试。 |
| A4 | passed | brief.md | 个人记忆存储在专用 Git repository；完成节点自动提交并按配置同步，另一会话、设备、同仓库 worktree 或重新克隆可以通过稳定 project identity 读取相同内容。 | 默认 bridge 使用独立 memory repository、GitMemorySync 和稳定 project identity；checkpoint sync 失败不会阻塞 workflow。 |
| A5 | failed | brief.md | 项目规则上下文按任务、目标路径和验证阶段路由，固定保守上限；没有 Hook 时由 Skill 使用同一 selector，不复制整份规则到宿主配置。 | selector 只按任务和路径选择，没有验证阶段参数；Hook/Skill 虽有文本约定，但没有统一可调用的阶段路由。 |
| A6 | failed | brief.md | 两次独立成功任务形成同一规则候选后，Skill 在任务结束只显示一条可读摘要；用户可以一次加入、忽略或稍后，不创建规则专用 Comet change。 | 候选读取和用户操作仍只是 Skill 文本约定，没有宿主侧一次摘要、加入/忽略/稍后编排。 |
| A7 | failed | brief.md | 用户明确添加规则时，若已有可用 linter、测试、编译器、构建插件或 CI，Comet 生成/定位对应原生配置或测试改动；无法确定性检查的要求写入最相关的 Agent 指令或普通 Markdown 规则。 | proposeCarrier 能识别验证入口，但 adoptCandidate 在该分支仍写入 .comet/rules，没有生成或定位 linter、测试、编译器、插件或 CI 的原生配置改动。 |
| A8 | failed | brief.md | Agent 修改代码后，项目规则服务能够运行实际可用的仓库验证入口；只有命令失败才进入修复循环，warning 且命令成功不被误报为阻塞。 | rules verify 只执行首个验证命令并返回结果，没有宿主驱动的失败诊断到 Agent 修复再验证循环。 |
| A9 | passed | brief.md | Dashboard、Skill 和 CLI 调用同一插件 runtime、service、状态和存储；Dashboard 失效时 Skill/CLI 仍可完成上下文、候选、规则和记忆操作。 | Dashboard、Skill fallback 和 CLI 使用同一 bridge/runtime/service 边界；插件 API 与状态隔离测试通过。 |
| A10 | passed | brief.md | 缺少或失败的一个插件只产生带插件标识的诊断，健康插件和基础 workflow 继续运行；相关集成测试覆盖跨项目、跨插件和旧请求不回写。 | 插件失败捕获、健康插件继续运行、跨项目/插件状态隔离和旧请求防护已有覆盖；剩余宿主接线缺口已在 A1/A2/A5/A6 标出。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| targeted Vitest | exec vitest run test/domains/comet-plugin/plugin-integration.test.ts test/app/personal-memory-command.test.ts test/app/project-rules-command.test.ts test/domains/project-rules/plugin.test.ts test/domains/project-rules/project-rules.test.ts test/app/native-command.test.ts test/app/classic-command.test.ts test/domains/skill/skills.test.ts | . | failed | 1 | 1461 ms |
| TypeScript | exec tsc --noEmit | . | passed | 0 | 6685 ms |
| generated assets | run check:generated | . | passed | 0 | 1854 ms |
| architecture lint | run lint:architecture | . | failed | 1 | 943 ms |
| affected-file formatting | exec prettier --check assets/skills-zh/comet-classic/SKILL.md assets/skills-zh/comet-hotfix/SKILL.md assets/skills-zh/comet-native/SKILL.md assets/skills-zh/comet-tweak/SKILL.md assets/skills-zh/comet/SKILL.md assets/skills/comet-classic/SKILL.md assets/skills/comet-hotfix/SKILL.md assets/skills/comet-native/SKILL.md assets/skills/comet-tweak/SKILL.md assets/skills/comet/SKILL.md assets/skills/comet/rules/comet-workflow-guard.en.md assets/skills/comet/rules/comet-workflow-guard.md docs/comet/changes/memory-rules-host-integration-repair/brief.md domains/comet-plugin/integration.ts domains/project-rules/project-rules.ts test/app/classic-command.test.ts test/app/native-command.test.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/project-rules/project-rules.test.ts test/domains/skill/skills.test.ts | . | failed | 1 | 779 ms |

## Blockers

_None._

## Risks and skipped work

- Runtime 预设 check plan 使用 child worktree 的 pnpm exec，child 没有本地 vitest/prettier；使用根仓库显式可执行文件重跑通过。
- Runtime architecture 首次检查受临时 check-plan JSON 顶层文件影响；该临时文件已删除，重跑通过。
- 独立验证：8 个 targeted Vitest 184/184 通过，tsc、generated、architecture、Prettier 通过。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A1, A2, A5, A6, A7, A8 | Runtime/domain 局部能力通过，但普通 Skill 自动上下文、完整 workflow 事件、阶段路由、候选交互、原生规则 carrier 和失败修复循环仍缺真实宿主接线；A1/A2/A5/A6/A7/A8 阻塞，返回 Build 修复。 | 2026-08-14T13:25:22.376Z |

## Conclusion

Runtime/domain 局部能力通过，但普通 Skill 自动上下文、完整 workflow 事件、阶段路由、候选交互、原生规则 carrier 和失败修复循环仍缺真实宿主接线；A1/A2/A5/A6/A7/A8 阻塞，返回 Build 修复。
