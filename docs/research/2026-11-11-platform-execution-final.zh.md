# Native / Classic 平台执行精简交付记录

来源：`report:2026-11-10-agent-platform-execution`、`report:2026-11-10-comet-context-size`。比较基线：`630ce380787f446e803f94b4b90cbbdbf8663364`。分支 `053`，当前版本 `0.5.3`；核对远端 master 为 `0.5.2`，继续使用现有 0.5.3 条目。本文汇总最终实现；早期调查中的中间方案和失败结果保留在原记录中，不代表当前行为。

## 执行责任

普通开发、测试和命令使用 Agent 平台工具。Native / Classic 已删除对应受管执行器、普通命令监管进程、PID 与进程创建身份绑定、停止握手和回执、历史进程恢复、内容快照及仅服务这些机制的锁和兼容实现。检查命令只给出平台执行与报告指引，不另行启动普通检查进程。

Comet 继续维护原 Run、用户批准、任务记录和勾选、用户选择的执行方式、TDD / Review 设置、候选、完整验收与实际交付。检查报告不能代替用户批准，缺失报告不能作为通过。用户要求独立验收时，领取会话必须与 Builder 不同。

同一工作区和 Run 由主 Agent 顺序写入；并行 Child 只改各自 worktree，把结果交主 Agent 按原 Action、真实子会话和领取身份提交。已删除 Native / Classic 的项目锁、状态与检查点投影锁、工作区／应用范围锁、归属分区锁、锁 token 与锁恢复。项目配置事务也不再保存或探测写入者 PID。旧锁和 PID 元数据不控制新流程，原文件保留。

仍保留实际文件发布事务、Native Archive / transition 恢复和 SDK Portable 业务检查点。它们处理实际中断写入，保留原批准、任务和验收。已停用的内容证明入口后面的整套实现及专属 helper 也物理删除，没有继续携带旧锁和内容证明框架。

通用 SDK 的默认原子提交保护仍用于 Creator / standalone 应用：Creator 自己等待异步 Eval 时，公开 cancel 可以同时修改同一 Run。确定性 Promise 测试证明，把这条实际并发路线改成无锁会使迟到结果覆盖已取消状态；没有为此启动 Eval。普通 Native / Classic 及其固定应用使用调用方保证顺序提交的存储模式，不经过该锁。全局安装与共享插件存储也不受 worktree 隔离，继续按其真实共享范围处理。

CLI 自己启动的 Eval、下载、Git / rg 和安装能力仍承担其实际子进程清理责任。`bin/comet-daemon-router.js` 的 Windows 路由仍调用 `windows-process-broker`，因此该模块有真实调用者，保留；早期责任调查只搜索源码目录而将其列为闲置，已更正。没有启动 Eval，也没有用另一套监管、指纹、缓存或恢复框架替代普通执行器。

## 升级与明确恢复

已知内置版本和受当前适配契约支持的固定应用 Run，在现有读取与提交边界转换业务数据，保留 Run、批准、Action 输入、领取和已接受结果；不重放已完成命令，不补造检查通过或停止证明。新 Run 只构造当前业务流程。实际 0.5.2 Run、固定 Native / Classic 应用和旧检查前沿分别保留了发布版本材料和可执行回归。

普通路径解析和查询只使用当前工作区，不自动搜索其他 worktree、不迁移旧目录、不创建旧布局 fence。旧目录业务数据通过明确 Doctor 导入 / 恢复入口处理，源数据保留。Classic 旧项目和 Git common 目录中的交付收据按原身份、批准及已封存提交校验后导入；重复导入不重复产生交付动作。

兼容限制：旧检查工作进程不能重新连接；进程是否仍运行、未知普通命令的外部副作用由 Agent 使用平台工具核对。损坏或未知的流程定义、冲突业务记录和未完成 Archive 事务仍须明确处理，不能为了无提示升级而伪造成功。旧 Portable 检查点保留其实际编码的 claim 契约，不承诺恢复编码前的会话秘密。

0.5.2 SDK 的 `nativeExtensionArtifactHashes` 内容证明 API 已撤下，Changelog 已列为移除项。直接导入该 API 或自行嵌入旧执行器的自定义应用需要调整为平台检查报告；自动业务数据适配不等于解释并改写任意自定义模块源码。不会为此保留整套旧内容证明和执行代码。

旧 overlay 的错误目标绑定和丢失 sidecar 不再通过读取 status 自动改写或重建；缺少可信 Child 证据时保留现场并使用明确恢复入口。普通入口不自动寻找其他 worktree 中的 Run，也不隐式搬迁旧目录。Classic 原有脏文件默认不加入交付；Agent 可在原 Archive 提案中明确选择属于当前 change 的交付路径，这份选择使用同一次用户批准。

CLI 创建的 Git 工作区继续有真实收尾责任。Native / Compat Supervisor 在实际写入前检查工作区、分支和目标，保留已批准的集成结果；归档后清理自己的 Child／integration 工作区和分支。实际部分清理中断后，公开 Archive 沿原回执补剩余收尾，不重复写 Spec；该修复包含 source 故障注入与生成 bundle 恢复验证。

## 工具输出与 Skill

中英文 Skill 已同步，用户确认的中文平台执行说明为依据。保留 Open 批准、范围变更和升级 Design 的用户决定、任务勾选及 Verify / Archive 要求。SessionStart 改为完整 Rule 的短入口，压缩后缺少规则时重新读取；Classic 普通 dispatch 返回当前动作所需内容，完整 inspect / details 仍可用。

隔离的 0.5.2 Classic dispatch 对照从 208,201 字节降到 15,249 字节，约减少 93%；这是命令输出字节测量。用户只提供 0.5.2，缺少平台、workflow 和原工具轨迹，频繁上下文压缩的现场仍未复现，不能宣称其根因已完全确定或压缩问题已关闭。

## 验证记录

此前源码的完整 build、TypeScript、格式、lint / architecture、SDK 公开 API 报告和生成 Runtime 检查通过。lint 有 9 条原有 warning，没有新增错误。当时 530 个有效登记及全部迁移链 evidence 的结构、原字段和冻结文件摘要检查通过；后续补充案例及最终检查另记在下方。

最初精简实现的报告根目录修复构建为 `coverage/platform-execution-lazy-report-root-corrected-build.log`。此前一次补丁路径校验失败后仍启动了构建，该次没有包含报告根目录修复，不作为该修复的验证依据。后续归档及完整 CLI 构建结果见下节。

实际执行了 `pnpm verify:changed --base 630ce380787f446e803f94b4b90cbbdbf8663364`。首轮停在旧锁文案契约，修正后该文件 6 项通过；下一轮在 App 的三条旧锁排他断言处停止。后续按同一份 23 组计划续跑，保留每组原结果，再对实际失败的精确目标补验，没有反复重跑已经完成的整个模块。完整原始日志在 `coverage/platform-execution-final-changed-verification*.log` 和 `coverage/final-diff-*.log`，续跑记录为 `coverage/final-diff-remaining-results.json`。该阶段没有取得整轮零失败结果；后续标准全量测试结果见下节，不能把它改写成 `verify:changed` 本身整轮通过。

下表中的整组数字是实际日志，不能将后续单项通过改写成整组重跑通过：

| 范围                                                  | 整组实际结果：通过 / 失败 / 跳过            | 后续实际结果                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| App                                                   | 1000 / 3 / 9                                | 旧锁断言改测串行业务；Runtime 命令整文件 53 / 0 / 4                                                            |
| Classic                                               | 1566 / 11 / 24                              | 11 个失败目标均经原文归档、业务映射后定向通过；包含源码和生成命令边界，未重跑整组                              |
| Entry                                                 | 376 / 10 / 29                               | owner 批读整文件 24 / 0 / 1；恢复两项 2 / 0；学习回执原两项未改直接 2 / 0，原负载下 Git 探测失败原因未再次复现 |
| Native                                                | 1624 / 21 / 15                              | 21 个失败目标分别补验通过；保留旧批准、候选、隔离、真实清理与原正文，未重跑整组                                |
| Platform / scripts                                    | 446 / 0 / 12；195 / 0 / 0                   | 整组通过                                                                                                       |
| Comet Memory                                          | 154 / 0 / 0                                 | 整组通过                                                                                                       |
| Dashboard / engine                                    | 485 / 0 / 2；491 / 0 / 4                    | 整组通过                                                                                                       |
| Skill                                                 | 636 / 2 / 0                                 | 路由旧恢复文案迁移后与 Native Skill 合组 41 / 0 / 0                                                            |
| Workflow application                                  | 244 / 1 / 2                                 | 同工作区并发 claim 改测顺序权限保护，原文件 8 / 0 / 0                                                          |
| Workflow contract                                     | 208 / 0 / 1                                 | 整组通过                                                                                                       |
| Eval 来源 / 存储单元                                  | 5 / 0 / 1；44 / 0 / 2                       | 普通确定性单元测试，未运行模型或容器 Eval                                                                      |
| CI / Runtime assets / CLI build fixtures / 覆盖率契约 | 32 / 0 / 0；9 / 0 / 0；7 / 0 / 0；2 / 0 / 0 | 全部通过；覆盖率包含真实定制应用恢复与已执行源码命中要求                                                       |

生成 Runtime 的 UserOptions 原六项全部通过；加强后的 worktree 案例另通过真实“Spec 已写入 → 部分清理中断 → 生成 CLI 恢复 → 重复归档”验证。SDK 转移、检查点及单写入方存储合组 31 / 0；真实旧版本材料、原测试全文、逐行为映射和 Review 位于 [迁移记录](2026-11-11-platform-execution-test-migration.zh.md) 及同名证据目录。没有把原进程监管和快照协议的退休解释成这些历史协议仍然可执行。

两项 Entry 学习回执在整组运行中进入 100ms Git 身份探测的超时路径；原测试未修改即定向 2 / 0，相关异步身份和生产超时回退三项 3 / 0。原负载原因未再次复现，不宣称已经修复或整轮全绿。早期嵌套覆盖测试一次失败时未输出内部失败细节；补充诊断后单项通过，最后整文件实际 2 / 0，但同样没有编造首轮失败根因。

首轮定向交付时未执行全仓库测试；用户随后明确要求本地测试全部通过，后续完整测试见下节。真实模型 / 容器 Eval、真实平台 Hook 安装与事件验证、完整发布安装验收仍未执行。Eval 没有用户启动授权；其余属于本轮确定性检查以外的证据。表内原有平台及可选集成跳过均未计为通过，没有补跑 Windows 文件 symlink 等原跳过场景。单元测试、生成 Runtime、公开 CLI 和真实平台执行分别报告，不能相互替代；现有模型类附加验收仍保持原登记状态。

## 授权后的完整本地测试

第一轮标准 `pnpm test` 实际退出 1：729 个文件中 6 失败、721 通过、2 跳过；8743 项中 13 失败、8616 通过、114 跳过，耗时 3236.40 秒。原始结果为 `coverage/platform-execution-full-suite-round1.json`，保留完整失败，不用之前定向结果替代。

失败及修复逐项记录在[全量补充修复](2026-11-11-platform-execution-retirement/full-suite-followup/README.zh.md)，原六文件全文已归档并完成独立 Standards / Spec Review。产品样板接到已有 Build 完成步骤；旧版本与执行器断言按现有业务契约迁移，批准、验收、证据拒绝及冷恢复断言保留；回执单测固定身份边界，并补实际调用链的正向回执与 Git 超时后原 worker 回退。生产学习预算、身份规则及 Windows 读取策略未变。

补充定向检查 9 个文件，55 项通过、4 项原有跳过。修正后完整 build、lint / architecture 和 532 个案例的结构及迁移 evidence 检查通过；最终完整重跑仍待取得结果，不能据此宣称全量通过。

补充兼容复核又实际发现并修复[旧内置 Classic 固定样板缺口](2026-11-11-platform-execution-retirement/classic-052-fixed-application/README.zh.md)：工厂须先转换已知旧检查点，升级沿现有领域 handler 进入未执行扩展，原 claim 结果按原来源校验。已冻结真实 0.5.2 包和 Build / Verify 原 Run，17 项升级测试及 6 项当前业务定向检查通过；包含 Review 补充的旧已领取 Builder 首次结果缺少报告仍必须拒绝的 RED → GREEN 反例。真实公开 CLI 可提交两种原扩展 claim，原输入和批准保留。原本地存储缺失时，经明确的 `next` 恢复入口导入原 Portable 后可继续；旧编码前的 secret 不能从 Portable 恢复，该限制未被伪装成无损。

第二轮完整测试实际退出 1：731 个文件中 727 通过、2 失败、2 跳过；8755 项中 8639 通过、2 失败、114 跳过，耗时 3248.66 秒。归档目录移动的短暂 EPERM 已通过复用现有适配器处理，持续失败保留原事务，原人工提交恢复断言保留，归档整文件 28 项通过。CLI 自有进程测试的晚写入另经时间探针复现：监管器按时发起停止，但 Windows taskkill 的清理延迟超过了原测试约半秒余量。用户已明确批准撤回半秒量化保证，保留独立发起停止与真实整树退出确认；同一新断言在真实基线适配器上 RED、当前实现 GREEN，完整进程文件 22 项通过，两轴 Review 后沿原链追加了该验收变更。具体证据见[第二轮跟进](2026-11-11-platform-execution-retirement/second-full-suite-followup/README.zh.md)。

最终登记又完成[95 项旧选择器迁移](2026-11-11-platform-execution-retirement/final-registry-selectors/README.zh.md)，保留全部旧来源和链及未受影响目标；已恢复遗失的原测试正文，并补上正式 Spec 独立追加在恢复及重复归档后字节不变的业务断言。结构、evidence 和两轴 Review 通过。官方回归入口的归档及检查证据两组实际执行 11 项通过，日志为 `coverage/platform-execution-final-selectors-core.log`。最终选择器逐断言审计无缺失，原 Windows 文件 symlink 权限跳过仍未验证。

第三轮完整测试实际退出 1：731 个文件中 724 通过、5 失败、2 跳过；8757 项中 8629 通过、14 失败、114 跳过，耗时 3276.92 秒。[第三轮跟进](2026-11-11-platform-execution-retirement/third-full-suite-followup/README.zh.md)保存修改前原文件与实际原因。七项失败是漏做完整构建导致测试中途重建共享 `dist`，已在该轮结束后完整构建成功；HTTP 夹具的 Fetch 禁止端口问题有固定同端口 RED → GREEN，并经两轴 Review 确认全部业务断言未改。另有清理及恢复时间相关失败，原四个相关文件按默认并发重跑 150 项全部通过，但不能据此宣称已定位或修复负载失败根因。

第三轮后的 TypeScript、lint / architecture（9 条原有 warning）、SDK API、Runtime 生成物检查通过；当前增量清单 537 个案例，连同历史映射的 1130 个有效入口及迁移 evidence 校验通过。

第四轮标准完整测试实际退出 0：731 个文件中 729 通过、2 跳过；8757 项中 **8643 通过、0 失败、114 跳过**，耗时 3385.16 秒。命令为 `pnpm test --reporter=default --reporter=json --outputFile.json=coverage/platform-execution-full-suite-round4.json`，原始控制台和 JSON 结果完整保留。文件数按控制台和 `testResults` 核对，不使用包含 describe 的 `numTotalTestSuites` 或包含嵌套测试的日志行数代替。

第四轮开始前已完整构建并确认全部 CLI 产物存在且新于源码；结束后受跟踪差异与开始时逐字节一致，CLI 没有被中途重建，website 状态为空。第三轮的五个失败文件、归档文件和真实进程清理文件在本轮全部通过，未修改负载相关失败用例的时间或业务断言。该结果证明当前标准完整测试通过，不表示已稳定复现并定位此前全部负载波动根因。

使用第四轮这一个完整报告重新核对当前登记及历史映射：664 组记录中的 3126 条必需断言无缺失，3125 条有通过证据，1 条为原 Windows 文件 symlink 权限跳过。明细为 `coverage/platform-execution-round4-registry-assertion-audit.json`。原有 114 项跳过及真实模型／容器 Eval、真实平台 Hook 和完整发布安装验收仍保持上文的未执行边界；没有以全量单元测试替代它们。

## 工作区保护

没有提交、推送、创建 PR 或评论 GitHub；未修改 website 子模块内容或引用，也未修改本地安装 Skill 副本。自动审批拒绝清理本任务此前测量产生的 8 个用户数据目录后，没有再次尝试删除；精确清单保存在 `coverage/runtime-cleanup-owned-audit-paths.json`。另一次 Temp 多余交付副本清理也被自动审批拒绝，原目录保留并改用新建的干净交付目录，没有重试删除。

完成通知使用当前已授权的 `benyum@agent.qq.com` 发送给固定收件人 `675260709@qq.com`。此前阶段首次正文被 CLI 的 Markdown 结构校验拒绝；明确使用纯文本后成功入队。本轮在第四轮完整测试和最终核对结束后重新确认主邮箱及发送权限，以纯文本发送最终结果，CLI 实际退出 0 并返回 `ok: true, queued: true`。这证明邮件已进入发送队列，不代表收件端已送达。
