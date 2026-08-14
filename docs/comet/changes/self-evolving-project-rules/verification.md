---
generated_from_state_version: 22
---

# Verification

## Current result

- Result: **Failed**
- Assurance: **skill-coordinated**
- Goal cycle: 2
- Iteration: 4
- Verifier attempt: 1
- Completed: 2026-08-14T10:28:18.938Z
- Summary: 独立 Verifier 复现 Maven 可用性误判及 Classic full workflow 拒绝；代码已回到 Build 修复并新增回归测试。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | 用户手动创建 `.comet/rules/database.md`，写入普通标题、列表和可选的 `适用范围：server/**/migration/**`；扫描和选择器可以直接读取它。 | Markdown 规则可直接读取。 |
| A2 | passed | brief.md | 在没有规则文件的仓库运行 `comet rules init`，得到盘点摘要并保存 Runtime 状态，但仓库不会出现空规则文件或 Comet change。 | init 只读盘点并保存 Runtime 状态。 |
| A3 | passed | brief.md | 用户说“加入规则：迁移必须同步回滚说明”，服务追加到指定 Markdown 文件，已有内容和注释保持不变。 | 显式添加保留原文并追加规则。 |
| A4 | passed | brief.md | 同一候选只在两个不同且成功的 change 中观察到后才进入待处理候选；重复恢复同一 change 不增加计数。 | 不同成功 change 才形成候选且去重。 |
| A5 | passed | brief.md | `select` 对任务和目标路径返回相关规则，结果不超过固定字节上限；普通运行不返回整个候选列表。 | 完整返回数组受固定字节预算约束。 |
| A6 | failed | brief.md | 项目含 `package.json`、`pom.xml`、`build.gradle` 或 Makefile 时，服务返回项目实际可用的验证入口，不要求统一为 Comet 命令。 | 旧实现的 Maven 入口判断把截断 XML 或依赖嵌套坐标误判为可用入口。 |
| A7 | passed | brief.md | `comet rules status --json` 返回初始化状态、规则来源、验证入口和候选摘要；不暴露内部 Runtime 字段。 | status 摘要不暴露 Runtime 内部字段。 |
| A8 | passed | specs/project-rules/spec.md | `domains/project-rules` 提供项目规则文件读取、扫描、候选管理、上下文选择和验证入口发现。它不依赖某一个 Comet workflow，也不修改 Native、Classic、Hotfix 或 Tweak 的状态。`app/commands/project-rules.ts` 只把这些能力暴露为 `comet rules` CLI。 | 领域服务与 workflow 状态解耦。 |
| A9 | passed | specs/project-rules/spec.md | `.comet/rules/*.md` 是可选的普通 Markdown 文件；一个文件可以写多条规则。 | 普通 Markdown 文件可一文件多条规则。 |
| A10 | passed | specs/project-rules/spec.md | 规则段落可以用标题分组，并可在段落中写 `适用范围：<glob>`；没有范围时按标题、正文、任务和目标路径匹配。 | 标题、范围和 glob 选择已覆盖。 |
| A11 | passed | specs/project-rules/spec.md | 扫描还可以识别仓库已有的 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md` 等指令来源，但不把它们复制到 `.comet/rules`。 | 原有指令源只读发现不复制。 |
| A12 | passed | specs/project-rules/spec.md | 写入规则时只能追加或替换明确的目标文件，保留其他文本；初始化和扫描不能生成空规则文件。 | 写入只作用于明确目标并保留其他文本。 |
| A13 | passed | specs/project-rules/spec.md | Runtime 状态位于 `.comet/runtime/project-rules/`，包括最近扫描、来源索引、观察去重键和候选状态。它不是用户维护界面，也不替代 Markdown、Agent 指令或原生检查配置。 | Runtime 路径固定且保存来源索引。 |
| A14 | passed | specs/project-rules/spec.md | `init` 和 `scan` 都执行有边界的只读盘点，并更新 Runtime 状态；两者幂等且不创建 Comet change。 | init/scan 有界、幂等且不创建 change。 |
| A15 | passed | specs/project-rules/spec.md | `status` 返回初始化、上次盘点、来源、验证入口和待处理/稍后候选摘要；摘要只包含用户可读文本和处理状态，候选详情按需读取。 | 状态和候选公开接口返回可读摘要。 |
| A16 | passed | specs/project-rules/spec.md | 显式添加的规则立即写入用户指定的普通 Markdown 文件；自动候选只有用户选择加入后才能生成仓库改动。 | 自动候选只有 adopt 才修改规则文件。 |
| A17 | failed | specs/project-rules/spec.md | 观察必须带项目身份、workflow 家族、change ID、成功结果和候选键。同一 change 只计一次；至少两个不同且成功的 change 提供一致证据后才生成非阻塞候选。 | 旧实现拒绝实际 Classic profile full，且未统一 classic 别名。 |
| A18 | passed | specs/project-rules/spec.md | 候选可以 `adopt`、`ignore`、`snooze` 或恢复为待处理。未采用候选不进入上下文，不阻塞编译、测试、构建或 CI，也不静默修改规则来源。 | 候选支持 adopt/ignore/snooze/restore 且非阻塞。 |
| A19 | passed | specs/project-rules/spec.md | 选择器先按来源、项目、路径和任务做确定性过滤，再按匹配程度排序；调用者可以缩小但不能放大固定的最大段数和字节数。调用者获得规则文本、来源路径和适用范围，不获得完整候选列表或 Runtime 机器字段。 | 过滤排序和固定上下限已覆盖。 |
| A20 | failed | specs/project-rules/spec.md | 服务从 `package.json` scripts、有效的 Maven/Gradle 构建文件、Makefile、Python 项目配置和可用 wrapper 中发现验证入口，返回实际命令和来源；空文件或仅注释的构建文件不会被宣称为入口。它不安装依赖、不运行命令、不改变 warning/error 语义；Agent 或宿主负责在授权范围内执行并根据原生诊断修复。 | 旧实现对截断或嵌套坐标 Maven 文件宣称 mvn verify。 |
| A21 | passed | specs/project-rules/spec.md | 三个命令调用同一领域服务；普通输出简短可读，`--json` 只返回用户需要的状态和摘要，不返回内部 ID、评分、证据时间戳或状态机字段。 | CLI 复用领域服务且 JSON 只公开用户需要的摘要。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| project rules tests | vitest run test/domains/project-rules/project-rules.test.ts test/app/project-rules-command.test.ts | . | passed | 0 | 2529 ms |
| TypeScript typecheck | exec tsc --noEmit | . | passed | 0 | 6928 ms |
| architecture lint | run lint:architecture | . | passed | 0 | 884 ms |
| project rules formatting | prettier --check domains/project-rules/project-rules.ts domains/project-rules/types.ts domains/project-rules/index.ts app/commands/project-rules.ts app/cli/index.ts test/domains/project-rules/project-rules.test.ts test/app/project-rules-command.test.ts config/repository-layout.json docs/comet/changes/self-evolving-project-rules/brief.md docs/comet/changes/self-evolving-project-rules/specs/project-rules/spec.md | . | passed | 0 | 1711 ms |
| repository build | run build | . | passed | 0 | 31345 ms |

## Blockers

_None._

## Risks and skipped work

- 本次失败证据对应 b4491b78；随后已修复 Maven 直接子元素解析和 Classic/full 规范化，需以新候选重新终审。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A5, A6, A7, A10, A13, A15, A17, A18, A19, A20, A21 | 独立只读复核确认 13 项验收存在可复现缺口；先回到 Build 修复选择边界、来源状态、候选摘要、观察身份、snooze 恢复、验证入口判断和 CLI 输出，再重新验证。 | 2026-08-14T09:53:36.429Z |
| 1 | 2 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-08-14T10:02:22.500Z |
| 2 | 1 | 1 | recovery | — | Verifier 复查发现并已修复 Runtime 路径固定、验证入口摘要去除内部 ID，以及 Gradle 检查任务识别边界；实现已更新，重新验证。 | 2026-08-14T10:07:24.014Z |
| 2 | 2 | 1 | recovery | — | 终审又发现选择结果预算未计返回元数据、空 workflow/changeId 可制造虚假证据、Maven/Python 入口仍过宽；已修复并加入测试，重新验证。 | 2026-08-14T10:13:35.634Z |
| 2 | 3 | 1 | recovery | — | 终审又复现了数组 JSON 开销越界、非 Comet workflow 伪造证据，以及 Gradle/Python 注释误判；已修复并覆盖回归测试，重新验证。 | 2026-08-14T10:19:13.007Z |
| 2 | 4 | 1 | fail | A6, A17, A20 | 独立 Verifier 复现 Maven 可用性误判及 Classic full workflow 拒绝；代码已回到 Build 修复并新增回归测试。 | 2026-08-14T10:28:18.938Z |

## Conclusion

独立 Verifier 复现 Maven 可用性误判及 Classic full workflow 拒绝；代码已回到 Build 修复并新增回归测试。
