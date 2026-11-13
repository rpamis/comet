# 17个Archive/冲突/Spec重合并旧声明迁移（Spec轴）

仅Temp原型/报告，无产品、仓库测试或registry修改。基线 `630ce380787f446e803f94b4b90cbbdbf8663364`；旧4文件原字节及17个body/assertion/原caseID已冻结。无可直接当纯机制整文件删除的文件；应用业务替代后可退休旧全文。

## 实际验证

- `repo-ready-complete-result.json`：11过，0败，0未选择/跳过。
- `reused-current-result.json`：9过，0败，171未选择/跳过。
- `original-finalize-recovery-result.json`：7过，0败，5未选择/跳过。
- `pending-transition-reuse-result.json`：1过，0败，35未选择/跳过。
- `unsafe-original-input-reuse-result.json`：3过，0败，5未选择/跳过。
- `real-wal-boundaries-reuse-result.json`：8过，0败，0未选择/跳过。

未选中的历史测试不算通过。`repo-ready-complete-result`仅11项当前业务原型；其他结果是单独实际复用执行。

## 两项真实红绿

1. 既有Archive目标：`target-business-red-result.json`7过2败，Portable和SDK在最终移动失败前已将state标成done并应用Spec。主Agent在统一预检仅无原事务时提前检查目标；同源输入 `target-business-green-result.json`9过0败。原finalize7断点及真实moved-WAL合法恢复另独立执行。
2. legacy status：`legacy-status-red-result.json`0过1败，仍指引next自动迁移。主Agent改为Doctor--repair；11项完整结果含原反例绿。不将不同边界单元结果说成已发布安装包验证。

## 合同改变

- Ordinary managed check/timeout/stdout receipt issuance retired; platform reports carry checks.
- No content proof scopes, preflight fingerprint, partial allowance hash or peer radar.
- A same-capability peer is no standalone blocker; real frozen canonical CAS is retained.
- Legacy bare business state requires explicit Doctor import; existing SDK Run adaptation is separate.
- Full-Spec reconciliation is Agent editing plus explicit revise to Shape and fresh confirmation/verification, rather than legacy base_hash refresh to Build.
- Original Archive WAL is resumable and does not imply an unconditional pending-journal blocker.

## 逐原声明映射

### native-archive-inspection.test.ts:56 / 0

`issues automated Git-bound verification receipts through a project parent alias`

判定：retire-mechanism。普通受管命令执行及Git内容绑定自动回执已撤下；原alias场景只断言该回执签发，不是当前Git交付的路径合同。保留原caseID来源，不能宣称旧回执缺陷已修复。

原/已存在case ID：native-automated-receipt-git-parent-alias。建议新增（尚未登记）：无。


### native-archive-inspection.test.ts:231 / 1

`returns a stable ready preview without writing project state`

判定：migrate-business。保留相同输入稳定预览及不写入业务文件；revision/evidenceFreshness/固定预检hash投影撤下。

原/已存在case ID：无。建议新增（尚未登记）：native-archive-preview-business-readonly。

- `Native Archive business migration previews the same current Archive operations without writing business files` → `repo-ready-complete-result.json`

### native-archive-inspection.test.ts:257 / 2

`validates manual acceptance IDs and automated command timeouts before execution`

判定：split。保留acceptance IDs必须覆盖当前范围；未知/缺失/跳过各独立拒绝。旧CLI timeout预算、stdout摘要、自动exit回执签发、可复用receipt依赖均属受管checker退休；平台承担命令退出和超时。

原/已存在case ID：无。建议新增（尚未登记）：native-archive-acceptance-id-boundary、native-archive-verifier-missing-or-skipped-acceptance。

- `Native Archive business migration rejects escaping capabilities and mismatched acceptance IDs at the current boundary` → `repo-ready-complete-result.json`
- `Native Archive business migration refuses skipped acceptance in a passing Verifier outcome without mutating the candidate` → `repo-ready-complete-result.json`
- `Native Archive business migration refuses missing acceptance in a passing Verifier outcome without mutating the candidate` → `repo-ready-complete-result.json`

### native-archive-inspection.test.ts:347 / 3

`binds an existing archive target and pending journal into readiness`

判定：split。既有目标必须在WAL/Spec/State写入前拒绝；真实未接受Verify transition必须阻止Archive。已有原Archive事务不是一律阻塞，须续原事务到原目标。旧随意transition.json={}不映射为合法事务。

原/已存在case ID：无。建议新增（尚未登记）：native-archive-target-exists-before-apply。

- `Native Archive business migration refuses an existing archive target without overwriting it` → `repo-ready-complete-result.json`
- `rejects an occupied Archive target before applying current SDK Specs or accepting done state` → `repo-ready-complete-result.json`
- `does not archive through a pending unaccepted Verify transition or consume its WAL` → `pending-transition-reuse-result.json`
- `source portable mutation boundary: a real pending WAL blocks both Shape return and new SDK change` → `real-wal-boundaries-reuse-result.json`
- `resumes the original finalize after interruption at report without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at report-journal without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at move without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at move-journal without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at portable-receipt without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at runtime-receipt without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at cleanup without replaying applied side effects` → `original-finalize-recovery-result.json`
- `source portable public recovery: explicit Doctor continues a genuine prepared Archive transaction` → `real-wal-boundaries-reuse-result.json`
- `source portable moved archive Doctor: diagnoses by original name without active directory and continues only the explicit transaction` → `real-wal-boundaries-reuse-result.json`

### native-archive-inspection.test.ts:365 / 4

`blocks when another visible change claims the same implementation artifact`

判定：retire-mechanism。自动扫描其他change的implementation_scope内容证明并阻塞归档已撤下。相同capability peer不再单独阻塞；实际canonical写冲突仍拒绝，不复活peer雷达。

原/已存在case ID：native-archive-actual-spec-conflict、native-create-canonical-conflict-after-preflight。建议新增（尚未登记）：无。

- `Native SDK v2 Archive simplification archives a current Spec while another active SDK change declares the same capability` → `reused-current-result.json` / native-archive-actual-spec-conflict,native-create-canonical-conflict-after-preflight
- `Native SDK v2 Archive simplification refuses an actual canonical Spec conflict after preflight without overwriting it` → `reused-current-result.json` / native-archive-actual-spec-conflict,native-create-canonical-conflict-after-preflight
- `source portable remove journal: resumes without deleting an externally recreated Spec` → `real-wal-boundaries-reuse-result.json`
- `source portable applied Spec edit: retains the same transaction and never overwrites later canonical content` → `real-wal-boundaries-reuse-result.json`

### native-archive-inspection.test.ts:392 / 5

`includes the current workspace finishing contract when present`

判定：split。保留原workspace current finish业务及真实Git交付结果；移除单独workspace-v3身份内容投影。

原/已存在case ID：无。建议新增（尚未登记）：无。

- `Native portable Archive allows current workspace finishes to preserve unrelated files while committing change-owned files` → `reused-current-result.json`

### native-archive-preflight.test.ts:49 / 0

`is deterministic across spec order and previews the exact content-bound operations`

判定：split。保留准确Spec操作预览及相同输入只读稳定性、完整create/modify/remove的真实应用。排序/内容摘要/preflightHash形态撤下。

原/已存在case ID：无。建议新增（尚未登记）：native-archive-preview-business-readonly。

- `Native Archive business migration previews the same current Archive operations without writing business files` → `repo-ready-complete-result.json`
- `Native portable Archive applies complete create, modify, and remove Spec operations` → `reused-current-result.json`

### native-archive-preflight.test.ts:76 / 1

`changes the preflight hash when %s changes`

判定：retire-mechanism。11个参数仅断言preflightHash变化，全部属于已删除的内容证明/预检hash投影。批准、原事务、实际canonical CAS有独立业务测试；不以恢复hash来保留这些机械断言。

原/已存在case ID：无。建议新增（尚未登记）：无。


### native-archive-preflight.test.ts:109 / 2

`blocks stale evidence, canonical drift, a pending journal, or an existing target`

判定：split。拆开保留真实目标冲突、canonical CAS、未接受transition阻止Archive。stale evidence摘要失效与一律pending-journal阻塞撤下；有原Archive事务必须可续行。

原/已存在case ID：native-archive-actual-spec-conflict、native-create-canonical-conflict-after-preflight。建议新增（尚未登记）：native-archive-target-exists-before-apply。

- `Native Archive business migration refuses an existing archive target without overwriting it` → `repo-ready-complete-result.json`
- `rejects an occupied Archive target before applying current SDK Specs or accepting done state` → `repo-ready-complete-result.json`
- `Native SDK v2 Archive simplification refuses an actual canonical Spec conflict after preflight without overwriting it` → `reused-current-result.json` / native-archive-actual-spec-conflict,native-create-canonical-conflict-after-preflight
- `source portable remove journal: resumes without deleting an externally recreated Spec` → `real-wal-boundaries-reuse-result.json`
- `source portable applied Spec edit: retains the same transaction and never overwrites later canonical content` → `real-wal-boundaries-reuse-result.json`
- `does not archive through a pending unaccepted Verify transition or consume its WAL` → `pending-transition-reuse-result.json`
- `source portable mutation boundary: a real pending WAL blocks both Shape return and new SDK change` → `real-wal-boundaries-reuse-result.json`
- `resumes the original finalize after interruption at report without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at report-journal without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at move without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at move-journal without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at portable-receipt without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at runtime-receipt without replaying applied side effects` → `original-finalize-recovery-result.json`
- `resumes the original finalize after interruption at cleanup without replaying applied side effects` → `original-finalize-recovery-result.json`
- `source portable public recovery: explicit Doctor continues a genuine prepared Archive transaction` → `real-wal-boundaries-reuse-result.json`
- `source portable moved archive Doctor: diagnoses by original name without active directory and continues only the explicit transaction` → `real-wal-boundaries-reuse-result.json`

### native-archive-preflight.test.ts:126 / 3

`accepts partial evidence only when it binds an exact allowance hash`

判定：retire-mechanism。partialAllowanceHash与evidenceFreshness=partial只服务旧内容证明。当前完整acceptance/明确用户确认继续保留；不宣称兼容旧hash协议。

原/已存在case ID：无。建议新增（尚未登记）：无。

- `Native Archive business migration refuses Archive before Shape approval and completed acceptance without writing business files` → `repo-ready-complete-result.json`
- `Native SDK Workflow Application requires user confirmation before Archiving an independently verified Skill-coordinated pass (memory)` → `reused-current-result.json`
- `Native SDK Workflow Application requires user confirmation before Archiving an independently verified Skill-coordinated pass (sdk)` → `reused-current-result.json`

### native-archive-preflight.test.ts:139 / 4

`blocks Archive when the accepted evidence still contains a skipped criterion`

判定：migrate-business。保留passing verifier不得省略或跳过任何验收；current schema直接拒skipped，缺失ID拒绝，候选和文件不写。

原/已存在case ID：无。建议新增（尚未登记）：native-archive-verifier-missing-or-skipped-acceptance。

- `Native Archive business migration refuses skipped acceptance in a passing Verifier outcome without mutating the candidate` → `repo-ready-complete-result.json`
- `Native Archive business migration refuses missing acceptance in a passing Verifier outcome without mutating the candidate` → `repo-ready-complete-result.json`

### native-archive-preflight.test.ts:149 / 5

`rejects unsafe target refs and malformed operation/base combinations`

判定：split。保留路径不得逃逸及真实事务operation载荷一致性、actual create canonical冲突拒绝。旧expectedBaseHash输入关系随纯预检hash协议撤下；当前target由业务日期/name生成。

原/已存在case ID：native-archive-actual-spec-conflict、native-create-canonical-conflict-after-preflight。建议新增（尚未登记）：native-archive-transaction-input-boundaries。

- `Native Archive business migration rejects unsafe Archive transaction refs and malformed operation payloads without changing a legal transaction` → `repo-ready-complete-result.json`
- `Native Archive business migration rejects escaping capabilities and mismatched acceptance IDs at the current boundary` → `repo-ready-complete-result.json`
- `rejects escaping-ref in original materials of an actual published Archive WAL` → `unsafe-original-input-reuse-result.json`
- `rejects foreign-ref in original materials of an actual published Archive WAL` → `unsafe-original-input-reuse-result.json`
- `rejects invented-original in original materials of an actual published Archive WAL` → `unsafe-original-input-reuse-result.json`
- `Native SDK v2 Archive simplification refuses an actual canonical Spec conflict after preflight without overwriting it` → `reused-current-result.json` / native-archive-actual-spec-conflict,native-create-canonical-conflict-after-preflight
- `source portable remove journal: resumes without deleting an externally recreated Spec` → `real-wal-boundaries-reuse-result.json`
- `source portable applied Spec edit: retains the same transaction and never overwrites later canonical content` → `real-wal-boundaries-reuse-result.json`

### native-conflict-inspection.test.ts:86 / 0

`collects current spec and content-addressed artifact overlap from one Native root`

判定：split。radar关系/信号/内容scope冲突断言退休；原status migrationRequired业务诊断不能删。当前源命令诊断blocked+明确Doctor--repair且不写；不再返回legacy-content-proof-removed重复证据投影。

原/已存在case ID：native-archive-actual-spec-conflict、native-create-canonical-conflict-after-preflight。建议新增（尚未登记）：native-legacy-status-explicit-doctor-import。

- `Native Archive business migration diagnoses legacy business state with explicit Doctor guidance without scanning content-proof peers or rewriting state` → `repo-ready-complete-result.json`
- `Native SDK v2 Archive simplification archives a current Spec while another active SDK change declares the same capability` → `reused-current-result.json` / native-archive-actual-spec-conflict,native-create-canonical-conflict-after-preflight
- `Native SDK v2 Archive simplification refuses an actual canonical Spec conflict after preflight without overwriting it` → `reused-current-result.json` / native-archive-actual-spec-conflict,native-create-canonical-conflict-after-preflight
- `source portable remove journal: resumes without deleting an externally recreated Spec` → `real-wal-boundaries-reuse-result.json`
- `source portable applied Spec edit: retains the same transaction and never overwrites later canonical content` → `real-wal-boundaries-reuse-result.json`

### native-conflict-inspection.test.ts:129 / 1

`fails closed when a visible change points at invalid scope evidence`

判定：retire-mechanism。无效scope evidence使自动雷达fail closed，scope证明与雷达入口均退休；没有活跃业务输入需重新校验此scope。

原/已存在case ID：无。建议新增（尚未登记）：无。


### native-conflict-inspection.test.ts:140 / 2

`does not traverse a symlinked change directory`

判定：retire-mechanism。不跟随symlink change目录属于已删除雷达遍历行为；不会用其它安全测试冒称同入口等价，直接记录入口退休。

原/已存在case ID：无。建议新增（尚未登记）：无。


### native-spec-rebase.test.ts:133 / 0

`refreshes a replace base and reopens Archive to Build for re-verification`

判定：migrate-business。保留replace/modify需求明确重合并后重新批准及完整验收，再写canonical目标。当前Agent编辑目标并显式revise-requirements回Shape，清旧candidate/verification；不恢复旧自动base_hash刷新/Build重验API。

原/已存在case ID：native-archive-actual-spec-conflict、native-create-canonical-conflict-after-preflight。建议新增（尚未登记）：native-revise-spec-preserves-modify-remove-intent。

- `Native Archive business migration revises an accepted modify intent after canonical drift and requires fresh Shape and acceptance` → `repo-ready-complete-result.json`
- `Native SDK Workflow Application returns an unclaimed Build change to Shape when removing an existing capability` → `reused-current-result.json`
- `Native SDK Workflow Application returns Verify to Shape through a persisted requirements revision command` → `reused-current-result.json`
- `Native SDK Workflow Application allows requirements revision before Archive applies Specs but rejects it afterwards` → `reused-current-result.json`
- `Native SDK v2 Archive simplification refuses an actual canonical Spec conflict after preflight without overwriting it` → `reused-current-result.json` / native-archive-actual-spec-conflict,native-create-canonical-conflict-after-preflight
- `source portable remove journal: resumes without deleting an externally recreated Spec` → `real-wal-boundaries-reuse-result.json`
- `source portable applied Spec edit: retains the same transaction and never overwrites later canonical content` → `real-wal-boundaries-reuse-result.json`

### native-spec-rebase.test.ts:198 / 1

`refreshes a remove base and preserves the explicit removal intent`

判定：migrate-business。保留原remove意图跨canonical独立变更和明确修订后仍是source=null remove，清旧验收，重新Shape批准/独立验收后真实删除canonical。current SDK remove命令也保留业务Run。

原/已存在case ID：无。建议新增（尚未登记）：native-revise-spec-preserves-modify-remove-intent。

- `Native Archive business migration revises an accepted remove intent after canonical drift and requires fresh Shape and acceptance` → `repo-ready-complete-result.json`
- `Native SDK Workflow Application returns an unclaimed Build change to Shape when removing an existing capability` → `reused-current-result.json`
- `Native SDK Workflow Application returns Verify to Shape through a persisted requirements revision command` → `reused-current-result.json`
- `Native SDK Workflow Application allows requirements revision before Archive applies Specs but rejects it afterwards` → `reused-current-result.json`

## 未执行

- Eval (no authorization)
- Full repository suite (not required for this slice)
- New installed/package/bundle boundary for the two latest product fixes; deterministic source CLI/domain Runtime tested here.
- WSL/symlink execution for this slice; old receipt/radar linked-directory mechanisms are retired, not replaced with claims of link equivalence.

补充验收：`refuses Archive before Shape approval and completed acceptance without writing business files` 已实过；建议登记 `native-archive-requires-approved-complete-acceptance`（尚未写registry）。SDK目标反例另有 `sdk-target-case.fragment.ts`，可直接追加到现有SDK测试并复用其夹具，避免新增重复helper。
