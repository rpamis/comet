# Native 首批流程简化

来源：`report:2026-11-02-native-protocol-simplification`。比较基线：`784694e310911586e55984fc3444cf3f8ded9bae`。

## 实施范围

- 新的 Builder 回报模板不要求 Agent 填写 `submittedAt`。未提供有效时间时由 Runtime 记录；旧请求中的有效时间继续兼容。候选内容、领取身份和验收覆盖仍按原规则核对。
- 一次 `native next` 连续执行当前应用已允许的内部工具 Action，每项仍单独领取、校验、保存结果。等待用户决定、Agent handoff、结果未知、执行失败或没有进展时返回。单次最多处理 32 项，剩余动作通过原 continuation 继续。
- 同一次推进共享已经加载的应用和执行器，减少重复加载。不复用跨动作的内容快照，不省略执行器原有的输入检查。
- 按用户本轮明确要求保持版本 `0.5.2`，覆盖先前按 `origin/master` 推导出的升级决定。package、锁文件根包、manifest 与 Changelog 保持一致，并重新构建发布资产。

本轮没有加入新的项目配置，也没有改变独立验收、用户授权、Git 隔离或检查证据有效性规则。领取令牌、结果 ID 等协议字段的整体封装，以及输入观察的进一步合并，仍是后续工作；不能把本轮实现称为整个协议重构完成。

## 复现与回归

旧实现的临时 SDK 项目在省略或填错 `submittedAt` 时拒绝完整 Builder 结果；已获批准的待归档项目执行一次公开 `next` 后仍为运行中。同一测试先取得三项失败，再验证新实现通过。

案例登记：`native-builder-runtime-submission-time` 和 `native-next-drain-internal-actions`。精确测试均位于 `test/domains/comet-native/native-sdk-application.test.ts` 的 `Native protocol simplification` 分组，覆盖：

- 缺失、错误时间的自动记录；
- source CLI 和独立 bundle 连续归档、重复调用不重放；
- 用户接受结果前不归档；
- 不自动领取独立 Verifier；
- 失败检查不继续派发验收；
- 未知 Verifier 执行保留原归属与结果状态。

## 验证记录

- 最终新增 8 项回归全部通过，已根据 Vitest JSON 报告逐一核对两个登记案例的 requiredNames。未知执行断言允许原有检查补记停止证据，同时严格保持原 Verifier 的身份、结果、候选与动作集合。
- 相邻定向回归 9 项中 8 项通过，`rejects Archive document drift before overwriting the confirmed report` 在夹具准备时出现 `EXECUTION_UNKNOWN`。隔离提取未修改的基线后，用同一测试选择器复现相同失败，未缩减或跳过原断言。
- Native 发布资产与自包含检查：6 项通过，3 项由原有环境条件跳过。
- `pnpm build`、TypeScript、lint 与架构检查通过；lint 保留 Dashboard 的 8 个既有警告。初次生成物检查提示 Entry 资产需要重建，完整构建后检查通过。
- `verify:changed` 选择了整个 Native 测试目录；在格式检查阶段主动停止，未将整轮报告为通过。使用本次精确测试和受影响文件格式检查作为实际验证。
- 未运行仓库全量、真实平台 Hook、完整 npm 安装验收或真实模型 Eval。用户没有授权启动 Eval。本轮证明 Runtime 行为与 bundle 的边界，不声明已测得总体耗时、token 或模型错误率收益。

历史基线夹具位于忽略目录 `.tmp/native-protocol-baseline`，新增回归 JSON 报告位于 `.tmp/native-protocol-simplification-tests.json`。后续若需要量化流程收益，应另行比较同任务的调用次数和墙钟耗时；真实模型评估须获得用户明确启动请求。

## 继续审查：下一批简化候选

本节记录第二轮实施前的只读分析；实施结果见下一节。用户已明确指定版本保持 `0.5.2`；版本修正后重新执行完整构建、生成物一致性和受影响文件格式检查，公开 CLI 的 `--version` 返回 `0.5.2`。当时没有重跑前述行为回归或启动 Eval。

1. **先补齐 Runtime 与 Skill 参考之间的差异。** 中英文 `comet-native/reference/commands.md` 仍写着 `next` 每次只执行一个 Action、Builder 必须填写 `submittedAt`。这些说明与上一轮实现不同，容易让 Agent 继续做多余操作。内容同步需遵守项目先中文确认、再英文的规则；本轮仅登记差异。
2. **复用已有轻量领取和回报接口。** `domains/workflow-application/skill-invocation.ts` 已能接收较少领取字段，以 `receipt + result` 回报，并补齐 attempt、inputHash、claimToken 和 outcomeId。Native 可复用这种请求组装方式，保持自己的加载与投影路径，免去 Agent 拆装机械身份字段。收据仍绑定原任务，不能静默替换成最新 Action；实际会话身份仍由执行方提供。
3. **一次取得编辑判断需要的材料。** `native-edit-review-command.ts` 的 observe 已发现正式材料变化，却提示另跑 prepare-applied；后者已有自动准备及沿用当前领取的能力。可合并准备入口，一次返回普通差异、正式原文和分别绑定的判断模板。判断仍由当前 Agent 完成，不能自动保留全部检查或把全部文档编辑归为无行为变化。
4. **收拢同一稳定阶段的重复读取。** `native-sdk-next.ts` 丢弃 `runtime.next()` 返回的 Run 后又 inspect，间接再次加载应用。status 中 diagnostics 与 continuation 也分别查询 Git 工作区。`native-sdk-checks.ts` 的部分补查 preflight 可以传递候选检查已返回的 observedInputs。应复用这些已取得且范围匹配的结果；实际命令执行后重新观察，不能将一次 CLI 请求视为跨写入的缓存有效期。
5. **减少 Builder 表单中的重复必填信息。** 完整 acceptanceReview 已覆盖验收 ID；addressedAcceptanceIds 可考虑作为可选的本轮重点信息。二者不能直接等同：完整自检范围不证明本轮修改了所有验收项。旧输入及历史记录继续可读，逐项证据与独立验收保留。

批量推进只在循环入口执行完整 diagnostics；原来分次执行 next 会重新进入诊断。这是需要补查的边界：每个执行器是否已覆盖写入后的工作区、分支和存储变化。当前静态审查没有复现越权推进或重复副作用，不能把这一观察写成已确认缺陷；后续应针对实际缺口补最小检查，避免每步重新扫描全部内容。

建议先处理说明一致性和请求组装，再合并编辑材料收集与重复读取。自动恢复失败 Builder、降低独立验收频率会改变授权或验收契约，另行设计。

## 第二轮实施与验证

- Native 领取响应新增 `resultRequest`：收据整体绑定原 Run、Action、attempt、inputHash 和 claim，调用方仅填真实业务结果。原 dispatch 入口展开收据，生成稳定 outcomeId，重复相同结果不重复推进，混合输入和陈旧绑定被拒绝。旧 outcomeRequest 保留。为避免重复整份结果模板，新请求引用旧输出模板填写业务结果；领取模板预填稳定令牌。
- Native observe 组合正式材料准备，返回 formalReview 中的原文及判断模板。普通差异和正式材料仍分别绑定提案、由当前 Agent 判断；准备步骤分别获取和释放原锁，不嵌套同一写锁。原文不足仍明确失败，不构造缺失证据。
- addressedAcceptanceIds 可省略，保存为空的本轮重点列表；完整 acceptanceReview 仍必需。旧模板继续提供原字段，避免破坏已有客户端。中英文 Skill 同步说明首轮和本轮行为。
- next 直接使用 runtime.next 返回的 Run；状态投影共享一次只读 Git 观察；补查 preflight 复用候选检查已取得、范围相同的输入观察。实际命令执行前后仍重新观察。连续推进在动作后重新核对绑定分支，存储推进继续使用原 Runtime 的校验与并发保护。

新增回归登记为 `runtime-receipt-result-input`、`native-observe-formal-originals`、`native-builder-optional-iteration-focus`。前两项均取得旧代码失败、新代码通过的同一断言证据；可选重点列表复用已登记的提交案例，增加省略字段、空重点和完整自检保留断言。

实际验证：

- Native 定向 11 项通过；正式材料案例另补普通文件同时变化和两份判断模板的断言，单独通过。
- Runtime dispatch 定向 6 项通过；Native CLI presentation 文件 10 项中最终 9 项通过。旧模板字段兼容失败已修复并定向复验；剩余 Spec 漂移恢复缺少 shape-drift 输出的失败，在未修改的 `784694e3` 隔离副本同样复现，未削弱历史断言。
- Skill 路由与 Native Skill 检查合计 33 项通过，2 项因既有 walkthrough 链接清单失败；这两项在同一基线副本均复现。未修改相关历史断言或 walkthrough 文件。
- Native 资产与自包含检查 6 项通过、3 项按原环境条件跳过。
- 完整构建、TypeScript、lint/架构、生成物、badcase 登记及受影响文件格式检查通过；lint 保留 8 个既有 Dashboard 警告。
- 未运行仓库全量测试、完整 npm 安装验收、真实平台 Hook 或模型 Eval。未量化总体耗时、token 或模型错误率收益。版本保持 `0.5.2`，网站子模块未变，未提交或推送。
