# Entry / Dashboard API 与投影失败调查

日期：2026-11-11。仅系统 Temp 原型/报告；仓库产品、测试、registry 未写。沿途 AGENTS 已读取。没有 Eval、模型、容器、Runtime 构建或真实全局安装。

## 交付

source-proposals/domains 下三份源码可由根 Agent 逐文件 CAS 应用，完整原字节/新字节见 source-proposals/source-before-after-cas.json，最小差异见 source-proposals/minimal.patch。生成时三仓库源码仍与 before 相同。

repository-ready/test/domains 下四份既有测试可整体应用：comet-entry/application-hook-readonly.test.ts、hook-allow-path-symlinks.test.ts、project-sdk-status.test.ts，dashboard/mcp-cli-setup.test.ts。workflow-learning-receipt.test.ts 原样保留，不需要复制。五个仓库测试生成时均与冻存 before 相同。原25声明/五全文在 original-five-all-declarations.json；逐声明完整正文/当前正文/改变的断言在 five-files-complete-body-map.json。delivery-ast-verification.json 逐项证明五测试和三源码的可应用副本与实际执行副本除模块路径、格式外 AST 相同。

新增共同恢复测试和真实冻结资料：repository-ready/test/domains/comet-native/native-cancelled-portable-recovery.test.ts、repository-ready/test/fixtures/native-052-cancelled-portable-history/cancelled.json。它不是用2条测试替换原 native-sdk-history.test.ts；原文件19声明全部正文已保存在 original-native-sdk-history-all-declarations.json，混合业务逐行为迁移交 native_step_research 继续。

## 实际问题与最薄源码方案

1. 全局历史可见性是真实回归。公开 new→cancel 得到真实 closed Run/history owner；明确 SIMULATED 移除派生 formal 目录后，具名 status 成功且仍读 cancelled，全局默认/includeHistory:true 却 []。新源码仅在 includeHistory 时，将当前 workspace 的本地 history owner 名字并入 formal 名字；复用现有 Store readPartitionMetadata 筛除真正 missing 的孤立垃圾条目。元数据损坏仍保名字，由现有 readSdkChangeOwners/inspectNativeSdkStatus 逐 change 报错；不调用一条坏 body 就整批失败的发现接口，不扫描其他 worktree，不创建索引、投影或持久缓存。该薄名字能力放在原 Native history-discovery 模块，Entry 只组合；使用既有 mapWithConcurrency 限4。无 canonical hardlink 索引的实际 closed Run 也可见，旧无索引样本明确是 SIMULATED 兼容故障，不冒称052发行包原态。

2. 共同 checkpoint 恢复确实遇到旧 v3 close 回归。原 public Doctor --repair --confirmed：current 取消 checkpoint 完整通过；真实052 SDK取消的 v3 portable 先恢复原Raw Run/owner，随后 close 将已升级 inspection.run 与原Raw Run直接比较，报同revision内容变化。Temp close 仅在读入边界复用现有当前定义和 upgradeNativeRun，对 stored 及外部 options.run 各规范化一次，再保持原revision/content检查和原Store.closeRun；关闭的仍是原Raw记录，没有另写Run或投影。未知当前4 hash、陈旧revision、同revision不同内容仍拒绝。

3. 旧 portableCancellationHistory 是无调用闭包。源码 hasNativeSdkPortableHistoryImport / migrateNativeSdkPortableCancellationHistory 已无调用者，当前公开入口是 Doctor repair→state-store checkpoint恢复→既有adapter→close。方案物理删除两exports和只服务它们的私有 import ref/journal/read/sourceHash/marker发布/跨worktree来源扫描，不复活另一个HistoryImport恢复流程。保留当前业务 close/取消/归档收尾、Run、owner、Store事务和Archive receipt。删除该死闭包不会主动清理用户磁盘上的历史材料。

## 测试迁移的合同

Hook六旧失败中，Native/Classic重复 marker 已停止生成，不能要求缺它进入repair；Native派生文件缺失/陈旧不再替代SDK Run权威。原零写 spies、write-open探测、项目树完全相等均保留，增加Runtime目录逐字节相等。真实缺失/坏JSON应用Run仍拒绝。Classic正式配置缺失/变更仍保原失败关闭/待导入配置断言。实际公开Native Shape/Classic Open缺owner仍允许编辑初始草案，是被批准保留的原phase权限；实现文件始终拒绝。坏owner则草案和实现均拒绝。没有新增owner握手，也没有把通用独立Application强加领域owner。

Symlink两失败仅发生在fixture mkdir：纯 resolve 已不创建父目录。fixture明确 mkdir recursive；所有原物理 .. 穿越、allow-path ownership、禁止写入Runtime与目标不存在断言保留。

project-sdk-status 将已退休 .comet/runtime migration fence 参数映射到实际 .change-owner-partitions.json 权威分区损坏，保“所有受影响记录报错、其他单条坏owner不隐藏正常项”。旧重复 state-projection revision 断言改为损坏实际当前SDK checkpoint，仍要求Named/global一致拒绝且Classic正常；原marker/storage生命周期是另一协议，仍保原断言，没有混删。

MCP实际真实npx只读诊断先行：原transport env同时带NPM_CONFIG_PREFIX=D:\nodejs及lowercase Temp。真实Windows child只保留uppercase，npm root实际D:\nodejs\node_modules。规范化显式Temp overrides大小写后，同一真实child npm root精确为Temp/prefix/node_modules。原不安全安装路径未启动。fixture只改transport环境边界并加readonly npm-root前置检查，随后真实MCP连接/本地假包安装在Temp执行；原CLI版本、自动安装时机、Hook数量、禁用旧Skill配置、保留旧Skill原bytes、禁止创建项目配置断言全部保留。ensureCodexPluginCli无法修复一个在更早child spawn时已丢失的lowercase值，因此没有建议改该产品模块。

learning原样8通过/1原Windows skip，原3错误本轮未复现。无origin本来会fallback；源码100ms timeout/取消会抛，而生产 comet-task-context 调用方本来 catch(()=>false)。不能简单说Origin missing是根因，也不能把这3项写成已修复。此文件未改。

## 真实执行结果

- baseline-four-results.json：48通过、10失败、25原平台skip，76.38秒；Hook6、symlink2、status2同原失败；learning8通过。
- hook-business-final-results.json：完整18/18，26.18秒。
- migration-first-results.json：symlink完整16通过/23原文件符号链接平台skip；Hook当时owner假设后来按原phase合同调整，不以该中间失败冒称产品缺陷。
- status-proposal-results.json：整文件23通过/1原skip，58.73秒（当时新增历史例为单current-index）。随后最终有界helper和current-index/legacy-no-index两个展开的 status-history-compat-results.json 为10通过；14未选+1原平台skip。覆盖精确历史/每项错误组，未冒称又完整跑了一遍最终25项。
- mcp-npm-readonly-results.json：真实npx只读probe1通过；mcp-npm-readonly-observation.json保真实两种环境root。mcp-safe-results.json：原MCP业务1通过，2.40秒，真实安装仅Temp假包。
- history-repair-public-results.json：共同原实现 current1通过、真实0521失败，旧版报同revision内容变更。history-repair-proposed-results.json：修复后两个真实生成案例2/2，15.88秒。
- history-recovery-frozen-final-results.json：最终可应用测试/冻结052 fixture的Temp执行版2/2，增加完整Raw Run深相等断言后的最后一次为10.32秒；只将history模块替换为Temp源码提案，实际 runNativeCli 其余模块原样，无build。

没有单次完整五文件+源码全绿报告，不合并不同批次伪称一次通过。未执行真实平台Hook安装、发布bundle/包重建、Linux-only场景、Eval或模型。根 Agent 后续执行仓库内检查。

## 052 claim 与Portable合同

真实052样本来自已发布包 createNativeSdkRuntime.cancel，对现有实际发布pending检查Run执行明确SIMULATED用户取消。没有启动受管检查器、模型或停止监管；没有构造假停止收据。portable格式本来把live Runtime claimToken改成portable-*并重算receipt hash。因此精确保留的是实际原文件 readPortableRunCheckpoint 解码得到的claims/Actions/Waits/commands/sourceRevision，另与live Run核对actionId/attempt/inputHash/session/executor和原批准/业务结果。不能宣称live secret token也必须逐字恢复，更没有修改该已有序列化协议。

最终测试还检查源文件原bytes、原旧marker bytes、closed owner、重复repair不重放、只读升级可见4且raw历史仍旧3、外部raw旧参数幂等、陈旧revision false、同revision改内容拒绝、未知当前4 hash拒绝、拒绝后Run/owner/source不变。

## 登记与移交

当前五文件仅MCP命中有效末端 codex-plugin-migrate-file-skills，selector与全部业务断言保持，fixture隔离修正不需要append迁移链；另外四文件无当前有效末端。registry-plan.json记录精确依据。两个新产品回归稳定ID由根 Agent统一登记，本子任务未占ID。

native-sdk-history.test.ts现有7条有效目标/6个ID需逐行为迁移，effective-registry-links.json含精确旧selector；已移交 native_step_research 原文及真实资料。不能把这7条都映射到新两个recovery happy path。原跨worktree权威、坏checkpoint、来源变化、中断事务等必须各保留，纯旧marker/journal机制可明确退休。

增量Builder parser Standards审查无阻塞，见 incremental-parser-standards/review.zh.md；仅审当前业务字段错误聚合，未额外运行测试，父48 GREEN另作执行证据。

补充同输入对照：history-recovery-frozen-red-green-results.json 为单次原/新模块边界对照（15.82秒），原实现 current 恢复控制例通过、相同冻结052 portable bytes案例RED65；新实现同两个正文/相同冻结资料均GREEN。总3通过1预期RED，不能把整组称为全绿。未知当前hash反例接受原实现“content changed”和新边界“definition hash”两种拒绝诊断，业务拒绝及之后完整Raw Run/source/owner不变的断言没有放宽。

Peer Review发现active Archive收据末尾仍使用RuntimeValue类型，该import已保留并同步CAS/patch。此后仅类型import变化，不影响上述运行时证据。原history19声明迁移继续由native_step_research负责，已收到完整资料与同输入对照。
