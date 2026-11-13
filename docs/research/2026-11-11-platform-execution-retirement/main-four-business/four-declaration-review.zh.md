# Native SDK main 四条混合声明迁移

结论：四条均不能整条纯机制退休。Temp原型通过4/4（30.16秒），114条仅本轮未选中，不是skip/退休建议。产品/仓库测试/registry未改，未运行Eval、模型、容器、安装、根构建或旧检查器。Temp文件为满足模块解析仅junction当前node_modules。

## 证据和应用方式

完整原文件 original-native-sdk-application.test.txt；四原body original-four-declarations.json；逐41个原expect/旧机制拆分见 four-declaration-business-map.json。实际四条新声明来自同一文件当前公开SDK/CLI/API，临时项目与COMET_DATA_DIR/HOME/USERPROFILE/APPDATA/LOCALAPPDATA/CODEX_HOME/XDG全隔离。Agent/User均SIMULATED；真实普通Node失败、普通Node启动/取消、真实Git仅Temp。

四条代码片段和helper位于 repository-ready/native-sdk-main-four.replacements.json 与 native-sdk-main-four.helpers.ts。按oldBody精确替换四条并添加helper，避免覆盖root并行变动；native-sdk-application.four-updates.test.ts提供格式化整文件对照，不能直接覆盖并行修改。副本仅格式/相对imports与已执行Temp相应，未再次执行。实际测试为native-sdk-main-four.prototype.test.ts，结果 four-business-prototype-results.json / four-business-prototype-run.log。

## 四条业务与退休边界

1. 真实失败后修复归档：Agent普通Node实际抛 controlled-check-failure、exit1，保存原stdout/stderr日志及一次计数；完整Verifier如实记录fail回Build，原Shape和失败报告保留。陈旧Builder revision领取拒绝，旧Verifier重试拒绝且Run不变；实际Node0报告形成不同candidate，新独立完整Verify、新用户批准（错误hash拒绝）、三步真实Archive完成，原失败Action/Shape/log/count不变。旧verify.checks Action/Runtime check receipt/logRef store退休，替换为普通平台报告与原业务历史。

2. 中断未知与用户决定：真实普通Node启动后SDK Verifier标unknown，公共next不另派Verifier；错claim结果拒绝，原候选不变。隔离测试Agent终止自己创建的Node，实际close确认后沿原claim记录failed，无executionStop/cancellation。新Verifier须完整验收，当前真实verify.confirm提案的错误hash拒绝、匹配用户rejected决定回Build，保原失败Action/Shape。专用verify.checks-stop Wait和Comet进程树停止协议退休；新的proposal-bound决定发生在重试的完整Verifier结果Wait，不能冒称恢复旧checks-stop协议或一开始便要求用户停止回执。

3. 一次检查/Archive-ready编辑：普通Node one-shot实际只运行一次，另有实际repeatable命令报告；已完整Verify并批准、Archive preflight成功后用户编辑代码，status不自动报candidate-drift。错误修订proposal拒绝且Run不变，原批准显式revise后回Build，保原文件/报告/批准；Agent明确判断原报告仍适用形成新candidate，仍需全量新独立Verify和新批准后完成Archive。count1、原log/旧报告保留。旧Runtime自动依据repeatable/fingerprint复用收据机制退休，不宣称平台代码自动判断旧检查仍适用。

4. Child接受后集成：当前v4真实Child Builder已有平台Node0报告；未接受Verifier前直接integration拒绝且Run不变，正常完整Child接受复用报告后真实Git integration和child Archive成功。原Builder报告不变，无supervisor.child.checks/integration-checks任务或额外命令。旧case直接调用version3是Fixture残留；旧独立计划节点/managed checks空结果断言退休，实际业务接受/报告/集成/归档保留。既有DAG8+Review3的coverage/native-current-supervisor-repository-results.json11GREEN及parallel1也提供更广补充，未替代新原型的精确Child场景。

## 初轮harness差异

首轮2GREEN/2失败原记录另存 four-business-initial-harness-results.json/log。其一旧managed check失败是Action failed，当前Verifier成功回报business verdict fail是Action succeeded，retry正确拒绝码为ACTION_ACTIVE，已保持拒绝且Run不变断言。其二新候选前可保留旧Archive preflight成功历史，不能要求全部历史archive.*不存在；改为无archive.execute/finalize实际写入在新批准前成功，保原history。

## Registry

本批四旧声明当前有效末端只有 manual-recovery-native-archive-check-history关联第三条，见effective-registry-links.json；根metadata Agent负责原14ID，不另写登记。第三条替代精确name为 preserves an Agent-selected one-shot report while explicitly revising Archive-ready code without replay。第一/二仍在Native SDK Workflow Application suite内，requiredName需包含该suite前缀；JSON已给出完整requiredName。其他三条无额外当前直接ID。

仅证明当前源码公开业务接口普通确定性测试；未证明生成bundle、安装包、真实Agent平台Hook或模型遵循。当前根整文件111/9报告用于定位，不把该9失败写成已全部解决；根另负责其余声明。
