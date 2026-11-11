# Native transition recovery 当前业务迁移原型

原23声明逐项映射；最终repo-ready候选实际36过/0败/0跳过。没有改产品、仓库测试或registry，没有Eval。

## 可直接应用的Temp文件
- repo-ready/test/domains/comet-native/native-transition-recovery.test.ts
- repo-ready/test/fixtures/native-052-transition-journal/non-first-hop-build-to-verify.json（13KB，仅原业务材料/WAL/Run/trajectory/checkpoint，无baseline、scope snapshot或旧执行器）

最终执行：从repo-ready目录调用当前已安装Vitest；repo-ready-result-final.json为真实36/0/0。初次跨盘收集失败、所有中间RED均另存。

## 实际发现并验证的修复
- 普通Archive/next/spec remove隐式转换原状态和消耗原WAL：同一组3项先0/3，主Agent修改后3/0；现在原state/WAL/Run/owner原样、明确提示Doctor--repair。
- Doctor未修可截尾的trajectory：1项RED；主Agent复用现有tail API修正后，截尾与中间坏行反例2/0。最终整组36/0。

## 合同变化与兼容限制
- 不恢复旧v1→v2→v3中间schema creator、snapshot、schema migration或Archive supersede执行器。v1/v2纯parser输入明确由真实v3记录变体构造，不能冒充历史原字节执行证据。
- 历史v1/v2 transition reader继续报告migration-required并拒绝隐式续行；这份原型没有提供其旧执行器端到端恢复。
- 明确Doctor完成真实052的v3原WAL，原Run、原批准eventData/evidenceHash及checkpoint历史不变；裸legacy文档随后转当前portable稳定边界，不等于原SDK旧Run薄升级。
- ordinary三个入口不会触发裸legacy转换；已拥有SDK Run的自动薄适配另有真实旧Run证据，不混用。
- 原忙锁立即报错策略允许变为等待/观察完成，但原事务不得执行两遍；当前诊断token接管且确认也不能删除真实活跃writer。

## 原23项→精确selector

### [0] evaluates an oversized transition journal through schema validation, not a byte cap

- 保留：大文档仍由真实JSON/schema拒绝，不能恢复字节快照预算。
- case IDs：无原登记匹配
- 新selector：
  - `validates an oversized original transition document by JSON/schema rather than retired snapshot budgets`

### [1] continues after an interruption at $label

- 保留：原Run/Change/checkpoint/trajectory只推进一次，三个真实写边界中断可重试。
- case IDs：无原登记匹配
- 新selector：
  - `continues original published prepared WAL exactly once without rebuilding the old creator`
  - `continues original WAL after an interruption at prepared without incrementing twice`
  - `continues original WAL after an interruption at Run-write without incrementing twice`
  - `continues original WAL after an interruption at change-write without incrementing twice`
  - `explicit Doctor repair completes original first-hop WAL once and retains original approval event Run and checkpoint history`
  - `explicit Doctor repair completes original non-first-hop WAL once and retains original approval event Run and checkpoint history`

### [2] fails closed on a %s transition journal whose next Run is still waiting

- 保留：waiting nextRun不得被持久reader或续行接纳，原WAL/state不改。
- case IDs：无原登记匹配
- 新selector：
  - `rejects a waiting next Run in the retained persisted-journal reader without changing bytes`
  - `reads v1 historical journal schema without restoring its removed migration executor and rejects malformed Run data`
  - `reads v2 historical journal schema without restoring its removed migration executor and rejects malformed Run data`

### [3] rejects %s non-first-hop Run identity, ref, retry, and iteration tampering

- 保留：非首跳runId、固定metadata、refs、iteration、retries、previousRun/phase不能篡改。
- case IDs：无原登记匹配
- 新selector：
  - `rejects original non-first-hop identity refs counters and iteration tampering through the retained parser`

### [4] rejects %s first-hop Run metadata, iteration, retry, and previous-run tampering

- 保留：首跳不能发明previousRun、跳iteration、注入pending/retries或改存储refs。
- case IDs：无原登记匹配
- 新selector：
  - `rejects first-hop Run metadata iteration retry and previous-Run tampering from the published WAL`

### [5] rejects %s non-adjacent phases and non-canonical event evidence

- 保留：不跳阶段、不接未知/遗漏event字段、credential、超长summary或伪造evidence/result/artifacts。
- case IDs：无原登记匹配
- 新selector：
  - `rejects phase skipping unknown event fields credential leaks and forged evidence from the original WAL`

### [6] requires a typed v3 operation and does not let spec-rebase bypass advance semantics

- 保留：当前v3 operation必需，不能用spec-rebase绕过advance状态语义。
- case IDs：无原登记匹配
- 新selector：
  - `requires current typed operation and rejects relabeling advance as spec-rebase`

### [7] deterministically migrates an old %s spec-rebase journal into the typed operation

- 保留：旧rebase的Run归属和格式仍可读；不静默运行未知/旧中间schema。
- case IDs：无原登记匹配
- 新selector：
  - `keeps v1 old spec-rebase semantics readable without recreating the removed intermediate migration`
  - `keeps v2 old spec-rebase semantics readable without recreating the removed intermediate migration`
- 合同改变：旧v1/v2 spec-rebase journal→typed v3改写和evidenceHash重算属于删除的中间schema迁移执行器；保留纯reader识别与拒绝静默执行，不宣称旧迁移仍成功。

### [8] preserves a pending journal when the same-revision change content diverges

- 保留：同revision外部状态不可覆盖。
- case IDs：无原登记匹配
- 新selector：
  - `preserves original WAL over a same-revision external change`

### [9] preserves a pending journal when a different valid Run is present

- 保留：不同有效Run不可被原WAL覆盖。
- case IDs：无原登记匹配
- 新selector：
  - `preserves original WAL and change when a different valid Run exists`

### [10] rejects an existing transition event whose full content does not match the journal

- 保留：既有完整trajectory事件必须与原WAL全部内容一致。
- case IDs：无原登记匹配
- 新selector：
  - `does not accept an existing trajectory event whose complete content diverges from the original WAL`

### [11] doctor migrates and exactly-once continues a v1 transition interrupted at $label

- 保留：明确恢复保存原Run、批准事件、checkpoint、已完成事件与输入原文。
- case IDs：无原登记匹配
- 新selector：
  - `explicitly imports a real published prepared migration journal without recreating middle-schema engines`
  - `explicitly imports a real published yaml-committed migration journal without recreating middle-schema engines`
  - `reads v1 historical journal schema without restoring its removed migration executor and rejects malformed Run data`
  - `reads v2 historical journal schema without restoring its removed migration executor and rejects malformed Run data`
  - `explicit Doctor repair completes original first-hop WAL once and retains original approval event Run and checkpoint history`
  - `explicit Doctor repair completes original non-first-hop WAL once and retains original approval event Run and checkpoint history`
- 合同改变：旧v1→v2→v3 phase迁移执行器及其Doctor hooks已删除；改以真实052当前v3 WAL续行和显式portable-migration事务恢复覆盖业务原子性，不将两种schema说成同一运行样本。
- 限制：Removed v1/v2 intermediate migration and supersede execution is not restored or proven; actual frozen old v2 Archive supersede end-to-end recovery is not claimed. Current explicit import/retained record predicates are separately executed.

### [12] migrates and continues a directly persisted v2 transition exactly once

- 保留：真实当前WAL和明确导入恰好一次，不发明旧schema自动续行。
- case IDs：无原登记匹配
- 新selector：
  - `explicitly imports a real published prepared migration journal without recreating middle-schema engines`
  - `explicitly imports a real published yaml-committed migration journal without recreating middle-schema engines`
  - `reads v1 historical journal schema without restoring its removed migration executor and rejects malformed Run data`
  - `reads v2 historical journal schema without restoring its removed migration executor and rejects malformed Run data`
  - `explicit Doctor repair completes original non-first-hop WAL once and retains original approval event Run and checkpoint history`
- 合同改变：旧v2 phase-journal到v3的执行步骤不恢复；历史格式只读识别migration-required，真实052 v3 WAL和明确portable import另测。
- 限制：Removed v1/v2 intermediate migration and supersede execution is not restored or proven; actual frozen old v2 Archive supersede end-to-end recovery is not claimed. Current explicit import/retained record predicates are separately executed.

### [13] recovers a v1 transition migration interrupted after writing the v2 journal

- 保留：真实portable prepared/yaml-committed边界重入不重复写。
- case IDs：无原登记匹配
- 新selector：
  - `explicitly imports a real published prepared migration journal without recreating middle-schema engines`
  - `explicitly imports a real published yaml-committed migration journal without recreating middle-schema engines`
  - `reads v1 historical journal schema without restoring its removed migration executor and rejects malformed Run data`
  - `reads v2 historical journal schema without restoring its removed migration executor and rejects malformed Run data`
  - `explicit Doctor repair completes original first-hop WAL once and retains original approval event Run and checkpoint history`
  - `explicit Doctor repair completes original non-first-hop WAL once and retains original approval event Run and checkpoint history`
- 合同改变：旧中间v1→v2 journal写入的重入步骤不恢复；明确导入当前受支持的真实事务，不重建旧creator/快照。
- 限制：Removed v1/v2 intermediate migration and supersede execution is not restored or proven; actual frozen old v2 Archive supersede end-to-end recovery is not claimed. Current explicit import/retained record predicates are separately executed.

### [14] supersedes a durable v2 Archive transition through the schema-migration journal

- 保留：未明确导入不改原记录、不归档、不伪造接受结果。
- case IDs：无原登记匹配
- 新selector：
  - `does not archive through a pending unaccepted Verify transition or consume its WAL`
  - `explicitly imports a real published prepared migration journal without recreating middle-schema engines`
  - `explicitly imports a real published yaml-committed migration journal without recreating middle-schema engines`
  - `requires explicit Doctor import for ordinary archive and leaves original WAL state Run and owner unchanged`
  - `requires explicit Doctor import for ordinary next and leaves original WAL state Run and owner unchanged`
  - `requires explicit Doctor import for ordinary spec-remove and leaves original WAL state Run and owner unchanged`
- 合同改变：旧v2 Archive transition被schema migration自动supersede到Build的策略退休；普通Archive/next/spec remove不得触发迁移或动原WAL/state，必须明确Doctor。该原型没有声称继续执行已删除的v2 supersede策略。
- 限制：Removed v1/v2 intermediate migration and supersede execution is not restored or proven; actual frozen old v2 Archive supersede end-to-end recovery is not claimed. Current explicit import/retained record predicates are separately executed.

### [15] recovers a pending v2 Archive supersede interrupted after $label exactly once

- 保留：中断记录不被普通命令消耗；当前明确导入事务可重试。
- case IDs：无原登记匹配
- 新selector：
  - `does not archive through a pending unaccepted Verify transition or consume its WAL`
  - `explicitly imports a real published prepared migration journal without recreating middle-schema engines`
  - `explicitly imports a real published yaml-committed migration journal without recreating middle-schema engines`
  - `requires explicit Doctor import for ordinary archive and leaves original WAL state Run and owner unchanged`
  - `requires explicit Doctor import for ordinary next and leaves original WAL state Run and owner unchanged`
  - `requires explicit Doctor import for ordinary spec-remove and leaves original WAL state Run and owner unchanged`
  - `explicit Doctor repair completes original first-hop WAL once and retains original approval event Run and checkpoint history`
  - `explicit Doctor repair completes original non-first-hop WAL once and retains original approval event Run and checkpoint history`
- 合同改变：旧v2 Archive supersede的所有逐hook重试步骤退休；改为原事务保留和明确导入的幂等边界。没有实际旧v2 Archive supersede字节样本的端到端恢复证据。
- 限制：Removed v1/v2 intermediate migration and supersede execution is not restored or proven; actual frozen old v2 Archive supersede end-to-end recovery is not claimed. Current explicit import/retained record predicates are separately executed.

### [16] serializes concurrent transitions for the same change

- 保留：同一原WAL并发不得重复副作用。
- case IDs：无原登记匹配
- 新selector：
  - `serializes concurrent continuation of one published transition without duplicate events`
- 合同改变：原并发第二调用立即Native lock busy的报错策略不要求保留；当前允许等待后观察已完成WAL，但只完成一次、不重复Run/trajectory。

### [17] writes the prepared journal before the first trajectory event

- 保留：WAL持久化先于Run、checkpoint和trajectory写入。
- case IDs：无原登记匹配
- 新selector：
  - `has the real prepared WAL durable before any trajectory or Run side effect`
- 合同改变：移除旧advanceNativeChange creator fixture；以真实052原prepared字节和当前prepareNativeTransition WAL API证明先有WAL、后有Run/trajectory。

### [18] doctor atomically removes only an incomplete final trajectory line before continuing

- 保留：只读诊断不截尾；仅明确repair截合法不完整尾部并续同一WAL一次。
- case IDs：native-incomplete-trajectory-status-recovery
- 新selector：
  - `explicitly truncates only an incomplete last trajectory line then continues the same WAL once`
  - `retains explicit Doctor tail repair and same-WAL continuation for the original incomplete-trajectory badcase`
- 合同改变：旧doctorNativeProject聚合API被移除，迁移到当前nativeDoctorCommand的明确repair；真实尾部RED已经由主Agent修复，保留截尾和原WAL恰好一次的业务断言。

### [19] never truncates a malformed middle trajectory line

- 保留：中间坏行不截断、不更改Run/state或删除原WAL。
- case IDs：native-invalid-middle-trajectory-doctor, native-missing-trajectory-runtime-diagnostics
- 新selector：
  - `never truncates a malformed middle trajectory line or clears its original WAL`
  - `keeps malformed middle trajectory bytes and original WAL unchanged during explicit Doctor repair`

### [20] refuses to overwrite trajectory events appended after tail inspection

- 保留：截尾准备后有并发append必须保留新增字节，拒绝覆盖。
- case IDs：无原登记匹配
- 新selector：
  - `preserves concurrently appended trajectory bytes when preparing tail repair`

### [21] requires explicit doctor takeover before continuing stale transition locks

- 保留：没有明确确认不得接管，真实活跃writer即使token确认也不能删除。
- case IDs：无原登记匹配
- 新selector：
  - `requires explicit confirmation for the original real writer metadata before finishing its WAL`
  - `preserves both original root and transition writer metadata until each explicit confirmed takeover`
  - `does not remove an actually held transition writer even when its exact token is confirmed`
- 合同改变：旧调用按owner字符串id接管改为当前诊断返回的精确token并显式确认；真实root/transition写锁与实际活跃writer仍受保护，不属于PID进程停机握手。

### [22] requires pending Verify recovery before archive preview and commit

- 保留：pending未验收状态不得Archive，不得借普通命令迁移/改state/WAL/Run/owner。
- case IDs：无原登记匹配
- 新selector：
  - `does not archive through a pending unaccepted Verify transition or consume its WAL`
  - `requires explicit Doctor import for ordinary archive and leaves original WAL state Run and owner unchanged`
  - `requires explicit Doctor import for ordinary next and leaves original WAL state Run and owner unchanged`
  - `requires explicit Doctor import for ordinary spec-remove and leaves original WAL state Run and owner unchanged`
- 合同改变：旧预检直接恢复入口改为普通Archive/next/spec remove只读阻断并返回Doctor--repair；明确Doctor才完成原WAL及portable导入。

## 未执行
- model Eval
- actual platform Hook
- npm package/install or generated command bundle validation
- repository full suite
- historical v1/v2 intermediate migration executors or old v2 Archive supersede end-to-end recovery

原正文、全部expect与原文件完整字节已保存migration-map.json，主Agent应用前应按既有规范归档并逐行为更新映射；36项通过不授权整组静默删除历史业务。