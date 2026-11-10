# Runtime 剩余失败修复与测试清理

来源：report:2026-11-10-runtime-remaining-failures。继续原 Native/Classic 提交审查和测试精简，比较基线为 59b5c58b1c0eb01a964b9f7d3e611dacf0d2ec14；交付目标为本地 053，不推送。

后续状态见[失败用例定向修复](2026-11-10-failed-case-followup.zh.md)：已确定性复现并修复同症状的Windows超时确认竞态，用户另行授权提交和推送。本文的全量结果及“尚未解决”段落保留为上轮当时的诊断记录。

本轮修复保留 Agent 平台报告、明确修订和原 Run 续行。没有恢复 PID 探测、文件内容证明、自动字节失效或未知副作用重放。

## 实际缺陷

- Native root move 将正常持久化的 .lock.sqlite 数据库当未释放锁；公开旧 bundle 在隔离项目 init 后迁移返回73且 doctor健康，新 bundle成功。现在仅忽略普通SQLite文件，真实锁元数据、未知文件和链接仍拒绝。
- v3/v4 Archive 的可选阅读报告渲染失败时，保留已接受结果。所有版本的 Run 已完成后，归档阅读视图被目录占用只返回报告未就绪提示，保留原目录、移动后的报告、批准和归档收据。旧版本在执行期间必须生成的报告仍保留其失败行为。
- Classic 复用 store 的目录准备缓存阻塞从便携状态恢复，当前在真实目录缺失边界重新准备相同工作区，再恢复原 Run。只读查询不创建目录。
- Native ordinary Doctor曾将旧allowAgedUnknown当停止确认并删除未知锁。当前必须显式确认原写入者已停止且token匹配；活跃SQLite事务仍拒绝恢复。已释放v2事务的元数据残留仍正确诊断和恢复，不按PID或年龄猜测。
- Native确认修复损坏锁后保存原字节；旧token不能删除替换后的记录，活跃lease不能被确认绕过。
- 尚未应用的Delta事务恢复时，将冻结Delta作用于当前正式Spec，保留独立新增条目；原事务ID、已完成游标和重复恢复不重放保持。旧源码同一输入丢失Profile，新断言同时核对Password、Profile和重复公开恢复正文不变。
- 资源only Hook事件保持non-write；含真实文件或无效file地址的混合请求仍交给Guard，Verify/Archive拒写且批准不回退。
- Classic归档manifest正文可来自原收据，但真实交付路径仍须是普通文件。Linux验证发现链接sidecar可被提交并结案，现恢复路径类型检查，不恢复内容hash。
- 旧Native日志目录缺失时诊断仍可报告迁移，保留错误日志、损坏历史和路径越界的拒绝。
- Classic交付复核提示改为执行实际返回的 `commandArgs`，沿原Action继续 `state next --continue`，不再要求读取不存在的 `data.continuation.request`。

具体case ID和精确选择器见 config/workflow-regressions.json 中本报告来源的登记。

## 测试清理与保留

删除依据是协议已退出产品或静态断言重复，包含observe/record、原始输入快照、Markdown语义自动失效、旧contenders队列、由日志字节决定重验、整份源码中文扫描和重复文案。混合用例保留真实失败、批准、Run/Action/claim、一次性检查、固定依赖、分支隔离、外部链接拒绝、事务身份和恢复游标。

[完整退休正文](2026-11-10-runtime-followup/)包含原代码、来源、理由和替代覆盖；[登记迁移](2026-11-10-runtime-followup/registered-migrations/behaviors.json)保留旧登记，使用已有supersededBy链追加当前契约。既有审计字段的SHA只校验这些离线证据，未新增运行时内容证明。

受保护替代关系：Verifier一次性检查由完成收据复用/显式修订后不重放覆盖；Archive自动漂移由合法编辑续行、真实失败仍阻塞和原Action恢复覆盖；Classic supplemental proof由实际check复用及显式失败阻塞覆盖；Supervisor日志证明由未知Verifier不重派和真实失败原Wait重试覆盖。原批准、失败和未知执行没有因测试精简被放行。

进一步移除16个长期跳过的退休或重复用例，并删除它们的独占准备代码。另两个有效的repair用例改用保留的Runtime API：第三次失败暂停及匹配override只能使用一次恢复执行；配置从五次提高到六次后，原Run仍保留五次失败，第六次失败再次停止。后一组断言并入已有循环，避免重复跑五轮。旧命令的明确拒绝用例保留。

删除六个无生产调用且未在SDK入口导出的旧实现：Native checkpoint/receipt命令、Native/Classic edit-review，以及Native edit-review-scope、receipt-refresh私有辅助模块。公开导出、旧Run的checkpoint/transition读取、Shape迁移和真实进程停止代码继续保留。[删除及替代映射](2026-11-10-runtime-followup/retired-code-cleanup.json)与[有效repair测试迁移](2026-11-10-runtime-followup/repair-tests-moved.json)保存原文和审查依据。

CI中六个Linux普通重复步骤改为核对同一轮quality报告的26个精确测试文件。缺失文件、全部跳过或失败会拒绝复用；历史CORE案例仍单独核对精确名称。Windows、macOS、Node22两个分片、最低Node版本、SDK/安装包和真实Docker检查继续执行。Node22外部OpenSpec兼容性只在一个分片运行。尚无远端CI耗时对比，不能据删除步骤推算实际节省秒数。

基线收集9467个用例、746个文件，当前收集9383个用例、742个文件，净减少84个收集用例和4个文件。收集不执行测试，不代替全量结果；最后只变更Native SDK文件时，用该文件的真实单独收集结果替换原清单对应条目，其他文件未变。251个CORE分组的文件和精确名称已逐项匹配，没有缺失选择器。漏写suite前缀的16个本轮新登记已修正；两个旧Eval登记追加迁移，原来源和历史容器记录完整保留。

旧EPERM测试的present/unknown参数在PID枚举退出后已变成相同的持锁路径，现合为released/held两项。保留旧登记及原三个名称，追加迁移说明；原claim拒绝、持锁拒绝、明确停止证据、释放后沿原Action修复和候选不变均保留。12条本轮迁移保留原定义、来源、全文及前置链。

Windows持有SQLite数据库时，namespace不能rename；对应安装测试明确断言系统拒绝并未发布外部文件。Linux保留真实替换后拒绝路径。文件链接用例没有改成hardlink或目录junction来冒充文件链接，已用WSL Linux运行。

嵌套coverage测试只核对源代码命中传播，移除其继承的仓库全局覆盖率阈值；仓库正式覆盖率阈值未修改。fake Docker测试明确选择Git Bash，避免WindowsApps bash路由到无对应工具的WSL；没有运行真实Docker或模型。

## 验证边界

完整数字、实际报告选择器和Linux对应证据见[验证记录](2026-11-10-runtime-followup/validation.json)。

每组先按冻结失败的精确名称修复，再验证相邻真实反例；中间失败和最终通过分开记录。

原冻结候选的Windows全量执行134分钟，746个文件、9501项：9348通过、37失败、116跳过，进程退出1。35项文件符号链接权限失败全部有相同用例的真实Linux通过记录；1项指向已删除测试文件的登记引用在后置迁移后通过；另1项超时重试尚未解决。另有Native SDK套件清理EBUSY：该套件179项通过、2项跳过，但注入后到登记的测试没释放SQLite lease。精确复现同一执行文件的清理失败后，仅补finally释放，同一用例及套件清理均通过。没有给runtime-home加吞错或重试。

后置检查在第二个隔离工作区执行，原全量工作区保持代码、测试和登记冻结；第二工作区的暂存基线与原冻结差异逐字节相同。已完成的后置验证：CI契约32项、清理与repair16项、报告视图及生成Runtime/重试4项、登记引用1项、Eval工具与缓存契约1项（内部四个Python断言）、后到登记清理1项、停止证明及lease两项，共57项通过。build、TypeScript、lint/架构、SDK API、生成物及登记基线保留检查通过。定向选择器未选择的pending不计入通过数。一次CI收集因第二工作区缺少离线证据目录而失败，补齐后同目标通过，原失败记录保留。未再跑第二轮全量，不能把这些结果合称全量全绿。

SQLite清理修复属于测试夹具生命周期维护，不是用户行为修复，复用原竞态用例取得同一输入的失败和通过证据，没有新增产品badcase或删除原竞态断言。

尚未解决：冻结全量中的 `offers retry-checks when a repeatable handoff verification check is interrupted` 第三次调用返回CLI65，原匹配断言没有保留错误正文。独立一次、三组样本、整文件62项以及后置诊断增强后的单次均通过，未复现原因。保留原Build/repair、一次成功检查、三次中断和超时预算断言；现在失败时会输出完整响应与本机执行记录。不能用定向通过声明原全量失败已修复。

未获授权启动真实模型或容器Eval；未验证真实Agent平台Hook、完整安装发布或远端CI。当前package版本0.5.3高于origin/master的0.5.2，保持同一版本；本轮为未发布分支审查修复和内部测试清理，不新增开发过程Changelog条目。
