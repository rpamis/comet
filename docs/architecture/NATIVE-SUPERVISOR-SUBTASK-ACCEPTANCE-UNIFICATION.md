# Native Supervisor 子任务验收、证据与检查执行统一设计

> 状态：Proposed（回应 [issue #389](https://github.com/rpamis/comet/issues/389)，暂未实施）
> 设计基线：`0.4.0-rc.5`（master `c1118e19`），目标版本 `0.4.0-rc.6`
> 影响范围：`domains/comet-native`、Native 中英文 Skill、`test/domains/comet-native`

> 本文为方案设计，尚未实施。文中引用的文件、行号与函数名均核对自设计基线对应的源码；实施时如源码已变化，以当前分支为准重新核对。

## 一、决策摘要

Native Supervisor 的子任务（child）路径与单个 change 的推进共用同一套 Runtime 身份绑定（runId、候选 commit、role 校验）和父级最终全量验收，但子任务**中间过程**的验收校验、证据保护和检查执行弱于通用 Verifier 流程。本设计不推翻"轻量任务包 + 父级完整验收"的架构，而是复用现有机制补齐三个缺口，分四期实施：

1. **P0 统一子任务验收协议**：子任务 Verifier 结果复用通用 Verifier 的逐项验收覆盖与判定一致性校验，binding 来自 children.yaml 的 `covers` 映射。独立可交付，是本设计的核心。
2. **P1a 检查执行接入回执**：子任务的正式检查经 Runtime 执行并产出 `NativeCheckReceipt`，结果以 receipt ref 提交，替代提交方自行声明的检查状态。
3. **P1b 外部证据登记与核验**：子任务的正式外部证据复用 Runtime 内容寻址证据空间登记，引用而非裸路径。
4. **P2 任务包语义增强**：任务包携带子任务验收范围与验收项版本引用；`checks` 为空时必须给出原因枚举。

每期独立产生用户可感知的保障提升，P0 完成后子任务报告即可被 Runtime 程序化拒绝遗漏与矛盾，不再依赖监督者人工核对。

## 二、背景与问题

issue #389 报告：多会话协作下，Supervisor 子任务的验收一致性、外部证据完整性和检查执行状态仍需监督者通过自然语言报告核对，希望可程序化校验的约束在子任务路径统一生效。经与当前源码核对，报告属实，定性为"保障一致性差距"而非缺陷：

| 保障点                 | 单个 change 通用流程                                                                                                                                          | Supervisor 子任务路径                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 验收项覆盖与判定一致性 | `native-verifier-protocol.ts` 的 `validateNativeTrustedVerifierEnvelope` 校验覆盖（拒绝重复/未知/遗漏）、pass 需全部逐项通过、fail/blocked 需至少一项对应结果 | `applyNativeSupervisorVerifierResult` 只校验摘要非空、pass 至少一条检查描述、runId 匹配（`native-supervisor.ts` 的 `applyNativeSupervisorVerifierResult`） |
| 检查执行               | Runtime 执行 check plan 并产出带 `receiptHash` 的 `NativeCheckReceipt`，`authoritativePortableChecks` 以 Runtime 权威结果覆盖提交方声明                       | 检查由子会话自行运行后以文字汇报；`supervisor-integrate` 的 checks 也是提交方声明的 `{name, status, reason}`                                               |
| 证据完整性             | 验证证据按内容哈希绑定（contractHash、acceptanceHash、reportHash 等，见 `native-verification-evidence.ts`），证据文档存于内容寻址的 `runtime/evidence/` 空间  | 子任务证据即 `{summary: string, checks: string[]}`，外部报告、探针输出以裸文本引用，无哈希、无执行引用、无受测候选绑定                                     |

已有的硬兜底（issue 也确认其存在，本设计不改变它们）：

- 子任务结果的**身份绑定**：runId 匹配当前任务、role 正确、候选 commit 落在 `comet/supervisor/<parent>/<child>` 分支（`assertSupervisorTaskCommit`），过期或冒领结果被拒绝并 block 任务。
- **集成检查**：`supervisor-integrate` 要求 checks 非空且全部 passed。
- **父级最终 Verify**：全部子任务 integrated 后，父级在 integration worktree 上走完整的通用 Verifier 流程（`dispatch-verifier` → Runtime 执行检查 → 逐项验收），全部验收项在集成结果上重新验收。

因此风险不是错误交付，而是**中间过程的监督成本**：子任务报告遗漏验收项、描述与结论矛盾、或引用了失效的外部文件时，Runtime 无法拒绝，只能由协调会话人工判断。这正是 issue 建议统一的部分。

另有一个现状细节需要一并处理：子任务验收有两个入口——多会话模式的 `applyNativeSupervisorVerifierResult` 与单会话顺序推进使用的 `markNativeSupervisorChildVerified`，二者当前都是弱校验，P0 必须同时覆盖。

## 三、设计原则

1. **复用优先**：校验逻辑、回执、证据存储全部复用 `domains/comet-native/` 现有模块；不为 Supervisor 建立第二套验收、回执或证据机制。
2. **Runtime 单向校验闭环**：子会话是宿主平台的外部会话（独立 Codex session、Agent Team 成员或 subagent），Runtime 无法强制其内部行为。约束通过"Runtime 拒绝不合规结果 → 子任务转入 needs-reverify/block 并记录原因 → 监督者按最新 continuation 重派"闭环实现，与现有 stale 结果的处理方式一致。
3. **单会话与多会话同享**：两种协调模式共用同一验收入口，P0 改动对两种模式同时生效。
4. **渐进兼容**：Supervisor 状态 schema（`comet.native.supervisor.v2`）内的新字段使用 optional 渐进；输入协议的破坏性调整（如 verdict 枚举对齐）在 rc 阶段直接落地并同步 Skill，不做长期双格式。
5. **有界失败**：重派闭环必须有次数上限，防止子会话反复产出不合规结果造成无限循环。

## 四、P0：统一子任务验收协议

### 4.1 现状

- 通用流程：`applyNativeVerifierEnvelope`（`native-loop-runtime.ts`）以 `{candidateId, identityProvider, builderExecutionRef, iteration, attempt, acceptanceIds, requiredChecksPassed}` 构造 `NativeVerifierBinding`，其中 `acceptanceIds` 来自 `pendingAcceptanceIds(state)`、`requiredChecksPassed` 来自 Runtime 权威检查结果；`validateNativeTrustedVerifierEnvelope` 随后执行覆盖与一致性校验。
- 子任务流程：`RunnerSupervisorVerifierInput` 携带 `{child, runId, verdict, evidence}`，`evidence` 仅为 `{summary, checks: string[]}`；`applyNativeSupervisorVerifierResult` 无逐项校验。

### 4.2 数据结构调整

`NativeSupervisorVerificationEvidence`（`native-supervisor.ts`）扩展：

```ts
export interface NativeSupervisorVerificationEvidence {
  summary: string;
  checks: string[];
  /** P0 新增：逐项验收结果，解析复用通用协议的 NativeVerifierAcceptanceResult（id/result/reason）。 */
  acceptance?: NativeVerifierAcceptanceResult[];
}
```

`applyNativeSupervisorVerifierResult` 与 `markNativeSupervisorChildVerified` 的 `verdict` 枚举从 `'pass' | 'fail' | 'incomplete'` 对齐为通用协议的 `'pass' | 'fail' | 'blocked'`。原 `'incomplete'` 语义（子任务未能形成结论）由 `verdict: 'blocked'` 加 reason 承担，输入 schema 移除 `'incomplete'`。理由：两种枚举并存会让"总判定与逐项结果一致性"出现第二套规则，与统一目标矛盾；Supervisor 是 rc 阶段新能力，用户面小，配合 Skill 同步一次到位。

状态落盘：`child.verification` 保存含逐项结果的完整 evidence，供父级最终 Verify 前审计与 status/Dashboard 展示。`acceptance` 在 v2 schema 内为 optional 字段，读取旧状态不受影响。

### 4.3 binding 来源

- `acceptanceIds` = 该 child 在 children.yaml v2 中的 `covers`（`NativeChildDefinition.covers`）。children.yaml 在 Shape 确认时已经过 `validateCoverage` 校验（child `covers` 无未知项、并集覆盖父验收全集），因此 binding 数据现成且已验证。
- 验收项文本经 `acceptance_index`（`NativeChildAcceptanceIndexEntry`）引用，verifier 结果只携带 ID 与结论，不搬运文本。
- `requiredChecksPassed`：P0 阶段保持现有语义，取 `checks.length > 0`（pass 至少一条检查描述），作为 binding 参数传入共享校验；P1a 回执落地后改由 Runtime 权威回执判定，收紧点集中在一处。

### 4.4 校验复用与抽取

将 `native-verifier-protocol.ts` 中 final result 的覆盖校验与判定一致性校验（当前内联在 `validateNativeTrustedVerifierEnvelope` 尾部：覆盖缺失/重复/未知拒绝、pass 需全部 passed、fail 需至少一个 failed、blocked 需至少一个 blocked、`requiredChecksPassed` 为假时拒绝 pass）抽取为导出的纯函数，例如：

```ts
export function validateNativeVerifierFinalResultConsistency(
  result: Pick<NativeVerifierFinalResult, 'verdict' | 'acceptance'>,
  binding: Pick<NativeVerifierBinding, 'acceptanceIds' | 'requiredChecksPassed'>,
): void;
```

通用路径在 `validateNativeTrustedVerifierEnvelope` 内调用它，子任务路径在 `applyNativeSupervisorVerifierResult` 与 `markNativeSupervisorChildVerified` 内调用它。两条路径共享同一份校验规则，后续调整只改一处。

子任务入口的完整校验顺序：runId/role/候选 commit 绑定（现有 `assertSupervisorTaskCommit`，不变）→ evidence 结构解析（`acceptance` 数组、每项 `{id, result, reason}`）→ `validateNativeVerifierFinalResultConsistency`（covers 覆盖 + 一致性 + requiredChecksPassed）→ 状态迁移（pass → verified；fail/blocked → needs-reverify 并以 summary 作 blocker）。

### 4.5 失败闭环

- 协议校验失败（格式、覆盖、一致性）不属于安全问题，处理为 **needs-reverify**：child 保留候选 commit，blocker 记录具体校验错误，监督者按最新 continuation 重派 Verifier 任务（新 runId）。区别于 runId/commit 绑定失败（重放/冒领）走现有 block 任务路径。
- 有界性：为同一 child 的连续协议失败引入重派计数上限（复用 Build↔Verify 有界 Loop 的停滞思路），达到上限进入 await-user，由用户决定继续重派、降级接受或取消子任务。具体上限值与计数存放位置在实施时确定。
- Skill 同步：`supervisor-verifier-result` 输入模板增加逐项验收输出要求（每个 covers 验收项恰好一条结论），说明 verdict 三态与新校验；中英文版本同步修改，并运行相关 Skill 契约测试。

### 4.6 兼容与迁移

- 输入协议直接强制新格式：`acceptance` 缺失或包含 covers 之外 ID 的结果被拒绝，错误信息指明缺少/多余的验收项 ID，子会话可据此自行修正重报。
- 状态 schema 不升级：`acceptance` 为 evidence 内 optional 字段，v2 读取兼容；`markNativeSupervisorChildVerified` 的旧调用方（若有）在过渡期以"无 acceptance 则走原弱校验"运行，最终在 rc.6 内完成迁移并移除该分支。
- `projectNativeSupervisorChildren`（`native-supervisor.ts`，当前输出 `covers: []`）顺带输出真实 covers 与逐项验收状态，供 status/Dashboard 只读展示（展示层增强属可选，不阻塞 P0）。

### 4.7 涉及文件与测试

- 源码：`native-verifier-protocol.ts`（抽取共享校验）、`native-supervisor.ts`（两个验收入口、evidence 结构、失败闭环）、`native-runner-input.ts`（输入 schema 与 verdict 枚举）、`native-children.ts`（covers 读取辅助，如需）。
- 测试：`test/domains/comet-native/native-supervisor.test.ts`（协议校验通过/拒绝用例：遗漏项、多余项、pass 混 failed、fail 无 failed 项、blocked 一致性、requiredChecksPassed、needs-reverify 闭环与重派上限）、`native-children.test.ts`（covers binding 构造）、verifier protocol 抽取后的既有测试回归、`native-runner-input.ts` 对应输入解析测试。
- Skill：`assets/skills/comet-native/` 与 `assets/skills-zh/comet-native/` 的 Supervisor 章节（中英文同步），涉及 Build 章节子任务汇报模板。

## 五、P1a：子任务检查执行接入回执

### 5.1 现状

Runtime 已有完整的检查执行与回执设施：`native-check-executor.ts` 的 `executeNativeCheck` 执行 `NativeCheckPlan`（退出码、超时、日志边界），`native-check-receipt-*.ts` 产出与存取带 `receiptHash`、stale 判定的 `NativeCheckReceipt`（含 checker 版本/哈希、inputHash、contract 哈希、implementation scopeHash 等）。但该设施只服务单 change 主流程；子任务的检查（包括 `supervisor-integrate` 提交的集成检查）由提交方声明状态，Runtime 无法区分"确实执行通过"与"声明执行通过"。

### 5.2 方案

- 子任务的**正式检查**通过 Runtime 执行：扩展检查执行入口支持 Supervisor 子任务场景（在 child worktree 或 integration worktree 上执行 check plan），产出 receipt。子会话不再自行运行正式检查后口头汇报。
- `supervisor-verifier-result` 与 `supervisor-integrate` 的 checks 从 `{name, status, reason}` 升级为携带 **receipt ref**（`nativeCheckReceiptRef(hash)` 风格）；Runtime 消费时读取 receipt、校验 receiptHash、candidate/contract 绑定与 stale 标记，检查状态以 Runtime 读到的 receipt 为准，对齐单 change 的 `authoritativePortableChecks` 语义。
- **降级通道**：无法产生 receipt 的检查（子会话环境探索、手工探查等）保留为非正式描述，evidence 中显式标注 `formal: false`；非正式检查不参与 `requiredChecksPassed`，只能作为 Verifier 的调查线索，与单 change 中"Verifier 可以要求 Runtime 补充正式检查"的规则一致。
- `requiredChecksPassed` 切换：P0 的 `checks.length > 0` 语义替换为"binding 引用的正式 receipt 全部 passed 且未 stale"。单一收紧点，见 4.3。
- 存储与可见性：receipt 沿用内容寻址存储；子任务 receipt 存入 Supervisor change 的证据空间，保证 child worktree、integration worktree 与父会话读取到同一份回执。`.comet` 状态目录在多个 worktree 间的解析路径是本期的首要实施风险，动手前先做最小 spike 验证（见第八节）。

### 5.3 涉及文件与测试

- 源码：`native-check-executor.ts`/`native-check-receipt-*.ts`（子任务场景的 plan 构造与 receipt 归属）、`native-supervisor.ts`（checks 消费改为 receipt 判定、integration checks 收紧）、`native-runner-input.ts`（checks 输入结构）、检查命令入口（`native-check-command.ts`，如需子任务参数）。
- 测试：receipt 生成/消费/ stale 拒绝、集成 checks 缺 receipt 拒绝、非正式检查降级标注；复用 `native-check-receipt.test.ts` 的既有模式。

## 六、P1b：外部证据登记与核验

### 6.1 现状

`native-evidence-storage.ts` 已提供内容寻址证据空间：`nativeEvidenceRef(kind, hash)` 生成规范引用，write/read 接口按哈希落盘并在读取时校验内容哈希（`readNativeVerificationEvidence` 等已按 expected ref 校验），验证报告快照、实现范围、部分豁免、验证回执均有登记先例。子任务引用的外部证据（审查报告、探针输出、复现记录）未接入该空间。

### 6.2 方案

- **登记**：子会话将正式外部证据提交给 Runtime，Runtime 计算 canonical hash、写入证据空间、返回规范 ref。子任务 verifier evidence 与 `child.verification` 以 ref 引用证据，不再以裸路径或文字转述承载"证据在哪"。
- **重跑语义**：内容寻址天然满足"重跑生成新记录、历史原件保留"——重跑产物哈希不同即新记录；引用方显式指向其一，不存在覆盖。
- **消费校验**：读取 ref 时重算内容哈希，不匹配即拒绝。被覆盖、指向旧文件、文件与受测候选不一致的引用在消费点暴露。
- **候选绑定**：正式证据登记时记录产生证据的执行上下文（child、runId、候选 commit），ref 结构与 `native-verification-evidence.ts` 现有 trace/scope 绑定模式一致，消费时可校验"证据确实来自当前候选的验证执行"。
- **保障边界声明**（回应 issue 的能力边界问题）：Runtime 保障的是 `.comet` 证据空间内**已登记**的记录——不可变、可校验、可引用；子会话工作目录中的普通文件不在保护范围内，写权限隔离依赖宿主平台。报告若引用未登记文件，Runtime 视其为非正式线索（同 5.2 的 `formal: false` 通道）。

### 6.3 涉及文件与测试

- 源码：`native-evidence-storage.ts`（子任务证据 kind 或复用现有 kind 的登记入口）、`native-supervisor.ts`（evidence 持有 ref、消费校验）、`native-canonical-hash.ts`（复用）。
- 测试：登记/引用/篡改拒绝/重跑新记录/候选绑定校验。

## 七、P2：任务包范围与检查语义增强

- **任务包携带验收范围**：`dispatchNativeSupervisorReadyTasks` 返回的任务包与 `supervisorTask` 增加 child 的 `covers` 列表及 children 契约哈希（`NativeChildrenInspection.contractHash`），子会话无需重新推导"本轮要验收什么"，也使验收范围与 Shape 确认版本可对照。
- **空 checks 原因枚举**：输入协议中 `checks`/`acceptance` 为空时必须携带原因：`none-scheduled`（本轮未安排检查）、`not-applicable`（不适用于该子任务）、`not-run`（尚未执行）。消除"空数组无语义"的多解释空间（回应 issue 第 4 点）。
- **展示对齐**：status/Dashboard 呈现 child 逐项验收状态与证据 ref（只读），依赖 4.6 的 `projectNativeSupervisorChildren` 输出。

## 八、实施顺序、测试与风险

### 实施顺序

P0 → P1a → P1b → P2。P0 不依赖回执与证据设施，独立可交付并可单独发布；P1a 与 P1b 相互独立可并行；P2 依赖前三期的数据结构落定。每期交付前运行全量测试（跨模块与 Runtime 行为修改），Skill 变更在中英文同步完成后写 CHANGELOG。

### 测试落点

| 层级              | 位置                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| 协议校验单元      | `test/domains/comet-native/native-verifier-protocol.test.ts`（抽取后回归） |
| Supervisor 状态机 | `test/domains/comet-native/native-supervisor.test.ts`                      |
| children binding  | `test/domains/comet-native/native-children.test.ts`                        |
| 输入协议          | `native-runner-input` 相关测试                                             |
| Skill 契约        | 既有 Skill 契约测试 + 中英文一致性                                         |

单元与集成测试通过不等于真实多会话闭环成立；每期实施后需在真实双会话（协调会话 + 独立子会话）环境验证拒绝-重派闭环与证据引用链，真实平台验证结果单独记录。

### 风险与对策

1. **子会话不配合新协议**：Skill 同步 + Runtime 错误信息指明缺失/多余项便于自修正；重派计数上限兜底，不合规不会无限循环。
2. **verdict 枚举对齐为破坏性变更**（移除 `'incomplete'`）：Supervisor 为 rc 阶段新能力，用户面小；Skill 与输入 schema 同步修改，CHANGELOG 在 Fixed/Changed 中说明。
3. **回执与证据跨 worktree 可见性**：`.comet` 状态目录在 child worktree / integration worktree / 父工作树的解析需要先验证；P1a 动手前以最小临时项目 spike 确认，必要时统一经由父会话或 integration worktree 读写。
4. **校验抽取引入通用路径回归**：抽取为纯函数 + 既有 verifier protocol 测试全量回归；`applyNativeVerifierEnvelope` 行为不变是抽取的硬约束。

### 非目标

- 不给子任务引入独立的 change 状态机：子任务仍是轻量任务包，Shape、验收分配、集成与最终验收由父级 Runtime 统一持有。
- 不改变父级最终 Verify 的全量验收流程与 `runId`/候选 commit 绑定规则。
- 不为子任务新增 Dashboard 写入能力或新的用户确认边界。
- 不在本设计内处理 Classic runtime（`domains/comet-classic/`）；Classic Guard 与 Native Guard 保持独立。
