# Classic 普通任务取消与真实 Archive 保护审计（最终）

## 结论

普通平台任务的停止握手残留已真实复现，并在父 Agent 当前源码修复后通过。同一个普通 Open Skill、Build running、Build unknown 三样本：修复前 0 passed / 3 failed，修复后同原探针 3/3 GREEN。完整旧业务范围迁移并增加真实 Archive 保护，最新单轮 **9/9 GREEN，53.81秒**，包含实际 Doctor 只读诊断。

本 Agent 仅写 Temp，未改仓库产品、测试或 registry；父 Agent 的源码修改另行审查。未运行 Eval、真实模型、容器、安装或构建。

## 原始问题与实际输入

初始源码 classic-sdk-run-lifecycle.ts 要求 cancelled+claim 的 Action 具备 cancellation 或 executionStop。普通 Action 已随Run取消，但 complete=false、next=reconcile、requiredInputs要求 original-execution-stop-evidence、selection仍selected、active1、Hook拒写、Classic/shared resume均ask_user要求stoppedActions。

当前 v2 Run 用公开 Classic state init/select 创建；Build 经 guard open preview 的原 approvalHash 正常批准，没有手工绕过审批。Agent/User/claim输入均标记 SIMULATED。原 Action 经SDK claim；unknown经markUnknown。取消经 app runtimeDispatchCommand，不附stoppedActions，不声称OS已停止。

修复前证据：ordinary-cancellation-red-results.json、ordinary-cancellation-red-run.log、ordinary-cancellation-summary.json。修复后同探针：ordinary-cancellation-green-results.json、ordinary-cancellation-green-run.log。三份 *-observation.json 在GREEN复测被更新为当前完整观测；RED原始汇总、失败断言及独立summary仍保留，不把GREEN完整Run冒充旧RED完整Run。

## 当前源码边界

共享 isUnresolvedClassicArchiveAction 仅识别 ref=classic-archive 的 running/unknown，或旧cancelled+claim且无outcome。isClassicSdkCancellationComplete 只根据业务调度终态、待处理Wait/Evidence/ready、子Run及实际Archive未决判断；普通Skill的claim不要求停止证明。

StateStore compareAndSwap在底层写入前读取原Run；原Archive未决时拒绝cancel，保留原running/unknown Action并指向既有 state check archive --recover。原Action取消不保存旧status，因此不能事后靠claim猜是否真实Archive未决。diagnostics复用相同业务判据，普通cancelled Skill不误报unresolved；unknown child仍healthy=false并解释业务未决。Hook/resume/continuation不再要求stoppedActions，仍要求保留实际未决业务结果。

Generic Engine的可选停止记录不在本次证明范围；本次证明普通Classic流程不再依赖它。没有新worker、stop proof、持久标记或恢复框架。

## 真实 Archive 与 Git 责任

classic-sdk-archive.ts实际通过 executeClassicOpenSpec 启动外部Archive写入；超时不能证明无副作用。已有恢复接受原running/unknown，不能先cancel后提前释放。两个新增样本使用当前v2公开业务流程：正常Open批准、Agent平台报告完成Build和Verify、真实报告文件、propose-archive/decide-archive原用户Wait、成功Archive preflight，再用真实SDK claim领取 ref=classic-archive、executorId=comet-classic-archive。

使用本机已安装的真实 OpenSpec CLI：D:/nodejs/node_modules/@fission-ai/openspec/bin/openspec.js；没有替代validator、没有假执行成功收据、没有安装。Archive只在Temp项目运行。running样本在归档执行前请求cancel；unknown样本先真实执行OpenSpec归档，再模拟回报丢失经markUnknown请求cancel。

两种cancel均拒绝；前后原Run对象完全相等，项目及workspace Runtime全部文件逐项base64 bytes相等（仅排除.git和输入request.json）。原claim/批准/材料保留。running样本当时恢复仍拒绝“may still be running”；真实同步OpenSpec归档返回后，显式markUnknown，再走原 recoverClassicSdkArchive；unknown样本直接沿同一恢复入口。两者最终同Action/attempt/inputHash/claim成功，state.archived=true，原用户Wait不变；重复recover返回完全相同Run，不重放Archive。

该结果是Archive恢复成功，未完成后续Git交付。classic-sdk-delivery.ts只核验Agent已执行的Git结果，未启动commit/push/merge。本批Git仅初始化及Temp本地fixture提交；未对真实用户项目执行Git写入。

旧版本若已经把真实Archive改成cancelled且无outcome，不能安全推定Archive完成，也不能伪造成功或重新start Run。当前谓词保守阻塞这类记录；本批未新增自动修复框架，也未宣称这类旧业务残留已恢复。

## 全部旧声明去向

原文件6声明/7展开，完整正文原封不动保存在 original-classic-sdk-cancellation.test.txt；逐声明/具体selector见 original-cancellation-declaration-map.json。4声明完整保留；2声明拆分退休普通平台任务强制停止回执部分，保留原业务范围并加强原批准/任务/claim/拒绝迟到成功保护。

已实际保留：取消Run不再进入Classic/shared续行（含复制目录），另一个active Run唯一续行，claimed/unclaimed取消均释放本selection与Guard而保历史材料，next done及取消Run不可选，重复clear无害，stale selection的readonly Hook不写而显式next清理，running/unknown Build原批准/任务bytes/state/outputs/Action IDs/claim不变，取消后late success拒绝且Run不写，未知child仍不完整且diagnostics unhealthy，取消demo不清other selection。

## Doctor证据

最新完整9项一轮中，claimed Open及running/unknown Build取消后实际调用 doctorCommand(root,{json:true,scope:'project'})，SDK对应 comet-state.yaml: demo 检查为pass；共享diagnostics healthy=true、executionReconciled=true、issues=[]；Doctor前后Run与state文件bytes相等。只声称该SDK业务检查通过，不声称临时项目完整安装资产/平台配置全部healthy。未知child数据反例仍healthy=false、classic-cancellation-business-unresolved。原控制器console输出在 finally恢复。

## 交付与执行层级

可整体应用旧scope7测试：repository-ready/test/domains/comet-classic/classic-sdk-cancellation.test.ts。
新增Archive集成测试：repository-ready/test/domains/comet-classic/classic-sdk-archive-cancellation.test.ts。该测试依赖现有真实OpenSpec CLI，通过COMET_OPENSPEC或PATH openspec解析；本批实际执行版本明确使用上述绝对入口。repo-ready仅改相对import/命令解析并移除Temp观测写出，按仓库.prettierrc格式化；此副本未另行执行，父应用后应按实际仓库/CI工具依赖验证，不能静默skip。

完整运行证据：full-cancellation-green-results.json、full-cancellation-green-run.log（9/9，53.81秒）；首个9/9未含最新Doctor的证据另存 full-cancellation-first-nine-green-results.json。首轮harness两处错误已单独保存 full-cancellation-harness-first-results.json：Open公开批准不保证是resolved Wait、未决Archive诊断应返回阻塞退出码；均按实际协议纠正，未降低Run/bytes/批准断言。

命令：node D:/Project/Comet/node_modules/vitest/vitest.mjs run --config [本目录]/full-vitest.config.cjs。setup.ts覆盖COMET_DATA_DIR、HOME/USERPROFILE、APPDATA/LOCALAPPDATA、CODEX_HOME及XDG所有目录，全部测试使用Temp项目。普通测试直接导入当前源码的公开CLI/SDK/API，未验证生成bundle、发布包安装、真实Agent平台Hook、真实模型或Eval。
