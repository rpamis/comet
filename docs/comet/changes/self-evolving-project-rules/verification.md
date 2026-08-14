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
- Completed: 2026-08-14T09:53:36.429Z
- Summary: 独立只读复核确认 13 项验收存在可复现缺口；先回到 Build 修复选择边界、来源状态、候选摘要、观察身份、snooze 恢复、验证入口判断和 CLI 输出，再重新验证。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | 用户手动创建 `.comet/rules/database.md`，写入普通标题、列表和可选的 `适用范围：server/**/migration/**`；扫描和选择器可以直接读取它。 | 普通 Markdown 规则文件和可读范围示例可被读取。 |
| A2 | passed | brief.md | 在没有规则文件的仓库运行 `comet rules init`，得到盘点摘要并保存 Runtime 状态，但仓库不会出现空规则文件或 Comet change。 | 初始化与扫描保持幂等且只写 Runtime 状态。 |
| A3 | passed | brief.md | 用户说“加入规则：迁移必须同步回滚说明”，服务追加到指定 Markdown 文件，已有内容和注释保持不变。 | 显式规则可追加到用户指定的 Markdown 文件并保留已有内容。 |
| A4 | passed | brief.md | 同一候选只在两个不同且成功的 change 中观察到后才进入待处理候选；重复恢复同一 change 不增加计数。 | 观察按 workflow/change 去重，两个成功 change 后形成候选。 |
| A5 | failed | brief.md | `select` 对任务和目标路径返回相关规则，结果不超过固定字节上限；普通运行不返回整个候选列表。 | 选择上限可由调用者任意放大，且无匹配的无范围规则仍可能返回；不满足固定上下文边界。 |
| A6 | failed | brief.md | 项目含 `package.json`、`pom.xml`、`build.gradle` 或 Makefile 时，服务返回项目实际可用的验证入口，不要求统一为 Comet 命令。 | 仅凭 build 文件存在就猜测 mvn/gradle 命令，未确认项目实际验证入口。 |
| A7 | failed | brief.md | `comet rules status --json` 返回初始化状态、规则来源、验证入口和候选摘要；不暴露内部 Runtime 字段。 | CLI --json 直接暴露 candidate id/key、观察次数和时间戳等 Runtime 内部字段。 |
| A8 | passed | specs/project-rules/spec.md | `domains/project-rules` 提供项目规则文件读取、扫描、候选管理、上下文选择和验证入口发现。它不依赖某一个 Comet workflow，也不修改 Native、Classic、Hotfix 或 Tweak 的状态。`app/commands/project-rules.ts` 只把这些能力暴露为 `comet rules` CLI。 | 未采用候选不进入公开选择结果，也不阻塞项目检查。 |
| A9 | passed | specs/project-rules/spec.md | `.comet/rules/*.md` 是可选的普通 Markdown 文件；一个文件可以写多条规则。 | 来源、任务和路径选择返回用户可读规则文本。 |
| A10 | failed | specs/project-rules/spec.md | 规则段落可以用标题分组，并可在段落中写 `适用范围：<glob>`；没有范围时按标题、正文、任务和目标路径匹配。 | ** glob 会被后续 * 替换破坏，深层路径匹配失败；无范围零相关段落也会入选。 |
| A11 | passed | specs/project-rules/spec.md | 扫描还可以识别仓库已有的 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md` 等指令来源，但不把它们复制到 `.comet/rules`。 | 验证入口发现覆盖 package scripts、Maven、Gradle、Makefile 和 Python 配置。 |
| A12 | passed | specs/project-rules/spec.md | 写入规则时只能追加或替换明确的目标文件，保留其他文本；初始化和扫描不能生成空规则文件。 | 未执行命令、不安装依赖、不重新解释原生工具严重级别。 |
| A13 | failed | specs/project-rules/spec.md | Runtime 状态位于 `.comet/runtime/project-rules/`，包括最近扫描、来源索引、观察去重键和候选状态。它不是用户维护界面，也不替代 Markdown、Agent 指令或原生检查配置。 | Runtime state 未持久化来源索引，且可通过 runtimeDirectory 指向项目外。 |
| A14 | passed | specs/project-rules/spec.md | `init` 和 `scan` 都执行有边界的只读盘点，并更新 Runtime 状态；两者幂等且不创建 Comet change。 | 规则状态位于 .comet/runtime/project-rules，规则来源仍由 Markdown 维护。 |
| A15 | failed | specs/project-rules/spec.md | `status` 返回初始化、上次盘点、来源、验证入口和待处理候选摘要。 | 公开 candidates/status 返回原始 RuleCandidate，而不是用户可读摘要。 |
| A16 | passed | specs/project-rules/spec.md | 显式添加的规则立即写入用户指定的普通 Markdown 文件；自动候选只有用户选择加入后才能生成仓库改动。 | 项目内相对路径检查阻止规则写入项目外。 |
| A17 | failed | specs/project-rules/spec.md | 观察必须带项目身份、workflow 家族、change ID、成功结果和候选键。同一 change 只计一次；至少两个不同且成功的 change 提供一致证据后才生成非阻塞候选。 | 观察没有独立 project identity；成功一致性只信任调用者 candidateKey，且失败后同 change 成功不能纠正既有失败观察。 |
| A18 | failed | specs/project-rules/spec.md | 候选可以 `adopt`、`ignore` 或 `snooze`。未采用候选不进入上下文，不阻塞编译、测试、构建或 CI，也不静默修改规则来源。 | snooze 后候选从公开结果永久消失，没有恢复或到期入口。 |
| A19 | failed | specs/project-rules/spec.md | 选择器先按来源、项目、路径和任务做确定性过滤，再按匹配程度排序；结果使用固定的最大段数和字节数。调用者获得规则文本、来源路径和适用范围，不获得完整候选列表或 Runtime 机器字段。 | 选择器没有来源过滤，零相关规则仍会入选，调用者可以放大上限。 |
| A20 | failed | specs/project-rules/spec.md | 服务从 `package.json` scripts、Maven/Gradle 构建文件、Makefile、Python 项目配置等已存在文件中发现验证入口，返回实际命令和来源。它不安装依赖、不运行命令、不改变 warning/error 语义；Agent 或宿主负责在授权范围内执行并根据原生诊断修复。 | 空或仅注释的 build.gradle 也返回 gradle check，未识别 wrapper、插件任务和 lockfile；pytest.ini-only 的 sourcePath 也错误。 |
| A21 | failed | specs/project-rules/spec.md | 三个命令调用同一领域服务；普通输出简短可读，`--json` 只返回用户需要的状态和摘要，不返回内部 ID、评分或状态机字段。 | JSON 仍暴露内部 ID/状态，CLI 测试未覆盖 scan 和普通文本输出。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| project rules tests | vitest run test/domains/project-rules/project-rules.test.ts test/app/project-rules-command.test.ts | . | passed | 0 | 2597 ms |
| TypeScript typecheck | exec tsc --noEmit | . | passed | 0 | 6728 ms |
| architecture lint | run lint:architecture | . | passed | 0 | 956 ms |
| project rules formatting | prettier --check domains/project-rules/project-rules.ts domains/project-rules/types.ts domains/project-rules/index.ts app/commands/project-rules.ts app/cli/index.ts test/domains/project-rules/project-rules.test.ts test/app/project-rules-command.test.ts config/repository-layout.json docs/comet/changes/self-evolving-project-rules/brief.md docs/comet/changes/self-evolving-project-rules/specs/project-rules/spec.md | . | passed | 0 | 1769 ms |
| repository build | run build | . | passed | 0 | 32021 ms |

## Blockers

_None._

## Risks and skipped work

- 项目规则 domain 默认直接依赖 node:fs/path，按仓库分层规范应由 platform 适配。
- 完整 pnpm lint 未运行，child worktree 缺少 eslint 可执行文件。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A5, A6, A7, A10, A13, A15, A17, A18, A19, A20, A21 | 独立只读复核确认 13 项验收存在可复现缺口；先回到 Build 修复选择边界、来源状态、候选摘要、观察身份、snooze 恢复、验证入口判断和 CLI 输出，再重新验证。 | 2026-08-14T09:53:36.429Z |

## Conclusion

独立只读复核确认 13 项验收存在可复现缺口；先回到 Build 修复选择边界、来源状态、候选摘要、观察身份、snooze 恢复、验证入口判断和 CLI 输出，再重新验证。
