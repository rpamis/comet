# 共享固定应用取消占用审计

当前共享普通 invoke_skill 取消后仍要求进程停止回执的问题已复现，并在父 Agent 的最薄修正后同样本 **3/3 GREEN（9.38秒）**。本 Agent 只写Temp，不改产品/仓库测试/registry；未运行Eval、模型、容器、安装或构建。

## 实际证据

application-platform-cancellation.test.ts复用现有createScopeCycleApplication公开固定应用fixture：创建真正磁盘manifest/Skill，执行prepare、取得原用户Wait批准，再经SDK claim普通invoke_skill。没有调用Skill host的invokeSkill，没有启动检查器/外部任务或假造OS停止；Agent/User/claim明确标记SIMULATED。取消经实际 app runtimeDispatchCommand，output=compact，不带stoppedActions。

修复前2RED/1GREEN：原Run及Action已cancelled，原claim保留且cancellation/executionStop缺失，但新应用cold reload后同范围claim被SCOPE_HELD拒绝；实际cliResponse.continuation=reconcile，附confirmStoppedRequest/stoppedActions。generic claimed call_tool取消仍reconcile的保护反例为GREEN。

父修正后同3probe全GREEN：跨应用cold reload同范围claim成功，旧Run仍完全相同；未运行Skill脚本，因此shared.txt不存在；紧凑实际返回和公开run-view均done，不再含stoppedActions/confirmStoppedRequest；generic call_tool仍holdsScope/reconcile且原claim不变。

RED完整观测：red-scope-cancelled-observation.json、red-view-cancelled-observation.json及 application-cancel-red-results.json/log。GREEN观测：scope-cancelled-observation.json、view-cancelled-observation.json及 application-cancel-green-results.json/log。两轮各独立JSON，未覆盖RED。

## 当前调用链及范围

skill-executor.ts applicationActionHoldsScope原先所有cancelled+claim缺cancellation/executionStop都继续持有。application.ts的workspaceClaimsForRun(:289)、recordHoldsApplicationScope(:324)、storageIndex(:862)、holderSignature(:878)、peer scope(:942)复用该predicate；所以领域自身允许cancel并不自动清除共享占用。

所有loadWorkflowApplication的固定应用都会先创建shared pinnedStore，再把它交给implementation.wrapStore（application.ts约:1193）。Native native-application.ts:529和Classic classic-application.ts:760确实采用这一wrapStore。manifest.base不会绕过shared scope协调。因此Native/Classic定制固定应用绑定的普通写Skill也受同一判据影响。该适用结论来自当前源码链；本批实际运行的是standalone固定应用，未另跑Native/Classic固定应用完整流程，不能把源码分析写成独立执行证据。

app/commands/runtime.ts:842定制应用先loadWorkflowApplication。Classic及standalone紧凑输出使用projectWorkflowApplicationRun；Native的紧凑输出经nativeCliResponse领域投影，因此不能声称Native实际CLI也显示了同一停止模板。其shared scope索引仍复用上述代码。内置application=native/classic-*另走built-in分支；前批Classic builtin取消9GREEN不等于本批shared固定应用已覆盖。

当前domains树没有isRuntimeRunQuiescent标识。owning application.ts:156-160用applicationRunCanClose（同predicate），且只对base=standalone执行close布局。cold reload真实peer claim通过，证明本例没有第二个shared quiescence条件继续拦截；固定Native/Classic本来不在这个close分支，不能把其分区仍active直接判断成取消泄漏。

## 最薄规则与实际副作用

父修正仅使cancelled invoke_skill不再holdsScope；running/unknown仍持有，cancelled call_tool及其他generic Action保留原claim停止确认合同。run-view同样按type区分。ordinary invoke_skill表示交给Agent平台执行的Skill，取消和清理由平台负责，不要求Comet保存另一套进程停止证明。

不能全局删除generic call_tool停止恢复：此类型可能由应用Runtime直接调用实际工具/进程。第三probe只验证保守投影和claim合同，不声称启动/停止了真实OS进程。真正Comet-owned Classic Archive的实际执行/拒绝cancel/原claim恢复已由前批真实OpenSpec两样本证明，见相邻 classic-cancel-audit 最终报告。generic Engine已接受的停止记录和原Action身份验证也不因本次Skill规则变化而删除。

## 历史测试迁移建议

完整4源文件与匹配声明正文冻结在 original-shared-cancellation-test-bodies.json；精确name、业务保留、纯停止握手退休及尚未执行项见shared-cancellation-migration-map.json。

必须迁移的直接旧断言：run-view的“publishes pending stop confirmation…”原fixture明确invoke_skill，应拆成普通Skill取消done，以及保留generic call_tool旧确认模板；cross-application-scope的“retains cancelled ownership…”改为普通取消后冷重载释放；workspace-scope参数化cancel/acknowledgeStopped要拆分普通Skill无需停止证明、同应用cold reload及closed元数据、旧unknown checkpoint恢复隔离、generic Engine停止记录身份校验，不能整条用本批一个happy path替代；application-hook的128child测试保留真的active宽度拒绝，退休仅因为cancelled Skill无proof而计活跃的部分，增加取消后不再虚占宽度。

另两个cross-app case中的stoppedActions只是末尾清理输入：无关坏目录不得阻止旧任务取消，以及恢复旧unknown writer前不能释放fence。这些正文保护必须保留，可仅移除普通Skill取消的停止输入并调整标题。相关完整原场景本批未执行，明确pending；current泛化3GREEN不能替代它们。

原未受影响业务完整保留：终态不执行残留child、raw writer fencing、128完成历史不计active width/child归属、warm claim不遍历inactive peer、generic Engine错误claim/attempt/inputHash/placeholder proof/CAS拒绝。已有Engine精确selector在map注明NOT RUN本批，不虚构绿证据。当前registry未修改。

## 可应用文件与验证边界

repository-ready/test/domains/workflow-application/application-platform-cancellation.test.ts是本批3probe的相对import副本，移除Temp观测写出，按仓库.prettierrc格式化；副本未另行执行，父应用后验证。不要用该新文件整体替换任一旧混合文件。

命令：node D:/Project/Comet/node_modules/vitest/vitest.mjs run --config [本目录]/vitest-green.config.cjs。setup覆盖COMET_DATA_DIR、HOME/USERPROFILE、APPDATA/LOCALAPPDATA、CODEX_HOME及XDG数据/配置/缓存/状态目录。证据层是当前源码公开CLI/SDK+真实磁盘/冷重载，未验证生成bundle、发布安装包、真实平台Hook或模型遵循。
