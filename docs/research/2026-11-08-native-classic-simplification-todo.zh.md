# Native / Classic 流程减负执行计划

来源为 `report:2026-11-08-native-classic-overdesign-audit`。2026-11-08 按用户新增的“保护核心使用体验”约束重新审核，基线为 `053` / `2999b60d0b1a373a158a238fba126bb03ac3c98c`。

用户已确认最小写锁方向，并要求将整体工作交给后续 Agent 执行。本文作为统一交接入口，执行范围覆盖下列 23 项优化及 8 项保留能力的回归核对。每项源码依据与验收要求见后文同编号详情。

## 审核结论

上一版把性能优化与功能退役放进了同一执行清单，并将低并发假设扩展为竞争立即报错、恢复需要手动操作的支持模型。这些建议会增加用户操作，已在本文逐项改正。

31 项中，8 项有明确的重复工作可优先优化，15 项需要等价实现与回归证据，8 项撤回删除建议。审核状态表示原方案判断；当前执行状态为 23 项优化已完成、8 项保留能力已核对。T12 采用固定文件入口与真实文件身份绑定的等价实现，保留旧分区用于兼容；T18/T20/T22 已经用户确认后同步英文。实现完成不等于全部平台或模型验证完成，限制见执行报告。

核心使用体验按以下实际流程评估。

- 普通 Native 与 Classic full/hotfix/tweak 能从创建推进到交付，原审批与验收点可达。
- 中断后再次运行能按现有语义续行，短暂竞争与已死进程锁可按既有规则处理。
- worktree 切换、归档合入、旧 Run 与已有材料能够沿既有入口读取和恢复。
- 用户的 walkthrough 开关、独立阶段调用、实施方法选择、记忆请求和自动协作能力按原配置生效。
- 实际代码/需求变化会使相关旧证据失效，失败与未知执行可诊断和重试。

## 实施顺序

| 批次 | 覆盖项                                 | 实施内容                                                                                                                              | 本批交付                                                |
| ---- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A    | T01、T02、T03、T04、T14、T18、T23、T26 | 纯查询去学习副作用、非边界提交去整份重读、共享命令上下文、项目外结果提前返回、不可变定义复用、空学习减负、编辑材料合并、批量 Git 读取 | 公开 CLI 输出与推进结果等价，相关调用次数下降           |
| B    | T05、T06、T07、T08、T09、T11           | 稳定观察内合并路径检查、减少重复 sync、当前格式解析快路、统一最小写锁方向、历史事务退出日常扫描                                       | 正常路径 I/O 与锁操作减少，真实竞争及崩溃恢复通过       |
| C    | T16、T20、T22、T31                     | 只读入口减少执行器装配、阶段正文去重、上下文增量交付、具名本地读取避开无关 worktree 观察                                              | Hook 决策等价，Skill 阅读与工具轮次减少，工作区变化可见 |
| D    | T12、T13、T17、T21、T28                | owner 存储优化、纯 Shape 一次提交、Classic checkpoint 合并、handoff 源读取复用、Engine 已验证值去重                                   | 当前格式与旧 Run 可恢复，持久化和字节处理减少           |
| E    | T10、T15、T19、T24、T25、T27、T29、T30 | 核对迁移、Supervisor、walkthrough、任务发现、worktree 寻址、交付修复、Archive 重验、共享写协调                                        | 按受影响调用链完成回归，并记录能力保留结果              |

A 到 D 覆盖全部 23 个优化编号。E 的验证随相关改动分批执行，末尾汇总。批次内部按依赖推进，已取得的有效验证证据可以复用。

“需等价验证”要求后续 Agent 完成源码复核、具体方案、实施及验证。若较大的替换无法满足核心体验，先落地该项已确认的局部等价优化，再记录剩余限制。仍有缺失证据或未实现内容时，将对应项标记为未完成并给出具体原因。

## 已确认的最小写锁方向

目标是普通单 Run 的一次状态提交只使用一个短写锁。公开 CLI 一次调用可能产生多次合法提交，每次提交各自完成互斥。锁只覆盖需要一致性的写入区间。

| 操作                                            | 目标行为                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| 普通 status、inspect、Hook 读取                 | 读取完整的已提交状态，纯读取免写锁。确需修复时进入显式写入分支      |
| Run 状态提交                                    | 持有该 Run 短锁，检查 expectedRevision，完成原子发布并释放          |
| 模型执行、真实测试、用户等待                    | 通过 Action 身份和持久状态表达执行归属，执行期间释放磁盘锁          |
| 短暂写竞争                                      | 沿用适用入口现有的有限等待或冲突处理，保留原结果与重试信息          |
| 崩溃遗留锁                                      | 沿用适用入口现有的精确 owner 诊断与恢复，错误或未知身份按原规则处理 |
| 共享 Spec、多文件事务、目录迁移、应用共享写范围 | 按实际共享资源确定互斥范围，锁顺序固定，沿用可恢复事务身份          |

T08/T09 负责盘点三套锁的调用者、重入方式、获取/释放、旧格式与恢复协议，优先消除无竞争时的票据、目录枚举和重复元数据发布。新旧 writer 与恢复者必须共同遵守同一个互斥协议。迁移过程中先证明它们互斥，再切换默认实现和删除旧协调步骤。

CAS 的 revision 比较与提交放在同一受保护区间。序列化和纯计算可提前完成，进入写入区间后验证其依赖的 revision 与必要输入绑定。发布失败、释放失败和进程中断都需要可诊断结果。

投影发布属于另外的派生写入。T02/T17 先减少无用投影与重复读取，再按其真实一致性需求决定投影锁是否可以合并。涉及多个真实共享资源时，逐项记录额外锁的职责和顺序，以实际互斥需求评估。

锁验证至少覆盖一次正常提交、两个进程竞争、持有者崩溃、旧 owner 释放 replacement 锁、发布失败后重试及旧 writer 混用。公开入口的等待、恢复和退出结果同时核对。

## 后续 Agent 的执行与交付要求

### 开始工作

检查当前分支、HEAD、工作区差异、子模块和目标路径沿途 AGENTS。本次交接时的无关修改位于 `docs/comet/archive/2026-10-06-comet-any-sdk/comet-state.yaml` 与 `website`。两份研究文档当前为未跟踪文件，接手时确认可见并纳入本任务文档维护。

先按当前源码核对各项是否已由其他任务完成。已完成项记录真实 commit、测试和调用路径，尚存问题继续实施。既有微测脚本保存在初轮报告列出的本机临时目录，目录失效时按相同入口重建最小 fixture。

### 逐项完成记录

在每个 T 编号详情末尾追加执行记录，包含实际改动、涉及文件、行为验证、性能结果、遗留内容和执行状态。执行状态使用“待实施”“实施中”“已完成”“部分完成”“受阻”“保留能力已核对”。审核状态继续表达原方案评估，执行状态表达真正完成程度。

23 个优化项的完成条件同时包括核心体验等价、相关验证通过和重复工作实际减少。优化没有可确认收益时，记录测量与原因，调整到更小且有收益的实现。8 个撤回删除项记录受影响能力的核对结果。

### 验证范围

各批先运行覆盖改动的最小相关测试。用户行为修复按仓库 badcase 规则登记来源、稳定 case ID 与精确选择器。现有断言继续保护审批、候选、工作区身份、结果幂等和恢复。

涉及 Native、Classic 或 Entry Runtime 时，从 owning source 修改并构建对应自包含 bundle，再用最小临时项目验证公开命令。涉及配置、固定应用或旧格式时，加入对应加载/恢复用例。按仓库规则选择 lint、类型、格式与生成物检查。

性能比较覆盖本批相关公开入口，采用一致 fixture 与采样条件，同时记录耗时和关键操作次数。普通流程、恢复流程与长历史各按实际影响选择样本。一次批次验证通过后，后续仅在修改或新风险使证据失效时重跑。

核心流程包括普通 Native、Classic full/hotfix/tweak、编辑后续行、用户批准、检查失败返回实施、归档交付、中断后恢复与跨 worktree 查询。复杂任务和扩展应用在触及其共享依赖时纳入定向验证。

Skill 修改按仓库规定先完成中文，向用户提供具体中文差异供确认，再同步英文。涉及真实模型遵循的证据标记待 Eval，取得明确的场景、样本和轮次启动请求后执行。当前交接授权涵盖实施及普通定向验证。

### 最终交付

汇总 31 项处理结果与 23 项优化的实际完成状态，列出改动前后耗时、调用量、通过的验证及未完成部分。按发布基线判断 Changelog 和版本处理。GitHub 评论、PR、推送遵循用户对相应操作的授权范围。

按项目约定发送任务完成邮件，并报告 CLI 实际返回的发送状态。

## 可复制的交接指令

```text
请在 D:\Project\Comet 接手并执行 docs/research/2026-11-08-native-classic-simplification-todo.zh.md 的完整计划。按 A–D 批次完成全部 23 项优化，并对 E 批次的 8 项保留能力完成相关回归核对。核心目标是明显减少 Native、Classic、共享 Engine 和 Skill 的重复工作，同时保障现有审批、验收、恢复、worktree、配置与交付体验。锁按“一次 Run 状态提交、一次短写锁”收敛，纯读取免写锁，模型/测试/用户等待期间释放锁，实际共享资源按需协调，保留现有有限等待、精确释放和适用入口的自动恢复。请直接推进实现、定向测试、相关 Runtime 构建和公开 CLI 性能对照，持续更新每个 T 编号的执行记录。需等价验证的项也属于执行范围，遇到困难先寻找满足现有体验的局部实现，再报告剩余缺口。遵守沿途 AGENTS，保护无关修改，中文 Skill 按规则确认后同步英文，Eval 等明确启动授权。最后交付逐项完成情况、性能对照、验证结果与剩余限制，并按项目约定发送完成邮件。
```

## 31 项处理结果

| ID  | 审核状态   | 实施范围                          |
| --- | ---------- | --------------------------------- |
| T01 | 可优先实施 | 纯查询跳过完成学习                |
| T02 | 可优先实施 | Native 非边界提交复用已提交 Run   |
| T03 | 可优先实施 | 同次命令复用已验证上下文          |
| T04 | 可优先实施 | 项目外结果登记提前返回            |
| T05 | 需等价验证 | 合并重复路径观察                  |
| T06 | 需等价验证 | 减少重复目录同步与写路径检查      |
| T07 | 需等价验证 | 当前格式解析跳过重复迁移检查      |
| T08 | 需等价验证 | 共享锁增加无竞争短路径            |
| T09 | 需等价验证 | Native 协调器优化无竞争路径       |
| T10 | 撤回删除   | 保留 root move 与迁移协调         |
| T11 | 需等价验证 | 完成事务退出日常全量扫描          |
| T12 | 需等价验证 | 稳定 canonical owner 替代分区双查 |
| T13 | 需等价验证 | 纯 Shape 步骤合并持久化           |
| T14 | 可优先实施 | 复用不可变 definition             |
| T15 | 撤回删除   | 保留自动 Supervisor               |
| T16 | 需等价验证 | 只读入口减少执行装配              |
| T17 | 需等价验证 | Classic 优化 checkpoint 生成      |
| T18 | 可优先实施 | 删空学习提交与无关维护            |
| T19 | 撤回删除   | 保留 walkthrough 当前默认与开关   |
| T20 | 需等价验证 | 精简阶段重复正文                  |
| T21 | 需等价验证 | handoff 共用一次源读取            |
| T22 | 需等价验证 | 阶段上下文增量交付                |
| T23 | 可优先实施 | Classic observe 合并准备          |
| T24 | 撤回删除   | 保留唯一 change 自动发现          |
| T25 | 撤回删除   | 保留跨 worktree 寻址与归档查询    |
| T26 | 可优先实施 | 批量读取交付 Git 元数据           |
| T27 | 撤回删除   | 保留归档后交付修复                |
| T28 | 需等价验证 | Engine 已验证不可变值去重         |
| T29 | 撤回删除   | 保留 Archive 提交时输入重验       |
| T30 | 撤回删除   | 保留扩展应用共享写协调            |
| T31 | 需等价验证 | 具名本地查询减少全表观察          |

## 逐项依据与验收

### T01 纯查询跳过完成学习

审核状态为可优先实施。

先覆盖 Classic state get 等已确认的纯查询。Native next 能推进内部步骤或归档，须按实际产生的结果判断事件，不能仅凭缺少 --result 跳过学习。显式任务/学习请求继续处理。

验收要求包括普通纯查询 worker 为 0，真实检查、审查解决、失败解决、归档事件各自正确且幂等。

[`classic.ts:94`](../../app/commands/classic.ts#L94) 只将 current/next 列为只读；get 成功后经 [`classic.ts:126`](../../app/commands/classic.ts#L126) 记录 `episode.completed`，[`comet-task-context.ts:55`](../../app/commands/comet-task-context.ts#L55) 同步启动 worker。Native [`native.ts:39`](../../app/commands/native.ts#L39) 也把无 result 的 next 领取记为完成；已有 receipt 复用不能算新机会。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：Classic state get 纳入纯查询；Native next 由新提交的 outcome 判断完成事件，单纯领取和重复回报不触发学习。显式上下文请求保留。
- 涉及文件：app/commands/classic.ts、native.ts；native-experience.ts、native-sdk-next.ts、native-sdk-task-command.ts。
- 验证及性能：Classic get 纯查询零学习、Native 无新完成不学习与真实生命周期事件定向通过；最终公开 get 972→296 ms、worker 1→0。参见执行报告与测量 JSON。
- 剩余内容：无本项实现缺口；真实模型学习效果不在本轮确定性证据范围。

### T02 Native 非边界提交复用已提交 Run

审核状态为可优先实施。

删去为 checkpoint 判断而重新打开整份 Run 的工作。将当前 syncStateFile 内的 workspace、name/input、artifact root 一致性检查迁到可复用检查处，继续检查实际配置。边界发布仍在锁内读取最新 authority。

验收要求包括非边界无额外完整 Run read，根变化仍及时报错，边界恢复、取消/完成清理、旧协议可完成。

[`native-sdk-state-store.ts:847`](../../domains/comet-native/native-sdk-state-store.ts#L847) 成功 CAS 后仍 `syncStateFile(runId, true)`；[`同文件:528`](../../domains/comet-native/native-sdk-state-store.ts#L528) 重读 authority，解析状态并读 config，才在 [`同文件:467`](../../domains/comet-native/native-sdk-state-store.ts#L467) 判断不是边界。**v3 已经不是每 revision 写 YAML。**

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：v3 CAS 后直接使用已提交 Run 判断 checkpoint 边界，边界发布仍在投影锁内重读 authority。
- 涉及文件：domains/comet-native/native-sdk-state-store.ts。
- 验证及性能：非边界 authority 重读 1→0（同一测试旧失败、新通过）；v3 读取/投影预算组通过，边界仍重新读取最新 authority。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：保留真实边界的 Portable 投影锁与输入绑定。

### T03 同次命令复用已验证上下文

审核状态为可优先实施。

Native next 与 Classic Guard 传递 owner、Runtime 和最新提交。以真实外部执行、编辑和用户等待结束作为刷新点，内部纯渲染使用已提交结果。

验收要求包括少一次完整 inspect，审批/证据拒绝、分支变化、原领取结算、并发 CAS 冲突结果正确。

Native [`native-sdk-task-command.ts:287`](../../domains/comet-native/native-sdk-task-command.ts#L287) load/inspect，进入 [`native-sdk-next.ts:183`](../../domains/comet-native/native-sdk-next.ts#L183) 再 inspect，返回后再读；内部循环已有 `owned` 复用，不能说每步都新建。Classic [`classic-guard.ts:1423`](../../domains/comet-classic/classic-guard.ts#L1423) 取得已经 inspect 的 workspace，却只把 root/name 交给 [`classic-sdk-guard.ts:142`](../../domains/comet-classic/classic-sdk-guard.ts#L142) 等阶段处理器再次 inspect。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：Native 高层 next 传入已验证 Run；Classic 各阶段 Guard 复用 findClassicSdkWorkspace 返回的 inspect；外部检查前仍刷新。
- 涉及文件：native-sdk-task-command.ts、native-sdk-next.ts；classic-guard.ts、classic-sdk-guard.ts、classic-sdk-design.ts。
- 验证及性能：Design 共用 inspect 与最终证据/批准检查 4 项通过；Native 高层/读取预算与完整推进定向通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：外部执行后与提交前按原规则刷新；不跨命令缓存可变状态。

### T04 项目外结果登记提前返回

审核状态为可优先实施。

先完成结果路径解析、读取与 schema 验证，再跳过项目外文件的排除登记锁。原项目内结果路径继续兼容。默认传输改位置另列待验证子项，需兼容平台读写权限、工具可见路径和清理时机。

验收要求包括项目外结果登记锁为 0，合法旧模板仍能回报，项目内已登记文件变成真实输入时进入候选。

[`native-runtime-ownership.ts:57`](../../domains/comet-native/native-runtime-ownership.ts#L57) 先解析可写 paths 并取全项目 mutation lock，直到 [`native-runner-input-artifacts.ts:135`](../../domains/comet-native/native-runner-input-artifacts.ts#L135) 才对项目外文件 return。项目内登记读取 Git 跟踪列表、registry，并逐个重新读/hash 已登记文件；输入采集还要再次消费排除列表。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：项目外请求先 race-safe 读取并调用原 schema/content validator，再提前返回；不解析 writable paths 或获取登记锁。保留原项目内路径。
- 涉及文件：domains/comet-native/native-runtime-ownership.ts。
- 验证及性能：项目外输入先校验再返回：旧代码 validator 调用 0 次失败，新版 1 次通过；无 writable resolver、登记锁或项目初始化。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：保持既有外部输入读取范围，不增加项目级预算。

### T05 合并重复路径观察

审核状态为需等价验证。

撤回直接排除内部祖先替换风险的方案。利用已有 read session 在同一稳定观察内合并重复检查，复用明确绑定的根。更短内部接口须覆盖目录移动、链接替换、坏记录和旧 handle 的现有失败语义。

验收要求包括lstat/realpath 随唯一观察规模增长，读取失败/不稳定仍拒绝，第三方内容与项目输入保持严格检查。

[`protected-project-path.ts:515`](../../domains/workflow-contract/protected-project-path.ts#L515) 先 inspect 祖先，race-safe 的三个读取检查点又回调检查整条祖先链；[`race-safe-read.ts:124`](../../platform/fs/race-safe-read.ts#L124) 自身还有路径和 descriptor 核对。owner、token、checkpoint 共享祖先，却重复付费。已有 read session / Hook 请求缓存，不应再造一个无边界全局缓存。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：protected read session 新增字节读取，共用目录身份并在各读取检查点核对，结束前验证祖先；降低重复 realpath，保留叶子与目录替换检查。
- 涉及文件：domains/workflow-contract/protected-project-path.ts。
- 验证及性能：protected read 的 junction/目录替换断言通过。最终 named status async realpath 442→329、open 26→21，为多项联合效果；Windows file symlink 权限限制另列。
- 剩余内容：部分 Windows 文件 symlink 用例在创建链接时 EPERM，未执行目标断言；不等同全部平台验证。

### T06 减少重复目录同步与写路径检查

审核状态为需等价验证。

先确认创建、恢复、迁移的目录项均有持久化保证，再省已有目录的重复 sync。已有目录存在本身不足以证明之前的 sync 已成功。沿用原子写和精确清理，批次内合并能证明等价的检查。

验收要求包括目录创建中断、sync 失败后重试、原子发布、换父目录/临时文件反例通过。

[`contained-atomic-write.ts:88`](../../domains/workflow-contract/contained-atomic-write.ts#L88) 建目录时反复核对前缀，写前后再查全链；[`runtime-store.ts:978`](../../domains/engine/runtime-store.ts#L978) 每 CAS 同步 compact/root 两个祖先目录，即使目录早已存在。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：已有完整目录链直接线性采集和验证；缺目录继续原创建路径，原子发布和目录持久化步骤保留。
- 涉及文件：domains/workflow-contract/contained-atomic-write.ts。
- 验证及性能：已有目录链复用；原子写与 race-safe 组 17 通过、4 跳过，父目录替换安全选择器通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：只优化重复准备，不删除 fsync；未以吞掉同步失败换取性能。

### T07 当前格式解析跳过重复迁移检查

审核状态为需等价验证。

保留首次打开旧数据时透明升级、旧 fence 保护和中断修复。通过当前格式完成证据与命令局部解析复用减少扫描，遇旧布局仍进入现有迁移入口。撤回要求用户额外执行 migrate 的方案。

验收要求包括当前格式具名访问成本不随其他 change 数增长，旧项目直接打开可继续，foreign fence 和半迁移仍正确处理。

[`workflow-contract/workspace-runtime.ts:1388`](../../domains/workflow-contract/workspace-runtime.ts#L1388) 可写 resolver 即使已有 current fence，仍做目录确保、失败/迁移/fence 检查；current fence 已有短路，不是每次复制整树。Native [`native-paths.ts:154`](../../domains/comet-native/native-paths.ts#L154) 只合并重叠 promise，完成即删除，后续串行 writable paths 仍扫描所有 change 的旧 runtime。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：当前 fence 快路；具名 Native 只迁移对应 legacy change，全项目仍完整发现。迁移元数据变化时最多新鲜读取三次，不稳定仍失败，不复用旧内容。
- 涉及文件：workspace-runtime.ts；native-paths.ts、native-config.ts、native-next-command.ts、native-sdk-application.ts。
- 验证及性能：Native paths 22 项及有界 fence 新鲜重读、持续变化失败反例通过；最终完整登记已执行。
- 剩余内容：首次真实迁移仍执行共享静止检查；journal、fence 或失败回执异常仍进入原恢复分支。

### T08 共享锁增加无竞争短路径

审核状态为需等价验证。

撤回所有竞争立即 busy 和统一取消 CAS 重试的建议。快路径需与旧 writer、恢复者使用同一互斥协议，发生竞争后继续有限等待及现有可恢复冲突处理。公平票据只有在替代协议证明互斥、活性、恢复和精确释放后才能删除。

验收要求包括短竞争后正常调用仍可成功，已死 owner 可按原语义恢复，live/unknown owner 不被误接管，旧 owner 不删新锁。

[`platform/fs/recoverable-file-lock.ts:243`](../../platform/fs/recoverable-file-lock.ts#L243) 发布 choosing/ticket、枚举 contenders；[`同文件:409`](../../platform/fs/recoverable-file-lock.ts#L409) acquire 和 release 都进入协调器。Engine [`runtime-store.ts:983`](../../domains/engine/runtime-store.ts#L983) 使用它。**Classic 大量调用的是另一套 [`plugin-store.ts:94`](../../platform/fs/plugin-store.ts#L94) 短锁，不可套用 bakery 成本。**

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：共享锁无竞争时直接 no-clobber 发布及精确释放；有协调记录时继续旧 bakery 协议、有限等待和 stale 恢复。
- 涉及文件：platform/fs/recoverable-file-lock.ts。
- 验证及性能：共享锁无竞争 41.616→15.421 ms，open 11→5、link 5→1、readdir 4→0；短竞争、精确释放与新旧双进程通过。
- 剩余内容：八进程、显式 10 秒等待压测中，纯旧/纯新/混跑均有超时，不能记为通过；末轮混跑 2/8 成功。默认 30 秒等待未由该压测证明失败；未观察到重叠，后续维护者可沿保留脚本调查 choosing/ticket 吞吐。

### T09 Native 协调器优化无竞争路径

审核状态为需等价验证。

保留 root-move 锁的本机 stale 自动恢复及已有有限等待体验，专用 transition 的显式恢复语义继续遵循现状。替代 claim 协调器需验证 acquire/release、接管与旧格式协作，避免快慢路径同时认为自己持锁。

验收要求包括无竞争元数据 I/O 下降，短竞争与崩溃恢复可自动续行，replacement owner 和旧 claim 恢复用例通过。

[`native-lock.ts:469`](../../domains/comet-native/native-lock.ts#L469) 自建 `.coordinator` claim，写/sync/rename/重读并枚举他人 claim；[`同文件:636`](../../domains/comet-native/native-lock.ts#L636) 释放真实锁又协调一次。它是第三套协议，与 T08 不同。own PID identity 已缓存；15 分钟 unknown 接管仅显式诊断，不是正常自动偷锁。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：完整写入私有元数据后 hardlink 发布唯一主锁，保留私有链接直到精确释放；协调目录曾变化时，即使 claim 已消失也沿旧协调顺序释放。hardlink 不支持走旧协议；变化观察在原 5 秒内重新读取，持续变化仍有界失败。
- 涉及文件：domains/comet-native/native-lock.ts、native-mutation-lock.ts。
- 验证及性能：无竞争 47.860→21.716 ms，open 18→10、rename 5→2；原子发布、已消失 claim、替换保护、变化重试与上限反例通过。末轮八进程纯新/混跑均 8/8，五轮立即退出纯新 10/10、混跑 9/10。
- 剩余内容：五轮立即退出纯旧 6/10，混跑仍有一例旧 writer busy，未记为通过，失败路径推测涉及旧版退出身份诊断，根因未完全证明；不放宽 unknown 或自动接管规则。

### T10 保留 root move 与迁移协调

审核状态为撤回删除。

离线限定会使活动 Run 的迁移增加停止、恢复等用户动作。本轮保留现有能力，普通路径开销从 T03/T07/T11 减少。

验收要求包括root move、pending 恢复、跨 change 共享写入与当前错误诊断继续可用。

[`native-mutation-lock.ts:97`](../../domains/comet-native/native-mutation-lock.ts#L97) 统一取 root-move 锁并查 pending；[`native-root-move.ts:945`](../../domains/comet-native/native-root-move.ts#L945) 在线搬迁与其协调。触发是 new、结果文件登记、部分 owner 恢复、archive/cleanup 等；**普通 SDK claim/outcome 不都直接取它。**

#### 执行记录（2026-11-08 接手）

- 执行状态：保留能力已核对。
- 实际改动：保留 root move、pending 恢复和共享资源协调；事务历史在显式搬迁前仍纳入检查。
- 涉及文件：domains/comet-native/native-root-move.ts 及对应测试。
- 验证及性能：root move/事务组通过；补充活动目录缺失仍审计历史的回归，修改前失败、修改后通过，配置与目标目录不变。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：保留迁移、崩溃恢复与 SDK root move 拒绝；非本轮改成无协调迁移。

### T11 完成事务退出日常全量扫描

审核状态为需等价验证。

可将已完成事务移历史，并维护可靠的活动事务入口。保留影响共享 Spec/root 的全局未结束事务检测。只读当前 change journal 会漏掉其他 change 留下的共享资源半写状态，需先建立等价发现协议。

验收要求包括历史数量增长不增加正常扫描，活动入口丢失/损坏、写 journal 后崩溃、共享事务未完成仍能被检测。

[`native-mutation-lock.ts:21`](../../domains/comet-native/native-mutation-lock.ts#L21) 枚举一般及 portable transaction，读完 journal 才知道已结束；T 随历史积累。空目录只支付固定 readdir，不能据此估计长期成本。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：已结束一般事务移入 transaction-history，逻辑 ref 与原 journal 字节保持不变；实际 payload 通过原 ID 寻址。旧终态在 mutation 扫描时迁入；Doctor/root move 仍审计历史。Portable 活动事务保持原发现。
- 涉及文件：native-transaction.ts、native-archive-transaction.ts、native-mutation-lock.ts、native-doctor.ts、native-root-move.ts、native-atomic-file.ts。
- 验证及性能：结束事务移入 transaction-history；保留原 journal 字节、逻辑引用与重复 finalize。事务/root move 最新 39 通过、1 跳过；登记补充 2 项通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：Doctor/root move 仍完整审计历史；不把历史损坏藏在快路中。旧 writer 不理解新历史位置的跨版本回滚兼容未验证。

### T12 稳定 canonical owner 替代分区双查

审核状态为需等价验证。

可以设计稳定 owner 位置与发现索引。旧分区迁移、归档重开、同名冲突和全列表一致性需完整实现后再移除 token 协议。该项属于存储重构，优先级低于重复读消除。

验收要求包括reopen 恰好发生在发现期间也能找到 owner，完整列表与具名读取一致，冷恢复和旧格式仍成功。

[`change-runtime-owner.ts:193`](../../domains/workflow-contract/change-runtime-owner.ts#L193) token 前后读取并最多重试三次，具名读查 active 与 history；[`同文件:658`](../../domains/workflow-contract/change-runtime-owner.ts#L658) owner 写用全局锁和 writing/stable 两次发布。目的是兼容分区移动恰好夹在两次查找之间。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：新增固定 owner 文件入口，使用受保护的原子 hardlink 发布，与实际旧分区 owner 共用正文。具名读取验证当前文件对象绑定后少读一次 token、免分区正文重读；旧 writer 原子换文件或绑定不匹配时沿用原完整校验。注册与明确恢复/分区移动时更新，纯读取不写记录。
- 涉及文件：change-runtime-owner.ts、contained-atomic-write.ts、native-runtime-ownership.ts、native-sdk-create.ts、classic-sdk-create.ts 及对应测试。
- 验证及性能：固定入口读取同一实际正文，微测 13.238→10.822 ms，open 4→3、token 2→1、分区正文重读 1→0；旧 HEAD 同一预算失败、新版通过。编译旧 writer close/reopen 与公开命名迁移恢复通过；T12 精确组 12 项通过。
- 剩余内容：保留旧分区和全列表 token 协议，文件对象无法可靠比较或 hardlink 不支持时走旧路径，不在纯读取中做迁移。采用兼容的固定入口，不执行破坏性存储切换或删除旧 writer 的恢复材料。

### T13 纯 Shape 步骤合并持久化

审核状态为需等价验证。

先证明指定步骤无副作用且可重算。一次提交仍须经过同等 validator、revision/input 校验并保存可诊断结果。固定 workflow 定义、公开 SDK claim/outcome、取消和旧 Run 恢复需要兼容。

验收要求包括采样前后崩溃可重算，候选变化拒绝旧结果，用户批准可达，外部 Builder/Verifier/check/Archive 执行身份完整。

[`native-sdk-next.ts:812`](../../domains/comet-native/native-sdk-next.ts#L812) 对 `shape.prepare/revalidate` 读取提案后仍先 claim、再 recordOutcome，两次持久提交；共享 [`runtime-service.ts:1774`](../../domains/engine/runtime-service.ts#L1774) 通用 executor 两阶段协议服务于外部执行恢复。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：内置 v3 的纯 shape.prepare/revalidate 在内存沿用原 claim/outcome/validator，再 CAS 发布一个 revision；旧 Run、固定应用和外部执行继续原协议。
- 涉及文件：domains/comet-native/native-sdk-next.ts。
- 验证及性能：内置 v3 纯 Shape 仍走完整 claim/outcome 校验，再一次 CAS；旧 revision 3、新 revision 2，批准仍待用户。最终公开 Shape 准备 3195→2350 ms，模拟批准及重启等待样本全部保持正确状态。
- 剩余内容：固定应用、旧 v1/v2、外部执行仍走原协议；不合并模型或测试执行期间的持锁范围。

### T14 复用不可变 definition

审核状态为可优先实施。

复用相同身份的不可变工厂/规范化定义，按原 definition 身份加载 handler。保留现有 Supervisor 节点、旧 hash 和扩展应用绑定。跨项目配置或闭包状态不可共用。

验收要求包括相同定义重复构造减少，多项目/版本/固定应用隔离，普通与 Supervisor 均能推进。

[`native-sdk-application.ts:1127`](../../domains/comet-native/native-sdk-application.ts#L1127) 大工厂连同 Supervisor 节点；[`native-runtime-ownership.ts:543`](../../domains/comet-native/native-runtime-ownership.ts#L543) 每次 load 创建工厂。Engine 规范化 WeakMap 已有，但新对象无法复用；[`native-sdk-application.ts:168`](../../domains/comet-native/native-sdk-application.ts#L168) 已先 match 当前 hash 才构造历史变体。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：loader 按内置版本复用规范化不可变 workflow，每个 Runtime 的 handler/validator/executor 注册对象仍独立；公开可修改工厂继续返回新对象。
- 涉及文件：domains/comet-native/native-runtime-ownership.ts。
- 验证及性能：内部按版本复用不可变 definition；公开工厂仍返回独立可修改对象，executor/Run 状态不共享；定义/读取预算定向通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：仅缓存不可变定义，不复用跨 Run 的可变执行对象。

### T15 保留自动 Supervisor

审核状态为撤回删除。

平台子 Agent/worktree 无法自动替代 Comet 的 Child 批准、集成、父级验收、交付和清理恢复。可由 T14 改善普通入口加载成本。

验收要求包括现有复杂任务、在途 Child、失败集成与取消恢复保持可执行。

[`native-sdk-application.ts:1224`](../../domains/comet-native/native-sdk-application.ts#L1224) 起包含 Child prepare、集成、父级验收、交付、cleanup；普通高层 task 在 [`native-sdk-task-command.ts:293`](../../domains/comet-native/native-sdk-task-command.ts#L293) 主动拒绝 children contract。这些实际执行只属于 Supervisor，普通仅可能付装配/加载成本。

#### 执行记录（2026-11-08 接手）

- 执行状态：保留能力已核对。
- 实际改动：Supervisor 节点、Child、集成、父级验收与清理未删除；相关定向回归待补齐。
- 涉及文件：native-supervisor-portability 等既有测试。
- 验证及性能：Supervisor、共享 scope、跨应用与 Hook 定向组 80 项通过，自动协作与恢复能力保留。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：没有以手动任务替代自动 Supervisor；未运行真实模型。

### T16 只读入口减少执行装配

审核状态为需等价验证。

只读 store/模型入口需给出与现有 inspect 等价的固定应用、Run、取消/claim 与格式验证。先比较两条读路径的结果和错误语义，再删 executor 注册。

验收要求包括Hook 对同一状态作相同决定，旧格式/自定义应用/取消中状态受控，普通合法写入与诊断可用。

[`native-hook-guard.ts:55`](../../domains/comet-native/native-hook-guard.ts#L55) 只读 inspect 仍进入 owner/loader/createRuntime/handler 注册；具名 selection 的 [`同文件:838`](../../domains/comet-native/native-hook-guard.ts#L838) 也要此路径。Hook 请求内 memoization 已有。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：readOnly Native runtime 不注册执行器，仍加载并验证原 workflow/handlers/state/validators/固定应用。Hook 使用同一 inspect 决策。
- 涉及文件：domains/comet-native/native-runtime-ownership.ts。
- 验证及性能：readOnly Runtime 不注册 executors，仍完整加载定义/validators；Hook Router、状态读取与取消历史恢复组通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：未引入跳过候选、配置或材料检查的弱读模型；真实平台 Hook 未运行。

### T17 Classic 优化 checkpoint 生成

审核状态为需等价验证。

撤回直接取消中间 Portable 的交付方案。先枚举 YAML、handoff、Hook、导出及第三方读者，并核对每个可观察命令返回后的恢复能力。可研究一个内部命令内合并投影，命令返回/交接时交付完整有效 checkpoint。

验收要求包括用户随既有入口读取或复制材料的恢复语义得到覆盖，手改配置、旧 Run、丢本机 Run 与归档交付可恢复。

[`classic-sdk-state-store.ts:520`](../../domains/comet-classic/classic-sdk-state-store.ts#L520) 比较字段、编码全 Run checkpoint、渲染 YAML/marker；[`同文件:642`](../../domains/comet-classic/classic-sdk-state-store.ts#L642) 成功非初始 CAS 进入 sync。正常 read 已有无写锁快路；归档交付基线分支也已避免每次回写。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：Classic checkpoint 直接比较最终编码格式，省去必然不相等的完整未编码比较；每次公开命令返回的 Portable checkpoint 保持交付。
- 涉及文件：domains/comet-classic/classic-sdk-state-store.ts。
- 验证及性能：去掉编码前完整 checkpoint 的无用比较，只比较实际编码后的 Portable 值；Classic 读取预算 4 项通过，三 preset 源码与 bundle 生命周期 6 项通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：保留每次公开提交的完整 Portable 投影与单独投影锁；未合并需要旧版读取的中间 checkpoint。

### T18 删空学习提交与无关维护

审核状态为可优先实施。

仅在本次任务缺少合格观察和待处理学习时省空 review/空 actions。保留真实用户纠正、明确记忆请求、可复用经验及当前 change 已有待评审的处理。原协议 review 仅处理本次 change，上一版将其概括为清历史队列过宽。

验收要求包括空收尾零额外评审调用，真实经验/当前待评审正常保存，学习失败如实显示且开发交付可完成。

[`comet-classic/reference/scripts.md:158`](../../assets/skills-zh/comet-classic/reference/scripts.md#L158) 每次收尾要求 review、无经验也 actions=[]，并清 pending 队列。Native [`reference/commands.md:109`](../../assets/skills-zh/comet-native/reference/commands.md#L109) 已按真实观察提交，普通任务跳过空学习维护。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：双语 Skill取消无观察且无已知待评审时的 review/空动作文件；当前 change 的真实待评审及失败处理保留。中文已获确认并同步英文。
- 涉及文件：assets/skills-zh/ 与 assets/skills/ 中的 comet-classic/reference/scripts.md、comet/reference/task-learning.md。
- 验证及性能：中文明确空观察/无反馈/无已知待评审时跳过空学习文件与空 review，真实本 change 待评审继续处理；Skill 最新组 68 项通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：相关中文已获用户明确确认并同步英文；双语 Skill 等最新 6 个测试文件 87 项通过。真实模型遵循未运行 Eval，未获得启动授权。

### T19 保留 walkthrough 当前默认与开关

审核状态为撤回删除。

用户已有 Dashboard 开关和自动说明预期，按需默认会改变交付内容。优化同页更新、重复渲染与已生成材料复用，遵循显式配置。

验收要求包括开启获得页面，关闭按现有摘要交付，已有页面更新及 Archive 链接正确。

[`comet-build/SKILL.md:34`](../../assets/skills-zh/comet-build/SKILL.md#L34)、[`comet-verify/SKILL.md:28`](../../assets/skills-zh/comet-verify/SKILL.md#L28) 缺省/true 时生成或更新；Native [`comet-native/SKILL.md:137`](../../assets/skills-zh/comet-native/SKILL.md#L137) 已仅在用户要求时生成。共享参考也须对齐。

#### 执行记录（2026-11-08 接手）

- 执行状态：保留能力已核对。
- 实际改动：walkthrough 当前默认、显式开关、同页更新和 Archive 引用未改；契约检查通过。
- 涉及文件：既有 Skill walkthrough 契约测试。
- 验证及性能：默认 walkthrough、项目开关、独立阶段和实施方法契约保留；Skill 与 layout 定向通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：未用全局关闭 walkthrough 获取减负收益。

### T20 精简阶段重复正文

审核状态为需等价验证。

可抽取重复说明并按当前阶段加载。保留独立 Skill 入口、外部方法选择、阶段确认、TDD/review 配置和固定应用引用。撤回删除用户可选方法、阶段入口的方案。

验收要求包括full/hotfix/tweak、单独阶段调用、换 Agent/冷恢复均可达，加载量下降，确认点与实施方法仍符合配置。

[`comet-classic/SKILL.md:44`](../../assets/skills-zh/comet-classic/SKILL.md#L44) 分阶段加载；[`comet-build/SKILL.md:8`](../../assets/skills-zh/comet-build/SKILL.md#L8) 等再读 layout、编辑协议与阶段方法；[`comet-open/SKILL.md:75`](../../assets/skills-zh/comet-open/SKILL.md#L75) 的 full 正常路径加载外部 OpenSpec 方法后又适配其 CLI/cwd/路径。大型 PRD 才批量拆分，不能算所有任务成本。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：中文 Design/Build/Verify/Archive 抽取重复布局及编辑说明到 scripts.md 的阶段共用入口，保留每个独立入口、方法和配置。中文已获确认并同步英文。
- 涉及文件：assets/skills-zh/comet-{design,build,verify,archive}/SKILL.md、comet-classic/reference/scripts.md。
- 验证及性能：四阶段改为明确共用入口，阶段自身审批/实施/审查要求保留；每个入口重复段落 UTF-8 593→333 bytes；layout 与独立入口契约通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：相关中文已获用户明确确认并同步英文；双语 Skill 等最新 6 个测试文件 87 项通过。真实模型遵循未运行 Eval，未获得启动授权。

### T21 handoff 共用一次源读取

审核状态为需等价验证。

先消除同次提案重复采集/渲染。JSON、Markdown 与批准原文有不同消费者，须核对后才能合并存储并按需导出。保留离线交接、换 Agent 和原字节批准证据。

验收要求包括源文档漂移拒绝，既有 handoff 消费者可读取，换 Agent 获取完整要求，旧 Run 可批准与恢复。

[`classic-sdk-design.ts:133`](../../domains/comet-classic/classic-sdk-design.ts#L133) 保存 proposal/handoff/sourceEvidence；[`classic-handoff.ts:538`](../../domains/comet-classic/classic-handoff.ts#L538) 生成 JSON＋Markdown 并保留批准原文，接受时再次核对；[`comet-design/SKILL.md:20`](../../assets/skills-zh/comet-design/SKILL.md#L20) 要求已读源材料的 Agent 再读生成的 Markdown。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：同次 Design 提案用有结束验证的 source observation 共用 sourceEvidence/requirementsEvidence/handoff 的原文字节；提交验收在 scope 外重新读取。
- 涉及文件：classic-protected-path.ts、classic-sdk-design.ts、classic-sdk-application.ts。
- 验证及性能：提案 evidence、requirements 与 handoff 共用一次 source observation，提交验证另起新鲜观察；两文件最新 11 通过、1 跳过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：缓存只在短提案准备作用域内，不能跨用户编辑或提交验证复用。

### T22 阶段上下文增量交付

审核状态为需等价验证。

仅在接收会话有可验证交付记录时去重。阶段规则变化、上下文压缩、切会话或记录不完整时完整交付。当前自动 contextDelivery 已去重的路径优先复用。

验收要求包括同会话少重复正文，阶段专用约束和压缩恢复完整可得，真实模型行为仍需单独 Eval 授权。

Classic [`reference/scripts.md:140`](../../assets/skills-zh/comet-classic/reference/scripts.md#L140) 与 Native [`reference/commands.md:73`](../../assets/skills-zh/comet-native/reference/commands.md#L73) 已优先 contextDelivery、同阶段不重复；没有自动交付时首次新阶段仍需完整 snapshot。重复 contextRequest 字段不等于 Agent 真重复查询。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：中文 Skill 仅在同会话有可核对交付记录、正文仍在上下文中时使用 incremental；新会话、压缩、恢复、记录缺失时 snapshot。阶段专用约束仍加载。中文已获确认并同步英文。
- 涉及文件：agent-learning/context-director.ts、context-application-store.ts；双语 scripts.md。
- 验证及性能：已完整交付的同 session/task/project/path/operation profile 在显式 incremental 跨阶段去重；阶段规则、snapshot、新会话恢复保留；学习组 43 项通过，SQLite 查询定向通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：相关中文已获用户明确确认并同步英文；双语 Skill 等最新 6 个测试文件 87 项通过。真实模型遵循未运行 Eval，未获得启动授权。

### T23 Classic observe 合并准备

审核状态为可优先实施。

让 observe 返回正式原文与判断模板，沿用已实现的 Native 方向。保留旧 prepare-applied 命令入口以及判断、批准和候选绑定。

验收要求包括一次 observe 获取所需材料，连续编辑和补检查失败恢复成功，旧调用者可继续。

[`classic-edit-review-command.ts:388`](../../domains/comet-classic/classic-edit-review-command.ts#L388) 只有 formalChanges，正式原文/提案另走 [`同文件:397`](../../domains/comet-classic/classic-edit-review-command.ts#L397) 的 prepare-applied。共享 [`edit-review.md:23`](../../assets/skills-zh/comet/reference/edit-review.md#L23) 已说明 Native observe 合并准备，这部分 Native 不再待做。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：Classic observe 同次返回 formalReview、实际批准原文 originals 和判断模板；保留旧 prepare-applied。共享编辑协议明确 Native/Classic 均复用已返回材料，中文补充已再次获确认并同步英文。
- 涉及文件：domains/comet-classic/classic-edit-review-command.ts；双语 comet/reference/edit-review.md；对应 Runtime 与 Skill 契约测试。
- 验证及性能：编辑后继续 Verify、批准原文与模板断言通过；双语减少重复准备的契约通过，最终 T23 登记组 2 项通过。
- 剩余内容：返回实际批准原文；不自动替用户或审查者作行为影响判断。

### T24 保留唯一 change 自动发现

审核状态为撤回删除。

缺 selection 一律要求 select 会为恢复和普通写入增加工具轮次。当前有效 selection 已走具名路径，可优化缺失时发现成本，继续拒绝真正歧义。

验收要求包括唯一有效 change 自动恢复，多候选要求选择，失效/不可读归属按既有安全规则处理。

[`hook-router.ts:202`](../../domains/comet-entry/hook-router.ts#L202) 有效 selection 已具名读取；[`同文件:249`](../../domains/comet-entry/hook-router.ts#L249) 具名失败、`:298` 无 selection 才全量发现。Native 会读 active/history；不是每次 Hook 全扫描。

#### 执行记录（2026-11-08 接手）

- 执行状态：保留能力已核对。
- 实际改动：selection 缺失时唯一 change 自动发现与真正歧义拒绝均保留，未添加用户 select 轮次。
- 涉及文件：hook-router、Native history 与 Classic recovery-read 既有测试。
- 验证及性能：唯一 change 自动发现、无/多候选与恢复路径相关组 42 项通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：不删除自动发现或把多候选改为默认猜测。

### T25 保留跨 worktree 寻址与归档查询

审核状态为撤回删除。

用户常用 worktree，因此原目录/目标目录切换后的寻址和归档合入查询属于需保障的使用场景。要求手动给原路径会直接损害该体验。

验收要求包括跨 worktree 与 amend 后查询成功，坏副本和缺原历史仍正确拒绝，原 Run 不重复导入。

[`classic-sdk-status.ts:188`](../../domains/comet-classic/classic-sdk-status.ts#L188) 本地缺 owner 才枚举 registered worktrees；[`classic-runtime-ownership.ts:235`](../../domains/comet-classic/classic-runtime-ownership.ts#L235) 归档副本自动找原已完成 Run。#527 是真实问题，非假想并发。

#### 执行记录（2026-11-08 接手）

- 执行状态：保留能力已核对。
- 实际改动：跨 worktree 寻址及归档合入查询未删除；此前 delivery-scope 40 项通过，manifest symlink 用例因 Windows EPERM 未运行目标断言。
- 涉及文件：Classic delivery-scope、Git worktree 与 Native 高层既有测试。
- 验证及性能：worktree 本地身份/全表更新测试通过，跨工作区交付范围定向通过；对归档/续行使用原寻址规则。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：Classic manifest symlink 用例因 Windows EPERM 未到目标断言；不把这个失败记为通过。

### T26 批量读取交付 Git 元数据

审核状态为可优先实施。

用批量 Git 调用取得同等逐 commit 信息，保留完整父链、每次提交路径和真实 remote 校验。

验收要求包括1/2/100 commit 的进程启动数改善，夹带后撤销、merge/断连/错误 HEAD 均被拒绝，合法多提交交付成功。

[`classic-sdk-application.ts:448`](../../domains/comet-classic/classic-sdk-application.ts#L448) rev-list 后逐 commit 检查单父连续性与 diff-tree；`:479` 拒绝夹带未批准文件后撤销。只发生交付验证，不是每 state get 遍历历史。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：正常路径用 git diff-tree --stdin 一次读取全部提交路径；批量总输出或总时限触及边界时，沿原逐提交参数完整检查，不把聚合限制变成新的交付阻塞；真实 Git 输入错误直接报告。
- 涉及文件：platform/process/git.ts、classic-sdk-application.ts、test/platform/git-commit-paths.test.ts。
- 验证及性能：1/2/100 提交正常路径通过；最终 100 提交与资源边界、输入错误组 4 项通过。两种资源回退在修改前失败、修改后通过，真实 Node 错误码另行核对。所有中间提交、空格和类似 hash 文件名保留。
- 剩余内容：父链/merge、先夹带再撤销、远端/HEAD 与批准内容校验继续执行；批处理未放宽交付范围。

### T27 保留归档后交付修复

审核状态为撤回删除。

中断、未知执行、晚产物和失败重试直接影响交付完成率。保留 repair 及旧 checkpoint 恢复能力，可在 T14 方向验证按需装配。

验收要求包括原 Action 结算、retry、clone/原工作区恢复可用，已执行副作用按既有身份幂等处理。

[`classic-sdk-delivery-checkpoint.ts:38`](../../domains/comet-classic/classic-sdk-delivery-checkpoint.ts#L38) 保存交付前 checkpoint；delivery-repair 模块处理 failed/unknown/晚产物，非所有任务必跑。state-store 已避免最终 commit 自引用回写。

#### 执行记录（2026-11-08 接手）

- 执行状态：保留能力已核对。
- 实际改动：delivery repair、旧 checkpoint、unknown 和晚产物恢复未删除，相关 history/handoff 定向验证进行中。
- 涉及文件：Classic application、state history、handoff 既有测试。
- 验证及性能：归档后交付修复/状态历史定向 27 项通过；完整 Classic application 选择组 4 项通过，三 preset 跨会话 source/bundle 6 项通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：交付修复沿用原授权、Run 与恢复链，不制造第一次 push/PR。

### T28 Engine 已验证不可变值去重

审核状态为需等价验证。

先测长 Run 的实际主要成本，仅对同身份、同字节且不可变对象去重。历史分存后置，完整审计/导出、坏历史拒绝和旧 checkpoint 兼容均须成立。

验收要求包括字节处理量/CPU/内存有配对收益，原历史、审批和未知执行恢复可用。

[`runtime-service.ts:720`](../../domains/engine/runtime-service.ts#L720) inspect 解析验证完整 Run，mutation 再 copy/validate；[`runtime-store.ts:1194`](../../domains/engine/runtime-store.ts#L1194) CAS 再验证、编码历史、JSON 隔离与发布 hash。当前已有不可变结果缓存、value pool、长度缓存，CAS 不先展开全部旧 pool，Native Portable history 也有限额/overflow，不能描述成完全无复用。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：只有已验证并冻结的相同 Run 对象复用解析结果；可变对象、换字节及键不匹配继续拒绝；公共 parser 保留独立副本。
- 涉及文件：engine/workflow-run-validation.ts、platform/fs/json-value-pool.ts。
- 验证及性能：已验证 immutable snapshot 复用；mutable/changed、坏 envelope/内容检查保留。长历史 200 轮所有摘要相同，中位数 2.377→1.406 ms、CPU 483→314 ms。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：post-GC heap 30,274,928→36,837,912 bytes，约增加 6.26 MiB；有 CPU/内存取舍，不宣称节省内存。

### T29 保留 Archive 提交时输入重验

审核状态为撤回删除。

单 Agent 的检查、生成文件或编辑也会使预检后输入变化。当前 executor 与 validator 是不同观察时点，保留每边界一次完整观察，复用各自观察内部材料。

验收要求包括预检后改候选/报告/Spec 均拒绝陈旧结果，稳定重试能归档。

[`native-sdk-archive.ts:533`](../../domains/comet-native/native-sdk-archive.ts#L533) executor 预检，`:556` validator 再预检，跨执行/提交各观察一次；单次内 observedInputs/materials 复用已实现。现有测试故意在两边界间修改输入，证明第二次不是纯浪费。

#### 执行记录（2026-11-08 接手）

- 执行状态：保留能力已核对。
- 实际改动：Archive 执行与提交边界两次输入观察均保留；继续拒绝两边界之间候选/报告/Spec 漂移。
- 涉及文件：Native SDK application Archive 既有测试。
- 验证及性能：选择组 7 项通过，包含 Archive 候选漂移拒绝、返回后续行、同 session 交付与检查失败修复。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：保留执行前及提交时输入重验；普通单测不代表真实模型验收。

### T30 保留扩展应用共享写协调

审核状态为撤回删除。

扩展 Skill 可声明共享或项目外写范围，worktree 隔离无法覆盖这些路径。普通内置 Native 已无此 holder 成本。保留 scope 协调、固定包和原执行范围。

验收要求包括有重合写范围的应用正确协调，纯读或无 scope 走现有快路，未知执行范围保留至停止证据完整。

[`workflow-application/application.ts:1066`](../../domains/workflow-application/application.ts#L1066) 固定材料/holder 核对，scope 变化等条件才走 [`workspace-scope.ts:118`](../../domains/workflow-application/workspace-scope.ts#L118) workspace＋application 双锁，底下还有 Run CAS。只读或无 scope 不需 holder，已有快路。**普通内置 Native 直接建 store，不走 holder 双锁。**

#### 执行记录（2026-11-08 接手）

- 执行状态：保留能力已核对。
- 实际改动：固定扩展应用的 workspace scope holder/共享写范围、停止证据及未知执行协调未改；纯读与无 scope 保持快路。
- 涉及文件：domains/workflow-application/workspace-scope.ts 及跨应用测试。
- 验证及性能：scope/跨应用/端口/Supervisor 80 项组通过；共享资源协调及固定锁顺序保持。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：同应用与跨应用真实共享写仍按资源协调，不取消应用持有者协议。

### T31 具名本地查询减少全表观察

审核状态为需等价验证。

先测实际 daemon/Dashboard 调用链，只在能从已绑定本地身份得出结果时跳过无关 worktree stamp。全项目视图与真正 worktree 操作继续取得新鲜元数据。

验收要求包括具名查询不随无关 worktree 数增长，分支切换、工作区删除/重建及项目列表刷新及时。

[`git-worktree.ts:34`](../../platform/paths/git-worktree.ts#L34)、[`git-worktree-cache.ts:65`](../../platform/paths/git-worktree-cache.ts#L65) 跨请求缓存前后采 metadata stamp，枚举 common/worktrees 与多个元数据文件。属于 daemon/Dashboard 专用，非普通 CLI 固有成本。

#### 执行记录（2026-11-08 接手）

- 执行状态：已完成。
- 实际改动：daemon 具名 status/show 复用已绑定本地 Git 身份时不采无关 worktree stamp；listGitWorktrees 在同一 scope 仍走新鲜发现，本地 HEAD/目录/配置变化使绑定失效。
- 涉及文件：platform/paths/git-worktree-cache.ts、git-worktree.ts、app/commands/daemon-server.ts。
- 验证及性能：具名本地 daemon 查询 stamp 不枚举 peer 注册表；真正全表读取仍新鲜，当前分支变化使本地缓存失效；Git worktree 15 项及新增选择器通过。详见[执行报告](2026-11-08-native-classic-simplification-execution.zh.md)与[原始测量](2026-11-08-native-classic-simplification-measurements.json)。
- 剩余内容：优化只作用具名本地读取；全项目/Dashboard 全表观察保留，未声称 daemon-off CLI 已获得此项全部收益。
