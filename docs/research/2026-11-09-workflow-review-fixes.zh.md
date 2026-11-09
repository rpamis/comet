# Native / Classic 简化后的 Review 修复与测试退休

来源：`report:2026-11-09-latest-commit-review-fixes`。用户要求修复最近提交的全部 Review 问题，并检查已撤下技术机制对应的单元测试。比较基线为 `6b4c26f34b5969912edc04591e513ef4ad2b7d57`，真实旧 Classic Run 来自其父提交 `5426c4cbb3569e749ce8050888517f93b8437f5d`。

授权范围沿用本次对话：移除 Native / Classic 内容证明、hash / 文件指纹及自动内容失效；保留共享 SDK 请求身份、原执行记录、用户决定、安装摘要和 Git 标识。不恢复删除的 API，也不把仍存在的审批、执行与恢复行为作为过时测试删除。

## Classic 旧 Verify 续行

旧 Runtime 成功执行 Verify 后，Action 的 `output.contentHash` 是历史日志摘要。新业务续行提交同一 Action 的证据时使用 `Action.inputHash` 标识原请求。归档只接受前者，导致真正成功的旧执行在用户选择归档时被拒绝。

修复仅允许证据沿用这两个原记录中的标识之一；仍检查原引用、原 Action / claim、持久化执行收据、当前检查轮次、最新失败和用户决定。没有重新扫描文件或计算日志摘要。

新增 `classic-sdk-legacy-check-continuation.test.ts` 通过源码与生成 CLI，在原 SDK claim / outcome 边界提供历史收据格式，执行真实命令并断言副作用只发生一次。反例覆盖错误引用、错误请求标识、原收据缺失、最新失败和未决用户决定。登记 ID：`classic-legacy-verify-receipt-continuation`。

同一测试在修改前复现 `Classic Verify execution does not belong to the accepted SDK evidence request`，修改后源码通过。另在临时项目中使用真实父提交 Runtime 生成旧 Run，再切换当前源码：`state next --continue`、`propose-archive`、`decide-archive --choice local` 成功，保留同一 Run 和原成功执行。源码测试、bundle 测试与真实旧 Run 的结果分别记录，不互相替代。

## 测试退休和保留覆盖

补充定向测试还复现了五项实际阻塞，均保留同一输入的失败记录：

- 已批准升级的 hotfix / tweak Run 进入 full Build 时，错误要求不存在的 `full.open.confirm`。现在认可原 Run 的升级批准，仍要求原成功 handoff、设计批准和计划验收。四个源码 / bundle 升级组合保留“未批准不执行”的前置反例。案例：`classic-approved-preset-upgrade-continuation`。
- SDK 已提交真实检查结果后，辅助 `check-receipts` 丢失或冷恢复会阻塞续行。现在仅在 SDK 持久化记录中的 workflow、input、完整原 Action / claim / outcome 和结果都匹配时沿用原结果；未提交、伪造或冲突结果仍拒绝。两项原恢复用例、五项伪造反例、断线原 claim 恢复和源码 / bundle Verify 续行分别执行。案例：`classic-committed-check-without-auxiliary-receipt`。
- full 明确重新验收后，交付仍读取已经不再生成的 `.comet/archive-documents.json`，源码和 bundle 均报 ENOENT。撤下该重复正文检查，继续核对原 Archive Action、原文档路径、真实 Git 提交、逐提交路径范围、用户批准与归档标记。案例：`classic-reverified-full-delivery-without-document-proof`。
- 组合应用进入 Archive 后，固定命令检查误用当前 `phase` 选择检查种类。现在按原 Build / Verify Action 定位固定命令；八个 full / hotfix / tweak、不同扩展产物和中断恢复场景继续保留扩展验收及 Git 交付。案例：`classic-composed-archive-fixed-command-scope`。该红色记录是在迁移到当前收据格式、完成前述四项修复后取得；相关 scope 源码与基线一致，不将这次运行冒充原基线的整套测试结果。
- Native 已退出检查的恢复被无条件 `running` 拒绝挡住。只统一旧测试的错误文案后，原 Native 源码在 owner 和子进程树均已停止时仍于原案例第 214 行失败。修复仅在 `checking/runtime` 且进程都确认停止时保存原中断记录，清除停止后的 process 登记；同计划先返回原中断结果，显式 retry 才执行。存活、未知、外部 Verifier、一次性检查和三次预算反例继续保留。案例：`native-proven-orphan-check-explicit-retry`。

整文件退休十个测试文件：Native 的 check-input-fingerprint、check-scope、candidate-performance、portable-checks-digest、runner-input-artifacts、source-comments；Classic 的 check-snapshot、check-performance、check-hash-batching、handoff-source。其断言依赖已删除的内容证明 API、语言识别或清单扫描；完整旧正文保存在本记录配套的 `tests.json` 中。

混合测试按行为迁移：

| 范围                        | 撤下的断言                                   | 继续执行的有效行为                                                                                                                           |
| --------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Shape                | 文件变化自动撤销批准、语义指纹、豁免关键词   | 显式修订、原 canonical Spec 保护、state version、SDK 所有权、真实 0.5.0 Run 原批准和 Builder claim、历史字段解析                             |
| Native 检查                 | 输入快照和候选内容摘要、编辑自动拒绝最终结果 | Agent 指定复用、原检查来源、真实失败、一次性检查防重放、候选修复、跨会话 / 路径归属                                                          |
| Native Supervisor / Archive | 材料内容摘要证明                             | 原任务、检查、依赖、真实 Git 集成、缺失归档材料恢复、dry run、备份和路径限制、只读 index / status、二进制材料原样恢复                        |
| Native Spec sync            | 内容摘要、内容寻址审计                       | JSON / 字段 / 大小校验，正文链接替换，代码与引用示例保护，actor 审计，过期请求和任意语义替换拒绝，失败回滚、未知提交和已提交后失败的事实保留 |
| Classic 检查                | 清单、输入 / 环境内容证明、内容变化失效      | 原 Action 预启动失败重试、未知执行不重放、真实失败和超时、显式复用、跨 Run 隔离、冷恢复、原检查轮次                                          |
| Classic 任务与恢复          | task 内容 revision 和自动 checkpoint 失效    | 任务 ID、重复 / malformed 输入、当前任务完成、显式协调和计划同步、原批准和交付恢复                                                           |
| Classic 旧归档              | 内容清单摘要                                 | 原成功 Archive 执行、归档路径、原 full 设计 / 计划输出、显式 Spec 输出、迁移 marker、错误执行拒绝                                            |
| Dashboard                   | 旧 contract hash 夹具字段                    | 原 SDK 权威状态、未创建子任务展示、路径 / 工作区 / 归档观测                                                                                  |

`native-spec-sync-recovery` 的审计现在使用 UUID 路径；失败尝试的审计记录仍保留，未提交的正文回滚。先前已有的审计不被失败尝试覆盖。此处只迁移到当前契约，不恢复内容寻址。

## 历史登记迁移

冻结的历史清单和已有迁移证据不改写。追加 21 项 `testMigration` 或 `supersededBy`，保留原 ID、来源、行为和完整断言正文。其中七项为：

- `native-docker-syntax-scope`：退休环境摘要推断，改执行 Agent 判断、真实失败和生成 Runtime 续行。
- `classic-compat-proven-prelaunch-retry`：同名安全测试改用真实未启动轨迹，仍只执行一次。
- `native-unapproved-shape-replace-target`：取消文件编辑自动撤销，保留显式目标修订和旧请求拒绝。
- `native-unapproved-shape-withdraw-last-target`：取消 Spec 豁免语句，保留自由格式 Shape 与 canonical Spec 保护。
- `issue-188-evidence`：退休子模块内容指纹，不宣称已验证被移除的子模块摘要策略；保留工作区归属、实际检查和 Git 标识。
- `native-240-failed-incomplete-checks`：退休输入枚举 / 快照策略，继续验证真实失败、归档阻塞和原执行来源。
- `issue-391-reference-sync`：保留有效链接同步行为，仅迁移无内容摘要的审计。

其余记录覆盖 Native / Classic 原命令续行、错误 Verifier 原 claim、Archive 只读观测、Archive 显式实现修复、分支接管与修复组合、用户既有实现交接、Classic 复用读取开销、Portable 显式中断重试、文档写入策略、原进程退出核对、Classic 既有测试作为验收命令、自定义验收脚本和结果、组合应用的权威需求来源，以及 Native Build 检查复用。组合应用夹具保留用户明确配置的扩展验收与 SDK 产物校验，只迁移默认 Classic 证据身份和撤下的重复正文证明。Native Build 检查复用明确设置 `reusable`，由 Agent 选择原成功执行；后续真实失败仍不得复用。

有效执行功能使用 `tests-moved` 保留原验收要求：错误 Verifier claim、显式中断重试、孤立原进程核对与用户既有实现交接。涉及内容证明退休的记录使用 `feature-removed`，不把原策略的附加验收改写为通过。`native-240-failed-incomplete-checks` 继续包含原 `native-verifier-protocol` 的“检查失败或验收项失败时拒绝 pass”选择器。Dashboard 和 A4 用例本身只调整夹具字段 / 删除未使用局部绑定，断言未缩窄；已授权续行案例中的另一个旧自动漂移测试改为绑定原批准和版本的显式修订。

配套 `registry.json` 是迁移前登记，`tests.json` 保存完整旧文件，`mapping.json` 逐案例对应新选择器，`patch.patch` 保存测试差异，`inventory.json` 列出被改写或退休的原声明。`retired-or-renamed` 包含改名重写，不能当作实际删除数量。这些审计文件的摘要沿用仓库既有维护协议，不属于产品 Runtime 内容证明。

## 验证边界

登记校验器另有一项维护修复：基线清单已超过 Node 子进程默认 1 MiB 输出缓冲，正式 `check:badcase-registration` 报 `spawnSync git ENOBUFS`。新增真实临时 Git 仓库中的 2 MiB 清单回归，修改前失败、提高内部读取缓冲后通过；缺失 / 无效基线的原反例保留。不修改产品配置或恢复文件扫描预算。案例：`badcase-large-baseline-registry`。

定向执行相关源码测试、生成 CLI 测试、原业务续行契约、历史案例选择器和构建新鲜度检查。最终实际结果在完成报告中列出；失败和未执行不会记为通过。

本轮最终记录见配套 `validation.json`：七项新增登记共 36 个不同测试断言全部通过，21 项迁移涉及的 49 个不同精确选择器全部有同文件、同完整名称的实际通过记录。两组存在重叠，不能相加当作总数。初轮失败及夹具迁移中的失败报告保留，最终结果逐断言核对，不将整轮红色报告记为通过。

已完成 Classic / Native / Entry Runtime 构建，`check:generated`、`tsc --noEmit`、源码 ESLint，以及对 `6b4c26f3` 和本地修复声明的登记检查通过。源码 ESLint 有九项既有警告。完整 `pnpm lint` 仍被工作区既有 `.ruff_cache` 顶层目录阻塞，未删除该无关缓存来取得绿色；额外扩大到受影响测试文件的 ESLint 发现登记测试中四个基线已有的显式 `any` 和三个既有未使用绑定警告，保留原状并记录，未将该检查写成通过。

不启动全量测试或 Eval；用户未授权真实模型 Eval。本轮没有改动 npm 安装或真实 Agent 平台 Hook，相关安装 / 平台验收未执行。保留当前 `0.5.3`：它比 master 的 `0.5.2` 高一个版本；本次修复的是未发布开发提交中新引入的阻塞，测试迁移也不是用户可运行的新能力，按仓库发布视角规则不新增 Changelog 条目。

## 合入后登记协调

本批未提交现场与 Native v4 改动先后合入 053。`native-docker-syntax-scope` 已有审核过的退役迁移，继续保留它的完整登记、授权、证据和替代测试；本批同一机制的候选迁移原文保存在配套审计文件中，不覆盖已提交记录。它对应的旧 Portable 正常续行与真实失败测试继续由核心回归执行。原 21 个迁移候选中，这一项复用已有迁移，其余保留本批新增登记。`badcase-large-baseline-registry` 保留已提交行为和单元测试边界，仅追加本批来源，避免将同一维护修复记作两种不一致定义。
