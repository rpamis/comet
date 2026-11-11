# 旧内置 Classic 固定样板兼容修复

来源：`report:2026-11-10-agent-platform-execution`。用户要求旧版本业务 Run 自动兼容，新流程没有普通检查运行器。这里是 0.5.2 内置样板的已知工厂参数，不能归为任意自定义源码不兼容。

## 已执行的证据

现存真实 `@rpamis/comet@0.5.2` 发布包通过公开样板生成、应用加载、SDK start、原 Wait 批准、原固定 executor 领取和结果回报产生三份 Run。用户批准及 Agent 输出为明确模拟；实际执行一次无副作用的 Node0 检查并提交原真实收据。没有手工改写正常状态，没有启动模型或容器 Eval。

- `package-files.json` 保存原固定包全部 23 个文件的原字节。
- `build-check-pending.run.json`、`extension-pending.run.json`、`extension-claimed.run.json` 是原 SDK JSON，不能替换路径、输入或 claim 后冒充原始材料。
- `original-claimed-result.json` 是原固定检查脚本读取实际 `candidate.txt` 生成的结果，绑定原 Action、attempt、inputHash 和 token。
- `provenance.json`、`generator.mjs.txt` 和 `published-examples.js.txt` 保留发布包来源、原生成器和实际生成过程。
- `second-boundary-red.json`、`second-boundary-probe.mjs.txt` 保留只转换 options 仍失败的两个边界。`nonFinalRunningActionValidation` 只是浅前置诊断，不代表结果已被 SDK 接受；以 `publicOriginalClaimSubmission` 为准。

原固定样板在当前 fresh 进程的 `loadWorkflowApplication({runId, readOnly:true})` 被 `build.check.evidence` 参数拒绝；root 的反馈脚本实际退出 1，日志为 `coverage/platform-execution-published-classic-options-red.log`。只在探针局部转换参数后，纯升级把 Build 检查前沿直接推到 Verify，绕过必要扩展；原已领取扩展提交真实结果时，公开 SDK 返回 `OUTCOME_PROCESSING_ERROR`，旧来源步骤查 validator 为 undefined，纯 handler 还会在查链时出现 indexOf 错误。

## 必须完成的修复与验证

1. 在已知 0.5.2 工厂边界转换旧 Build / Verify 检查点到现有业务检查点，新生成器仅产生新参数。未知检查点仍拒绝，不加载旧执行器。
2. 退休 Build 检查前沿必须经现有领域 handler 进入尚未完成的扩展，不能硬编码跳到 Verify，不能补造检查结果。
3. 原已领取扩展保留 Action 输入、来源、claim、批准和真实结果；查路由时适配已知旧来源，真实来源校验仍针对原事件与收据，不能重写输入或重新领取。
4. 同步审查 superseded 中仍只识别旧检查点的条件，保持新 Builder 使旧扩展失效的业务语义。
5. 验证本地 Run 索引缺失、通过 Portable 首次加载的场景：工厂早于该恢复入口执行，不能依赖此时已有 existingRun 才适配已知参数及旧输出契约。
6. 为上述行为增加精确回归登记，用冻结原始 Run 测纯迁移和 SDK 原 claim 回报，再用保留的同一真实临时项目验证公开加载与续行。完整本地第二轮尚未启动，需修复、构建和定向验证后再启动。

## 实际修复与验证

已在现有 Classic 工厂边界转换已知 0.5.2 检查点和旧输出契约，新版或未知检查点仍拒绝。原 Run 升级可调用现有领域 handler，未完成扩展继续执行；原来源和领取保持不变，只有路由查询和续行读取已知业务步骤。已接受的 v1 结果只沿原事实继续，不被重写成新版检查报告；新的结果仍须通过当前验证。没有新增执行器、缓存、锁、恢复框架或内容指纹。

十项新回归使用 `test/fixtures/classic-052-fixed-application/` 的真实旧包与 Run：Build 三项先 RED 后 GREEN，另补 Verify 原已领取／待领取、原 claim / input / source 拒绝及退休前沿完整完成验证。Verify 配置经旧公开编译入口在启动前声明，材料在 fixture 的 `verify/` 中；不是默认样板，也没有手改 Run。纯迁移测试使用冻结结果的业务判定，未执行记录中已不存在的绝对路径；真实文件判定另经保留的原临时项目和公开 CLI 完成。

- 新回归与原已发布业务升级合组：17 项通过，`coverage/platform-execution-legacy-active-report-final-green.json`。较早的 16 项结果保留，不作为新增反例的验证。
- 当前业务相邻检查：6 项通过；95 项因本次精确选择器未选中，不能视为执行通过，见 `coverage/platform-execution-legacy-extension-neighbor.json`。
- 构建和类型检查通过；完整仓库第二轮尚待执行。
- 真实 `bin/comet.js runtime dispatch` 分别提交 Build 和 Verify 的原 claim，原输入、批准和领取不变；分别进入 Verify 与 Archive 准备，重复 inspect 不变。见 `coverage/platform-execution-legacy-extension-public-cli-results.json`。
- 另建真实 0.5.2 项目，备份并移走其本地应用存储，用返回的明确 `next` 请求从原 Portable 恢复并提交结果，仍沿原 Run 进入 Verify。见 `coverage/platform-execution-legacy-portable-public-cli-results.json`。

Portable 验证的最初测试工具把备份放在活跃 applications 目录，被正确识别为另一个应用分区并拒绝；备份移到该临时项目的运行目录之外后恢复可执行，没有修改产品索引检查。旧 Portable 本来就将本地 secret 编码成可恢复的 claim token；已对照真实 0.5.2 codec，验证恢复的是原检查点实际保存的领取身份，不能宣称丢失本地存储后还能恢复编码前的 secret。原本地存储仍在时，前述两项公开 CLI 验证保留的是原 token。失败原日志均保留，没有将其改写为通过。

新增登记：`classic-published-extension-options-upgrade`、`classic-published-retired-build-extension-frontier`、`classic-published-original-extension-claim-upgrade`。完整测试尚未取得通过结果，不能将这些定向证据表述为全量通过。

## Review 补充的首次回报反例

Spec Review 又指出：SDK 在调用 handler 前已临时接受当前 outcome，仅靠 v1、成功状态及 outcome 相等无法区分历史与首次提交。组合 handler 还会先进入扩展，原 handler 的报告检查尚未执行。用 `active-builder-generator.mjs.txt` 经旧公开 SDK 另冻结已领取、未回报的 `builder-claimed.run.json`，真实 SDK 负面测试先 RED：不带报告的首次结果被接受。

现在历史续行还要求原 `outputs` 的序号和值与原 Action 相符；组合应用的首次 Builder / Verifier 业务结果在进入扩展前执行现有报告检查。缺失报告拒绝并保留原领取；同一 Action 补实际 Node0 报告后可继续。没有新增输出标记、缓存或状态投影。该项登记为 `classic-published-active-work-check-reports`；初次仅修改历史判断仍未挡住组合拦截的失败日志保留为 `coverage/platform-execution-legacy-active-report-green.log`，最终 17 项通过以 `-final-green` 日志和 JSON 为准。

Standards Review 未发现规范阻塞或新增框架；Spec Review 在补充真实 claimed Builder 反例及上述修复后确认 P1 关闭，其余旧来源续行发现也已闭合。复核为只读，没有替代执行证据。

最终源码再次完整 build、类型和 lint / architecture 通过；lint 保留 9 条原有 warning、0 error。536 个案例结构及冻结 evidence 校验通过。正式 `test:core-regressions` 选择四个新案例后合并为同一文件的 1 组、10 项通过，不能重复计算为四组。最后一次完整 build 后另建两个真实旧项目，公开 CLI 再次提交原 Build / Verify claim 并重复 inspect，均保持原输入、领取和批准，记录为 `coverage/platform-execution-legacy-extension-final-public-cli-results.json`。
