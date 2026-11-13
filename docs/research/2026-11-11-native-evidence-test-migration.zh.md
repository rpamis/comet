# Native 五个旧证据测试文件的退休与业务保留

来源：`report:2026-11-10-agent-platform-execution`。本研究只写Temp，没有修改仓库产品、测试、registry或运行Eval。原五文件60条声明的完整正文、断言、CaseID、原行号以及逐条去向，保存在同目录`2026-11-11-native-evidence-test-migration-map.json`；原五文件全文另保存在`native-evidence-retirement-originals-20261111/`。

最终Spec分类：39条纯机制退休、18条机制与业务拆分、3条业务保留，共60条。39条退休项包含storage index15与verification-runtime index1的旧内容寻址report snapshot案例；当前原report bytes保留是另有GREEN的独立业务，不表示恢复内容快照。没有用静态模块absence代替验收、失败、Run隔离、事务或归档读取业务。新业务文件`test/domains/comet-native/native-verification-business.test.ts`共20展开项，一次普通隔离Vitest全部通过，11.07秒。相对imports、isolated-agent-home、移除Temp观察写和Prettier已完成；复制进仓库后的类型/定向测试/build由根Agent执行。

## 真实业务证据

当前SDK/Portable/公开CLI验证了：完整验收不依赖旧receipt envelope，结果顺序不影响按原A1/A2绑定；missing、unknown、duplicate、ambiguous、skipped五种非法结果分别拒绝，完整state/用户原report树bytes不变；用户此时请求accept-result也不能绕过缺项或skipped。跨candidate与跨Verifier task两种结果分别拒绝且不写当前Run材料。Shape阶段通过公开CLI不能先持久化Verify结果或生成报告。

测试中的Agent实际执行普通Node退出7。旧成功或文字自述不能把它变pass；合法完整fail保留实际failed检查报告与note。新candidate正常提交只重置当前pending验收/结果，旧fail history、未解决ID与原失败报告bytes继续保留。此前已通过的真实052→Builder→新报告writer测试进一步验证旧verification原文在view更新前完整备份，不以内容hash重新授权。

真实完整独立pass仍等待用户决定；当前stateVersion下明确接受后进入Archive，普通next不退回Build/Verify，也不改任何已接受材料。原next-only探针仅保留为普通入口不隐式导入保护：合法裸legacy next也会因Doctor指引拒绝，因此不能用它单独证明实际执行了轨迹校验。

旧evidence-transitions index4的实际轨迹检查证据另由`test/domains/comet-native/native-transition-recovery.test.ts`的精确selector `^keeps malformed middle trajectory bytes and original WAL unchanged during explicit Doctor repair# Native 五个旧证据测试文件的退休与业务保留

来源：`report:2026-11-10-agent-platform-execution`。本研究只写Temp，没有修改仓库产品、测试、registry或运行Eval。原五文件60条声明的完整正文、断言、CaseID、原行号以及逐条去向，保存在同目录`2026-11-11-native-evidence-test-migration-map.json`；原五文件全文另保存在`native-evidence-retirement-originals-20261111/`。

最终Spec分类：39条纯机制退休、18条机制与业务拆分、3条业务保留，共60条。39条退休项包含storage index15与verification-runtime index1的旧内容寻址report snapshot案例；当前原report bytes保留是另有GREEN的独立业务，不表示恢复内容快照。没有用静态模块absence代替验收、失败、Run隔离、事务或归档读取业务。新业务文件`test/domains/comet-native/native-verification-business.test.ts`共20展开项，一次普通隔离Vitest全部通过，11.07秒。相对imports、isolated-agent-home、移除Temp观察写和Prettier已完成；复制进仓库后的类型/定向测试/build由根Agent执行。

## 真实业务证据

当前SDK/Portable/公开CLI验证了：完整验收不依赖旧receipt envelope，结果顺序不影响按原A1/A2绑定；missing、unknown、duplicate、ambiguous、skipped五种非法结果分别拒绝，完整state/用户原report树bytes不变；用户此时请求accept-result也不能绕过缺项或skipped。跨candidate与跨Verifier task两种结果分别拒绝且不写当前Run材料。Shape阶段通过公开CLI不能先持久化Verify结果或生成报告。

测试中的Agent实际执行普通Node退出7。旧成功或文字自述不能把它变pass；合法完整fail保留实际failed检查报告与note。新candidate正常提交只重置当前pending验收/结果，旧fail history、未解决ID与原失败报告bytes继续保留。此前已通过的真实052→Builder→新报告writer测试进一步验证旧verification原文在view更新前完整备份，不以内容hash重新授权。

提供。该case确实执行named Doctor --repair并返回trajectory-invalid，坏中间行、原trajectory/WAL/state原文和原Run数据保持不变，也不进行tail repair。已只读核对`coverage/native-legacy-schema-import-business-green.json`：success=true，51 passed/0 failed，该精确case为passed。本次没有新跑测试或Eval。

原“Run consistency必须接受前不写证据”里，旧run-state.currentStep和change.phase双份状态校验机制退休。其仍需保留的业务禁止结果由当前阶段、原candidate/task绑定错误拒绝before-write覆盖；不是继续依赖第二份Run状态。原v1 skillHash/skillVersion package identity兼容分支也退休；保留真实SDK原Run/Wait/claim及批准的迁移，用当前已GREEN的真实发布v1 SDK前沿与052批准WAL具体测试映射，明确两者不属于同一旧格式。

## fail缺项合同有明确改变

旧store可以在fail时把省略项自动投影成missing；该投影退休。当前Verifier协议要求pass和fail都显式覆盖全部正式ID。测试先证明不完整fail拒绝且不写，再提交完整failed+blocked报告，保留实际失败与“未检查”的明确原因；skipped不被包装成passed或evidence。不能把当前测试描述成“旧省略输入仍被接受”。缺项推断、traceHash、partial allowance的内容证明和固定预算不恢复。

## 旧归档counter的实际消费结论

旧`readArchivedNativeVerificationAcceptanceCounts`在HEAD生产代码只有`native-evidence-storage.ts:742`自己的定义，没有consumer。它的注释称counters应在Dashboard可见，但实际没有接线。当前真实消费方是`domains/dashboard/native-collector.ts`的legacy分支→`native-legacy-adapter.ts`，identity返回`acceptance:null`，详情返回`acceptanceItems:[]`；已有native-collector测试也明确断言null。

实际探针复制仓库真实`docs/comet/archive/2026-07-21-classic-config-block`，补一个明确SIMULATED旧辅助counter文档用于验证它不成为权威。真实collector仍显示原legacy-read-only归档，acceptance保持既有null；原4份材料、辅助文档与config bytes均不变，不生成SDK owner或隐式迁移。真实归档可见/只读业务保留；未接线的counter helper与旧envelope/change/hash校验退休。本轮不新增counter reader或展示，不宣称修复一个此前可展示而现丢失的功能。

## 脱敏的RED→GREEN与边界

原transitions两条credential redaction不能随partial/hash静默删除。当前公开compat CLI在正常批准后提交Builder summary和known_limits，最初两项真实RED：模拟Bearer/password/api_key/access_token值原样写入Native state；默认compact stdout当时已经不回显这些marker，不能误称CLI输出泄漏。

根Agent复用现有`redactNativeCredentialText`，仅在`native-loop-runtime.ts`的Native processed报告/历史自由文本转为PortableText处接入，不改变正式文档、acceptance来源、identity或原调用者inputfile。同输入两项现在GREEN；新增公开CLI Verifier summary/risks/acceptance reason也验证state、生成verification.md和compact stdout不含marker，原输入文件保持原内容。全部20项一次通过。此结论仅限Native业务自由文本/阅读view，绝不扩成generic Engine原始opaque outcome的通用脱敏承诺。

## 退休边界与Review

旧四个独立证据模块及native-transitions源码/当前dist路径均已只读确认不存在；这只是当前文件事实，不代替未来安装包/生成bundle回归。纯机制映射可以复用已GREEN的当前SDK无受管check/refresh图测试，不能拿它代替18条拆分项与3条保留项的具体业务断言。旧evidence-parent替换/junction测试仅绑定已撤下store写入端口，不为保旧race框架重新建store；当前报告与真实业务写入的已有受保护路径合同保持独立。

每条旧声明在JSON中分别记录退休部分、保留部分、当前精确selector和真实GREEN来源。旧immutable content-addressed report API及其两个snapshot测试按纯机制退休；原用户report bytes保留通过既有current writer测试另行证明，在JSON中仅列为独立业务参考，不声称内容快照已恢复或等价移植。对所有合同改变仍须根Agent明确Review并保留旧正文/登记来源，不能当原历史问题修复或改ID绕过。

实际命令和原始RED/GREEN文件见同目录results JSON。未build/最新生成bundle安装验证、未真实平台Hook、未全量、未真实模型或容器Eval。此前已通过的29项及root current32等仅在逐行为确实对应且实际JSON显示passed时复用，没有把source候选或未选择项当通过。

## 登记审计引用

`2026-11-11-native-evidence-registry-scope-audit.zh.md`及Temp `evidence-five/registry-draft/scope-audit.json`仍记录这五文件在当前有效selector和所有旧链均为零引用、追加为空。原NoOp四件证据和旧正文冻结不改；最新分类及覆盖更正以本文和同名60行map为准。此次仅更新这两个无registry hash绑定的映射/报告文件，未改源、测试或登记。
