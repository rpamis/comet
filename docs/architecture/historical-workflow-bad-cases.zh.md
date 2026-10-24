# Native / Classic 历史 bad case 清单

> 本文是可复核的历史清单，不是本轮测试通过报告。可执行的逐 case 行为、证据、测试文件与测试名保存在 [`config/historical-workflow-regressions.json`](../../config/historical-workflow-regressions.json)。

## 审计范围与完整性

- 完整核对 **206** 个 issue：**171** 个与 Native / Classic 或其安装、路由、工作流投影相关，**35** 个在文末逐项说明范围外理由。未按 label、open/closed 或作者是否维护者过滤；PR 与依赖机器人报告不属于来源集合。
- 起点：`0.4.0-beta.1`，提交 `baade7b0fc8f0b97b3494552edcb58099624f214`，时间 `2026-07-07T03:08:59Z`。CHANGELOG 标注发布日期 `2026-07-06`，故从该日保守搜索，保留 #155 的 0.3.9 报告与 tag 之前的 #157，不伪改报告版本。
- 终点产品面：`0.5.0`，提交 `aeb1a6598034e28ce46b8422d4dbd8785e607bd7`，时间 `2026-10-22T23:21:20Z`。同时纳入截至 `2026-10-24` 的 0.5.0 报告，包括 #500–#505。回归映射基于 0.5.1 候选工作区，不能据此声称这些缺陷在已发布 0.5.0 中不存在。
- 来源：[rpamis/comet Issues](https://github.com/rpamis/comet/issues)。连接器单次最多返回 100 条且无 cursor，因此用不重叠日期分区，逐区检查升序和降序返回相同集合；每区少于上限，合计 206 个不同编号。逐个读取正文与可用评论，未用关闭状态代替修复证据。

| 创建日期分区             | 数量 | 穷尽检查                        |
| ------------------------ | ---: | ------------------------------- |
| `2026-07-06..2026-07-31` |   73 | asc/desc 编号集合一致，均 < 100 |
| `2026-08-01..2026-08-31` |   54 | asc/desc 编号集合一致，均 < 100 |
| `2026-09-01..2026-09-30` |   55 | asc/desc 编号集合一致，均 < 100 |
| `2026-10-01..2026-10-24` |   24 | asc/desc 编号集合一致，均 < 100 |

全部 206 篇正文已读取；124 个含评论的 issue 共读取 242 条评论，与抓取时 issue 元数据的评论总数一致。完整编号、查询原文与逐项范围外理由均在 JSON 的 `inventory` 中。原始反馈可能包含用户业务日志，仅存于本次证据目录，不随仓库提交。

## 判定与证据层级

- `covered`：找到直接约束该行为的具体测试文件和标题片段。只说明映射成立，不代表本次已执行，更不代表真实模型或所有 Agent 平台通过。
- `gap`：0.5.0 仍支持的行为缺乏精确回归。发布检查必须拒绝，不能静默忽略。
- `excluded`：该旧行为已从当前入口移除，或是从未交付的能力提议、纯咨询。必须有现行入口/代码/Skill 与原 issue 的依据；不把“没人用”“已关闭”“不是 SDK”作为排除理由。
- 0.5.0 仍支持 `--runtime compat`。兼容流程回归有效，但只证明标明的 compat 层；默认 SDK 问题需要 SDK 证据。非 Git 协调根的 Classic 文档归档按当前 CLI 默认使用 compat，#468 不要求新增非 Git SDK 能力。
- 安装、Skill 元数据与文案契约可以用确定性测试覆盖对应安全边界；它们不是模型遵循率或平台实机认证。#168、#175、#274 等报告缺少完整复现材料的限制在对应 case reason 保留。#487 已读取截图并按实际 Classic 工作区绑定行为归类，而非照搬错误 area label。
- 当前 checkout 为 shallow，发布历史有 squash / 断开祖先关系。找到的 CHANGELOG 修复记录在 JSON 中标为 release-note；未找到独立 commit 时明确记为 not-located。关闭 issue 不构成已修证明。

## 发布检查契约

1. `inventory.complete` 必须为 true，完整编号必须无重复，且逐个归入相关 issue 或明确范围外列表。
2. 每个 case ID 稳定且唯一；相关反馈的不同故障拆分为独立 case，不用一条笼统测试掩盖多个子问题。
3. covered case 必须指定 `tests[].file`、`namePattern`、`requiredNames`。运行器按文件合并选择，每个 requiredNames 至少对应一项实际 passed；空选择、skip 或仅文件存在不能通过。
4. excluded 必须有明确理由与当前证据；任一 gap 阻塞发布。
5. 后续新增/改写测试名时同步本清单。发布时执行本地清单，不联网重新抓取历史；新增反馈需经过同样的人工行为核对。

## 当前映射结果

共 232 个行为 case：195 covered、37 excluded、0 gap。此计数随精确回归补齐更新，执行结果由发布运行器另行记录。

### 尚缺精确回归

当前清单没有 gap；仍须以发布运行器的实际通过结果确认，不得将映射状态当作运行结果。

### 相关 issue 总索引

报告版本按用户原文保存；“未提供”不根据日期推断。每个 case 的完整测试选择与依据请按下列 ID 查阅 JSON。

#### [#155 fix: Error: Unknown skill: openspec-new-change](https://github.com/rpamis/comet/issues/155)

报告版本：0.3.9。领域：`classic`。

- `issue-155-openspec-entry` [covered]：OpenSpec 技能安装与状态图须与 Classic 入口一致，不能硬编码已不存在的上游技能。

#### [#157 feat: 工作区隔离和自动提交代码的建议](https://github.com/rpamis/comet/issues/157)

报告版本：未提供。领域：`classic`。

- `issue-157-current` [covered]：用户可明确选择在当前分支执行，不创建新branch/worktree
- `issue-157-approval` [covered]：交付副作用必须等待用户选择；不能把实现完成视为提交/推送授权

#### [#158 feat: 建议废弃根目录文件 .comet.yaml](https://github.com/rpamis/comet/issues/158)

报告版本：未提供。领域：`classic`。

- `issue-158-config` [covered]：项目配置与change状态分离，缺失根.comet.yaml不阻塞当前入口
- `issue-158-layout` [covered]：按明确配置定位Classic文档根而非强依赖仓库根openspec

#### [#159 fix: comet init 里面的 Symlink安装模式会覆盖删除用户原本的文件数据](https://github.com/rpamis/comet/issues/159)

报告版本：v0.4.0-beta.1。领域：`shared-installation-routing`。

- `issue-159-user-skills` [covered]：symlink 覆盖安装只替换托管 Comet 条目，保留目录中的用户 Skills 与外部 symlink 目标。

#### [#160 fix: 并行任务时comet 的门卫脚本（hook）找错了 change](https://github.com/rpamis/comet/issues/160)

报告版本：0.3.9。领域：`classic`。

- `issue-160-selected` [covered]：多change的计划创建和源码写入由所选change管理，不能按字母顺序选其他change阻断

#### [#166 feat: build阶段选择worktree时，希望能自动初始化codegraph](https://github.com/rpamis/comet/issues/166)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-166-worktree-index` [covered]：工作流在 worktree 中缺失可选 CodeGraph 时应给出实际诊断，不能将其误作执行失败。
- `issue-166-automatic-codegraph` [excluded]：进入 worktree 自动生成 CodeGraph 索引。

#### [#167 fix: NotSpecified: (Initialize...kflow=full):String) in powershell](https://github.com/rpamis/comet/issues/167)

报告版本：0.4.0-beta.2。领域：`classic`。

- `issue-167-stdout` [covered]：成功初始化写stdout而不是stderr，避免PowerShell NativeCommandError
- `issue-167-version` [covered]：根CLI公开-v/--version版本入口

#### [#168 fix: kimicode can not find classic runtime](https://github.com/rpamis/comet/issues/168)

报告版本：0.4.0-beta.2。领域：`classic`。

- `issue-168-runtime` [covered]：平台安装目录不同或链接安装时仍能使用包内Classic Runtime，不猜Claude路径

#### [#170 fix: comet dashboard自适应内容优化](https://github.com/rpamis/comet/issues/170)

报告版本：0.4.0-beta.3。领域：`classic`。

- `issue-170-archived-hint` [covered]：已归档 Classic change 的 Dashboard 不再提示继续 Verify。
  范围说明：正文第 1 项横向自适应及第 2 项 Markdown 预览滚动属于通用 Dashboard UI，本清单不将其冒充工作流状态回归；第 3 项归档后错误 Verify 提示已纳入。

#### [#171 fix: comet init symlink在已存在skill的目录下使用时报错Comet failed](https://github.com/rpamis/comet/issues/171)

报告版本：0.4.0-beta.3。领域：`shared-installation-routing`。

- `issue-171-existing-skill-root` [covered]：symlink 安装可在含用户技能的现有目录中安装托管项，不整体覆盖或失败。

#### [#172 feat: comet-ambient-resume](https://github.com/rpamis/comet/issues/172)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-172-ambient-resume` [covered]：中断后探针只读识别当前 workflow；显式拒绝恢复和纯问题不应推进任务。

#### [#173 feat: unified product catalogue](https://github.com/rpamis/comet/issues/173)

报告版本：未提供。领域：`classic`。

- `issue-173-artifact-layout` [covered]：Classic 的统一 docs 布局与 Native 根并存，重复初始化不误迁移或冲突。

#### [#174 fix: Comet v0.4.0-beta.3 版本 - 全局的 language: zh-CN 没有生效](https://github.com/rpamis/comet/issues/174)

报告版本：v0.4.0-beta.3。领域：`classic`。

- `issue-174-locale` [covered]：全局语言可作为change默认，项目覆盖优先，SDK仍执行产物语言约束

#### [#175 fix: comet init时选择openspec会多出来node moudle](https://github.com/rpamis/comet/issues/175)

报告版本：0.4.0-beat.3。领域：`classic`。

- `issue-175-openspec-install-output` [covered]：Classic OpenSpec 安装不得把依赖装进用户项目；保留原 package.json/lock 字节且 npm install 必须显式 global。

#### [#176 Question: comet dashboard在归档后不显示superpowers的产物](https://github.com/rpamis/comet/issues/176)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-176-archived-artifacts` [covered]：Dashboard 从归档后的路径指针展示 Superpowers 设计、计划与验收产物。

#### [#177 feat: 考虑集成gstack的qa测试功能](https://github.com/rpamis/comet/issues/177)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-177-gstack-qa` [excluded]：把 gstack QA 添加为可选归档阶段。

#### [#178 feat: 一键update、一键uninstall](https://github.com/rpamis/comet/issues/178)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-178-all-projects-update` [covered]：显式 all-projects 更新覆盖已登记项目，局部失败不会漏掉其他项目。
- `issue-178-all-projects-uninstall` [covered]：显式 all-projects 卸载所有登记项目，完成后移除登记；普通卸载仍只作用当前项目。
- `issue-178-canonical-project-index` [covered]：项目安装索引重复 init/update 按规范路径去重，后续更新保留最初登记时间。

#### [#185 fix: archive annotations should preserve EOF formatting](https://github.com/rpamis/comet/issues/185)

报告版本：@rpamis/comet@0.4.0-beta.3。领域：`classic`。

- `issue-185-eof` [covered]：归档注记不制造EOF空白错误，重试保持字节一致

#### [#186 feat: provide stable CLI wrappers for Comet state and archive commands](https://github.com/rpamis/comet/issues/186)

报告版本：0.4.0-beta.3。领域：`classic`。

- `issue-186-facade` [covered]：稳定state/guard/handoff/archive CLI包装器隔离内部脚本路径变化

#### [#187 feat: surface Comet-managed changes and recommended archive commands](https://github.com/rpamis/comet/issues/187)

报告版本：0.4.0-beta.3。领域：`classic`。

- `issue-187-classification` [covered]：混合普通OpenSpec与Comet change时分类并给正确归档建议

#### [#188 feat: classify dirty state for submodule-heavy monorepos](https://github.com/rpamis/comet/issues/188)

报告版本：0.4.0-beta.3。领域：`classic`。

- `issue-188-evidence` [covered]：子模块HEAD/dirty内容变化不能复用原检查证据
- `issue-188-classifier` [excluded]：专门的六分类submodule dirty UI及自动建议staging命令

#### [#189 feat: guide submodule commit then parent pointer commit workflows](https://github.com/rpamis/comet/issues/189)

报告版本：0.4.0-beta.3。领域：`classic`。

- `issue-189-automatic-submodule-commits` [excluded]：自动编排先子模块commit再父仓pointer commit并分类无关子模块
- `issue-189-scope` [covered]：父仓交付不得携带未批准文件，不能以用户自行提交代替验证

#### [#190 feat: support current-branch mode with no new branch or worktree](https://github.com/rpamis/comet/issues/190)

报告版本：未提供。领域：`classic`。

- `issue-190-current` [covered]：current隔离方式不创建新分支或worktree

#### [#192 fix: provide an auditable build path for projects without inferred commands](https://github.com/rpamis/comet/issues/192)

报告版本：@rpamis/comet@0.4.0-beta.3。领域：`classic`。

- `issue-192-checks` [covered]：非内建项目可执行明确argv登记有效检查；失败不得被自动推断成功覆盖

#### [#193 feat: codebuddy hook support](https://github.com/rpamis/comet/issues/193)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-193-codebuddy-hook` [covered]：CodeBuddy 项目 Hook 使用托管 Router，卸载保留用户配置。

#### [#196 fix: scope phase guard source writes to the selected active change](https://github.com/rpamis/comet/issues/196)

报告版本：0.4.0-beta.4 (current beta4 source)。领域：`classic`。

- `issue-196-ownership` [covered]：其他open/design/archive change不应全球阻断已选Build源码，歧义时先选择

#### [#199 fix: codex hook安装错误](https://github.com/rpamis/comet/issues/199)

报告版本：0.4.0-beta.4。领域：`shared-installation-routing`。

- `issue-199-codex-hook-location` [covered]：Codex Hook 使用平台可加载的规范文件，迁移只清理托管旧入口。

#### [#200 fix: 在trae的终端中使用cc，没有能够触发主动式压缩](https://github.com/rpamis/comet/issues/200)

报告版本：0.4.0-beta.4。领域：`shared-installation-routing`。

- `classic-non-sdk-forced-compaction` [excluded]：在非 SDK Agent 中主动强制触发压缩
- `classic-optional-compaction-fallback` [covered]：兼容流程压缩不可调用时不阻塞、不伪造 shell 压缩

#### [#202 fix: hook与skill描述冲突](https://github.com/rpamis/comet/issues/202)

报告版本：0.4.0-beta.4。领域：`classic`。

- `issue-202-plan-first-write` [covered]：先写合法标准plan再记录path的恢复操作不能被Hook自身阻断

#### [#205 Question: How to open and design faster](https://github.com/rpamis/comet/issues/205)

报告版本：未提供。领域：`shared-installation-routing`。

- `classic-open-design-general-latency-question` [excluded]：Open/Design 比直接对话慢，询问如何提速

#### [#206 Question: How can existing test cases be integrated into the validation phase](https://github.com/rpamis/comet/issues/206)

报告版本：未提供。领域：`shared-installation-routing`。

- `classic-existing-tests-as-verification-command` [covered]：把现有 QA/回归脚本接入当前 Verify 执行与证据
- `classic-predevelopment-qa-extra-phase-question` [excluded]：评论进一步询问在开发前插入 QA 产出用例的自定义阶段

#### [#207 Question: 没触发comet的sdd流程](https://github.com/rpamis/comet/issues/207)

报告版本：未提供。领域：`shared-installation-routing`。

- `classic-explicit-entry-keeps-openspec-and-sdk-chain` [covered]：显式 /comet 不应退化成只运行 Superpowers 而跳过 OpenSpec/Comet

#### [#208 Question: 升级到 Comet 0.40.0以后claude出现门禁错误提醒](https://github.com/rpamis/comet/issues/208)

报告版本：0.40.0（原标题如此）。领域：`shared-installation-routing`。

- `classic-claude-mjs-hook-must-run-with-node` [covered]：Claude PreToolUse 不得把 .mjs 按 bash 执行

#### [#209 feat: 对loop循环任务的支持](https://github.com/rpamis/comet/issues/209)

报告版本：未提供。领域：`native`。

- `issue-209-bounded-loop` [covered]：Native Verify/Repair 循环有明确停止和用户决策，不能无限重复执行。

#### [#212 feat: 支持在工作流中配置项目级自定义校验脚本](https://github.com/rpamis/comet/issues/212)

报告版本：未提供。领域：`shared-installation-routing`。

- `classic-custom-validation-script-and-result` [covered]：用户自定义禁用 API/项目约束脚本接入 Verify 并保留结果

#### [#213 feat: 为 comet-open 增加小型低风险任务的轻量路径推荐](https://github.com/rpamis/comet/issues/213)

报告版本：未提供。领域：`shared-installation-routing`。

- `classic-risk-aware-lightweight-routing` [covered]：低风险 bug/docs 走轻量入口，高风险新增能力或 API 变化不能静默降级
- `classic-workflow-intensity-dependent-recommendation` [excluded]：workflow_intensity 控制推荐倾向及额外确认 UI

#### [#214 feat: 增加 workflow_intensity 配置以降低小任务 token 消耗](https://github.com/rpamis/comet/issues/214)

报告版本：未提供。领域：`shared-installation-routing`。

- `classic-workflow-intensity-project-setting` [excluded]：读写/校验/展示 workflow_intensity light|standard|thorough

#### [#215 Question: Comet Skill 列表为什么不再显示阶段编号](https://github.com/rpamis/comet/issues/215)

报告版本：未提供。领域：`shared-installation-routing`。

- `classic-numeric-phase-labels-in-skill-list` [excluded]：Skill description 显示阶段 1 至 5 数字标签

#### [#217 feat: 为comet init、comet update增加--platform，支持选定平台直接初始化](https://github.com/rpamis/comet/issues/217)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-217-noninteractive-install` [covered]：指定平台、workflow 与非交互参数应准确安装，不猜测全部平台。

#### [#226 fix(native)：基线快照应支持 Git LFS 和大型仓库](https://github.com/rpamis/comet/issues/226)

报告版本：0.4.0-beta.8。领域：`native`。

- `native-226-lfs-baseline` [excluded]：新建 change 因展开 LFS payload 超过旧 5 MiB/64 MiB 基线限制而失败
- `native-226-large-baseline` [excluded]：普通大文件或大仓库阻止 Native new

#### [#231 fix: Comet Native's baseline snapshot manifest cap](https://github.com/rpamis/comet/issues/231)

报告版本：4.0.0-beta7。领域：`native`。

- `native-231-manifest-cap` [excluded]：7,823 文件长路径使 new 的 1 MB baseline manifest 溢出

#### [#232 fix: /comet-native does not make commits while working on change](https://github.com/rpamis/comet/issues/232)

报告版本：4.0.0-beta7。领域：`native`。

- `native-232-workspace-choice` [covered]：创建前绑定用户选择的 branch/worktree，并在正确工作区继续
- `native-232-compat-git-finish` [covered]：Compat 归档提交并按显式 keep/merge/push/PR 交付
- `native-232-sdk-git-delivery` [covered]：SDK Archive 完成后继续已授权提交/推送，不能把 Run completed 当 Git 完成

#### [#234 Question: 全局安装时不能选择both模式](https://github.com/rpamis/comet/issues/234)

报告版本：未提供。领域：`classic`。

- `issue-234-global-both` [covered]：全局初始化明确提供并安装 Native/Classic/Both。

#### [#235 fix: when the Comet recovery probe is enabled, the manual triggering of the Comet process is skipped.](https://github.com/rpamis/comet/issues/235)

报告版本：0.4.0-beta.8。领域：`shared-installation-routing`。

- `explicit-comet-invocation-precedes-resume-probe` [covered]：开启恢复探针后，显式 Comet Skill 不得被 no-active-change 探针结果吞掉

#### [#236 fix: 多个 Claude 实例运行 comet native 的时候 ， 会发生 scope hash change 的错误 （使用 git worktree 隔离），造成事实上不可并行多实例](https://github.com/rpamis/comet/issues/236)

报告版本：0.4.0。领域：`native`。

- `native-236-linked-isolation` [covered]：多个真实 linked worktree 的 Native 会话互不污染 scope/运行状态，手工业务编辑后仍可推进

#### [#237 Question: archive 后再更改 branch_status 到 handled 是否合理?](https://github.com/rpamis/comet/issues/237)

报告版本：0.4.0-beta.6。领域：`shared-installation-routing`。

- `classic-compat-archive-handled-before-single-commit` [covered]：兼容 Archive 不在最后一次提交之后才写 handled
- `classic-sdk-delivery-terminal-state-persistence` [covered]：默认 SDK local/push 交付完成后不改脏已提交归档 checkpoint，保持 Git HEAD/远端一致；冷重开保留完成状态，跨设备只恢复可移植基线并复核交付而不重放 Archive。

#### [#238 feat: native skills support a pause before archiving](https://github.com/rpamis/comet/issues/238)

报告版本：未提供。领域：`native`。

- `native-238-final-approval` [covered]：独立验收通过后保留最终用户决定，未接受不得进入 Archive
- `native-238-old-auto-archive-contract` [excluded]：旧 --expect-preflight 加 archive_confirmation=automatic 实现无人确认自动归档
- `native-238-policy-parser` [covered]：保留配置只接受 automatic|required，非法值 fail closed

#### [#239 feat: comet runtime performance optimization](https://github.com/rpamis/comet/issues/239)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-239-bounded-runtime` [covered]：只读命令与 Hook 的成本受明确工作量边界约束，避免反复读取整个历史。

#### [#240 feat: strengthen the verification evidence and archiving completion conditions of Comet Native](https://github.com/rpamis/comet/issues/240)

报告版本：未提供。领域：`native`。

- `native-240-independent-complete-verifier` [covered]：Builder 自报通过、同一执行自验或漏验收项不得产生 pass
- `native-240-failed-incomplete-checks` [covered]：失败、无法完整采样或失效检查不能被 report=pass 覆盖
- `native-240-archive-freshness` [covered]：Verify 后源文件或报告改变时 Archive 不得复用旧通过
- `native-240-real-lifecycle` [covered]：遗漏→修复→独立验收→Archive 的完整真实 Runtime 链路
- `native-240-retired-receipt-waiver` [excluded]：signed-v2 typed receipt、人工 waiver、强制独立 pre-review 旧交互

#### [#242 feat: add a completion Loop based on the acceptance gap to Comet Native](https://github.com/rpamis/comet/issues/242)

报告版本：未提供。领域：`native`。

- `native-242-repair-loop` [covered]：失败独立验收回 Build，新候选修复后再次独立验收，不自动跳过缺口
- `native-242-budget-progress` [covered]：交替或增大未满足集合不算进展，停滞/预算耗尽停止
- `native-242-gap-pagination` [covered]：Build 可分页看完整验收和上一轮缺口，不能把 checkpoint 当验收证据
- `native-242-retired-checkpoint` [excluded]：Agent 主动调用旧 checkpoint CLI 作为分批进度推进

#### [#244 fix: archive 后未更新 handoff_context 的归档路径](https://github.com/rpamis/comet/issues/244)

报告版本：0.4.0-beta.9。领域：`shared-installation-routing`。

- `classic-archive-rebases-handoff-paths` [covered]：归档后 handoff_context/design_doc 等指向真实归档目录

#### [#246 fix: doctor 应区分 worktree 预期缺失与项目级安装损坏](https://github.com/rpamis/comet/issues/246)

报告版本：0.4.0-beta.9。领域：`shared-installation-routing`。

- `issue-246-worktree-doctor` [covered]：secondary worktree 缺少被忽略的本地资产时，Doctor 区分可用 global 回退和真实损坏。

#### [#247 fix: Build guard 不应将后续阶段计划项视为未完成构建任务](https://github.com/rpamis/comet/issues/247)

报告版本：0.4.0-beta.9。领域：`shared-installation-routing`。

- `classic-plan-no-independent-checkbox-ledger` [excluded]：旧 plan 全文未勾选框一律当成 Build blocker
- `classic-canonical-task-authority-and-legacy-projection` [covered]：当前任务权威只按稳定 ID 完成，不按 plan 顺序/措辞误完成未来任务

#### [#254 fix(classic): build 阶段压缩恢复后跳过 plan 直接执行](https://github.com/rpamis/comet/issues/254)

报告版本：首次 0.4.0-beta.11；重新核验 0.4.0-beta.14 与 beta.15 集成代码。领域：`classic`。

- `classic-resume-requires-current-plan` [covered]：Build 压缩恢复后缺失/损坏 plan 不得直接编写源代码

#### [#256 fix: Configured Classic layout is docs, but OpenSpec initialization requested legacy](https://github.com/rpamis/comet/issues/256)

报告版本：0.4.0-beta.12。领域：`classic`。

- `classic-init-adopts-existing-legacy-root` [covered]：旧项目缺少 Classic layout 配置时 init 不得误选 docs 再请求 legacy

#### [#257 fix: When the project has both the "docs/openspec" and "openspec" directories at the same time, the "comet init" operation fails.](https://github.com/rpamis/comet/issues/257)

报告版本：0.4.0-beta.12。领域：`shared-installation-routing`。

- `classic-init-allows-two-openspec-roots` [covered]：同时存在 openspec/ 和 docs/openspec/ 时按配置初始化且保留两边文件

#### [#258 Question: 如何移除已安装的 Classic 工作流](https://github.com/rpamis/comet/issues/258)

报告版本：未提供。领域：`classic`。

- `issue-258-selective-uninstall` [covered]：选择卸载 Classic 时保留 Native 与共享组件，不把所有工程 Skills 当作 Comet 私有文件。

#### [#259 fix: comet update 未升级 Classic 依赖的 Superpowers](https://github.com/rpamis/comet/issues/259)

报告版本：@rpamis/comet@0.4.0-beta.12。领域：`classic`。

- `issue-259-dependency-update` [covered]：Classic 显式 self-update 更新外部依赖，普通 Comet 更新不暗中升级依赖。

#### [#260 [Bug] comet update 在 global scope 下不复制 comet-native skill 文件](https://github.com/rpamis/comet/issues/260)

报告版本：0.4.0-beta.12。领域：`native`。

- `issue-260-global-native-assets` [covered]：全局 Both 更新真实复制 Native Skills，不能成功计数却漏写 Native。

#### [#261 comet 0.4.0-beta.12 无法识别插件方式安装的 Superpowers，且 OpenSpec 后未切换到 Superpowers](https://github.com/rpamis/comet/issues/261)

报告版本：0.4.0-beta.12。领域：`shared-installation-routing`。

- `classic-detect-plugin-superpowers` [covered]：识别 Claude plugin 管理的 Superpowers 安装
- `classic-openspec-to-build-execution-handoff` [covered]：OpenSpec 完成后保留 Build 执行方法与 Superpowers 委派协议

#### [#262 fix: comet update 在 global scope 下不复制 comet-native skill 文件](https://github.com/rpamis/comet/issues/262)

报告版本：0.4.0-beta.12。领域：`native`。

- `issue-262-global-native-assets` [covered]：全局 Both 更新真实复制 Native Skills，不能成功计数却漏写 Native。

#### [#267 feat: comet dashboard change查询性能优化](https://github.com/rpamis/comet/issues/267)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-267-history-read-cost` [covered]：大量历史 change 的 Dashboard 查询使用分页和增量摘要，不每次全量加载内容。

#### [#268 Question: 如果已经在comet的desgin，不继续执行，暂停，能另开change去做紧急需求么？](https://github.com/rpamis/comet/issues/268)

报告版本：未提供。领域：`shared-installation-routing`。

- `classic-active-change-resume-selection` [covered]：多个活动 change 时不擅自选错，明确 change 时能恢复
- `classic-sdk-design-pause-other-change-resume-isolation` [covered]：暂停 SDK Design，创建并处理另一个紧急 change，再回原 Run 不重放/不污染状态

#### [#269 feat: trae and trae cn hook support](https://github.com/rpamis/comet/issues/269)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-269-trae-hook` [covered]：Trae 与 Trae CN 的项目/全局 Hook 路径正确，并路由到同一工作流守卫。

#### [#274 fix: Runtime 0.4.0-beta.14 incremental projection diff bug](https://github.com/rpamis/comet/issues/274)

报告版本：Runtime 0.4.0-beta.14。领域：`native`。

- `native-portable-incremental-projection-soundness` [covered]：仍支持的 portable Native 增量投影在不变/修改/新增/index-hidden 文件下正确
- `native-projection-baseline-reuse-boundaries` [covered]：基线复用不得绑定错误 Git 对象或漏掉读取期间发生的修改

#### [#275 fix: subagent failed to receive the assignment in Qoder.](https://github.com/rpamis/comet/issues/275)

报告版本：0.4.0-beta.14。领域：`shared-installation-routing`。

- `classic-no-guessed-subagent-capability-denial` [covered]：用户选择 subagent 后不得因猜测平台能力而强迫改 execution mode

#### [#276 Question: 关于子代理完成Task后自动git commit 的疑问](https://github.com/rpamis/comet/issues/276)

报告版本：未提供。领域：`shared-installation-routing`。

- `classic-no-mandatory-microtask-progress-commit` [covered]：子代理每个小任务完成不应机械创建碎片进度提交

#### [#277 fix: openspec/ 迁移到 docs/openspec/ 后 Classic 双根冲突硬性阻断且无法回退](https://github.com/rpamis/comet/issues/277)

报告版本：0.4.0-beta.14。领域：`classic`。

- `classic-root-coexistence-and-recovery` [covered]：迁移/双根共存时 root show/doctor 不应全局硬阻断，并提供只读迁移检查

#### [#278 fix: codex 在使用 $comet native 一直会提示： PreToolUse hook (blocked)](https://github.com/rpamis/comet/issues/278)

报告版本：0.4.0-beta.14。领域：`native`。

- `native-278-raw-patch-attribution` [covered]：Codex 原始 apply_patch 输入能提取每个目标路径
- `native-278-shape-brief-permission` [covered]：Shape 允许 brief 写入且禁止业务源码写入
- `native-278-packaged-raw-brief-allow` [covered]：原始 patch 修改 Shape brief，经安装 Router 全链路不会误报 blocked

#### [#279 feat: 希望提供一个文档生成，入现在最新的需求文档，设计文档之类的](https://github.com/rpamis/comet/issues/279)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-279-generate-current-documents` [excluded]：生成一套独立的最新需求/设计文档。

#### [#280 feat: 提供取消变更的功能](https://github.com/rpamis/comet/issues/280)

报告版本：未提供。领域：`native`。

- `issue-280-cancel-change` [covered]：官方取消入口结束未完成 Native Run，保留代码，清理当前选择；不得伪装为成功归档。

#### [#282 fix: Codex raw apply_patch input bypasses Native Hook phase protection](https://github.com/rpamis/comet/issues/282)

报告版本：未提供。领域：`native`。

- `native-282-raw-phase-enforcement` [covered]：raw patch Add/Update/Delete/unified diff 不绕过 Native phase guard；多目标和错误输入不静默放行

#### [#285 fix: native 的归档流程可以做简单一点嘛](https://github.com/rpamis/comet/issues/285)

报告版本：0.4.0-beat.16。领域：`native`。

- `native-285-retired-receipt-lock` [excluded]：receipt 子命令 Native lock identity changed 无限循环
- `native-285-archive-context-bounds` [covered]：归档不重复执行已通过检查；常规响应和任务上下文有界

#### [#286 fix: 全局初始化无效](https://github.com/rpamis/comet/issues/286)

报告版本：0.4.0 beta14。领域：`shared-installation-routing`。

- `issue-286-global-activation` [covered]：全局安装不自动向未配置项目写入全部平台；项目激活单独处理。

#### [#289 fix: AGENTS.md 链接到 CLAUDE.md，导致无法初始化！](https://github.com/rpamis/comet/issues/289)

报告版本：0.4.0-beta.16。领域：`shared-installation-routing`。

- `issue-289-instruction-alias` [covered]：AGENTS.md 指向项目内 CLAUDE.md 时可更新真实目标，不替换链接或写出项目。

#### [#290 feat: 支持手动触发 comet-review](https://github.com/rpamis/comet/issues/290)

报告版本：未提供。领域：`native`。

- `issue-290-manual-review` [covered]：手动独立审查可执行，但不冒充正式 Native Verifier 或改变候选批准。

#### [#292 Codex OpenSpec skills stay stale after self-update with OpenSpec 1.8](https://github.com/rpamis/comet/issues/292)

报告版本：0.4.0-beta.16。领域：`classic`。

- `issue-292-openspec-refresh` [covered]：Classic self-update 在配置的 artifact root 刷新实际 OpenSpec 平台技能。

#### [#295 feat: 希望支持自定义配置不拦截写入的文件目录](https://github.com/rpamis/comet/issues/295)

报告版本：未提供。领域：`shared-installation-routing`。

- `shared-hook-configured-local-allow-paths` [covered]：非编码阶段项目自定义 allow_paths 可写，且不能绕过工作流保留目录
- `shared-hook-configured-symlink-directory` [covered]：用户反馈的自定义规则目录经软链供多 Agent 使用

#### [#296 comet classic openspec -- --version 返回 Comet 自身版本，导致 /comet-open 的 OpenSpec 兼容性检查误判](https://github.com/rpamis/comet/issues/296)

报告版本：0.4.0-beta.17。领域：`classic`。

- `classic-openspec-version-passthrough` [covered]：comet classic openspec -- --version 不得被 Comet 全局 version 消费

#### [#299 feat(native): support parent changes with ordered and parallel child changes](https://github.com/rpamis/comet/issues/299)

报告版本：未提供。领域：`native`。

- `native-299-dag-contract` [covered]：确认完整父子 DAG、拒绝缺依赖/环/漂移，独立任务可并行且依赖任务只在前驱集成后ready
- `native-299-real-integration-parent-verify` [covered]：真实 Child 分支串行集成后才解锁依赖，父级最终验收覆盖组合候选
- `native-299-old-direct-parent-merge` [excluded]：初版直接合入父change分支、Child先Archive才done的精确机制

#### [#301 feat(dashboard): show worktree changes and Native parent-child hierarchy](https://github.com/rpamis/comet/issues/301)

报告版本：未提供。领域：`native-classic-shared`。

- `issue-301-worktree-discovery` [covered]：同仓库跨 worktree 的 Classic/Native change 可见，同名独立任务不合并，只有明确父子关系嵌套。

#### [#302 feat(workspace): prepare and route parallel changes before binding](https://github.com/rpamis/comet/issues/302)

报告版本：未提供。领域：`native`。

- `native-302-prepare-route` [covered]：Native 创建前准备/复用 linked worktree，恢复自动定位权威workspace，selection互不覆盖
- `native-302-explicit-parallel-no-reask` [covered]：明确并行时直接worktree，不再重复询问三选一

#### [#304 Bug: guard resolves fs.readdir relative to CWD instead of project root (handoffSourceFiles)](https://github.com/rpamis/comet/issues/304)

报告版本：0.4.0-beta.17。领域：`shared-installation-routing`。

- `classic-handoff-specs-resolve-from-project-root` [covered]：handoff/guard 从非项目 CWD 读取 specs 时使用明确 projectRoot

#### [#306 Question: 当前正在使用Spec模式，能否平滑迁移Native模式](https://github.com/rpamis/comet/issues/306)

报告版本：未提供。领域：`classic`。

- `issue-306-cross-workflow-migration` [excluded]：将进行中的 Classic change 平滑变成 Native change。

#### [#308 Question: 感觉十分耗费token，是否有优化方式](https://github.com/rpamis/comet/issues/308)

报告版本：未提供。领域：`native-classic-shared`。

- `issue-308-bounded-guidance` [covered]：Classic 的恢复与交接按需读取，不无条件重复输出全部历史；不承诺某模型任务的 token 数值。

#### [#313 Question: 边界设计问题-Archive 发现本机 Runtime overlay 在归档边界不可复用，因此 Comet 按规则把状态退回 Verify，要求对同一候选重新生成 Runtime receipts。](https://github.com/rpamis/comet/issues/313)

报告版本：未提供。领域：`shared-installation-routing`。

- `native-313-finish-preview-evidence` [covered]：--dry-run --finish 改变交付选择后，正式Archive不应因版本overlay失配重跑同候选检查

#### [#314 feat(native): make Supervisor parent changes integration-first and user-readable](https://github.com/rpamis/comet/issues/314)

报告版本：未提供。领域：`native`。

- `native-314-integration-target-fence` [covered]：Child verified/integrated分离；父级完成前真实target不变，最终一次交付
- `native-314-readable-plan` [covered]：children.v2 可读summary计划并兼容v1，不能重写已integrated历史
- `native-314-agent-identity-recovery` [covered]：多个child可独立claim；重复/迟到回报或unknown任务不得制造重复派发
- `native-314-parent-evidence` [covered]：父级不得以空检查和统一理由冒充整体集成验收；保留checks与真实commit来源
- `native-314-status-bounds` [covered]：Supervisor默认摘要不泄漏内部runId，历史按cursor分页
- `native-314-32-child-scale` [covered]：32个Child下默认输出大小与按名称查询性能
- `native-314-portable-safe-recovery` [covered]：丢失子worktree/Runtime或迁移时不能猜测完成，也不得破坏未提交child工作

#### [#317 feat(native): support repository-owned pull request finish providers](https://github.com/rpamis/comet/issues/317)

报告版本：未提供。领域：`native`。

- `native-317-provider-contract` [covered]：repository-command provider使用versioned JSON、独立检查GitHub base/head/headSHA，并保留默认github-fill
- `native-317-idempotent-existing-pr` [covered]：已创建PR后的重试必须观察复用而非再create
- `native-317-provider-failure-preserves` [covered]：provider验证失败或最终远端不可用时保留PR URL、worktree与恢复命令，不报完成

#### [#319 fix(native): make Archive compatible with portable verification reports and Git-ignored artifacts](https://github.com/rpamis/comet/issues/319)

报告版本：0.4.0-beta.18 至报告时 origin/master（静态核对）。领域：`native`。

- `native-319-portable-report-not-legacy` [covered]：有效portable verification.md不能触发legacy migration残留误报
- `native-319-gitignore-artifacts` [covered]：被.gitignore忽略的未跟踪归档文件不强加；已跟踪文件仍正确提交
- `native-319-ignore-source-delete-matrix` [covered]：Git info/exclude、global excludes与已跟踪删除在branch/linked-worktree中同样正确

#### [#323 feat(native): add Runtime-managed Verify/Archive → Shape recovery](https://github.com/rpamis/comet/issues/323)

报告版本：0.4.0-beta.17、0.4.0-beta.18。领域：`native`。

- `native-323-verify-to-shape` [covered]：用户要求改目标时在同一Run回Shape，清除旧候选/验收/审批，保留change与workspace
- `native-323-archive-cutoff-stale` [covered]：Archive应用Specs之前可改需求，之后不得用旧授权改写；stale身份必须拒绝

#### [#324 fix: Classic design deadlock after Spec Patch](https://github.com/rpamis/comet/issues/324)

报告版本：0.4.0-beta.18。领域：`native-classic-shared`。

- `issue-324-spec-patch-handoff` [covered]：Spec Patch 后可重建 Design handoff；状态 hash 已对齐也须真实改写文件；进入 Build 后仍可合法恢复。
- `issue-324-sdk-reapproval` [covered]：默认 SDK 中语义等价的需求修订必须重新提议并拒绝旧批准，不能靠手改 hash。

#### [#325 fix: comet init/update strips the Ambient Resume block in Classic-only projects](https://github.com/rpamis/comet/issues/325)

报告版本：0.4.0-beta.18 (also reproduced on 0.4.0-beta.16)。领域：`classic`。

- `issue-325-classic-only-ambient` [covered]：Classic-only init/update 保留 ambient_resume=true 的托管指令，显式false才移除。

#### [#334 feat: 能增加omp 支持吗](https://github.com/rpamis/comet/issues/334)

报告版本：未提供。领域：`native-classic-shared`。

- `issue-334-omp-hook` [covered]：Oh My Pi 原生项目/用户 Hook 安装可加载且不覆盖用户 Hook。

#### [#335 fix: classic workspace command always fails with "Classic command project context is unavailable"](https://github.com/rpamis/comet/issues/335)

报告版本：0.4.0-beta.18 (latest published)。领域：`classic`。

- `issue-335-workspace-context` [covered]：公开 Classic workspace prepare/resolve 自己建立项目上下文，不依赖调用者预先设置 AsyncLocalStorage。

#### [#337 Question: 不太清楚咋回事，遇到锁的问题](https://github.com/rpamis/comet/issues/337)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-337-lock-recovery` [covered]：新会话遇到锁时必须区分活跃/未知与可确认过期的持有者，不抢未知锁；探针不把新任务静默恢复成旧任务。

#### [#342 feat: 什么时候能支持dsh](https://github.com/rpamis/comet/issues/342)

报告版本：未提供。领域：`native-classic-shared`。

- `issue-342-dsh-support` [covered]：DSH 的原生 Skill 与 Hook 桥接安装到所选平台；不声称可通过不支持的通用 plugin 安装替代 init。

#### [#343 feat: 原生支持deepseek harness](https://github.com/rpamis/comet/issues/343)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-343-dsh-support` [covered]：DSH 的原生 Skill 与 Hook 桥接安装到所选平台；不声称可通过不支持的通用 plugin 安装替代 init。

#### [#345 feat: harden Build Step 1 plan-writing subagent contract to stop frequent degraded fallback](https://github.com/rpamis/comet/issues/345)

报告版本：未提供。领域：`classic`。

- `issue-345-planning-subagent` [excluded]：Classic Build Step1 默认派发写计划子代理并解析 PLAN_PATH。
- `issue-345-inline-plan` [covered]：替代路径仍生成实现计划，不因计划子代理不可用反复降级。

#### [#348 fix: comet-intent.mjs rejects stdin JSON carrying a UTF-8 BOM (Windows)](https://github.com/rpamis/comet/issues/348)

报告版本：0.4.0-beta.19 (also present in earlier releases)。领域：`shared-installation-routing`。

- `issue-348-bom-input` [covered]：Windows UTF-8 BOM 的 stdin/file JSON 被正确解析，内部 BOM 不被任意清除。

#### [#349 Question: 为什么最新版之后，归档选项变了](https://github.com/rpamis/comet/issues/349)

报告版本：未提供。领域：`native-classic-shared`。

- `issue-349-local-finish` [covered]：归档可选择仅本地保留，不自动推送、合并或创建PR。

#### [#350 疑似性能问题：长流程修复阶段上下文重复复用导致 Token 异常膨胀](https://github.com/rpamis/comet/issues/350)

报告版本：未知（宿主集成版本，待维护者确认）。领域：`shared-installation-routing`。

- `issue-350-bounded-output` [covered]：长流程默认输出摘要和有界历史，完整验收按需读取；不得据此声称外部宿主历史token归零。

#### [#351 fix(native): avoid legacy 256 KiB limit for Portable v4 child discovery](https://github.com/rpamis/comet/issues/351)

报告版本：未提供。领域：`native`。

- `issue-351-large-parent-state` [covered]：合法的大于256KiB父状态不能因旧总字节阈值阻止真实linked-worktree子任务创建。

#### [#354 Question: 从mac换到windows工作后遇到问题（即使更新到最新版本也无效）](https://github.com/rpamis/comet/issues/354)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-354-outdated-node` [excluded]：低于支持版本的Node不能实际完成新版Comet更新，随后提示resume-probe不存在。

#### [#360 fix(native): allow archive-ready changes to return to Shape after requirement changes](https://github.com/rpamis/comet/issues/360)

报告版本：@rpamis/comet@0.4.0-beta.19。领域：`native`。

- `issue-360-archive-revise` [covered]：archive-ready未执行Specs写入前可经受控入口返回Shape，并作废旧批准/候选。

#### [#361 fix: 在qwen code中，执行/comet命令无法调用/comet-open等其他子skill，只能直接手工执行/comet-open](https://github.com/rpamis/comet/issues/361)

报告版本：0.4.0-beta.19。领域：`shared-installation-routing`。

- `issue-361-model-invocation-policy` [covered]：各 Agent 平台通用 Skill frontmatter 应只对显式工具关闭模型调用，正常工作流技能保持可调用。

#### [#364 Question: 怎么让我定义的流程接入到现在的native中](https://github.com/rpamis/comet/issues/364)

报告版本：未提供。领域：`native`。

- `issue-364-custom-native` [covered]：通过公开Native应用扩展执行自定义Skill，保留原有批准、Verify与冷恢复身份。

#### [#371 fix: Native verification loop stops relayed no user decision request](https://github.com/rpamis/comet/issues/371)

报告版本：0.4.0-rc.1。领域：`native`。

- `issue-371-loop-stop-decision` [covered]：loop-stop必须给用户明确选择和可执行的当前恢复命令，不能继续自循环。

#### [#372 fix: stale children indexes from foreign worktree copies blocked all Native status](https://github.com/rpamis/comet/issues/372)

报告版本：0.4.0-rc.1。领域：`native-classic-shared`。

- `issue-372-isolated-status-error` [covered]：一个损坏/漂移worktree副本不能隐藏其余健康Native任务；推进仍严格校验。

#### [#373 feat: Classic/Native CLI 输出分层重构，同时服务 agent 与人类读者](https://github.com/rpamis/comet/issues/373)

报告版本：未提供。领域：`classic`。

- `issue-373-readable-output` [covered]：CLI同时保留人类可读摘要与机器恢复字段，JSON输出仍可解析。

#### [#374 Question: How to add behaiviour to diferent stages and artifacts of the comet workflow?](https://github.com/rpamis/comet/issues/374)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-374-platform-custom-rules` [excluded]：用户项目规范自定义每阶段行为。

#### [#377 Question: OpenSpec 1.11.0 接受 windsurf 参数但输出改为 .devin/（Devin Desktop），comet rc.2 仍等待 .windsurf/](https://github.com/rpamis/comet/issues/377)

报告版本：未提供。领域：`native-classic-shared`。

- `issue-377-devin-openspec` [covered]：OpenSpec把Windsurf输出迁到.devin时，Classic安装识别新目录并兼容旧输出。

#### [#379 fix: Windows NTFS 上原子写入误报 temporary file changed before commit](https://github.com/rpamis/comet/issues/379)

报告版本：0.4.0-rc.2。领域：`shared-installation-routing`。

- `issue-379-windows-atomic` [covered]：原子写入使用close后的身份快照，正常NTFS元数据finalization不误报篡改，真实替换仍拒绝。

#### [#384 Question: Can I skip create artifacts/specs when my task small?](https://github.com/rpamis/comet/issues/384)

报告版本：未提供。领域：`native`。

- `issue-384-skip-all-specs` [excluded]：小任务完全跳过Native正式产物。

#### [#385 fix(dashboard): Supervisor Child 已验收后仍显示“尚未创建”](https://github.com/rpamis/comet/issues/385)

报告版本：未提供。领域：`native`。

- `issue-385-child-display` [covered]：Supervisor child已验收/集成/归档不能显示尚未创建，SDK状态覆盖过期overlay。

#### [#388 Question: Classic 归档后使用 Native 修改同一 capability 如何避免规格漂移？](https://github.com/rpamis/comet/issues/388)

报告版本：未提供。领域：`classic`。

- `issue-388-cross-workflow-spec-sync` [excluded]：Classic归档后Native修改同capability时自动同步两套主Spec。

#### [#389 feat: 统一 Native Supervisor 子任务的验收、证据与检查执行保障](https://github.com/rpamis/comet/issues/389)

报告版本：0.4.0-rc.5。领域：`native`。

- `issue-389-child-acceptance` [covered]：Supervisor Child验收必须绑定确认计划与独立Verifier，不接受遗漏或矛盾的正式结论。
- `issue-389-child-evidence-retry` [covered]：Child验证失败后保留真实检查回执，日志变更不能复用，未知执行不另启重复任务。

#### [#390 fix: Native 跨 worktree 状态汇总误选旧副本，已归档任务仍显示 Build / active](https://github.com/rpamis/comet/issues/390)

报告版本：0.4.0-rc.5。领域：`native`。

- `issue-390-archive-supersedes-copy` [covered]：跨 worktree 发现同一身份任务的有效归档后使用归档而非旧 active 副本；保留重复来源并隔离损坏归档。

#### [#391 fix: Native 规格修订与验证恢复闭环不完整，工作流可能持续阻塞](https://github.com/rpamis/comet/issues/391)

报告版本：本报告未单独提供版本，待补充；不直接沿用上一份跨 worktree 状态汇总报告的版本结论。。领域：`native`。

- `issue-391-controlled-revision` [covered]：正式规格修订必须经受控Shape重确认，不能手改Runtime状态；当前待批准版本变化拒绝旧批准。
- `issue-391-reference-sync` [covered]：非语义改变的正式文档引用修订经受控 spec sync 审计，保留不受影响的通过项，拒绝语义变化与过期输入。
- `issue-391-lost-verifier` [covered]：失联或未知Verifier不能无限当作健康，也不能未经停止证据重新派发；恢复保留原候选证据。
- `issue-391-protocol-identity` [covered]：不支持的固定应用或损坏checkpoint在恢复入口被拒绝，不默默改写协议身份。
- `issue-391-scoped-verification` [covered]：兼容局部重验只保留已通过且仍有效的范围，真正未知或矛盾验收ID仍拒绝。

#### [#396 feat: 明确 Native Supervisor 等待外部输入时的宿主监控暂停与恢复规则](https://github.com/rpamis/comet/issues/396)

报告版本：未提供。领域：`native`。

- `issue-396-monitor-pause` [covered]：Supervisor等待外部输入时不建议宿主不断唤醒；新输入/用户决定后再恢复。

#### [#398 Question: 请问 Native 如何结合 /grill-with-docs 和 /tdd 呢，有必要还可以接入 /code-review](https://github.com/rpamis/comet/issues/398)

报告版本：未提供。领域：`native`。

- `issue-398-external-engineering-skills` [excluded]：把用户偏好的grill-with-docs/TDD接入Native。

#### [#400 Question: 如何配置rule或者约束](https://github.com/rpamis/comet/issues/400)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-400-platform-rules` [excluded]：Comet读取并强制平台所有用户自定义rules。

#### [#401 Question: Is the Comet skill required after comet init?](https://github.com/rpamis/comet/issues/401)

报告版本：未提供。领域：`classic`。

- `issue-401-init-distributes` [covered]：完成init已经分发所选Native/Classic Skill/Rule/Hook，不要求再装第二份skill。

#### [#402 feat: sync Dashboard workflow defaults and plugin data freshness](https://github.com/rpamis/comet/issues/402)

报告版本：未提供。领域：`classic`。

- `issue-402-dashboard-default` [covered]：Dashboard按项目配置选择Native/Classic默认视图，不固定Classic。
  范围说明：同一反馈中的个人记忆/项目知识页面 fresh revalidation 属于独立插件 UI，不在 Native/Classic 执行工作流范围；项目默认工作流选择已纳入。

#### [#407 fix: dsh 平台 Hook 全部被拒（exit 64）——adapter 平台白名单缺少 dsh](https://github.com/rpamis/comet/issues/407)

报告版本：0.4.1（master 1bb4750）。领域：`shared-installation-routing`。

- `issue-407-all-write-tools` [covered]：MultiEdit/NotebookEdit与真实文件目标进入守卫，所有安装Hook的平台包括DSH都有对应adapter。

#### [#410 fix(native): recover orphaned Verify check operations after Runtime termination](https://github.com/rpamis/comet/issues/410)

报告版本：Unknown (reported on 2026-09-14; diagnosed against current source)。领域：`native`。

- `issue-410-orphan-check` [covered]：确证已结束的Runtime检查拥有者可安全恢复；未知/活跃进程不能重复执行。

#### [#417 fix: Comet验收登记](https://github.com/rpamis/comet/issues/417)

报告版本：0.4.1。领域：`shared-installation-routing`。

- `issue-417-pending-shape-drift` [covered]：待确认Shape内容漂移时公开恢复同一Run的批准提议，拒绝旧版本，不能假确认Build。

#### [#418 bug：Comet 0.4.1 项目级资产在 Classic 运行时与兼容层之间存在不一致](https://github.com/rpamis/comet/issues/418)

报告版本：0.4.1。领域：`classic`。

- `issue-418-strategy-before-plan` [covered]：Classic可执行步骤定义与Skill一致，先确认执行策略再创建计划。
- `issue-418-instruction-dedup` [covered]：CLAUDE直接导入AGENTS时托管恢复协议不重复注入，平台未选择Claude时不写CLAUDE。
- `issue-418-bash-compat` [excluded]：同步旧Shell状态与YAML校验器。
- `issue-418-generated-origin` [excluded]：给安装的 Runtime bundle 新增来源与生成版本 banner。

#### [#419 fix: fail fast when npm-installed Skill assets are incomplete](https://github.com/rpamis/comet/issues/419)

报告版本：0.4.1。领域：`shared-installation-routing`。

- `issue-419-incomplete-assets` [covered]：源npm资产缺失时init/update在写目标前一次性失败，不报告安装成功或留下逐文件混乱。

#### [#420 fix(native): scoped verification fails with fatal 'unknown' execution-error when Verifier returns full acceptance superset](https://github.com/rpamis/comet/issues/420)

报告版本：0.4.1。领域：`native`。

- `issue-420-scoped-superset` [covered]：局部重验允许带已通过的已知项superset，真正未知ID和矛盾状态仍拒绝。

#### [#421 Question: comet流程太费token了,简直](https://github.com/rpamis/comet/issues/421)

报告版本：未提供。领域：`classic`。

- `issue-421-classic-context` [covered]：Classic full保留所需方法步骤，但恢复/交接不重复全历史输出；不从静态回归宣称某模型token绝对下降。

#### [#422 fix(native): recover Shape changes created before Git initialization when promoted to Supervisor](https://github.com/rpamis/comet/issues/422)

报告版本：0.4.1。领域：`native`。

- `issue-422-pregit-supervisor` [covered]：Git初始化前创建的Shape在成为Supervisor时可安全绑定新Git基线，脏基线和活跃子任务禁止重绑。

#### [#423 fix: docs: delivery --file 输入的三处隐式约束未成文（路径/schemaVersion/回执落点）＋ Windows 高负载 git 5s 超时假失败](https://github.com/rpamis/comet/issues/423)

报告版本：0.4.1。领域：`shared-installation-routing`。

- `issue-423-delivery-collision` [covered]：delivery --file不能撞Runtime自有记录或其别名，并明确拒绝而非产生矛盾schema错误。
- `issue-423-sealed-delivery` [covered]：归档后的正式目录保持封存，额外未跟踪文件给出具体名称，交付记录绑定change身份。
- `issue-423-git-timeout` [covered]：Git校验超时明确报timeout并支持有界只读重试，不误报归档提交不匹配。
- `issue-423-learning-receipt` [covered]：宣称learning submitted必须有对应观察回执，否则给warning而非伪造完成。

#### [#425 Question: 升级到0.4.1版本，流程之间的衔接非常费劲，经常需要浪费很长时间，comet流程上花费的时间比设计、开发、测试还长，以前特别是0.4.0版本以前好像没这个问题](https://github.com/rpamis/comet/issues/425)

报告版本：0.4.1。领域：`classic`。

- `issue-425-classic-continuity` [covered]：Classic交接和归档使用同一Run与精简恢复数据，不反复重启已完成阶段。

#### [#428 Question: Native 源文档完整覆盖在用户限定章节时的适用范围](https://github.com/rpamis/comet/issues/428)

报告版本：0.4.1。领域：`native`。

- `issue-428-source-scope` [covered]：来源完整覆盖以用户明确限定的章节及必要依赖为边界，范围外缺失不阻塞当前任务。

#### [#429 feat(native): 明确完整门禁执行阶段，支持 Build → Verify 复用 Runtime 检查回执](https://github.com/rpamis/comet/issues/429)

报告版本：0.4.1。领域：`native`。

- `issue-429-runtime-check-reuse` [covered]：Build→Verify复用仍匹配当前候选的Runtime检查回执，不把Builder文字当证据或重复一次性检查。

#### [#430 feat(native): 支持在一次交互中选择 Supervisor 协作方式并确认完整 Shape](https://github.com/rpamis/comet/issues/430)

报告版本：0.4.1。领域：`native`。

- `issue-430-joint-shape` [covered]：完整Supervisor Shape和协作方式可在同一绑定用户决定确认，不把单独模式选择等同批准完整方案。

#### [#431 feat(classic): 允许显式授权后将文件数超限作为非阻塞范围复核提示](https://github.com/rpamis/comet/issues/431)

报告版本：0.4.1。领域：`classic`。

- `issue-431-file-count-approval` [covered]：轻量preset仅文件数超阈值可复用明确授权，真实范围/风险变化仍要求复核。

#### [#432 Question: comet 流程浪费时间总结，占了总时间的~40%](https://github.com/rpamis/comet/issues/432)

报告版本：未提供。领域：`classic`。

- `issue-432-cli-work-budget` [covered]：Classic状态和检查读取成本有界，不能为小任务反复全量读取同一份状态。

#### [#433 feat: 明确 guard 与 Native continuation 的刷新边界，避免恢复协议重复注入](https://github.com/rpamis/comet/issues/433)

报告版本：0.4.1。领域：`native`。

- `issue-433-refresh-boundary` [covered]：守卫不重复注入完整上下文；当前continuation可复用，只有失效或状态变化才刷新。

#### [#434 feat(native): 支持低风险任务的显式授权策略，减少重复确认](https://github.com/rpamis/comet/issues/434)

报告版本：0.4.1。领域：`native`。

- `issue-434-standing-low-risk-approval` [excluded]：通用低风险任务的持久预先授权策略。

#### [#435 feat(native): 创建 change 时区分无关未提交改动与工作区冲突](https://github.com/rpamis/comet/issues/435)

报告版本：0.4.1。领域：`native`。

- `issue-435-infer-unrelated-dirty` [excluded]：Runtime自动推断当前未提交内容与新需求无关并继续。

#### [#436 fix(classic): comet-archive runtime check](https://github.com/rpamis/comet/issues/436)

报告版本：0.4.1。领域：`native-classic-shared`。

- `issue-436-large-check-input` [covered]：Classic检查可流式指纹大于64MiB的真实输入，不因任意文件字节上限阻止验收。

#### [#438 feat: 支持zcode hook](https://github.com/rpamis/comet/issues/438)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-438-zcode-hook` [covered]：ZCode Hook使用平台真实配置路径，保留无关配置并识别写入。

#### [#439 fix: Native Supervisor Shape 修订确认后把全部非集成子任务置为 ready，导致 advance-children 被自身校验拒绝 (0.4.1)](https://github.com/rpamis/comet/issues/439)

报告版本：0.4.1。领域：`native`。

- `issue-439-child-dependency` [covered]：Shape重确认后子任务ready/pending按依赖重新派生，已集成兄弟不被重放，损坏overlay可诊断。

#### [#442 Question: comet uninstall 在「卸载全部已配置工作流」时删除项目配置 .comet/config.yaml](https://github.com/rpamis/comet/issues/442)

报告版本：0.4.1。领域：`shared-installation-routing`。

- `issue-442-preserve-managed-config` [excluded]：卸载全部workflow时无条件保留Comet托管config.yaml。
- `issue-442-preserve-user-content` [covered]：卸载不得因托管配置清理而删除.comet未知用户内容。

#### [#448 fix: [Windows] native status/show 等只读命令因 detached daemon 未脱离调用方 Job/Console，在 IDE 终端挂起 100~300 秒](https://github.com/rpamis/comet/issues/448)

报告版本：0.4.2。领域：`native`。

- `issue-448-windows-daemon` [covered]：只读CLI不能等待daemon生命周期；自动启动失败/超时时有界回退本地执行。

#### [#449 Question: 我现在classic、native同时使用时，native模式能读到classic下的归档和spec么？](https://github.com/rpamis/comet/issues/449)

报告版本：未提供。领域：`classic`。

- `issue-449-automatic-spec-link` [excluded]：Native自动与Classic主Spec建立同步或改写关联。

#### [#451 feat(native): 支持自定义归档与合并提交说明，以遵循项目提交规范](https://github.com/rpamis/comet/issues/451)

报告版本：0.4.1。领域：`native`。

- `issue-451-custom-commit-message` [covered]：归档/合并提交说明支持Unicode和项目Hook，重试保留授权，不重写已完成提交。

#### [#453 feat(native): 补充验收计划的范围依据、变更边界与可选资源互斥](https://github.com/rpamis/comet/issues/453)

报告版本：0.4.1。领域：`native`。

- `issue-453-new-check-scheduler` [excluded]：额外验收范围依据及跨change独占资源互斥调度。

#### [#455 Question: native 模式阶段交接也不顺畅，希望规则更简明直白，让流程少折腾](https://github.com/rpamis/comet/issues/455)

报告版本：Classic 0.4.1；Native 0.4.2、0.4.3。领域：`native`。

- `issue-455-protocol-input-noise` [covered]：仓库内经验证的handoff输入JSON不让候选漂移，真实源码/变更payload仍绑定。
- `issue-455-repair-checks` [covered]：检查输入真的变化时拒绝旧证据，恢复经显式批准；缓存输出变化不让验收永远refresh。

#### [#456 fix(native): Builder 可在未完成 change 规定任务时交接进入 Verify，缺少完成度门禁](https://github.com/rpamis/comet/issues/456)

报告版本：0.4.3（@rpamis/comet，全局安装）。领域：`native`。

- `issue-456-complete-builder` [covered]：Builder交接须逐项完成自查并给证据；缺项不能冻结候选进入Verify。

#### [#457 fix(native): 写前守卫把 agent:/Main 等非文件目标误判为实现写入，verify/archive 阶段误作废候选](https://github.com/rpamis/comet/issues/457)

报告版本：0.4.3。领域：`native`。

- `issue-457-non-file-target` [covered]：agent:/proc:/等资源不是文件写入，不作废候选；混合请求的真实文件目标仍受守卫约束。

#### [#459 Question: comet task 记忆检索超时（120s）](https://github.com/rpamis/comet/issues/459)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-459-optional-context-timeout` [covered]：记忆检索超时取消且不阻塞新的工作流任务，不要求Agent反复查包或重试。

#### [#461 feat: 支持 Prime Agent 平台（prime-agent platform adapter）](https://github.com/rpamis/comet/issues/461)

报告版本：0.4.3。领域：`shared-installation-routing`。

- `issue-461-prime-install` [covered]：新增Prime Agent时保留项目语言、工作流配置与用户指令。

#### [#464 feat: 为 Codex 与 DSH 提供 Comet Plugin 分发方式](https://github.com/rpamis/comet/issues/464)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-464-plugin-distribution` [excluded]：通过Codex/DSH Plugin一次分发所有工作流。

#### [#466 fix(dsh): Hook 安装后完全不生效 —— cordis.patch.yml 条目被 loader 丢弃 / matcher Write|Edit 不匹配 / exit 2 被 PowerShell 吞成 1](https://github.com/rpamis/comet/issues/466)

报告版本：0.4.4。领域：`shared-installation-routing`。

- `issue-466-dsh-bridge` [covered]：DSH桥接是真正可加载的profile插入，lower-case工具匹配，PowerShell保留拒绝决定。

#### [#468 fix(classic): 非 Git 协调根＋独立子仓库布局下，归档被 delivery 分支校验阻塞](https://github.com/rpamis/comet/issues/468)

报告版本：0.4.4。领域：`classic`。

- `issue-468-nongit-coordinator` [covered]：非Git协调根默认compat文档归档，可包含独立子仓库但不冒认子仓库commit为根归档证据。

#### [#481 Question: 技能顺序做出调整是否会更好？](https://github.com/rpamis/comet/issues/481)

报告版本：未提供。领域：`shared-installation-routing`。

- `issue-481-reorder-op-sp` [excluded]：调换OpenSpec与Superpowers固定澄清顺序以降低token。

#### [#482 fix(resume-probe): 探针对归档 change 重新执行交付核验，单次 resume-probe 耗时 20s+ 导致调用超时](https://github.com/rpamis/comet/issues/482)

报告版本：0.4.5。领域：`shared-installation-routing`。

- `issue-482-probe-no-delivery-verify` [covered]：resume-probe 发现大量待交付归档时只读 delivery，不重做每个归档的 Git 证据核验，也不改归档状态。

#### [#483 feat(native): 提供取消未完成 change 与安全清理流程记录的官方入口](https://github.com/rpamis/comet/issues/483)

报告版本：0.4.5。领域：`native`。

- `issue-483-cancel-with-code` [covered]：SDK cancel退出active列表且保留实现，dry-run只预览；取消不是归档成功。

#### [#486 feat: native在verify阶段手动给代码增加注释，会增加回到build的次数](https://github.com/rpamis/comet/issues/486)

报告版本：未提供。领域：`native`。

- `issue-486-ordinary-comments` [covered]：普通注释编辑可经独立edit-review保留候选；语法、类型、工具指令或混合业务修改不能伪装注释。

#### [#487 fix: worktree隔离与分支绑定](https://github.com/rpamis/comet/issues/487)

报告版本：0.4.5。领域：`classic`。

- `issue-487-workspace-binding-screenshot` [covered]：同一 linked worktree 的 Classic 选择、分支重绑与 Hook 使用一致执行根，不能由 CLI 回到主工作树而误拒工作树写入。

#### [#488 fix: Dashboard 每次刷新对全部 worktree 做数万次 lstat/realpath，导致本机卡顿](https://github.com/rpamis/comet/issues/488)

报告版本：0.4.5（全局安装，@rpamis/comet）。领域：`native-classic-shared`。

- `issue-488-dashboard-path-budget` [covered]：Dashboard刷新跨worktree概览不逐项做数万次路径检查，详情只按需展开。

#### [#490 fix: [Native] 模板输入枚举契约分散在三处文档、checks[].result 完全未记载，且 builder checks 与 verifier 逐项的枚举集合互不一致（not-run vs blocked），建议集中文档 + 统一错误消息自解释](https://github.com/rpamis/comet/issues/490)

报告版本：0.4.5。领域：`native`。

- `issue-490-input-enums` [covered]：当前Runner模板可解析且列出合法枚举，非法值报错定位字段并列出允许值，不要求查源码猜词。

#### [#494 fix(native): Windows 上 archive/doctor 走 dist、next 走 bundle，brief 含自动链接时 Shape 指纹永不一致，无法归档](https://github.com/rpamis/comet/issues/494)

报告版本：0.4.5（npm 全局安装于 2026-10-11；node_modules/marked 解析为 18.1.0）。领域：`native`。

- `issue-494-autolink-parity` [covered]：相同brief/spec自动链接在bundle next与dist Doctor间具有一致Shape指纹，真实内容变化仍需重确认。

#### [#500 fix(native): Verifier 提交时按提交进程重算检查指纹，指纹绑定代理等环境变量，导致反复「Native 检查输入已变化」](https://github.com/rpamis/comet/issues/500)

报告版本：0.5.0。领域：`native`。

- `issue-500-cross-shell` [covered]：检查与Verifier提交换shell仍可验收，保留原执行环境并拒绝真实源码变化。

#### [#501 fix(native): 被忽略生成文件快照会匹配 node_modules，大型 JS 项目中固定为「不完整」；修复时需同时考虑 dev server 持续改写 .next](https://github.com/rpamis/comet/issues/501)

报告版本：0.5.0。领域：`native`。

- `issue-501-generated-inputs` [covered]：忽略目录快照不深入依赖目录，Next生成类型仍绑定；不完整输入拒绝复用，dev缓存不制造漂移。

#### [#502 Classic: project-config default for check timeout + gitignore-aware evidence surface (like Native) + ignore presets](https://github.com/rpamis/comet/issues/502)

报告版本：0.5.0。领域：`classic`。

- `issue-502-timeout-and-inputs` [covered]：Classic采用项目超时并允许CLI覆盖；仅排除输出，明确声明的ignored输入仍绑定。

#### [#503 fix(classic): hotfix 交付校验的单提交/父提交约束未成文且报错不可定位；Verify 把其他 change 的未跟踪文件记进交付输入](https://github.com/rpamis/comet/issues/503)

报告版本：0.5.0。领域：`classic`。

- `issue-503-delivery-scope` [covered]：Classic交付允许批准范围内线性多提交，不携带其他change草稿，并拒绝篡改交付输入。

#### [#504 fix(native): 最后一个验收项的确认快照会吞进其后的整个 ## 章节](https://github.com/rpamis/comet/issues/504)

报告版本：0.5.0。领域：`native`。

- `issue-504-acceptance-boundary` [covered]：最后验收项不吞后续独立Markdown章节；实际要求变化仍重新确认。

#### [#505 fix(native): 单个 change 的 Verifier 判 blocked 后，resolve-verifier-blocker 与 revise-implementation 必然失败，只能借 revise-requirements 回 Shape](https://github.com/rpamis/comet/issues/505)

报告版本：0.5.0。领域：`native`。

- `issue-505-blocked-recovery` [covered]：ordinary change Verifier blocked后的公布恢复命令可原样执行，旧proposal与重复outcome拒绝。

## 范围外 issue：逐项说明

这些编号仍属于已穷尽的 206 条来源集合。排除依据是反馈对象，不是关闭状态或标签；其中通用 Dashboard 外观、独立 Eval / Memory / Knowledge / CodeGraph 的问题不等于 Native / Classic 执行工作流故障。涉及真实 workflow 选择、Hook、状态投影或恢复的报告已纳入上表。

| Issue / 原标题                                                                                                                                                              | 排除理由                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [#162 Docs: optional quick run for the Comet Skill](https://github.com/rpamis/comet/issues/162)                                                                             | 第三方试用平台推广，不是 Native/Classic 产品行为反馈。                                                                      |
| [#180 Question: Pass^5测试问题](https://github.com/rpamis/comet/issues/180)                                                                                                 | 独立 Comet Eval / Creator 评估工具链问题；不属于 Native/Classic 执行工作流回归。                                            |
| [#181 feat: comet dashboard功能增强](https://github.com/rpamis/comet/issues/181)                                                                                            | 通用 Dashboard 布局、预览、项目选择或滚动问题；不涉及 Native/Classic 状态推进或工作流投影契约。                             |
| [#182 fix: 让 npm 安装版的 comet eval 能够定位共享验证环境](https://github.com/rpamis/comet/issues/182)                                                                     | 独立 Comet Eval / Creator 评估工具链问题；不属于 Native/Classic 执行工作流回归。                                            |
| [#183 fix: 在收集测试前解析生成清单中的 draftHash](https://github.com/rpamis/comet/issues/183)                                                                              | 独立 Comet Eval / Creator 评估工具链问题；不属于 Native/Classic 执行工作流回归。                                            |
| [#194 fix: Dashboard Markdown 预览无法正确展示表格和全屏预览](https://github.com/rpamis/comet/issues/194)                                                                   | 通用 Dashboard 布局、预览、项目选择或滚动问题；不涉及 Native/Classic 状态推进或工作流投影契约。                             |
| [#229 comet eval: local workflow eval fails on task-image and Creator contract drift](https://github.com/rpamis/comet/issues/229)                                           | 独立 Comet Eval / Creator 评估工具链问题；不属于 Native/Classic 执行工作流回归。                                            |
| [#245 feat: 补全非交互初始化与 doctor repair 的 CodeGraph 索引生命周期](https://github.com/rpamis/comet/issues/245)                                                         | 可选 CodeGraph 安装/索引/MCP 诊断，不属于 Native/Classic 运行工作流状态契约。                                               |
| [#249 feat(eval): support selectable evaluation agent CLIs](https://github.com/rpamis/comet/issues/249)                                                                     | 独立 Comet Eval / Creator 评估工具链问题；不属于 Native/Classic 执行工作流回归。                                            |
| [#250 feat(eval): support project-authored task templates in comet/eval.yaml](https://github.com/rpamis/comet/issues/250)                                                   | 独立 Comet Eval / Creator 评估工具链问题；不属于 Native/Classic 执行工作流回归。                                            |
| [#251 feat(eval): automatically generate task templates when none are defined](https://github.com/rpamis/comet/issues/251)                                                  | 独立 Comet Eval / Creator 评估工具链问题；不属于 Native/Classic 执行工作流回归。                                            |
| [#252 feat(eval): add a built-in Langfuse evaluation suite](https://github.com/rpamis/comet/issues/252)                                                                     | 独立 Comet Eval / Creator 评估工具链问题；不属于 Native/Classic 执行工作流回归。                                            |
| [#270 Question: 全局规范](https://github.com/rpamis/comet/issues/270)                                                                                                       | 独立个人记忆/项目知识的存储、索引或管理能力；不属于 Native/Classic 的工作流推进。共享 task 失败不阻塞工作流另由 #459 覆盖。 |
| [#298 feat(eval): make standalone Skill evaluation first-class and easy to configure](https://github.com/rpamis/comet/issues/298)                                           | 独立 Comet Eval / Creator 评估工具链问题；不属于 Native/Classic 执行工作流回归。                                            |
| [#322 feat(memory): add semantic self-evolving memory review for Classic and Native](https://github.com/rpamis/comet/issues/322)                                            | 独立个人记忆/项目知识的存储、索引或管理能力；不属于 Native/Classic 的工作流推进。共享 task 失败不阻塞工作流另由 #459 覆盖。 |
| [#336 fix: `comet eval` fails on Windows — skill copy includes `.comet` cache and hits MAX_PATH (WinError 3)](https://github.com/rpamis/comet/issues/336)                   | 独立 Comet Eval / Creator 评估工具链问题；不属于 Native/Classic 执行工作流回归。                                            |
| [#344 feat: add bounded project knowledge retrieval across Comet workflows](https://github.com/rpamis/comet/issues/344)                                                     | 独立个人记忆/项目知识的存储、索引或管理能力；不属于 Native/Classic 的工作流推进。共享 task 失败不阻塞工作流另由 #459 覆盖。 |
| [#346 欢迎参加Comet社区贡献 Welcome to contribute to the Comet community.](https://github.com/rpamis/comet/issues/346)                                                      | 社区公告、视频占位、版本计划或开发总计划，不是用户可复现的 Native/Classic 故障。                                            |
| [#352 feat: 明确区分 CodeGraph CLI、项目索引与 MCP 注册状态](https://github.com/rpamis/comet/issues/352)                                                                    | 可选 CodeGraph 安装/索引/MCP 诊断，不属于 Native/Classic 运行工作流状态契约。                                               |
| [#366 Question: vedio](https://github.com/rpamis/comet/issues/366)                                                                                                          | 社区公告、视频占位、版本计划或开发总计划，不是用户可复现的 Native/Classic 故障。                                            |
| [#367 经历20个beta版本的迭代，6轮rc，0.4.0正式版发布啦🎉](https://github.com/rpamis/comet/issues/367)                                                                       | 社区公告、视频占位、版本计划或开发总计划，不是用户可复现的 Native/Classic 故障。                                            |
| [#376 fix: Dashboard 项目知识显示为空](https://github.com/rpamis/comet/issues/376)                                                                                          | 独立个人记忆/项目知识的存储、索引或管理能力；不属于 Native/Classic 的工作流推进。共享 task 失败不阻塞工作流另由 #459 覆盖。 |
| [#387 bug: update tests leak ghost projects into the installation registry](https://github.com/rpamis/comet/issues/387)                                                     | 测试环境/安装注册表的幽灵项目清理，不属于 Native/Classic 工作流执行或产物语义。                                             |
| [#399 fix: Dashboard 项目选择器启动后选错项目，下拉滚动后选项显示重复](https://github.com/rpamis/comet/issues/399)                                                          | 通用 Dashboard 布局、预览、项目选择或滚动问题；不涉及 Native/Classic 状态推进或工作流投影契约。                             |
| [#403 fix: Dashboard Git 快照未提交文件列表对中文等非 ASCII 文件名显示八进制转义乱码](https://github.com/rpamis/comet/issues/403)                                           | 通用 Dashboard 布局、预览、项目选择或滚动问题；不涉及 Native/Classic 状态推进或工作流投影契约。                             |
| [#409 fix: doctor 漏检 Codex 项目级 CodeGraph MCP 配置并误报未注册](https://github.com/rpamis/comet/issues/409)                                                             | 可选 CodeGraph 安装/索引/MCP 诊断，不属于 Native/Classic 运行工作流状态契约。                                               |
| [#440 fix(memory): 暂停学习仍保存观察正文，恢复后同一观察被去重](https://github.com/rpamis/comet/issues/440)                                                                | 独立个人记忆/项目知识的存储、索引或管理能力；不属于 Native/Classic 的工作流推进。共享 task 失败不阻塞工作流另由 #459 覆盖。 |
| [#444 fix(project-knowledge): 语料索引在 >45 文档时因 FTS5 孤儿 rowid 冲突与硬编码 2 秒超时引发塌缩 (Error: constraint failed)](https://github.com/rpamis/comet/issues/444) | 独立个人记忆/项目知识的存储、索引或管理能力；不属于 Native/Classic 的工作流推进。共享 task 失败不阻塞工作流另由 #459 覆盖。 |
| [#452 fix: dashboard project memory does not support scrolling.](https://github.com/rpamis/comet/issues/452)                                                                | 通用 Dashboard 布局、预览、项目选择或滚动问题；不涉及 Native/Classic 状态推进或工作流投影契约。                             |
| [#467 fix: knowledge review 队列积压使 context 命令陷入全量 replay（attempts 1561 无退避、CLI 提交单条 800s，排干后 <1 分钟）](https://github.com/rpamis/comet/issues/467)  | 独立个人记忆/项目知识的存储、索引或管理能力；不属于 Native/Classic 的工作流推进。共享 task 失败不阻塞工作流另由 #459 覆盖。 |
| [#474 fix: 已删除项目残留为幽灵工作区，且 comet uninstall 无法摘除 installations.json 索引记录](https://github.com/rpamis/comet/issues/474)                                 | 测试环境/安装注册表的幽灵项目清理，不属于 Native/Classic 工作流执行或产物语义。                                             |
| [#479 fix: doctor 误报 opencode 的 CodeGraph MCP 未注册（JSONC 块注释剥离吃掉 glob ＋ 不识别 mcp.servers 形状）](https://github.com/rpamis/comet/issues/479)                | 可选 CodeGraph 安装/索引/MCP 诊断，不属于 Native/Classic 运行工作流状态契约。                                               |
| [#484 feat: 050 SDK Runtime and Comet Any、Comet Eval Dashboard](https://github.com/rpamis/comet/issues/484)                                                                | 社区公告、视频占位、版本计划或开发总计划，不是用户可复现的 Native/Classic 故障。                                            |
| [#489 请问 050 分支 / 0.5.0 的正式发版计划？](https://github.com/rpamis/comet/issues/489)                                                                                   | 社区公告、视频占位、版本计划或开发总计划，不是用户可复现的 Native/Classic 故障。                                            |
| [#499 Question: dashboard页面没有滚动条，缩放到页面很小的情况才能看到全部内容？](https://github.com/rpamis/comet/issues/499)                                                | 通用 Dashboard 布局、预览、项目选择或滚动问题；不涉及 Native/Classic 状态推进或工作流投影契约。                             |

## 本次检查记录

- 已执行：来源分区穷尽核对、206 个编号闭合校验、逐 case 测试文件/标题片段存在性检查、JavaScript Unicode 正则合法性检查、这两个文件的格式检查。
- Vitest 实际 collection 已展开校验全部 covered 标题选择（包括 it.each）；当前清单的 requiredNames 无缺失。collection 只证明可收集与可选择，仍不是执行通过。
- 历史清单加载器契约测试：`node node_modules/vitest/vitest.mjs run test/scripts/historical-regressions.test.ts --reporter=dot`，1 个文件、6 项通过；只验证清单拒绝/合并规则，不代表全部历史回归已通过。
- 未在此清单审计中执行：全量测试、构建、真实模型 Eval 或真实 Agent 平台认证。定向回归及发布运行器结果由相应执行报告记录，不能从本文件推定。
