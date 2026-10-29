# 目标

在 `052` 优化 Native 与 Classic 的日常编辑续行。用户自由修改文档、代码或执行正常 Git 操作后，由当前 Agent 判断实际影响，保留有效决定、执行记录及检查，只补必要工作，使流程轻量、可靠、快速。

内容检测与用户代码语言无关，不依赖语法解析、AST、注释规则或编译。Runtime 记录变化、提供原始差异、保存判断和真实执行结果；内容含义、影响范围及检查选择交给 Agent。

# 范围

覆盖原始变化观察、当前 Agent 判断、证据最小更新、各阶段同 Run 续行、Git 状态与内容分离、必要核对提速，以及 Skill/CLI/生成资产/回归同步。Native 与 Classic 保留独立状态机，SDK 与仍受支持的 Compat 入口均在兼容范围内。

## 目录结构

### 修改

- domains/workflow-contract/ — 共享原始变化、判断对应输入和必要路径读取契约。
- domains/comet-native/ — 输入/候选观察、正式文件、检查、验收、归档与续行，替换内容语言特判。
- domains/comet-classic/ — 快照、正式文档证据、检查复用、修订/归档续行和交付路径索引。
- domains/comet-entry/、app/commands/ — 必要的公开 CLI、工作流输出和 Hook 接入。
- platform/fs/ — 仅处理已定位的共享重复读取，保留实际输入与路径身份核对。
- assets/skills-zh/、assets/skills/ — 相关 Native、Classic、入口 Skill 和参考，中文先行并按仓库规则同步英文。
- scripts/build/、scripts/benchmark/ — 对应 Runtime 构建及固定流程性能场景。
- test/domains/、test/app/、test/platform/、test/scripts/、test/repository/ — 按模块归属补定向回归与生成资产契约；真实模型用例复用现有 Eval 入口。
- config/workflow-regressions.json — 逐行为登记来源、稳定 case ID 和精确选择器。
- config/repository-layout.json、assets/manifest.json — 仅在入口、共享依赖或产物登记确有变化时同步。
- package.json、CHANGELOG.md 及现有版本同步文件 — 根据开工时 master 和最终行为统一版本及英文发布说明。
- docs/research/ — 保留调查和实现前后实测证据。

### 新建

- docs/comet/changes/lightweight-edit-continuation/specs/workflow-edit-continuation/spec.md — 完整目标规格。

### 明确不建

- 语言适配表、源码语义检测器或编译检测入口 — 内容判断由 Agent 完成。
- 第二套恢复状态机、逐次编辑的独立审查、要求用户维护的新依赖配置 — 复用 Run、Action 和 continuation。
- 新常驻服务或 Runtime 语言替换 — 不属于本轮已确认范围。

## Source coverage

覆盖本会话用户明确要求及 `docs/research/2026-10-28-052-implementation-checklist.zh.md` 全文；用户原话优先。其他调查只作背景，早期按语言扩展检测的建议已被用户否定。下表 Spec 位置均指 `specs/workflow-edit-continuation/spec.md`。

| 来源条目与位置                         | 读取状态 | 需要保留的内容                          | Spec 位置                  | 验收 ID              | 覆盖状态   | 理由或替代关系                 |
| -------------------------------------- | -------- | --------------------------------------- | -------------------------- | -------------------- | ---------- | ------------------------------ |
| U1：轻量可靠快速、自由编辑的用户要求   | complete | 日常编辑保留有效工作                    | 日常推进与恢复；性能       | A2、A3、A6、A10、A12 | covered    | 当前明确原则                   |
| U2：不绑定语言、不依赖编译、交给 Agent | complete | Runtime 与 Agent 分工                   | 变化记录与判断             | A1、A4               | covered    | 替代早期语言适配建议           |
| U3：基于 master 建立 052               | complete | 沿用当前工作区                          | 范围与兼容                 | A13                  | covered    | 已核对分支和基线               |
| S1：清单核心约定全部段落               | complete | 当前 Agent、原始变化、已有授权续行      | 变化记录与判断；决定与证据 | A1、A5、A6、A7       | covered    | 当前约定                       |
| S2：清单改动 1                         | complete | 原始变化与语言无关                      | 变化记录与判断             | A1                   | covered    | 保留原文件                     |
| S3：清单改动 2                         | complete | 当前 Agent、输入绑定及合并编辑          | 变化记录与判断             | A6、A7               | covered    | 不逐次另起审查                 |
| S4：清单改动 3                         | complete | 按影响更新证据                          | 决定与证据                 | A3、A4、A8           | covered    | 真实结果不改写                 |
| S5：清单改动 4                         | complete | 各阶段原地续行                          | 日常推进与恢复             | A2、A3、A10          | covered    | 原 Run 继续                    |
| S6：清单改动 5                         | complete | Git 元数据与交付身份                    | Git 与交付                 | A9                   | covered    | Git 依赖单独处理               |
| S7：清单改动 6                         | complete | 必要核对去重                            | 性能                       | A12                  | covered    | 实际边界仍核对                 |
| S8：清单改动 7                         | complete | Skill、CLI、生成物和回归一致            | 发布与验证                 | A13                  | covered    | 沿用仓库规则                   |
| S9：实施顺序和损坏处理段落             | complete | 先复现，再接入判断/续行并提速           | 日常推进与恢复；发布与验证 | A10、A11、A13        | covered    | 保留用户成果                   |
| S10：清单 A1                           | complete | 多语言/未知扩展名/无编译器              | Scenario: 语言无关         | A1                   | covered    | 保留原场景                     |
| S11：清单 A2                           | complete | 正式文档小改                            | Scenario: 正式文档续行     | A2                   | covered    | 保留原场景                     |
| S12：清单 A3                           | complete | 验收后普通文档                          | Scenario: 文档证据更新     | A3                   | covered    | 保留原场景                     |
| S13：清单 A4                           | complete | 模块和注释的实际影响                    | Scenario: 实现影响         | A4                   | covered    | 保留原场景                     |
| S14：清单 A5                           | complete | 未覆盖的实质变化                        | Scenario: 用户决定         | A5                   | covered    | 保留原场景                     |
| S15：清单 A6                           | complete | 连续编辑和重复查询                      | Scenario: 合并编辑         | A6                   | covered    | 保留原场景                     |
| S16：清单 A7                           | complete | 判断后新增变化                          | Scenario: 判断新鲜度       | A7                   | covered    | 保留原场景                     |
| S17：清单 A8                           | complete | 新失败不被旧成功覆盖                    | Scenario: 真实检查结果     | A8                   | covered    | 保留原场景                     |
| S18：清单 A9                           | complete | 暂存/取消暂存/空提交                    | Scenario: Git 状态         | A9                   | covered    | 保留原场景                     |
| S19：清单 A10                          | complete | 中断和副作用                            | Scenario: 中断恢复         | A10                  | covered    | 保留原场景                     |
| S20：清单 A11                          | complete | 普通编辑与实际损坏                      | Scenario: 结构损坏         | A11                  | covered    | 保留原场景                     |
| S21：清单 A12                          | complete | 完整流程性能                            | Scenario: 性能对照         | A12                  | covered    | 保留原场景                     |
| S22：完成标准六项及验证层级说明        | complete | 三个零、契约、CLI、Eval、性能、分层结果 | 发布与验证；各 Scenario    | A1–A13               | covered    | 发布一致性单列 A13，不扩大功能 |
| S23：版本及 Changelog 段落             | complete | 统一 master 后续版本                    | 发布与验证                 | A13                  | covered    | 不记开发流水账                 |
| S24：日期基线和清单整理验证记录        | complete | 准备阶段证据                            | —                          | —                    | background | 不代表产品实现通过             |

# 非目标

- 不修改 website，不处理无关旧 change 的恢复错误。
- 不自动提交、推送、合并、建 PR 或清理工作区；分别按已有或后续明确授权交付。
- 不取消实际项目验证，不把判断摘要变成未执行检查的成功。
- 不重写归档历史，不通过直接改状态、删旧回归或降低断言完成流程。
- 不默认全量测试，不承诺尚无测量依据的固定毫秒数或百分比。

# 决定与约束

- 沿用 `D:/Project/Comet`、`052`，四份准备文档属于本任务；产物位置使用 Runtime 返回路径。
- 项目使用 SDK Native、中文产物、Batch 澄清。独立子 Agent 和公开 Runtime 回报工具可用；正式 Verifier 在 Build 后独立领取，当前调查不算实现验收。
- 没有新的阻塞澄清项。旧 active change 保留 Run、文件、有效决定与记录，不默认回 Shape 或全量重验；缺证据时只处理具体缺项。已归档记录不重写。
- 已有显式严格配置和检查输入保持用户选择，不静默改配置；不新增语言检测。若实现发现真实兼容冲突，再列出具体行为差异。
- Agent 不确定时先调查或补必要验证，只在缺业务决定、授权或外部信息时问用户，不用统一全量重跑替代判断。
- 本需求使用一个 Native Run：共享观察、证据更新和两条流程需共同演进，拆成 Supervisor 子 change 会增加协调成本。可并行只读调查和独立验证。
- 保留原流程必要的 Builder/Verifier 分工；普通编辑不得额外新增审查环节。
- 完整 Shape 按当前 Comet 协议确认前不进入产品 Build；已有明确决定不重复提问。

# 验收示例

1. 多语言、未知扩展名、纯文档及无项目编译器环境都能获得完整变化；检测不解析用户代码语法或调用编译器，实际验证由 Agent 另选。
2. Classic 已批准设计加空行、Native Build brief 补说明，Agent 判断契约未变后在原阶段和 Run 继续，不重新批准、需求修订或另起审查。
3. Verify 或已批准待归档编辑普通说明，无关检查不执行，验收和批准保留；影响文档检查时只补该检查，用户修改进入交付。
4. 模块 A 变化只补 Agent 判断受影响的工作，B 的有效检查不重跑；注释影响实际行为时按影响处理，不按语法预判。
5. 目标、验收或方案实质变化且授权未覆盖时，只请求相关决定；未决定不推进受影响部分，其他成果保留。
6. 十次保存下一次推进合并处理；重复 status/next、同字节重写不重复审查；无关编辑新增确认 0 次、未受影响检查执行 0 次、额外独立审查 Agent 0 个。
7. Agent 看过差异后又编辑文件，旧判断不覆盖新内容，只补处理新增变化，不重开流程。
8. 新失败、中断、超时或未执行不能被旧成功或摘要改成通过，其他有效记录保留。
9. 相同内容仅暂存、取消暂存、空提交不机械作废候选；明确 Git 依赖正常处理，CI、Review、交付绑定实际提交。
10. 中断后继续同一 Run，保留文件、工作和有效决定；已完成提交、归档或交付不重放，结果不明先核对。
11. 普通编辑不进入结构修复；状态实际缺失、路径替换、读取不完整时诊断具体问题并保留成果，不伪造完整输入或覆盖用户编辑。
12. 固定同机、fixture、采样比较完整推进、编辑续行、大目录和多 Action，热点重复工作及中位耗时下降，正常路径无可重复回退；同时记录命令、模型、确认、检查、Git、文件操作数。
13. 中英文 Skill、公开 CLI、生成 Runtime 一致；旧 active change、显式配置和归档历史按约定兼容；分层报告契约、生成 CLI、相关安装/Hook、真实模型 Eval、性能，并按 master 统一版本及英文发布说明。

# 验证要求

先复现当前行为并逐行为登记回归，再验证实现。语义和影响判断使用真实模型 Eval；Runtime 输入绑定、检查结果与恢复使用定向测试及生成 CLI。安装或 Hook 变化时补对应层级。只重跑失败或已失效用例；未执行明确报告，不以旧证据证明新实现。
