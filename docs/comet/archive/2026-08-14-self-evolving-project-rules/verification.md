---
generated_from_state_version: 30
---

# Verification

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 3
- Iteration: 1
- Verifier attempt: 1
- Completed: 2026-08-14T10:35:16.947Z
- Summary: 独立只读终审通过：A1-A21 全部通过；Maven 可用性判断、Classic full workflow 归一化和固定选择预算均有独立复现证据。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | 用户手动创建 `.comet/rules/database.md`，写入普通标题、列表和可选的 `适用范围：server/**/migration/**`；扫描和选择器可以直接读取它。 | Markdown 标题、列表和适用范围可读取。 |
| A2 | passed | brief.md | 在没有规则文件的仓库运行 `comet rules init`，得到盘点摘要并保存 Runtime 状态，但仓库不会出现空规则文件或 Comet change。 | 无规则 init 只写 Runtime，不生成空规则或 change。 |
| A3 | passed | brief.md | 用户说“加入规则：迁移必须同步回滚说明”，服务追加到指定 Markdown 文件，已有内容和注释保持不变。 | addRule 仅追加指定 Markdown 并保留已有文本。 |
| A4 | passed | brief.md | 同一候选只在两个不同且成功的 change 中观察到后才进入待处理候选；重复恢复同一 change 不增加计数。 | 不同成功 change 计数，重复 change 去重。 |
| A5 | passed | brief.md | `select` 对任务和目标路径返回相关规则，结果不超过固定字节上限；普通运行不返回整个候选列表。 | 选择结果受固定段数和完整数组序列化字节预算约束。 |
| A6 | passed | brief.md | 项目含 `package.json`、`pom.xml`、`build.gradle` 或 Makefile 时，服务返回项目实际可用的验证入口，不要求统一为 Comet 命令。 | package、Maven、Gradle、Make 和 Python 入口均按项目内容发现。 |
| A7 | passed | brief.md | `comet rules status --json` 返回初始化状态、规则来源、验证入口和候选摘要；不暴露内部 Runtime 字段。 | status JSON 只返回用户摘要。 |
| A8 | passed | specs/project-rules/spec.md | `domains/project-rules` 提供项目规则文件读取、扫描、候选管理、上下文选择和验证入口发现。它不依赖某一个 Comet workflow，也不修改 Native、Classic、Hotfix 或 Tweak 的状态。`app/commands/project-rules.ts` 只把这些能力暴露为 `comet rules` CLI。 | 领域服务独立且不修改 workflow 状态。 |
| A9 | passed | specs/project-rules/spec.md | `.comet/rules/*.md` 是可选的普通 Markdown 文件；一个文件可以写多条规则。 | 支持可选的一文件多段 Markdown 规则。 |
| A10 | passed | specs/project-rules/spec.md | 规则段落可以用标题分组，并可在段落中写 `适用范围：<glob>`；没有范围时按标题、正文、任务和目标路径匹配。 | 标题、正文、适用范围 glob 匹配正常。 |
| A11 | passed | specs/project-rules/spec.md | 扫描还可以识别仓库已有的 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md` 等指令来源，但不把它们复制到 `.comet/rules`。 | 可发现 AGENTS、CLAUDE 和 Copilot 来源且不复制。 |
| A12 | passed | specs/project-rules/spec.md | 写入规则时只能追加或替换明确的目标文件，保留其他文本；初始化和扫描不能生成空规则文件。 | 路径约束、追加写入和盘点不建空文件。 |
| A13 | passed | specs/project-rules/spec.md | Runtime 状态位于 `.comet/runtime/project-rules/`，包括最近扫描、来源索引、观察去重键和候选状态。它不是用户维护界面，也不替代 Markdown、Agent 指令或原生检查配置。 | Runtime 固定在 .comet/runtime/project-rules。 |
| A14 | passed | specs/project-rules/spec.md | `init` 和 `scan` 都执行有边界的只读盘点，并更新 Runtime 状态；两者幂等且不创建 Comet change。 | init/scan 有界、幂等并不创建 change。 |
| A15 | passed | specs/project-rules/spec.md | `status` 返回初始化、上次盘点、来源、验证入口和待处理/稍后候选摘要；摘要只包含用户可读文本和处理状态，候选详情按需读取。 | status 提供盘点、来源、入口和候选摘要。 |
| A16 | passed | specs/project-rules/spec.md | 显式添加的规则立即写入用户指定的普通 Markdown 文件；自动候选只有用户选择加入后才能生成仓库改动。 | 显式规则立即写入，自动候选仅 adopt 才改仓库。 |
| A17 | passed | specs/project-rules/spec.md | 观察必须带项目身份、workflow 家族、change ID、成功结果和候选键。Native 使用 `native`，Classic 使用 `full`、`hotfix` 或 `tweak`；宿主传入 `classic` 时归一化为 `full`，不能形成第二个证据族。同一 change 只计一次；至少两个不同且成功的 change 提供一致证据后才生成非阻塞候选。 | 接受 native/full/hotfix/tweak，classic 归一化为 full，身份和成功证据正确去重。 |
| A18 | passed | specs/project-rules/spec.md | 候选可以 `adopt`、`ignore`、`snooze` 或恢复为待处理。未采用候选不进入上下文，不阻塞编译、测试、构建或 CI，也不静默修改规则来源。 | 支持 adopt/ignore/snooze/restore，未采用候选不进入选择也不阻塞。 |
| A19 | passed | specs/project-rules/spec.md | 选择器先按来源、项目、路径和任务做确定性过滤，再按匹配程度排序；调用者可以缩小但不能放大固定的最大段数和字节数。调用者获得规则文本、来源路径和适用范围，不获得完整候选列表或 Runtime 机器字段。 | 来源、路径、任务过滤和排序确定，调用者不能放大 5 段/8 KiB 上限。 |
| A20 | passed | specs/project-rules/spec.md | 服务从 `package.json` scripts、有效的 Maven/Gradle 构建文件、Makefile、Python 项目配置和可用 wrapper 中发现验证入口，返回实际命令和来源；空文件或仅注释的构建文件不会被宣称为入口。它不安装依赖、不运行命令、不改变 warning/error 语义；Agent 或宿主负责在授权范围内执行并根据原生诊断修复。 | 原生入口和 wrapper 发现正确，不执行命令；Maven 截断及嵌套坐标误报已修复。 |
| A21 | passed | specs/project-rules/spec.md | 三个命令调用同一领域服务；普通输出简短可读，`--json` 只返回用户需要的状态和摘要，不返回内部 ID、评分、证据时间戳或状态机字段。 | 三个 CLI 共用领域服务，JSON 不暴露内部 ID、评分或状态机字段。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| project rules tests | vitest run test/domains/project-rules/project-rules.test.ts test/app/project-rules-command.test.ts | . | passed | 0 | 3032 ms |
| TypeScript typecheck | exec tsc --noEmit | . | passed | 0 | 9807 ms |
| architecture lint | run lint:architecture | . | passed | 0 | 1113 ms |
| project rules formatting | prettier --check domains/project-rules/project-rules.ts domains/project-rules/types.ts domains/project-rules/index.ts app/commands/project-rules.ts app/cli/index.ts test/domains/project-rules/project-rules.test.ts test/app/project-rules-command.test.ts config/repository-layout.json docs/comet/changes/self-evolving-project-rules/brief.md docs/comet/changes/self-evolving-project-rules/specs/project-rules/spec.md | . | passed | 0 | 2443 ms |
| repository build | run build | . | passed | 0 | 33821 ms |

## Blockers

_None._

## Risks and skipped work

- child worktree 未运行 pnpm lint，因为隔离环境缺少 eslint 可执行文件；针对性测试、tsc、architecture、Prettier 和 build 均通过。
- Hook、Skill 上下文接线和 Dashboard 属于依赖 child 或最终集成，不在本 child 范围。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A5, A6, A7, A10, A13, A15, A17, A18, A19, A20, A21 | 独立只读复核确认 13 项验收存在可复现缺口；先回到 Build 修复选择边界、来源状态、候选摘要、观察身份、snooze 恢复、验证入口判断和 CLI 输出，再重新验证。 | 2026-08-14T09:53:36.429Z |
| 1 | 2 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-08-14T10:02:22.500Z |
| 2 | 1 | 1 | recovery | — | Verifier 复查发现并已修复 Runtime 路径固定、验证入口摘要去除内部 ID，以及 Gradle 检查任务识别边界；实现已更新，重新验证。 | 2026-08-14T10:07:24.014Z |
| 2 | 2 | 1 | recovery | — | 终审又发现选择结果预算未计返回元数据、空 workflow/changeId 可制造虚假证据、Maven/Python 入口仍过宽；已修复并加入测试，重新验证。 | 2026-08-14T10:13:35.634Z |
| 2 | 3 | 1 | recovery | — | 终审又复现了数组 JSON 开销越界、非 Comet workflow 伪造证据，以及 Gradle/Python 注释误判；已修复并覆盖回归测试，重新验证。 | 2026-08-14T10:19:13.007Z |
| 2 | 4 | 1 | fail | A6, A17, A20 | 独立 Verifier 复现 Maven 可用性误判及 Classic full workflow 拒绝；代码已回到 Build 修复并新增回归测试。 | 2026-08-14T10:28:18.938Z |
| 2 | 5 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-08-14T10:30:02.350Z |
| 3 | 1 | 1 | pass | — | 独立只读终审通过：A1-A21 全部通过；Maven 可用性判断、Classic full workflow 归一化和固定选择预算均有独立复现证据。 | 2026-08-14T10:35:16.947Z |

## Conclusion

独立只读终审通过：A1-A21 全部通过；Maven 可用性判断、Classic full workflow 归一化和固定选择预算均有独立复现证据。
