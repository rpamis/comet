# Native Portable、Recovery、Verifier start 与确定性回归测试迁移

四个原测试文件共43条声明已逐条映射，完整原文、断言、case ID、原行号及精确目标selector见同目录`2026-11-11-native-portable-runtime-test-migration-map.json`；四份原文件全文另保存在`native-retirement-originals-20261111/`。没有修改仓库产品、测试或registry，没有用整条删除代替混合业务迁移。

当前四文件原型一次29/29通过，18.76秒：Portable Runtime 18展开、Verifier start 7、Recovery 3、确定性完整Loop 1。可应用版已转换为仓库相对`.js` imports、移除Temp观察写，并经过Prettier。源码imports存在性全部核对，无已删除模块引用；复制进仓库后的类型/格式/定向测试由根Agent执行，Temp通过不等于该边界已运行。

## 保留的业务

Portable保留命名/路径发现、能力创建与修改、非法能力拒绝、持久化用户确认Wait与stale确认拒绝、普通newline调整不使批准过期、从Supervisor明确回Shape后协调选择清理、parser metadata不改验收、4MiB以上正文、Child完整验收矩阵与缺coordination拒绝。原缺coordination样本中手写branch字段已换为实际本地Git master基线与parent分支；在真实持久Wait之后拍bytes，确认拒绝不改变原Wait。

正常平台任务不会仅因launcher进程退出、等待两小时或没有旧machine overlay就失败/重派。显式平台execution error后才增加失败计数，同candidate后续显式dispatch进入attempt2；迟到旧attempt结果被拒且当前stateVersion/失败次数/attempt不变。repair候选始终完整A1/A2验收，平台丢任务之后也不缩小scope。

可信独立结果与Builder任务区分：Builder身份冒充Verifier被拒，原state bytes不变；缺少A2的pass被拒；合法独立fail回Build并生成失败报告，repair后仍独立覆盖全部验收项。未经当前用户接受不能Archive；显式用户接受绑定当前stateVersion才可进入Archive，随后真实本地Git归档。没有伪造用户批准或正常状态。

最终Outcome重复提交只接受一次，冲突重复拒绝，公开CLI重复不修改stateVersion。平台可报告verifier-started，绑定当前candidate/task；本轮发现旧同claim重复调用stateVersion6→7的真实RED，根Agent已以持锁后同对象不写修复，原案例完整GREEN。stale candidate/token仍拒绝且exactbytes不变。此可选平台任务通知不恢复强制启动握手/停止回执。

报告是阅读视图：只读status不会补写丢失报告；显式现存`ensureNativePortableReport`可依据同一原portable结果重建，state及pass/version不变。没有恢复通用overlay/progress恢复器，也没有重跑检查。

## 确定性长日志与完整Loop

`native-v4-regression-eval.test.ts`保留文件名，describe已写明deterministic；本轮只执行普通Vitest，未启动模型、容器或Eval。

旧Runtime检查器改由测试中的Agent直接调用普通Node脚本，实际产生4KiB、64KiB、256KiB的stdout和同样大小stderr；逐个核对退出码、每流字节数、落盘合并日志大小。执行完成后才提交对应的检查报告。完整日志留在隔离数据目录，不放进Comet业务结果；最终状态不包含连续4096个日志字符。Archive前后实际Node计数完全不变，不重新执行。原Builder自评→独立缺项拒绝→独立失败→repair→全覆盖独立通过→明确用户接受→Archive全部行为仍执行。

归档后旧测试要求整个child runtime目录消失；当前实测该目录仅空目录。整体目录删除属于已退休布局约束，当前检查不存在state.json/checklogs/snapshot/manifest，保留所有用户材料和实际报告，禁止借删除整个目录影响真实业务记录或writer。

## 明确退休与保留边界

只退休旧计划identity/检查预算与重用/命令预留/内容快照/机器overlay/检查执行与进程停止/自动retry-checks/request-checks执行。新negative在实际active Verifier上拒绝旧request-checks，提交的throw Error命令不执行，原Action/candidate/Builder报告和完整state bytes不变。不能将这些feature-removed条目声明为原历史故障已修复。

原Verifier start第2条手工从已派发state删除verifier_action，并要求靠旧overlay回填同Action ID。只退休这个overlay回填身份合同；真实SDK已存在的Action、claim、批准与Wait必须保留，精确映射已有published业务数据和v4 checkpoint unknown恢复测试。它们是源码核对/已有证据，未混入本轮29通过计数。父要求不新增手工缺字段假旧版本探针后，该临时探针已从交付文件移除，未作为真实052证据。

原machine overlay缺失触发unknown/撤销Archive-ready结论的推断退休；原已批准结果由SDK Run/portable业务数据决定，不能仅因辅助文件丢失就伪造停止或丢弃批准。当前show显示真实pending/running Action状态，show/status/doctor/next只读原state，未恢复旧synthetic verifierStartup文案或通用recover提示。

## 证据与未执行

实际命令与原始结果在同目录results JSON。核心原始报告`adjacent-four/four-retained-final-results.json`为一次29通过，startup RED保留在`runtime-start-current-results.json`。初次Temp marked依赖缺失、旧错误文案与原型变量/import适配失败均分开记录，没有算作产品复现。恢复初轮JSON曾被后续原型误复用，原log仍保留，该JSON不作那轮证据。

未build、未验证最新生成Runtime、未安装/真实平台Hook、未全量、未真实模型/容器Eval。60个原case ID仍保留在逐声明映射中；根Agent需保留旧registry字段和正文，按精确行为追加testMigration并明确Review，不以更换ID或一个入口happy path覆盖所有来源。
