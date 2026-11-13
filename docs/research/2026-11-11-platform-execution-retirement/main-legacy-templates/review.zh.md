# Main 15 + worker 24 旧模板 Spec Review

基线 `630ce380787f446e803f94b4b90cbbdbf8663364`。15与24含同一original-claim模板，合计38个唯一旧模板。原全文及逐体断言在本目录JSON/全文备份。不是24项全部纯worker；逐体判定14项纯机制、10项混合业务。

## 需要先处理的两类缺口

1. **真实052 Build前沿错误续行（已复现）**：`C:/Users/BENYM/AppData/Local/Temp/native-052-build-check-frontier-xto3Ac`。实际旧factory3接受Builder request-checks，分别冻结pending与claimed的原Run/批准/原字节，executors=[]未运行检查。当前owned load给verify.verifier ready；当前公开native next exit0且healthy:true/dispatch-verifier，但state仍build、builder_handoff=null。根因为upgradeNativeRun通用latest Builder分支把build.checks误当已有候选的Verify检查。最薄适配仅将原build.checks业务前沿回当前Builder，不恢复factory/检查/停止握手。#545两个原ID/source保留，旧invalid completed outcome/stop机制明确退休；不能用Verify前沿代称同一用户Run已验证。

2. **当前claim纠正目标缺少原业务断言**：native-rejected-check-proof-original-claim-correction需在现有同claim目标补拒绝ledger成功后仍保留、旧outcome重交不能覆盖、无重复Verifier/Archive并实际绿；native-verifier-position-diagnostic需补旧iteration/attempt→当前expected/received及原claim新outcomeId更正。Engine源码已有rejectedOutcomes存储，属定向断言/映射缺口，不要求恢复旧checker。

## 21 sharedAppliedArchive IDs

当前主档四个appliedUnknown变体都仍保留，真实当前图与原事务/claim/mtime/单次Archive恢复断言保留；root结果5/0还含cancelled事务业务。此15模板移除无需替换这21处shared selector。所有其他文件和业务链接原样保留，不能覆盖整个case.testMigration.tests。各原ID列表见review.json。

## 15模板

- 0 `repairs only the known pre-Child-archive definition and preserves Run facts (%s)`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 1 `repairs failed Supervisor Children and serializes integration after a definition upgrade`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：native-299-real-integration-parent-verify。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 2 `continues a healthy previous-definition Run without an upgrade or replacing its claim`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 3 `upgrades a stopped check Run without replaying its execution (tampered=%s)`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 4 `revalidates approved report %s changes without losing valid evidence`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 5 `rejects a file symlink backup for an old Archive %s transaction`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 6 `recovers an old Archive %s transaction by matching its original candidate evidence`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 7 `records an already-finalized %s receipt as history without revalidating changed implementation`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 8 `resumes the original finalize after interruption at %s without replaying applied side effects`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 9 `preserves the interrupted finalize when %s no longer matches its original evidence`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 10 `resumes a legacy finalize after rename using the original candidate evidence`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 11 `does not overwrite a changed pre-finalization report while resuming the original finalize`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 12 `rejects a rewritten frozen transaction even when the canonical Spec matches that rewrite`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 13 `keeps recovery blocked when neither the original transaction nor a complete receipt survived`：批准当前业务replacement方向，保留原case/source；执行证据必须逐名称引用，不把synthetic old图或人工缺binding说成真实发布052。 原case IDs：无。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。
- 14 `requires fresh verification instead of trusting a legacy check without a candidate digest`：保留业务；当前claim target补ledger/重复提交/位置诊断实际绿后才批准原checker模板退休。 原case IDs：native-rejected-check-proof-original-claim-correction。具体现有target沿原逐行为map，failure/input18过+Windows2个link skip；WSL link结果为root另行执行证据。

## 24 worker模板逐体

- 0 / L588 `reconciles legacy interruptions using explicit stop evidence and the original execution lease (lease=%s)` [retire-mechanism]：stop evidence/lease/EPERM owner归Comet受管检查器；不保留握手。保原native-531 case其它业务selector。 case ID：native-531-legacy-eperm-stop-recovery。
- 1 / L844 `stops public next after failed checks without dispatching a Verifier` [split]：停止自动检查失败→不派Verifier的受管步骤退休；真实平台reported check失败不可当pass保留，由新verification-business实际Node7正反例承接。native-next-drain-internal-actions其它用户Wait/handoff/单次Archive selector不动。 case ID：native-next-drain-internal-actions。
- 2 / L4522 `executes the Builder-bound check plan before dispatching an independent Verifier` [retire-mechanism]：Builder-bound Comet计划执行/日志/receipt summaries读取退休；当前Agent报告和独立Verifier保留。 case ID：无。
- 3 / L4862 `recovers a real complete check receipt without running its side effect again` [retire-mechanism]：Comet checker完成收据恢复与once计数机制退休；旧业务Run转换不执行旧checker，新原事务恢复另有真实CAS/WAL证据。 case ID：无。
- 4 / L4944 `recovers an invalid completed Build check through doctor without replay (%s)` [split-pending-real-frontier-fix]：#545两case原ID/source必须保留。停止确认/invalid outcome/log sidecar协议退休；原Build检查前沿的原Run/批准/未完成Builder业务必须续行。真实052 pending/claimed前沿已复现当前CLI错误调度Verifier，待薄修与同原字节GREEN，不得用仅Verify检查前沿称已覆盖。 case ID：native-invalid-completed-check-recovery, native-invalid-completed-check-guidance。
- 5 / L5146 `reconciles an actual dead check owner into a stopped repair and completes a fresh candidate` [retire-mechanism]：dead owner/PID/停止回执/旧check中断结果均退休；不再执行旧命令或假造其pass/stop。 case ID：无。
- 6 / L5442 `recovers a real reserved-before-child owner exit without replay (cancel=%s)` [retire-mechanism]：reserved-before-child process注册/stop/cancel证明退休；当前Run cancellation及已应用Archive事务拒cancel两项仍独立保留。 case ID：无。
- 7 / L5585 `reconciles a legacy unregistered execution only with original-host stop evidence and keeps every result unknown` [retire-mechanism]：legacy unregistered旧执行器原host停止确认入口退休，不以新框架复活。旧Action/claim作为业务历史保留，不代表已停止。 case ID：无。
- 8 / L5652 `rejects legacy interruption reconciliation if a late process registration appears before commit` [retire-mechanism]：late process registration并发守卫仅服务已删除监管机制，整个端口退休。 case ID：无。
- 9 / L5711 `reconciles %s check receipts under the fixed old definition before upgrading it` [split]：固定旧factory对checker receipt核对退休；原repair-only用户Wait/提案仍要保留，由published升级测试 retains the old repair-only decision...承接。 case ID：无。
- 10 / L6520 `runs Verifier-requested checks before accepting a final result from the same execution` [retire-mechanism]：Verifier request-checks→Comet调用执行器协议退休；普通测试交平台，最终报告与批准仍保留。 case ID：无。
- 11 / L6593 `rejects a Verifier pass after a requested Runtime check failed` [split]：Verifier请求Runtime检查这一路由退休；已实际失败的平台报告不能变pass，新verification-business Node7测试保留失败报告。 case ID：无。
- 12 / L6656 `rejects a conflicting command reused under the same Verifier check ID` [retire-mechanism]：检查ID→argv baseline及冲突缓存机制退休，不造替代baseline；原native-rejected-check-request-no-baseline保ID/source归档该机制，不能改名绕过。 case ID：native-rejected-check-request-no-baseline。
- 13 / L6712 `does not reserve a check ID or command from a rejected Verifier request` [split-needs-position-evidence]：check ID/command占用机制退休，但native-verifier-position-diagnostic的expected/received iteration/attempt与原claim更正是活跃final-result合同；须在现有sameclaim目标加旧轮次→正确轮次、新outcomeId、拒绝ledger/不重放断言并实际跑。 case ID：native-verifier-position-diagnostic, native-rejected-check-request-no-baseline。
- 14 / L6784 `rejects a Verifier check ID that conflicts with a required Runtime check` [retire-mechanism]：Verifier check ID与required Runtime check的冲突机制退休。 case ID：无。
- 15 / L6831 `rejects a second Verifier request that contains no new checks` [retire-mechanism]：同一Verifier二次无新增检查请求的预算/计划拒绝退休。 case ID：无。
- 16 / L6877 `lets a new Verifier session reuse requested checks after the prior session fails` [split]：requested checks复用退休；Verifier执行失败后新任务仍绑定原候选、原失败不可覆盖保留在当前Verifier重试/业务loop测试，不能保旧检查缓存。 case ID：无。
- 17 / L6960 `reuses a completed non-repeatable Runtime check requested by the Verifier` [retire-mechanism]：非重复Comet检查复用/计数机制退休，平台负责真实执行。 case ID：无。
- 18 / L8334 `requires fresh verification instead of trusting a legacy check without a candidate digest` [split-needs-original-claim-ledger-evidence]：native-rejected-check-proof-original-claim-correction保ID/source。当前foreign Verifier candidate原claim纠正目标已3绿，但需补成功后rejectedOutcomes完整保留、旧outcome重复不能改写、无重复Verifier/Archive。原checker digest与错误代码专用约束退休，不声称新报告是052旧收据。 case ID：native-rejected-check-proof-original-claim-correction。
- 19 / L9103 `keeps real check stop proof through cancel and cold copy without replay` [retire-mechanism]：check stop proof通过cancel与cold copy的监管记录退休；不是把普通SDK/Portable原Run/claim搬运业务整体删除。 case ID：无。
- 20 / L9381 `rejects one-time check plans before v2 verification execution` [retire-mechanism]：one-time/repeatable Comet check plan入口退休。native-repeatable-verify-plans保原来源；不新增平台计划校验。 case ID：native-repeatable-verify-plans。
- 21 / L9402 `returns one receipt result template for a claimed v2 Verifier` [split-ready-current-target]：native-single-result-template保ID/source；当前 omits unused recovery and failure templates for a healthy v3 Verifier 实际用factory4，完整保单一receipt/resultRequest与不重复嵌套template。只撤checkRequestTemplate.repeatable和旧v2 factory依赖；可直接迁精确selector并定向跑。 case ID：native-single-result-template。
- 22 / L9433 `reuses a Build check only when the Agent selects the original execution (edited=%s)` [split]：Build检查reusedFrom原执行器与内容判断退休；Agent直接报告实际结果，不保旧plan/action fingerprint。native-classic-check-plan-continuation中的其他Classic/文档业务链接不动，native-build-managed-check-reuse仅登记管理复用功能撤下。 case ID：native-classic-check-plan-continuation, native-build-managed-check-reuse。
- 23 / L10289 `preserves a committed Builder result when its internal check cannot start` [split]：后续internal checker不能start的故障触发已不存在，保原native-task-recovery-boundaries其它selectors；Builder已提交候选/真实原result仍是业务。可关联当前records a claimed Builder handoff...及commits acceptance without report Actions...作持久业务去向，但不能宣称重现旧checker失败边界。 case ID：native-task-recovery-boundaries。

## 登记边界

- 保每个原ID、source、behavior/reproduction/expected/forbidden历史，不将开发新title换ID逃过原selector。对于feature removed只追加明确退休的机制和本轮完整原文/patch/逐行为映射，当前业务target单列。
- native-single-result-template可直接薄迁当前factory4单一模板target，repeatable schema部分退休；标题中v3是历史命名，不等于旧factory。
- native-299-real-integration-parent-verify保历史登记，原synthetic preChild图退；使用当前真实Git DAG8、review3、reverse parallel两次失败/旧proposal拒绝1和真实published Child前沿。requiredNames须用实际JSON中8个完整参数名，不能用`... restart (`这种标题前缀冒充完整测试名。local-native-supervisor-auto-preparation其它targets保留。
- #545两条尚不能称当前旧Run升级已解决；pending/claimed实际数据已RED，原已完成且invalid durable outcome此次未运行/未伪造，停止协议撤下不能等同原CLI停止修复路径继续可用。

## 实际与未执行

本Review不重跑仓库测试。已读取root结果：archive-current20中18过2Win skip；Supervisor11/0、parallel1/0、candidate correction3/0、cancelled+appliedUnknown5/0、retained-business32/0。仅额外执行明确授权的Temp真实052工厂及当前公开CLI前沿探针，没有注册/运行检查executor；无Eval、无全量、无产品/仓库测试/registry写入。
