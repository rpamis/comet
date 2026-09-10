# Classic Agent CLI 操作审核

日期：2026-09-10。基线：`0.4.1` / `1617fa06da8a9bfbf5dd424316a1ba35072a289a`。

本次只审核并添加研究文档，未修改产品、测试、生成资产、website、GitHub 或版本。用户反馈“约三分之一时间用于纠正 CLI”作为调查线索；没有对应模型 trace，不能把这一比例当作测量结果，也不能据此归因于模型能力。

## 已确认结论

当前 Classic 已有执行检查、输入绑定、一次性证据、稳定任务 ID、紧凑恢复包和自主执行策略。09-08/09-09 调查中部分问题已经修复，不能原样重复旧结论。

仍存在四组可达的操作问题：Skill 提供的绝对路径与状态/计划契约冲突；两个状态检查错误使用调用目录解析设计路径；Design 中途恢复被“设计路径必须为空”的旧入口条件阻塞；当前快捷入口绕过完整 CLI 的集成参数处理。第一组会让遵循当前 Skill 的 Agent 也收到错误，不宜概括为“Agent 用错 CLI”。

### 1. P2：Skill 绑定绝对路径，状态写入与计划映射要求相对路径

- `assets/skills-zh/comet-classic/reference/classic-layout.md:9` 将 `<classic-change-dir>` 直接绑定入口 `changeDir`；当前 CLI 实际返回绝对路径。
- Design Skill 第 206、218 行沿该路径创建/登记设计；Build Skill 第 70、77、92 行沿布局创建/登记计划，并要求写 `<!-- comet-task-authority: <classic-change-dir>/tasks.md -->`。英文对应 Skill 也使用同样的绑定和参数，并非仅中文翻译问题。
- `domains/comet-classic/classic-state-command.ts:173-180` 拒绝绝对状态路径；第 453-460 行把该规则用于 `design_doc`、`plan` 等字段。
- `domains/comet-classic/classic-guard.ts:553-554` 将权威任务路径变为仓库相对路径；`classic-tasks.ts:117-120` 用字符串精确比较，绝对路径即使指向同一个文件也失败。

真实公开 CLI 对照：

| 操作                                                                            | 实际结果                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `comet state set demo design_doc C:/.../openspec/changes/demo/design.md --json` | exit 1，`design_doc must be a relative path within the repo`     |
| 同一文件改用 `openspec/changes/demo/design.md`                                  | exit 0                                                           |
| `comet state set demo plan C:/.../docs/superpowers/plans/demo.md --json`        | exit 1，`plan must be a relative path within the repo`           |
| 同一文件改用 `docs/superpowers/plans/demo.md`                                   | exit 0                                                           |
| 计划使用 Skill 指定的绝对 `comet-task-authority`，运行 Build Guard              | exit 1，`Plan task authority must point to this change tasks.md` |
| authority 改为 `openspec/changes/demo/tasks.md`，记录真实本地检查，再运行 Guard | exit 0，进入 Verify                                              |

这条失败链至少包含“设计路径失败 → 相对路径纠正 → 计划路径失败 → 相对路径纠正 → Build Guard 计划映射失败 → 改 authority 再验证”。不是该比例的实测，但已足以说明存在由产品协议制造的纠正轮次。

最小改法：文件工具继续使用绝对路径，状态与产物内引用统一使用 Runtime 返回的仓库相对 ref；在入口同时给出两种用途明确的字段。计划 authority 直接使用 `state tasks --json` 已返回的 `data.authority`，不要再让模型从绝对目录重算。登记计划时就校验映射，避免到 Build 退出才发现。双语 Skill 同步体现同一规则。

### 2. P2：从项目子目录运行时，合法的设计路径被误报不存在

`classic-command-context.ts` 会发现项目根并保存调用目录，不改变 `process.cwd()`。大部分路径辅助函数已经按项目根解析；但 `classic-state-command.ts:734` 和 `:1186` 先调用 `path.resolve(designDoc)`，把仓库相对路径错误变成相对子目录的绝对路径。

同一临时项目、同一状态、同一设计文档：

- 从项目根执行 `comet state check demo build --json`：exit 0，6/6 通过。
- 从项目 `src` 执行相同命令：exit 1，误报 `design_doc=openspec/changes/demo/design.md (expected: non-null and file exists)`。
- 从 `src` 执行 `comet state transition demo design-complete --json`：exit 1，声称 Design Doc 不存在；返回项目根后 Design Guard 正常完成同一阶段转换。

最小改法：这两处沿用 `classicProjectTargetExists` / `classicProjectFileNonempty` 的项目根基准，不提前使用无 root 的 `path.resolve`。增加根目录与嵌套目录的同值回归。不要要求 Agent 通过尝试不同 cwd 来找出哪条命令例外。

### 3. P2：Design 的可恢复中间状态仍被旧入口条件拒绝

Design Skill 明确要求恢复已有成果，并依次执行“登记 `design_doc` → 更新 handoff → design guard --apply”（第 214-224 行）。这三步不是单次原子操作，登记后中断、handoff 失败或 Guard 失败都可能保留 `phase: design` 与非空 `design_doc`。

`classic-state-command.ts:1167-1172` 仍把非空 `design_doc` 视为入口失败。

真实链路：

1. 初始化 full change，Open Guard 成功进入 Design。
2. Design 入口 8/8 通过；生成 handoff，登记合法设计路径。
3. 再执行 `comet state check demo design --json`：exit 1，7/8 通过，失败项为 `design_doc ... (expected: empty/null)`。
4. 对同一状态使用 `--recover --json` 返回 exit 0；既有 handoff/文档有效，Design Guard 可以成功进入 Build。

因此入口失败不能说明设计损坏。模型若根据“expected empty/null”清空路径，会制造无意义的状态回退。正常与冷恢复两种入口还会对同一状态给出不同的可继续结论。

最小改法：Design 入口接受已记录且有效的设计文件，明确返回待补的 handoff/确认/转换动作。确认仍由原有授权记录和 Skill 保证，不以“设计路径为空”代替确认。至少覆盖登记后中断、handoff 过期和重复恢复三种情况。

### 4. P2：快捷入口与完整 Classic CLI 的集成参数契约不一致

`bin/fast-runtime-router.js:39-41,77-79` 将公开 `state/check/guard/handoff/archive` 快捷命令直接交给独立 bundle。它绕过 `app/commands/classic.ts:20-29` 的集成参数处理、上下文注入和结果记录；而 `comet classic state ...` 仍经过第 67-76 行的完整 facade。

完整 facade 在第 145-157 行识别并移除 `--comet-task`、`--comet-path`、`--comet-phase`、`--comet-workflow`，再把剩余参数交给 Runtime。快路径不做同样处理，因此命令处理器收到这些额外参数并拒绝。

在新的临时项目和 HOME 中，通过公开入口初始化并选择 `audit-demo` 后，实际对照如下：

| 命令                                                                                 | 实际结果                                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `node D:/Project/Comet/bin/comet.js state current --json`                            | exit 0，返回 `audit-demo`                                                   |
| `node D:/Project/Comet/bin/comet.js state current --comet-task audit --json`         | exit 1，`Invalid arguments for comet state current; run comet state --help` |
| `node D:/Project/Comet/bin/comet.js classic state current --comet-task audit --json` | exit 0，返回 `audit-demo`                                                   |

另外三个集成参数共用同一分支，源码可确认快路径同样绕过其处理；本次未分别执行这三个参数。`classic-script-entry.ts:44-59` 只调用 handler 并输出结果，没有 facade 的 `recordClassicResult`。因此结果记录调用在快路径上缺失属于已核对的静态控制流差异，**本次没有观测或计数插件存储中的学习记录，不能声称已实测具体记忆数据丢失**。

最小调整：带集成参数的命令在当前快路径返回空路由，交回已有完整 facade；同时明确处理 `COMET_TASK` 及结果记录的语义。若要继续优化无参数快路径，应抽取轻量共享 facade 或明确替代的事件记录契约，不能仅用 stdout/退出码一致证明行为等价。回归比较应涵盖 argv、上下文注入和结果记录；子程序 `--` 后的同名参数仍须原样透传。

这是当前快路径的契约一致性问题。现行主要 Skill 多使用独立 `comet task`，本次没有用户历史 trace，因此不能直接把用户此前反馈的 CLI 纠正成本归因于该新增差异。

证据：`C:/Users/BENYM/AppData/Local/Temp/comet-classic-fast-contract-xRax5i/selected-evidence.json`。

## 正常链与额外操作成本

### OpenSpec 补查：adapter 正确执行，但上游下一步提示使用另一套调用上下文

本轮另外使用当前本机 OpenSpec 包与临时项目执行了真实 `new change`、`status`、`instructions`。包声明版本为 `1.7.0`，实际具备当前 Skill 所需的 `changeRoot/applyRequires/requires/outputPath/status/resolvedOutputPath`。不能仅因 Skill 写明曾核对 `1.11.0/1.12.0` 就认定本机版本不兼容，也未运行历史 `1.5.0` 来推断其能力。

当前中英文 Skill 已明确要求所有命令通过 `comet classic openspec -- …`，并覆盖外部 Skill 固定 cwd/物理目录的要求。然而 `classic-openspec-command.ts:24-33,45-49` 只切换子进程到配置的 `openSpecBase`，随后原样透传上游 stdout/stderr。上游新建命令输出与 status JSON 的 `nextSteps` 继续提示直接运行官方 CLI。

实际失败链：

1. 从临时项目根执行 `comet classic openspec -- new change quote-probe`，成功创建 `docs/openspec/changes/quote-probe`。
2. 输出提示 `Next: openspec status --change quote-probe`。
3. 照提示在 Agent 原项目根直接运行官方 status，exit 1：`Change 'quote-probe' not found. No changes exist.`
4. 使用 adapter 执行同一 status 参数，exit 0；JSON 又提示直接执行 `openspec instructions …`。

这是 **P2：当前 Skill 规则与 CLI 当下提示的上下文冲突**，不是 adapter 找不到 change，也不是上游 CLI 自身的目录语义错误。熟悉 Comet 规则的 Agent 可以始终正确调用，但必须反复重写上游命令。建议透明保留上游结果，同时提供带控制 cwd 与完整 Comet argv 的结构化动作，并明确原始 `nextSteps` 属于上游 cwd；不要只靠再加一段 Skill 警告解决。

另有 **P3：Windows adapter 参数不完全保真**。通过 Node 的字面 argv 传入描述 `Preserve %COMET_AUDIT_LITERAL% and "quoted"`，仅在 fixture 环境设置 `COMET_AUDIT_LITERAL=EXPANDED_BY_SHELL`，产物 README 中得到 `Preserve EXPANDED_BY_SHELL and "quoted"`。`classic-openspec-command.ts:29-33` 使用 `shell: true`，`platform/process/shell-quote.ts:17-26` 的双引号未阻止 cmd 百分号变量展开。未读取或输出任何真实敏感变量。应在平台适配层保证参数按字面传入，优先解析可直接执行的 Node CLI 入口；需要兼容 Windows shim 时单独验证实际 argv，而不是继续让模型猜 shell 转义。

额外往返也可定位：Open Skill 中文 `:176` 的兼容性 status 与 `:187` 的第一轮 status 之间没有产物写入；最后一轮 status 后，`state artifacts` 在 `classic-artifact-requirements.ts:169-173` 又查 status。Guard/设计入口/handoff 也有边界重验。第一处可以直接复用最新结果，其余只在同一次操作、文件与 schema 未变时复用，不能删除跨修改和确认边界的校验。

该补查临时证据：`C:/Users/BENYM/AppData/Local/Temp/classic-openspec-audit-6Ekj2D/results.json`；上游输出源码为本机安装包 `D:/nodejs/node_modules/@fission-ai/openspec/dist/commands/workflow/new-change.js:34`。这是当前本机包的实测，不是官方所有版本的兼容性声明。

### 公开 Classic 正常阶段链

本次使用 `node D:/Project/Comet/bin/comet.js ...` 执行公开入口，命中了包内当前 self-contained Runtime。临时项目与 HOME 位于系统 Temp，没有执行真实用户项目的状态命令。

最小 fixture 已通过：

```text
state init full
准备最小 proposal/design/tasks fixture
guard open --apply
state check design
handoff design --write
state set design_doc <repo-relative-ref>
guard design --apply
state set build_mode autonomous tdd_mode direct review_mode standard
创建并登记带任务 ID 的相对路径计划
state tasks → state task-complete --expect <revision>
check run build --local -- <真实 Node 子进程>
guard build --apply
登记 verification_report / verify_mode
check run verify --local -- <真实 Node 子进程>
guard verify --apply
state next → /comet-archive
```

这里的构建/验证子进程只打印 fixture 标记并退出 0，证明 CLI、证据和阶段转换可执行；不代表产品实现、用户验收、独立审查或完整 Classic 模型流程已通过。未调用 Superpowers Skill，也未替用户授权归档/交付。

即使无错误，五阶段依然需要较多选择、检查、登记、转换及 next 调用。OpenSpec 又要求逐 artifact 的 status/instructions 循环。应分别统计真实验证时间、Comet 管理命令时间、模型判断与工具往返时间；压缩其中一个不能被当作另一个的收益。

优先减少重复的管理操作：成功转换直接返回下一阶段入口数据；已选 workspace 不重复 select/resolve；有效入口摘要不再逐字段 get；设计登记/handoff/阶段转换可由一个带前置条件、可恢复的动作协调。保留失败证据与安全条件，把动作组合交给 Runtime，而非让模型拼接更多 shell。

## 输出与错误反馈：确认的设计负担，不冒充独立缺陷

- `state check --json` 正常时提供 `data.checks` 计数；失败详情仍在 `stdout` 的带 ANSI 文本中，没有丢失。不能声称“JSON 完全没有错误原因”。但 Agent 无法直接消费稳定的 `issues[]`、字段、期望值和修复 argv。
- Guard JSON 的诊断对象放在字符串 `stdout` 中，实际 Guard 的 PASS/FAIL 又在文本 `stderr`；例如计划映射失败时，内层 `runtimeEval.passed` 仍可为 true，因为它只验证 Engine 当前步骤所需证据。外层 `exitCode` 才是命令结果。该分层有语义解释，但容易迫使 Agent反复判断不同的“通过”。
- `state next` 的 `data.configuration` 使用 camelCase；`state set` 参数和 `.comet.yaml` 使用 snake_case。命令帮助已说明部分字段，但没有一份随当前动作返回的最小参数 schema。
- `state check`、`check run`、`guard`、`transition` 含义不同；`guard` 无 `--apply` 也可能执行构建，并非只读状态查询。当前帮助已经明确说明，不能继续归因于没有帮助。

建议统一增量增加 `issues[{code, field, actual, expected, remediation}]`，返回单个当前可执行动作的 `argv`、`cwd`、输入 schema 和 `retryable`。修复提示必须保留文件内容与授权，不提供清空状态或绕过检查的捷径。JSON 默认只返回结构化短结果；详细人读日志放 `--details` 或日志引用。保留兼容字段，但 Skill 不再从人读文本拼命令。

## 旧结论核对及证据边界

- 当前 `classic-command-checks.ts` 对执行结果绑定输入、环境和日志，手工 `record-check` 不能满足 Runtime 放行条件；不能再报告旧版“任意旧成功记录可放行”。
- 当前 Build Guard 在廉价前置失败后立即返回；本次 authority 错误中未执行 Build 检查。09-08 的“前置失败仍构建”不是当前结论。
- 当前帮助与代码已明确：预检不消费一次性证据，成功推进才消费；冷恢复重新验证可复用证据。09-09 早期实施记录中的相反说明已过时。
- 已实际执行当前公开入口的 Open→Design→Build→Verify→Archive-ready fixture，以及上述失败/纠正对照；未使用强制 phase 或跳过检查变量。
- 正在使用的本机 OpenSpec 安装包静态读取为 `1.7.0`；旧报告的 `1.11.0` 不能作为当前事实。本报告核心复现直接提供最小 OpenSpec 文件 fixture，未把它冒充当前官方 CLI 的完整生命周期。
- 未执行全量测试、构建生成物、真实平台 Hook、npm 安装包、真实模型 Eval、用户 trace 回放或远端 CI。运行中的毫秒数仅为小 fixture 单次命令观测，不是性能基准，不用于声称缩短比例。

临时证据：`C:/Users/BENYM/AppData/Local/Temp/comet-classic-cli-audit-se0Kgv/evidence.json` 与 `evidence-paths-and-full-chain.json`。文件含每次 argv、cwd、退出码、耗时和原始输出；Temp 可被系统清理，报告保留了必要命令与结果摘要。
