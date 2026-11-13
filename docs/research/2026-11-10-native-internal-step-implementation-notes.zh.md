# Native 内部步骤合并的实现核对

2026-11-10，`053`，基线 `630ce380787f446e803f94b4b90cbbdbf8663364`。本记录只研究实现，不修改产品；保留工作区 #545 等既有修改。

## 当前实际执行范围

`native-sdk-next.ts:865` 的 `shape.revalidate` 直接读取 `run.outputs['shape.prepare']`，随后仍 claim、recordOutcome、创建内存 staging Runtime 并发布一个 revision（第 879–931 行）。这是可以合并的确定性内部转换，不需要另一项执行。

普通 Native v3/v4 已在 `native-sdk-application.ts:2764` 的 `verify.confirm approved` 分支直接调用 `confirmNativeSkillCoordinatedPass` 并进入 `archive.prepare`。因此不能再声称删除 `verify.revalidate` 会给普通 v4 额外减少这一轮执行。剩余有意义的删除主要在 Supervisor：用户批准完整 Parent 验收后，当前仍经 `verify.revalidate` 才进入 `supervisor.parent.deliver`。

`native-sdk-report.ts:213` 的 `acceptedResult` 对 v4 不再核对受管检查，而是核对当前 Builder、Verifier、用户批准和报告 metadata。其批准核对可合入确认转换；实际 Parent Git 交付仍由 `native-sdk-supervisor-deliver.ts:48` 的已批准候选、分支和真实 Git 状态校验负责，不能一起跳过。

## 最小兼容方案

建议保持 `defineNativeWorkflowApplication(version)` 的对外签名，内部将现有工厂拆为私有 `createNativeWorkflowApplication(version, compactInternalSteps)`。公共工厂仅为新 v4 启用合并；v1–v3 构造保持原样。

`nativeSdkApplicationForRun` 当前在第 187 行先精确匹配当前定义，再遍历旧定义变体。应在当前匹配失败且保存版本为 v4 时，用私有工厂构造合并前 v4，并经现有 `nativeSdkMatchesRun` 精确匹配；成功后返回整份旧应用，包括旧 transition handler。不要只换旧 workflow 却继续使用绑定了新合并行为的 handler。

这样不需要增加项目配置、公开 factory 参数或新的指纹机制。保存的旧 v4 Run 可继续原 Action；新 v4 使用精简定义。未知定义仍由 Runtime 拒绝。固定应用保持其原 manifest、定义和实现；`native-application.ts` 的扩展工厂目前基于旧定义，不能把该变更强加到固定应用。

`native-runtime-ownership.ts:198` 的显式旧定义升级主要围绕默认 v1 和固定应用，不能假定它会自动替 v4 消除已存在的旧 Action。不要通过重写 Run 历史解决步骤删除；原 `running`、`unknown`、已接受结果、批准和副作用继续原定义恢复。

## Shape 合并需要同时改变的来源绑定

新定义在 `shape.confirm approved` 或 `supervisor.shape.confirm` 选择完成时直接确认验收：

1. 从当前批准所绑定的已完成 `shape.prepare` 读取原 proposal。
2. 沿用 `confirmNativePortableAcceptance` 更新阶段；Supervisor 还保留用户选定的 coordination mode。
3. 普通任务直接进入 Builder。Supervisor 将 `children_contract_ref` 绑定到该 `shape.prepare` Action ID，保存原 children contract，再进入 `supervisor.prepare`。

不要制造假的 `shape.revalidate` outcome 来满足旧消费者。当前强依赖该结果或分界的模块有：

| 来源                                               | 当前职责                                    | 新定义调整                                                                               |
| -------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `native-sdk-application.ts:1737`、`:1811`、`:2155` | Parent/Child 构造读取已确认 child proposal  | 用当前 `children_contract_ref` 所指的已完成 Shape Action，兼容旧 revalidate 和新 prepare |
| `native-sdk-supervisor-prepare.ts:40`              | 读取已确认子任务合同                        | 已支持 revalidate/prepare 回退，仍须核对原批准和当前合同归属                             |
| `native-sdk-supervisor-plan.ts:10`                 | 仅采用当前 Shape 后的 child 执行事实        | 使用当前合同引用定位 Shape 分界；避免旧轮 child 污染新轮                                 |
| `native-sdk-review.ts:16`                          | 阻止以前 Shape 的独立审查要求污染当前候选   | 新 prepare 也作为 Shape 分界，旧 revalidate 行为保留                                     |
| `native-sdk-supervisor-recovery.ts:57`             | 旧 v1 blocked Child 恢复读取原批准 proposal | 该入口只用于 v1，保持旧语义；共享帮助函数时不要改变其验证要求                            |
| `native-sdk-state-store.ts:133`                    | 内部 Action 不触发外部边界快照              | 删除新图的步骤后不再经过它；旧步骤名单保留服务旧 Run                                     |

`native-application.ts:127` 还读取旧 revalidate 的 formalHash，但固定扩展应用目前走 v1；不应为新内置 v4而削弱其原审查绑定。

## Verify 合并需要保留的顺序

`native-sdk-application.ts:2717` 起先查找当前 Wait/decision/proposal，并经 `nativeSdkVerifyWaitDecisions` 判定当前 choice 可执行；该顺序保留。

新 v4 的 Parent approved 分支可直接调用 `confirmNativeSkillCoordinatedPass`，再复用当前第 2863–2893 行的 Parent Builder activation、integration commit 与 candidate ID 构造，进入 `supervisor.parent.deliver`。普通 approved 路径保持已有直接 Archive 行为。rejected 与 reverify 仍走原修订/验收分支。

新图删除 `shape.revalidate`、`verify.revalidate` 的 steps、executor/validator 引用和相关边，补充批准到真实后继的边。旧图全部保留。不能删除实际 Archive preflight、Parent delivery 或它们的恢复收据。

## 建议的定向测试

### 新定义

- `native-agent-checks.test.ts` 的源码和 bundle 流程：Shape 批准后直接领取 Builder；原 Run 中从未出现两个被移除 Action；实际检查报告、独立要求、用户接受和 Archive 继续完整完成。
- `native-sdk-application.test.ts` 中 `integrates two agent-managed children and retains the complete parent acceptance without Runtime checks (interrupted merge: %s)`：两种中断参数均保留，实现真正 Parent 验收、交付与恢复；增加不存在内部转交 Action 的断言。
- `native-agent-supervisor-business.test.ts`：当前业务领取、缺失材料修正、两个 Child 和 Parent 路径仍可完成。
- 新增精确来源反例：重新确认 Shape 后不使用旧 child 事实；旧 Builder 的独立验收要求不污染新 Shape。

### 旧定义与固定应用

- `native-sdk-definition-selection.test.ts`：新增“精确识别合并前 v4”及未知 hash 仍拒绝；已有 v1 已知定义集合、normalized definition 快路全部保留。
- 保存真实合并前 v4 的 Run/定义身份，分别在 `shape.revalidate pending` 和 Supervisor `verify.revalidate pending/unknown` 处恢复；断言沿原 Action、原批准继续，不重新执行已完成的真实工作。不要只用新工厂构造所谓旧 fixture。
- `native-sdk-supervisor-verifier-recovery.test.ts` 的固定应用、旧 hash、晚结果和 sibling 保留测试不改断言。
- `native-sdk-supervisor-revise.test.ts` 的旧 Run 修订与重新确认测试不减少来源/恢复覆盖。

### 可以调整的测试准备代码

`native-sdk-application.test.ts:10412` 的 `nativeSupervisorReviewFixture(version, ...)` 在用户选择 coordination mode 后无条件回交一次 Shape 结果（约第 10482 行）。新 v4 此时已进入 `supervisor.prepare`，应仅在当前 Action 实际为 `shape.revalidate` 时回交，v2/v3 仍执行原步骤。这是匹配新定义的 fixture 调整，不应降低实际 Child/Parent/中断断言。

新定义专用断言可由“存在内部步骤”改为“直接进入同一业务后继”，但必须新增旧 v4 的原步骤恢复证据。现有 v1–v3 和固定应用断言应保留；历史登记不能通过改名、删除或 skip 绕过。

## 验证边界

本记录完成源码、定义选择、恢复入口和测试准备的只读核对，未执行产品修改或测试，未运行 Eval。实现后应先跑上述定向用例，再构建 Native/Entry runtime 并验证生成物；最后按用户目标执行本地全量测试。完整模型质量不在本记录的已验证结论内。

## 当前候选复核：兼容缺口与最小补充

复核依据为当前未提交 diff 和 `2026-11-10-runtime-cleanup-implementation.zh.md`。以下结论不把“定义匹配成功”替代实际旧 Action 恢复。

### 已发现并修正的原 v4 变体选择遗漏

初版 `nativeSdkApplicationForRun` 新分支只匹配完整合并前 v4，没有继续匹配 `nativeSdkLegacyDefinitions(originalV4)`。这组变体是旧选择器本来接受的格式；用冻结 `test/fixtures/native-v4-internal-actions/workflow.json` 执行只读源码探针，7 个变体中只有第 0 项仍识别，第 1–6 项会落到新图，随后产生 `WORKFLOW_CHANGED`。

已将该问题交给主 Agent，当前代码增加了对旧 v4 自身 legacy 变体的匹配，并套旧应用的 transition adapter；第二次同一探针得到 7 项全部识别。当前测试文件也已加入参数化变体选择断言。该修正仅证明选择恢复，不证明每个原 Action 都经过了公开 CLI 继续执行。

探针调用使用既有源码 loader，比较 `nativeSdkLegacyDefinitions(originalV4)` 每项与 `nativeSdkApplicationForRun` 返回定义，未修改文件、未启动 Eval。

### 尚缺旧 Supervisor Verify Action 的执行证据

当前 `native-sdk-definition-selection.test.ts` 新增的是旧 v4 **Shape** 的 pending/unknown 回交。它证明原图和 Shape handler 被选中，但没有经过旧 Supervisor `verify.revalidate`、报告 validator、Parent delivery 或 unknown 恢复入口。

最小补充可复用 `nativeSupervisorReviewFixture` 及双 Child/Parent 验收流程，为测试准备 helper 增加可选的应用实例参数，传入由冻结原图经 `nativeSdkApplicationForRun` 选出的旧 v4。完成一次真实 Child 集成和 Parent 验收，用户批准后确认当前 Action 仍是原 `verify.revalidate`。不要把新 v4 的直接 delivery 当成旧夹具。

对该合法边界分别验证：

1. **pending**：通过重新加载的原定义 Runtime 执行 `comet-native-report-revalidate`，断言旧 Action ID/attempt 和 workflow hash 未变，已接受的 Parent/Child 结果及批准不变，只新增一个 `supervisor.parent.deliver`。随后真实交付正常完成。
2. **unknown**：先用原 executor 领取，标记 unknown，保存并重新选原定义；经 `recoverNativeSdkReportRevalidation` 或公开 next 恢复，断言原 claim/Action 被收敛，不重跑任何 Child、检查或 Git merge。再次恢复不创建第二个 delivery。最后继续同一 delivery。

优先把旧 v4 作为现有双 Child 场景的参数，以复用真实路径；新/旧两个图的最终业务和副作用断言应相同，新图额外断言两个内部 Action 不存在，旧图额外断言它们仍按原 ID 恢复。若先用内存 Runtime 做定向回归，实施记录应如实标记该层，不能写成公开 CLI 验收。

`recoverNativeSdkReportRevalidation` 目前只处理 executor 匹配的 unknown `verify.revalidate`，仍通过旧 selector 返回的 validator 提交结果，因此从源码看保留了恢复路径；上述缺口是缺执行证据，未据此断言存在另一处已复现故障。

### 当前 Shape 来源绑定还需两个小反例

当前候选已将 application 中三个 proposal 读取改成 `state.children_contract_ref` 所指 Action 的 outcome。`confirmSdkShape` 将新图合同绑定到成功的 prepare；`currentNativeSdkSupervisorActions` 增加该引用作为分界；独立审查扫描遇到 prepare 也停止。这些修改方向一致。

建议在现有纯模型测试中增加两个精确行为，成本远小于再建完整 Git 工程：

- `native-sdk-supervisor-plan.test.ts`：同一 Run 放入旧 revalidate/旧已集成 Child、新 prepare/新 Child，当前 `children_contract_ref` 指向新 prepare；结果只能包含该引用之后的事实。保留旧 ref 指向 revalidate 时的原行为断言。
- 独立审查测试：旧 Shape 的 Builder 要求独立审查，新 prepare 后当前 Builder 未要求；当前 Verifier 不继承旧要求。当前 Builder 明确要求时仍必须独立。通过公开 `nativeSdkRequiresIndependentReview` 验证。

现有新 v4 Source/Bundled Supervisor 正常流程中，再断言合同引用对应成功的 `shape.prepare`、其 child contract 与当前 state 合同一致，并在 Child/Parent activation 中保持该引用。这样可直接约束本次来源替换，避免仅靠“流程最后完成”间接推断没有跨轮污染。

### 不把版本号当作新图识别

`native-sdk-supervisor-deliver.ts` 当前用 `run.workflow.version === '4'` 放行无 revalidation 的新路径，这也覆盖原 v4。但原 v4 的合法图只有在 revalidation 成功后才会调度 delivery，且当前 delivery 仍要求 Archive 状态、原批准、Parent 候选和真实 Git 绑定。因此尚未发现仅凭此行可通过合法流程绕过批准的证据，不建议为理论状态篡改新增多层防御。

应通过上述旧 pending/unknown 测试确认：旧图依然执行原 revalidation，新图才直接交付。若以后需要精确区分新旧图，应复用已选定义/真实调度事实，不能仅将“v4”视为新流程，也不引入新的文件指纹或授权参数。
