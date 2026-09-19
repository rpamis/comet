# 目标

消除 Classic 与 Native 工作流中已审查确认的流畅度问题：卡死级故障路径、单条命令内部的重复开销、编排层工具调用数量过多。用户在 issues #425/#432 报告的"comet 流程耗时超过实际开发时间"在 0.4.2 已修部分，本 change 处理系统审查后确认的剩余全部问题，逐条对应下文范围清单。

# 范围

修复项按类别编号，实现与验收逐条对应。

## A. 卡死级故障路径（修复后不得再出现"只能人工删锁/强杀/绕过"的场景）

- A1 Native 跨设备锁残留无恢复：hostname 不同判 `unknown` 而非 `stale`，`takeOverNativeStaleLock` 拒绝接管，doctor 对 `lock-owner-unknown` 无 repair，Skill 禁止手删（native-lock.ts:172-183、490-492；native-doctor.ts:363-369）。
- A2 Windows 进程身份探测依赖 PowerShell 冷启动（1–5s，被组策略禁用时必失败），且探测失败保守判"活着"——僵尸 owner 永远接管不了（platform/process/process-identity.ts:44-53、68-78）。
- A3 Classic 锁空文件窗口：crash 落在创建锁与写入 owner 之间留下空锁，解析失败要等 5 分钟才清理，期间每条命令各等 30s 超时（platform/fs/plugin-store.ts:74-75、97-120，DEFAULT_MALFORMED_LOCK_STALE_MS）。
- A4 Hook 读 stdin 无超时：宿主不关闭管道时 hook 进程永久阻塞（classic-hook-guard.ts:42-53；platform/process/hook-adapter.ts:260-269）。
- A5 Native"运行时数据找不到"循环（对应 issue #425 用户评论）：(a) status 发现的 blocked 条目指向其他 worktree 的坏副本而 doctor 只修当前目录；(b) overlay 版本错配即整体丢弃执行记录；(c) migration-required 时 status 给 doctor 指令、next 自动迁移的双轨；(d) liveness `unknown` 时非 doctor 一律 await-user 且探测失败判活后 doctor 也无法接管（native-status-discovery.ts:275-304、536-556；native-portable-recovery.ts:186-190、217-222；native-doctor-command.ts:453-464）。

## B. Native 单命令内部开销

- B1 检查输入指纹每次 7 连 git spawn（含全量 `diff --binary`）+ 逐文件哈希全部 untracked 与 ignored 生成目录 + 整个 process.env 入指纹；且复用判定发生在指纹计算之后，"复用"也要先付全价（native-portable-checks.ts:495-604、801、1104-1109）。
- B2 快照栅栏每趟 6–8 次 git spawn、双重全索引枚举；一次 Archive（dry-run + confirmed）付 3 趟完整快照（native-snapshot.ts:811-987、2872-3111；native-archive-inspection.ts:108；native-archive.ts:449-464；native-verification-receipt-runtime.ts:625、713）。
- B3 协调者 mutation lock 无竞争也要约 40 次文件操作（含 fsync），K 个检查的计划更新完整拿 2K+2 次锁（native-mutation-lock.ts:88-113；native-lock.ts:245-362；native-portable-checks.ts:1045-1202）。
- B4 status 全 worktree 发现：即使 `status <已知名字>` 也枚举全部 worktree、读全部 config、扫全部归档记录（native-status-discovery.ts:178-235、602-624）。
- B5 `next` 恢复路径固定 6 次 git spawn + 完整锁协议（native-next-command.ts:364-439；native-portable-recovery.ts:54、317）。
- B6 事务事件日志每次追加全量读 + 全量原子重写 + 再全量读校验，archive v2 最多 130+ 次追加即 O(N²) IO（native-transaction.ts:710-763）。
- B7 `comet native check` 不在快路径清单，独走完整 Commander 入口（bin/fast-runtime-router.js:6-17）。【Build 期间复核：该命令是 legacy-only 兼容入口（portable change 直接拒绝并引导 status/next），调用频率极低；为其新增自包含 bundle 的维护成本（manifest、构建、退役清单测试）大于收益，且 repository 测试有意锁定该 bundle 不复活。按实现选择处理：不修，保留完整 CLI 入口。】

## C. Classic 单命令内部开销

- C1 `guard --apply` 对同一份证据做两次全量校验（预检 classic-guard.ts:1186 与 apply 内 :1272 各一次 `evaluateCommandCheck`，每次含全树枚举 + PATH 环境扫描）。
- C2 `check run` 内部双快照、双环境指纹（第二次仅检测运行中变化）、双 state 读、双 policy 读（classic-command-checks.ts:344、384、351-355、406-412、337、401；classic-check-snapshot.ts:130、391-395）。
- C3 `state select` worktree 扇出：每个 worktree 3 次 git spawn，无 selection 缓存优先（classic-state-command.ts:1773-1790；classic-workspace.ts:412-436）。
- C4 readField 模式：每读一个字段完整重读重解析 `.comet.yaml`，单次 guard 约 12–15 次、`complete-design` 约 20+ 次（classic-state-command.ts:445-454 及各调用点）。
- C5 只读命令也抢写锁，且每次锁操作都做事务恢复探测（classic-store.ts:209-214、31-47）。
- C6 写命令尾部再跑一次完整 recovery context（刚读过同一状态又重读，classic-state-command.ts:1984-1995；classic-recovery.ts:26-66）。
- C7 无 check-policy `files` 声明时默认全树绑定——首次与 legacy 证据永远是最慢路径（classic-check-snapshot.ts:350、389）。【已确认纳入：默认输入绑定改为"上次成功 check 的 manifest 差分 + 新增文件"，见决策 Q2】
- C8 OpenSpec 适配器 spawnSync 无 timeout，openspec 卡死则 comet 永久挂起（classic-openspec-command.ts:103-111）。
- C9 `comet classic` 子命令组、`resume-probe`、`memory` 不在快路径，走完整 Commander 模块加载（bin/fast-runtime-router.js:4-17）。
- C10 git spawn 无 timeout 家族：init base_ref、scale diff、branch 探测、openspec（classic-state-command.ts:419-425；classic-branch-binding.ts:12-44）。
- C11 设计 guard 对 handoff 源文件重复 hash（classic-guard.ts:922、954-960）。
- C12 trajectory/checks 日志无限增长且每进程全量重解析，长 change 后期命令线性变慢（domains/engine/run-store.ts:50-75）。

## D. 编排层工具调用数量（Skill 文档 + CLI 返回值优化，中英文同步）

- D1 Classic Open 阶段每写一个产物强制刷一次 OpenSpec status（每次完整子进程，共 7–8 次；comet-open SKILL.md:193、209、241-243）。
- D2 design/verify/archive 每阶段入口无条件 `state select` + `state check`，与 auto-transition 协议矛盾（只有 build 有复用豁免；各 SKILL Step 0）。
- D3 Verify 阶段 scale → set → set 三连可合并（comet-verify SKILL.md:42-46、125-129）。【Build 期间复核：0.4.2 已把 scale 改为单命令（自行从 plan base-ref 解析、不再重复读 plan），已有 verify_mode 时跳过 set，剩余两个 set 分属不同决策时机；评估为已解决，不再改。】
- D4 归档的 `branch_status` 设置与终检 guard 未折叠进 `comet archive`（comet-archive SKILL.md:136-140）。
- D5 只读命令合批指引只在 comet-build 出现，open/design/verify/archive/hotfix 缺失。
- D6 Native `status` 与 `select` 两条必连续执行，select 已计算完整发现结果（native-select-command.ts:21-26）。
- D7 Native archive `--finish` 选择后强制第二次完整 dry-run（workspace.md:49）。
- D8 Native `--validate-only` 纯预检命令是编排层额外往返（commands.md:62）。

# 非目标

- 不改变证据安全语义：不放松环境绑定、哈希绑定、canonical 校验的强度；优化只消除重复计算，不跳过校验。
- 不重写 Classic/Native 状态机或合并两套 Guard。
- 不优化 `comet dashboard`、`memory`、`project-knowledge` 的内部实现（除非是 A/B/C 清单中点名文件）。
- 不处理 issues 中用户本机环境因素（fnm、全局包安装位置、Defender 扫描）造成的固有慢。
- website 子模块不修改。

# 验收示例

- Scenario: 跨主机残留锁恢复 —— 在设备 B 上面对设备 A 崩溃留下的 Native 变更锁（hostname 不同、owner 不可达），`comet native doctor <change> --repair` 在锁龄超过约定阈值后能够接管，后续变更命令不再每条空转 5 秒后失败。
- Scenario: Windows 进程探测降级 —— 在进程身份探测工具不可用（PowerShell 被禁用或超时）的 Windows 主机上，僵尸检查 owner 在合理时限内可被 doctor 判定并接管，不再出现"探测失败即永远判活"。
- Scenario: Classic 空锁快速自愈 —— 模拟 crash 留下的空 `.comet-state.lock`，后续命令在秒级（而非 5 分钟）内完成清理或自动恢复，不再每条命令等待 30 秒。
- Scenario: Hook stdin 超时退出 —— 宿主进程不写入也不关闭 stdin 时，hook 进程在约定超时内以非零码退出并输出可诊断错误，而不是永久阻塞。
- Scenario: 指纹复用先于全价 —— 工作树与状态版本未变时，连续两次 Runtime 检查保留判定中第二次不再重新执行全量 `diff --binary` 与 ignored 目录哈希，复用路径在计算指纹前命中。
- Scenario: guard --apply 校验去重 —— `comet guard <change> build --apply` 对同一份证据的昂贵部分只计算一次：策略文件每次评估只读一次、可执行文件路径按进程缓存；锁内的第二次校验作为防并发篡改保护保留，但其复验走 manifest 差分快照。
- Scenario: check run 去重 —— `comet check run` 执行期间环境未变化时，只计算一次环境指纹；after 快照复用 before 快照的枚举结构。
- Scenario: select 优先复用 —— `.comet/current-change.json` 有效时，`state select` 不再对每个 worktree 发起 3 次 git 调用。
- Scenario: Open 阶段产物刷新本地化 —— OpenSpec status 刷新改为本地 `state artifacts` 判定，仅在依赖报错时回退真实 status；Open 阶段外部子进程调用次数显著下降。
- Scenario: 阶段入口免重复读取 —— design/verify/archive 入口在上一阶段 guard 已返回本阶段状态时不再重复 `state select` + `state check`（与 build 的豁免对齐，Skill 中英文同步）。
- Scenario: status→select 单条化 —— 已知 change 名时 Native 入口一条命令完成发现与选择（select 返回发现结果或 status 复用 select 上下文），Skill 中英文同步更新。
- Scenario: 默认输入绑定走 manifest 差分 —— 未声明 check-policy `files` 的命令，第二次 `check run` 的输入指纹基于上次 manifest 差分与新增文件计算，不再全树枚举；与上次无关的文件改动不使证据失效，新增匹配文件仍使证据失效。
- Scenario: A5 四条循环出口 —— status blocked 指向外部 worktree 时返回指向该 worktree 的可执行修复命令；migration 双轨指令统一为单一推荐路径；liveness unknown 给出带时限的接管出口。

# 约束与不变量

- 证据失效语义保持：指纹/快照算法调整导致值变化时，按既有"checker 身份变化即失效一轮"的规则处理，不引入旧值兼容层（最终取舍见 Q3 结论）。
- 锁安全性不倒退：接管判定必须保留 owner 身份校验与防误杀活进程的保护；阈值与降级策略见 Q1 结论。
- Skill 文档中英文同步修改；行为变化同步 CHANGELOG（0.4.2 条目追加）。
- 修复后 runtime bundle 必须重新生成（build:classic-runtime / build:native-runtime）。
- 每个修复批次运行对应 domain 的最小相关测试；跨模块高风险项（A1/A2/B1/B2）补回归测试。
- 遵守仓库分层规则：Skill 副本目录（.agents/.claude/.zcode）不修改，改产品源码与 assets。

# 决策

- 修复批次顺序按"卡死级（A）→ 高收益低风险开销（B1/B2/C1/C2/B7）→ C7 默认绑定差分化 → 其余开销（B3-B6/C3-C6/C8-C12）→ 编排（D）"执行；每批独立可交付（Q4：单 change 分批顺序交付）。
- Q1 锁接管：跨设备 `unknown` 与探测失败的锁，锁龄超过 15 分钟后 `comet native doctor <change> --repair` 可显式接管；不做自动接管；保留 owner 身份校验与防误杀保护。（验收阶段用户修正：最长的合法持锁是分钟级 Archive 事务，1 小时会让崩溃后的主动修复空等，降到 15 分钟仍保持数倍误杀保护余量。）
- Q2 C7 纳入本 change：默认输入绑定从全树改为"上次成功 check 的 manifest 差分 + 新增文件"，首次证据之后不再全树枚举；失效语义变化（无关文件改动不作废证据、新增匹配文件作废）需专项测试。
- Q3 指纹与快照优化接受"失效一轮"：升级后已记录证据按既有 checker 身份变化规则失效，用户重跑一次检查；不做旧值兼容层。
- A4 超时值、B6 追加缓冲等纯技术参数由实现选择，写入代码并在测试中固定。
- C4/C5/C6 的重构以不改变外部行为为前提，单命令内做单次读传递或进程内缓存。
- Build 期间复核调整：B7（native check 快路径）与 D3（verify 三连）经代码核实后按实现选择不修，理由记录在范围清单对应条目；C1 的锁内第二次校验保留（TOCTOU 语义），收益改由环境指纹 PATH 缓存与 policy 单读实现；批次 4 中 B3（mutation lock 协议重构）、B4/B5（status/next 发现扇出）、C4（readField 全面缓存）、C5（读写锁分离）、C9（新 bundle）、C11/C12（低收益重构）因重构风险高于本批收益未实施，作为已知未修项移交后续 change。

# 待解决问题

（全部已确认，无待解决项。）

# 验证预期

- A 类：每条卡死路径有对应的故障注入测试（空锁、跨主机锁、僵尸 pid、stdin 不关闭、外部 worktree 坏副本）。
- B/C 类：性能修复通过行为测试验证（重复计算不再发生，如计数 git spawn 次数、校验函数调用次数），不依赖绝对耗时阈值。
- D 类：Skill 中英文文档一致性由契约测试覆盖；CLI 返回值扩展有单元测试。
- 全量验证在最终交付前运行一次（涉及 runtime、锁、Hook 等高风险边界）。
