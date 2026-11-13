# Skill 全流程剩余冗余审查

审查基线：`053`，`b0a2fc5d03b0e265ba83459667e3cad30c18fe39`，2026-11-08。

## 方法与证据边界

按用户实际进入、生成产物、确认、实施、验证、交付和恢复的顺序核对发布 Skill 与拥有相应行为的 Runtime。只有重复执行同一职责、把确定性编排留给模型，或重复维护同一事实时，才列为精简候选。文档较长、阶段较多或有安全检查本身不构成过度设计。

用户进一步要求重点寻找对 Agent 没有相应价值、却显著增加 Runtime 耗时的机制，因此优先级按实际重复计算、磁盘读取和子进程成本排列。文字长度和提问样式不列为主要收益。

本轮读取源码、Skill 与测试断言，执行了长 Run CPU 微测、隔离公开 CLI 等待路径观测、固定依赖目录读取微测，以及一个只用于验证 Git 重复查询成本的临时实验。另运行 SDK Skill 交接契约测试，结果 8 项通过、8 项失败，详见末节。未执行真实平台 Hook、全仓测试或模型 Eval；没有修改产品源码或 Skill。涉及授权、证据绑定和恢复行为的建议均需要等价验证。

## 优先级结论

| 顺序 | 机制                                              | 当前证据                                                                                                         | 建议边界                                                                             |
| ---- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1    | 固定应用每次读和 CAS 反复全包扫描、重新适配 Skill | 约 451 KiB、100 份参考文档样例，单次全包读取中位 337 ms，依赖检查 241 ms；一次 CAS 内存在两次完整材料核对        | 保留真实字节验证，让同一消费边界复用已验证材料，避免重新遍历、Markdown 解析和适配    |
| 2    | Classic 每个内部 CAS 都重建完整 Portable 副本     | 40 Action 长 Run，单次 Portable 生成、编码和 YAML 输出中位 127 ms，YAML parse 68 ms；一个 Design 命令有四个 CAS  | 权威 Run 正常持久化；合并内部 Portable 投影，在真实交接、等待、恢复和交付边界保存    |
| 3    | Native 同一次无变化 next 重做诊断和 worktree 查询 | 公开 CLI 等待样例有三次相同 worktree list；单次完整诊断中位 84 ms。临时实验只复用重复 Git 结果，637.7 → 507.8 ms | 同一无外部执行的观察边界共享诊断和 Git 观察，执行后与提交前按需要刷新                |
| 4    | 逐层重读 owner、配置及同一目录链                  | 同一等待命令 757 次 lstat、558 次 realpath；同一个具名 owner 正文读六次、配置读四次                              | 上下文显式传递已验证 owner、路径和读取会话，结束时校验目录身份；不增加跨命令时间缓存 |
| 5    | Classic 让 Agent 额外启动可合并或本地可替代的命令 | OpenSpec instructions 仍返回上游 status；手动 review 用四次单字段 get，而 Runtime 已支持多字段                   | 统一下一步协议、具名读取和批量字段读取；本轮没有模型端到端收益实测                   |

以上成本不能相加作为收益承诺，部分路径重叠，包大小、历史长度和磁盘环境也不同。优先做调用次数预算与边界复用，暂不引入新 daemon、第二套缓存协调器或新的项目预算配置。纯文字精简及确认合并放在后续，不以削弱审批、独立验收或恢复保证换取速度。

## Classic

### C00：每个内部 CAS 都重建完整 Portable checkpoint 和 YAML 投影

**优先级：最高。已经测到单次边界成本，需要设计恢复等价方案。**

- 触发：Classic SDK 任意非初始的成功 compareAndSwap，包括同一公开命令内部的 Wait 决定、Action 领取、结果与证据提交。
- 当前路径：先写本地权威 Run，再无条件调用 `syncStateFile(runId, false)`；另取 projection 短锁，读取/解析现有 YAML，完整 `createPortableRunCheckpoint(run)`、历史编码、YAML stringify，再分别写 YAML 与 projection marker。即便业务 phase 不变，sourceRevision 和完整 Run 进度仍会改变 checkpoint。T17 已去掉一次展开的深比较，但没有减少这条链路的调用次数。
- 对当前 Agent 的冗余：同一公开命令内、无模型或外部执行切换的中间状态，本地权威 Run 已持久化；又把每个中间 CAS 转换为一份完整的可携带副本。完成设计的一条合法路径就包含 resolveWait、claim、recordOutcome、recordEvidence 四个 CAS，现有测试明确保存这些边界。本地 CAS 与便携副本各有职责，但不代表每个内部 CAS 都需要立即完整重建后一份。
- 建议：保留每个本地权威 CAS 和全部审批/证据校验，先把纯内部连续推进期间的 Portable 写入合并到可恢复的命令出口、外部工作启动前、待用户决定、阶段和交付边界。投影锁内必须读取最新 authority，避免较旧调用后到而覆盖新投影。内建同步步骤可以进一步研究一次权威提交，但不能直接删除真实外部工作领取与未知结果边界。
- 必须保留：复制项目后仍恢复同一阶段和待决定项、已领取工作恢复为未知而非重放、用户配置导入、禁止修改 Runtime 字段、固定应用身份、归档后封存、projection 缺失修复和并发新版本优先。当前只读检查会拒绝不匹配 checkpoint，因此不能仅延后写入；必须同时定义“合法尚未投影”与“损坏/外部修改”的区别，保持纯读不补写及适用可写入口自动修复。
- 来源：`domains/comet-classic/classic-sdk-state-store.ts:299–322,490–563,637–638`；`domains/engine/portable-run-checkpoint.ts:32–42,120–134`；`test/domains/comet-classic/classic-sdk-design-performance.test.ts:118–142`。

同一长 Run 的本机 CPU 边界微测，Node `v22.20.0`，1 次预热、5 个样本，输入先经过 `parseWorkflowRun`，随后复用同一有效 Run。fixture 为上轮留存的 40 个 Action，展开 JSON 为 6,664,603 字节；本地历史编码 555,613 字节，Portable 编码 558,868 字节，包含 `run_checkpoint` 的 YAML 为 590,738 字节。

| 操作                                |  中位耗时 |
| ----------------------------------- | --------: |
| 本地 serializeRuntimeHistory        |  26.60 ms |
| createPortableRunCheckpoint         |  68.07 ms |
| encodePortableRunCheckpoint         |  33.22 ms |
| YAML stringify                      |  25.15 ms |
| YAML parse                          |  68.09 ms |
| Portable 创建、编码、stringify 合计 | 126.87 ms |

原始五个样本，列顺序为本地 serialize、Portable 创建、Portable 编码、YAML stringify、YAML parse、Portable 写出 CPU 合计，单位 ms：

```json
[
  [27.5592, 71.9742, 31.5763, 40.6531, 87.037, 144.2036],
  [25.965, 68.0712, 33.224, 22.6648, 62.8933, 123.96],
  [24.7211, 74.4076, 33.5978, 25.6522, 68.0907, 133.6576],
  [26.6044, 66.5061, 31.979, 22.7537, 59.8678, 121.2388],
  [27.0161, 66.472, 35.2453, 25.1548, 71.6617, 126.8721]
]
```

这是原有长 Run fixture 的纯函数微测，尚未专门构造同等大小的 Classic 全流程 Run；YAML 仅含 checkpoint 包装，没有模拟已有 state 文档的局部编辑。结果不含文件系统、锁、Git、CLI 启动或模型等待，不能直接乘 CAS 次数声称某条命令已提速，也不能与上一轮具有不同对象共享形态的缓存微测混作回归对照。脚本与完整结果位于本机临时目录 `C:/Users/BENYM/AppData/Local/Temp/comet-simplification-execution-20261108/classic-checkpoint-cpu-boundary.{mjs,json}`。

后续可复用的行为验证入口：`classic-sdk-state-recovery.test.ts` 的可信 checkpoint 恢复、运行中领取未知及投影发布中断案例；`classic-sdk-readonly.test.ts` 的实际 portable 正文核对、不写入及陈旧投影拒绝；`classic-sdk-read-performance.test.ts` 的稳定读取、用户配置导入、陈旧 CAS 与 marker 修复；`classic-sdk-application.test.ts` 的完整 full/hotfix/tweak 公开应用链。应新增每条合法公开命令的 Run CAS/Portable 写入计数预算，并在公开 CLI 上对照新旧端到端耗时。

### C01：产物生成后的下一步协议仍要求模型在两条路径间取舍

**优先级：高。可直接确定存在协议重复，实际模型开销尚未测量。**

- 触发：OpenSpec `instructions <artifact-id>` 返回后，Agent 写完一个必需产物。
- 当前路径：Open Skill 要求执行 `data.nextAction` 的完整 argv，同时要求产物后用本地 `state artifacts` 校验、只在依赖或实时指令变化时刷新上游 status。适配器的 instructions 响应却固定返回上游 `status`，并提示写完后刷新 status。测试也要求该响应包含 status。Agent 因而需要自己解决两个公开指引的分歧；沿返回 argv 执行时，每个产物可能多启动一次上游 OpenSpec。
- 建议：由 Runtime 返回与当前产物生命周期一致的唯一下一步。写完后先做本地依赖闭包验证；确实需要上游实时指令时再刷新 status。不能靠删掉 Skill 的安全校验来迁就旧响应。
- 可省工作：每个已写产物后的路径判断，以及满足本地验证条件时的上游 status 调用。具体次数取决于 schema，尚无模型实测。
- 必须保留：实际 schema 与依赖闭包、动态 ready 顺序、受保护输出路径、所有必需产物存在且非空、上游变化后的新鲜指令和明确失败。
- 来源：`assets/skills-zh/comet-open/SKILL.md:148–168,198–205`；`domains/comet-classic/classic-openspec-command.ts:234–261,287–299`；`test/domains/comet-classic/classic-openspec-command.test.ts:214–221`。

### C02：手动审查已明确目标时仍先扫描整个项目，再逐字段查询

**优先级：中。Classic 多字段查询已有实现，主要缺口在 Skill。**

- 触发：用户手动执行 comet-review，selection 已有效且明确指向一个 change。
- 当前路径：先无条件 `comet status . --json`，再读 selection；Classic 又独立运行四次 `state get` 获取 phase、base_ref、plan、verification_report；Native 要求 show 和 status details 两次读取。项目 status 会枚举、检查多个 change。当前 `state get` 已支持一次请求多个字段。
- 建议：先只读 selection 并验证其指向，已有明确目标走具名读取；只有缺 selection 且需唯一候选推断时才用全项目枚举。Classic 四个字段一次读取；Native 是否能一次覆盖全部引用需进一步核对公开输出后确定，不能先删命令造成漏证据。
- 可省工作：Classic 字段查询四个 CLI 进程收敛为一个；有效选择时可免全项目扫描。不能以未带全部证据的状态摘要代替审查材料。
- 必须保留：只读、不写 selection、不调用 next/Guard、不推进流程，失效选择停止、歧义选择询问，以及当前候选完整差异和相关证据。
- 来源：`assets/skills-zh/comet-review/SKILL.md:15–23,27–70`；`domains/comet-classic/classic-state-command.ts:2549–2563`；`domains/comet-entry/project-status.ts:128–146,280–290`。

### C03：新 change 的确定性创建事务由模型手动编排

**优先级：中。需要 Runtime 编排和中断等价验证。**

- 触发：真正创建一个 full、hotfix 或 tweak change。
- 当前路径：工作区 prepare → OpenSpec new 基础目录 → state init → state select，随后检查返回归属并进入产物循环。初始化中断时，模型还要判断目录、owner、Run、两种状态文件和检查点分别是否存在，决定只补哪一步。当前顺序有实际兼容原因：先 init 再 new 会因目录已存在失败。
- 建议：提供一条公开、可恢复的创建编排入口，接收已确定的名称、workflow 和 isolation，内部沿原顺序执行，返回同一 Run、layout 和 continuation。产品模块复用现有工作区和 OpenSpec 适配能力，不另建一套流程状态机；失败必须返回已完成步骤和恢复动作。
- 可省工作：模型不再维护三类流程各自的命令顺序、检查字段和初始化异常分支。不能把四个动作拼成 shell 字符串就当作事务完成。
- 必须保留：在获准工作区创建、OpenSpec 先建基础目录、Run 尽早持久化、选择记录只在初始化后写、冲突停止、已有目录不覆盖、既有 Run 不重复初始化，以及跨 worktree 绑定。
- 来源：`assets/skills-zh/comet-classic/reference/sdk-methods.md:19–24`；`assets/skills-zh/comet-open/SKILL.md:132–144,196–205`；`assets/skills-zh/comet-hotfix/SKILL.md:30`；`assets/skills-zh/comet-tweak/SKILL.md:33`。

### C04：子代理协调记录与任务验收仍分成多次模型写入

**优先级：中。可以批量提交，不能批量推断验收。**

- 触发：subagent-driven-development 或 autonomous 实际委派一组任务。
- 当前路径：派发前、拿到 session ID 后、审查、验收或阻塞时都要求 checkpoint。完成后还要逐 ID 调用 task-complete；一个命令只接受一个 ID。任务状态在 tasks.md，协调记录有自己的 JSON schema 和 Markdown 投影，模型需要保留两者关系并组织多次写入。
- 建议：允许一次提交同一 revision 下逐 ID 的验收结果、证据引用和协调进度，由 Runtime 原子核对后更新既有任务权威与协调记录。派发意图必须先持久化，拿到 session ID 后再关联；这两个真实恢复边界可以保留，不能以减少调用为由删除。
- 可省工作：一组已独立验收任务的 N 次 task-complete 与验收后 checkpoint 可合并；由 Runtime 生成投影和重复字段。只有协调状态或证据发生变化时写入，普通无变化反馈不写。
- 必须保留：逐 ID 验收、revision 拒绝陈旧需求、主会话整合验证、实现者与审查者独立、复查次数、未知执行结果先核对，以及 tasks.md 为唯一完成权威。批量接口的部分失败与全有或全无语义必须明确测试。
- 来源：`assets/skills-zh/comet-classic/reference/subagent-dispatch.md:9,22–34,40–62`；`domains/comet-classic/classic-state-command.ts:3093–3106`；`assets/skills-zh/comet-classic/reference/scripts.md:45–47`。

### C05：SDK 正常流程仍暴露一整组仅 Compat 适用的旧推进命令

**优先级：低。属于协议阅读和维护负担，尚无错误调用复现，不能承诺明显缩短 Runtime 耗时。**

- 触发：任一 SDK 阶段按共用入口读取 scripts.md。
- 当前路径：阶段主 Skill 已把 Compat 隔离到 reference/compat.md，共用 scripts.md 却仍把旧 handoff、delivery、直接 transition、archive-confirm 和 archive-reopen 作为一般公开工作流示例。SDK 主 Skill 随后再要求不要调用这些路径，模型需要同时记住“公开可用”与“当前不能用”。
- 建议：共用参考首先给 Runtime 无关的查询、任务、上下文和证据契约；旧推进写法集中在标明 `runtimeFormat: compat` 的章节或现有 compat 参考中。公开 CLI 兼容入口可以完整保留，不必为减少阅读面删除命令。
- 可省工作：SDK 无需加载和排除另一套推进方法，维护者也无需在新旧两处同步同一个使用条件。
- 必须保留：Compat 原命令与历史恢复能力，SDK Run 推进权威，明确禁止手动改 phase，以及用户独立调用公开诊断命令的能力。
- 来源：`assets/skills-zh/comet-classic/reference/scripts.md:13–37,53–75,126–132`；`assets/skills-zh/comet-build/SKILL.md:16–30`；`assets/skills-zh/comet-verify/SKILL.md:18–24`；`assets/skills-zh/comet-archive/SKILL.md:20–26`。

### C06：Spec Patch 与正式设计的确认可探索合并，但不能直接删一层批准

**优先级：低，待设计。当前两层各有保护对象，不能直接认定为无效确认。**

- 触发：full Design 需要修改已批准的 delta spec。
- 当前路径：先取得具体 Spec Patch 的事前同意 → 写入 delta spec → propose-design 固定当前来源证据及 handoff → 对整体方案记录 Design 决定 → 写唯一正式 Design Doc。第二次确认绑定已经修改的真实来源；第一次保证在改需求前已获得授权。
- 建议：如果产品希望减少一次用户等待，先设计“只读补丁预览 + 完整方案”的统一提案，批准同时覆盖补丁与方案，随后由 Runtime 应用批准的精确补丁并绑定最终来源；任一原文件漂移必须拒绝并重新提案。不能先改正式需求再补取批准，也不能用方案摘要代替原批准与精确补丁。
- 可省工作：补丁与整体方案适合同时判断时，可能合并一次用户决定。尚未验证现有输出、哈希和恢复结构能否等价承载；不列入可直接实施项。
- 必须保留：事前写授权、正式方案批准、原文与补丁绑定、漂移拒绝、恢复不重复应用，以及唯一 Design Doc。
- 来源：`assets/skills-zh/comet-design/SKILL.md:18–21`；`assets/skills-zh/comet-classic/reference/sdk-methods.md:36–44`；`assets/skills-zh/comet-classic/reference/decision-point.md:42–46`；`domains/comet-classic/classic-sdk-design.ts:119–173`。

### 本轮不建议删除的 Classic 保护

1. **Open 与 Design 的不同批准对象。** Open 确认范围与产物，Design 确认具体技术方案；已有授权覆盖时当前协议已经允许继续，不要求额外重复确认。来源：`assets/skills-zh/comet-classic/SKILL.md:78–88`，`assets/skills-zh/comet-classic/reference/decision-point.md:11–18,30`。
2. **任务级审查与最终集成审查。** 两者检查对象不同，当前协议已经明确 Build 不追加全分支最终审查，Verify 只有一次最终集成审查，且允许复用仍有效的独立结论。来源：`assets/skills-zh/comet-classic/reference/sdk-methods.md:82,88–98`，`assets/skills-zh/comet-classic/reference/subagent-dispatch.md:40–46,64`。
3. **恢复和交付实证。** 归档目录存在不等于提交、push 或 PR 完成；结果未知先只读核对是防重复副作用所需。来源：`assets/skills-zh/comet-archive/SKILL.md:16–22`。
4. **唯一任务权威与设计引用。** 当前计划已不允许复制 checkbox，Design Doc 优先使用已有 design.md；不能继续用“有多个文件”推断它们必然在维护第二套状态。来源：`assets/skills-zh/comet-classic/reference/sdk-methods.md:44,62`。
5. **walkthrough 默认能力及开关。** 当前已经规定复用同一页面，Archive 不补生成、不重跑检查；应保留用户能看到的说明体验，后续如优化只减少重复生成。来源：`assets/skills-zh/comet-build/SKILL.md:32–34`，`assets/skills-zh/comet-archive/SKILL.md:28`。

## 固定应用：重复验证已经超出消费边界

### A00：每次 Store 读取和一次 CAS 内多次全包读取、Skill 解析

**优先级：最高，影响固定 Native/Classic 扩展和独立应用；内置普通 Native 不走这条完整应用加载路径。**

当前加载首先 readApplicationFiles(packageRoot)，随后对每个依赖 adaptApplicationSkill。后者再次递归读取依赖目录，base64 编解码每个文件、计算摘要，并对所有 Markdown 执行 Lexer.lex/walkTokens 检查本地链接。包内依赖因而既被包目录遍历覆盖，又单独读取。后续 pinnedStore.readProjection/read 每次执行 assertCurrentMaterial；compareAndSwap 在准备前和 commit 内各执行一次。材料核对不是只在真实执行或内容消费前发生。

来源：domains/workflow-application/application.ts:513–559,978–998,1066–1084；domains/workflow-application/skill-adapter.ts:18–49,95–140。活动共享 scope 的其他 Run 还可能调用 recordScopeManifest/recordHoldsApplicationScope 再读固定包（application.ts:283–300,336–357），本轮未单独测量其放大程度。

对 Agent 的无效工作是：只为取得同一 Action、保存同一次结果和投影，反复重新解析同一份已核对 Skill。真实字节与固定身份核对仍有价值，不能因为目录名含 hash 就假定文件不可变，也不能用全局 TTL、mtime 或旧成功代替当前输入证据。

建议分两步：

1. 对同一次完整材料读取使用 protected read session，共用祖先目录检查，保留叶子 race-safe 读取和结束目录身份验证；解析、链接验证、schema 和适配结果按已经取得的内容摘要复用。
2. 给一个确定消费边界传递已验证材料，而非每个低层 read/CAS 再全包加载；模块加载前核对固定身份，外部执行、异步等待、写锁取得后需要新鲜证据时重新观察。若想把两个真实观察合为一个，必须让实际模块与 Skill 消费所验证的同一份字节，并证明无漂移窗口。

不能删掉的保护：依赖漂移必须在执行前拒绝、不得加载未经固定的代码、scope 冲突协调、批准来源、工件真实摘要、未知执行恢复及原固定应用身份。不得为了减少扫描默认放宽依赖包含范围；包是否包含不使用的大型资源需另行设计发布契约。

微测为合成包的读取边界，不是完整应用吞吐：102 个文件、461,640 字节，包含 SKILL.md 和 skills/writer/SKILL.md，以及 100 个 references/ref-N.md；每份正文为标题加 200 次 Stable reference text.。Node 22.20.0、当前 dist、同进程 1 次预热加 5 个样本。readApplicationFiles(packageRoot) 与 inspectApplicationSkill(skillRoot) 分别测量；完整适配及全应用加载的总收益未测。

| 边界                                  | 五个原始样本（ms）                               |      中位数 |
| ------------------------------------- | ------------------------------------------------ | ----------: |
| 全包读取                              | 350.7216, 348.8881, 333.0881, 332.8369, 337.0022 | 337.0022 ms |
| 依赖 Skill 读取、摘要与 Markdown 检查 | 241.8498, 242.8541, 224.9810, 222.2430, 241.4729 | 241.4729 ms |

这些结果说明连不到 0.5 MiB 的材料，反复遍历也有可见成本；不能据此声称已实现某个倍数提速。应在 application adaptation/identity drift、运行中包修改、审批与 scope 冲突用例之外，增加每次具名 inspect/claim/result 的文件读取和材料解析预算。

## Native：无变化等待也在重复全套观察

### N00：推进前和结果投影再次运行相同诊断

advanceNativeSdkChange 在处理普通推进前执行 inspectNativeSdkRunDiagnostics（native-sdk-next.ts:755），未产生新工作时仍由 sdkNextResult → projectNativeSdkStatus 再执行一次（native-sdk-status.ts:117）。诊断包含 owner、存储分区、执行停止事实及 worktree 分支读取，而不是只拼几个字段（native-sdk-diagnostics.ts:18–37,133–148）。

隔离样例停在 Shape 批准等待，run revision 始终为 2，无 Builder、Verifier、模型或真实批准。公开 bin/comet.js native next probe --project-root <fixture> --json 调用栈观测确认：

1. projectRootFrom → explicitProjectRootFromCurrentWorktree → inspectGitWorktree：第一次 worktree list。
2. advanceNativeSdkChange → inspectNativeSdkRunDiagnostics：第二次相同查询。
3. sdkNextResult → projectNativeSdkStatusOnce → inspectNativeSdkRunDiagnostics：第三次相同查询。

来源：native-cli-shared.ts 的 explicitProjectRootFromCurrentWorktree；platform/paths/git-worktree.ts:234–292；native-sdk-next.ts:122–145,755–760；native-sdk-status.ts:117。源模块调用栈和重建后公开 CLI 的子进程记录相互核对，不只依据静态计数。

建议让状态投影接受命令内已经取得且仍适用的诊断；没有 Run、工作区或执行环境变化时直接使用。真实执行完成、分支变更、恢复产生新事实或新 CAS 后，应重新观察相应事实，不复用旧 healthy 结论。

同一 Run 直接调用诊断，1 次预热加 5 次样本：90.4473、85.5517、83.7742、81.7386、80.0409 ms，中位 83.7742 ms。这里只说明一轮重复诊断的成本；删除重复工作尚未进入产品，也没有验证全部恢复反例。

### N01：next 的无变化分支没有查询观察复用

isNativeReadOnlyCommand 只包含 status、show、root show，native next 整条命令不进入 withGitWorktreeReadScope（native-cli-shared.ts:201–203；native-cli.ts:139–141）。不能把整个 next 粗暴改成只读：它可能启动命令、改变分支或提交结果。可精简的是同一命令中尚未跨越任何外部执行的那段观察，而不是为写命令添加长期缓存。

在刚才同一稳定等待样例，对 git worktree list 的精确参数结果做了一次仅供研究的进程内复用实验。未修改产品；实验不适用于跨外部变化的真实 next。两种方式交错，分别 1 次预热、5 次有效样本，daemon off，当前重建的 Native facade；每次都断言 revision=2 且仍需用户决定：

| 方式                                  | 五个有效原始样本（ms）                           |      中位数 |
| ------------------------------------- | ------------------------------------------------ | ----------: |
| 当前公开 CLI                          | 637.7253, 641.7037, 634.6421, 627.3218, 638.9812 | 637.7253 ms |
| 临时实验：同进程精确参数 Git 查询复用 | 525.4153, 504.5176, 506.0173, 507.7901, 510.9946 | 507.7901 ms |

这个样例减少约 130 ms、20.4%。这是方向验证，不是已经交付的优化，不代表复杂 Build/Verify/Archive 同样减少 20%。正式实现必须验证 checkout、root move、worktree 注册变化、外部进程和 Git 环境变量变化后的失效；不能降低分支归属和恢复检查。

### N02：owner、配置和父目录身份仍在层间反复发现

重建后同一等待命令的一次文件 API 观测为 757 次异步 lstat、558 次异步 realpath、35 次 open、7 次 readdir。固定入口已生效，但同一 change-owner-records/native/probe.json 正文仍读六次、分区 token 六次、配置四次、brief 四次、Spec 两次；权威 checkpoint.json 只读一次。瓶颈已不只是读 Run，还是各层重复解析归属和安全路径。

异步 lstat 与 realpath 各自调用耗时之和约 48 ms 与 88 ms；它们可能存在重叠，不能相加为可节省端到端耗时。数据来自独立单轮插桩，不能冒充多轮分位数。

来源：native-next-command.ts:287–300 的 owner/config/paths 路由，native-runtime-ownership.ts:552–565,633–640 的 owner/Runtime 装配，native-sdk-diagnostics.ts:23 再读 owner，native-command-recovery.ts:113–145 的命令后锁与项目诊断，以及 protected-project-path.ts 的读取与目录验证。

建议向下传递已经验证的 owner、路径和当前 Run；同一短观察使用 protected read session，结束时核对目录身份。每个叶子仍绑定实际字节，跨执行/提交边界重新读取需要的新证据，不做跨命令全局缓存。前一轮的单个读取器优化没有消除这些调用层之间的乘法。

### N03：每次成功也自动扫描完整恢复诊断，收益相对较小

withNativeCommandRecovery 对成功的 status/next/archive/runtime 仍检查 SDK projection、Run Store 和 Native project 锁（native-command-recovery.ts:113–145）。这与状态投影中的诊断还有职责交叉。直接测同一成功等待响应，5 次为 23.2748、24.1128、21.8691、22.3904、21.3182 ms，中位 22.3904 ms。

保留错误、未知结果、明确 Doctor/详细状态，以及实际发现恢复义务时的完整恢复诊断；普通成功响应可以复用已经观察的锁/恢复事实，或只检查当前入口真正需要的义务。已有自动恢复不能因此消失。相比 C00/A00/N00，这个候选收益较小，不应先重构整套恢复协议。

## 本轮需要纠正的既有结论

### Q00：中文和英文各有两份编辑协议，已经发生漂移

Native Skill 仍链接 comet-native/reference/edit-review.md，共享与 Classic 链接 comet/reference/edit-review.md。b0a2fc5d 最后更新了共享协议的 formalReview 段落，但没有同步 Native 副本；中文还存在一处空行差异。旧基线 2999b60d 两份内容分别相同，当前两种语言都不相同。

实际执行 pnpm exec vitest run test/domains/skill/sdk-flow-handoffs.test.ts：16 项中 8 通过、8 失败。失败均为四个场景 × 两种语言的同一副本一致性断言（测试第 80、111、142、159 行），不是八个已复现的 Runtime 行为故障。没有修改、删除或放宽这些断言，本轮也没有修复产品文件。

这是上一轮最终同步后遗漏的契约覆盖，不能继续声称相关 Skill 交接契约全部通过。后续应优先消除手工维护两份相同协议的需要：统一引用，或者由构建从单一语言源生成必要兼容路径；不能仅把重复副本再手工复制一次后认为维护问题已经解决。中文产品内容修改仍需先确认后同步英文。

### Q01：Native 性能对照必须包括公开 CLI 真正优先使用的 facade

初次观测发现 dist/app/commands/native.bundle.js 仍为 2026-11-08 04:52:44 UTC 生成的旧文件，没有 workflowCompleted 字段；源码、dist 原模块及 assets 命令 bundle 已含新字段。bin/fast-runtime-router.js:118–123 只要看到该文件存在就优先加载；build:native-runtime 与 check:generated 都不包含 facade 构建或一致性检查（package.json:92,96），完整 build 才调用 build-native-facade（build.js:63）。旧基线隔离源码没有该聚合文件。

因此前一轮部分 Native 公开 CLI 性能对照混入了不同构建入口，不能作为最终候选的严格同产物新旧对照。旧数字保留作历史记录，但不继续用作最终提速证明；Classic、锁、owner 和历史纯函数测量不因这一事实自动失效。

本轮已执行 node scripts/build/build-native-facade.mjs，重建的是本地忽略产物，没有产品源码变化。新的 facade 为 2,768,923 字节，含 workflowCompleted；重建后的等待样例不再启动学习 worker。本文 N00–N03 的公开 CLI/微测使用重建后产物。重建前 CPU profile、等待路径和 worker 观测均从当前产品收益判断中排除；没有完成全部旧基线同打包的新一轮配对，也没有验证完整安装发布产物。

这首先是性能验证入口一致性缺口，不能据此断言已发布包同样过期。后续任何性能对照都应记录 CLI 实际选中的入口及其摘要，并在两侧完整准备对应入口。

## 执行建议与本轮验证范围

建议先做 A00 的材料读取边界复用和 N00/N01/N02 的命令内观察复用，再做 C00 的 Classic 投影频率调整。前两者以减少相同职责调用次数为主；C00 必须同时迁移依赖 Portable 的恢复消费者，不能只加一个延迟写开关。C01/C02 可作为独立的小范围 CLI 往返优化。

不建议为此删除审批对象绑定、全部验收项核对、未知执行先核对、Archive 提交边界复验、worktree 归属、固定配置能力、唯一活跃 change 发现、walkthrough 或失败后有界恢复；也不建议因为每次完整历史处理有成本，就直接改成另一套事件日志或通用缓存框架。长历史权威存储分离的收益和迁移复杂度需另测，当前没有足够证据把它排在上述重复热路径之前。

本轮实际执行：源码/Skill 路径调查；Node 22.20.0 隔离公开 CLI 与函数边界观测；Native facade 本地重建；SDK handoff 定向测试（8 通过、8 失败）；研究文档 Prettier。没有运行全仓测试、真实模型 Eval、真实平台 Hook、完整安装升级或发布，没有修改产品/Skill、提交或推送本轮研究文档。临时样例没有替代任何真实 change 的审批。

Native 与应用微测脚本、原始 JSON 和插桩日志在本机临时目录 C:/Users/BENYM/AppData/Local/Temp/comet-skill-overdesign-FQMfh0/；本文保留关键原始样本和构造方式，临时实验不是产品入口。
