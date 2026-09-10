# Comet Classic / Native CLI 运行耗时审核

日期：2026-09-10。源码与发布 bundle 基线：`1617fa06da8a9bfbf5dd424316a1ba35072a289a`，分支 `0.4.1`。

本报告只调查 Runtime 的时间成本，不修改产品源码、生成资产、用户配置或业务状态。实验使用独立临时项目与 HOME；`next` 的状态推进也只发生在实验项目中。

## 结论

当前最值得优化的不是让 Skill 改用内部 bundle，也不是先引入常驻进程，而是减少一次公开 CLI 调用内部重复启动 Git、读取与目标无关的工作区，以及重复解析同一个项目身份。

- **Native 指定名称的 `status` 会先检查所有 worktree 的所有 change，最后才筛选名称。** 同一查询、相同 1,939 字节输出，在 1 / 10 / 30 个真实 worktree 下分别耗时约 **522 ms / 2.78 s / 8.23 s**。Git 次数为 **5 / 32 / 92**，显示出 `2 + 3 × N` 的放大；其中 `N` 在本实验中既是可见活跃 change 数，也是 worktree 数。
- **Native `next` 的 Shape 准备成功路径重复执行三轮相同 Git 检查，共 9 个 Git 进程。** 总耗时约 **1.05 s**，独立插桩样本中 Git 累计约 **659 ms**。
- **上下文为空的 `comet task` 仍重复解析项目身份六次。** 配有 origin 时约 **749 ms、6 次 Git**；没有 origin 时约 **1.25 s、12 次 Git**。这不是模型生成或网络时间，输出始终只有 `{ "context": [] }`。
- **公开 fast path 已经有效。** Classic `current` 经 public bin 与 direct bundle 均约 224 ms；Native `next` 分别约 1,045 / 1,033 ms。改 Skill 直接运行内部 `.mjs` 无法解决上述秒级成本，还会扩大安装路径耦合。
- 入口 Skill 实际使用 `comet workflow resolve . --activate --json`，它不走当前 fast router；已激活的实验项目中，这条命令约 **237 ms**，纯 resolve 约 **110 ms**。这是次一级优化点。

这些测量能确认具体性能缺陷，但**不能证明用户所说的“1/3 时间用于自我纠正”这一占比**。该比例需要真实 Agent 轨迹中的错误命令、重试、模型思考、工具调度与 Runtime 时间分段统计。

## 测量方法与边界

环境：Windows `10.0.26200` / x64，Node `v22.20.0`，Intel i5-10600KF @ 4.10 GHz，12 个逻辑 CPU，约 31.9 GiB 内存。

主实验期间协调其他审核 Agent 暂停进程型复现，所有样本串行执行；无法排除操作系统和用户其他应用的后台负载。origin 补充实验在该窗口结束后执行，因此单独标记为非独占样本。

- 每个样本通过 `spawnSync(process.execPath, argv)` 启动新的 Node 进程，测量从启动到退出的 wall time，包含 Node、模块加载、文件操作和 Git 子进程时间；不包含外层 PowerShell 启动和 Agent 工具往返。
- 每个目标先预热一次文件系统缓存。基线 `n=7`，规模实验 `n=3`，origin 补充实验 `n=5`；median 取排序中位数，p95 用 nearest-rank。样本很少，表中 p95 恰为最大值，**不是稳定尾延迟或 SLA**。
- 这是 **process cold、filesystem warm** 实验；没有清空操作系统磁盘缓存，也没有测量机器冷启动。
- 隔离 `HOME`、`USERPROFILE`、`XDG_CONFIG_HOME`、Git global/system config，设置 `COMET_SKIP_UPDATE_CHECK=1`。基础 fixture 无 origin；origin 补测仅添加 `https://example.test/comet-latency.git` 配置，命令未访问该地址。
  后续实施核对发现 Windows 知识缓存还会读取 `LOCALAPPDATA`，因此旧实验不能声明所有用户缓存均已隔离；新版对照脚本同时隔离 `APPDATA`、`LOCALAPPDATA`、`XDG_CACHE_HOME` 和 `XDG_DATA_HOME`，旧结果仅保留为问题定位证据。
- 表中全部计时样本和插桩调用均检查 `status === 0`，未把缺配置、缺 change、命令用错或超时当成正常工作流性能。搭建 fixture 时遇到的预期错误不计入结果。
- Native `next` 测量从有效 Shape state version 1、完整 brief 开始，执行带 `--summary`、`--expected-state-version 1`、`--expected-action prepare-shape-confirmation` 的成功推进；每次测量前在计时区间外恢复相同状态文件。
- Classic fixture 使用有效 Classic 配置与 OpenSpec 目录，执行 `state init ... tweak` 后显式 `state select`。`state current`、`get`、`next` 都来自已建立的 change。
- 规模实验通过 Git 创建真实 linked worktree，在每个新工作区执行一次公开 `comet native new`。未伪造多个 change 状态，也没有绕开当前“已有活跃 change 时新 change 必须隔离”的限制。
- Git 分解使用独立临时 `--require` loader 包装 `node:child_process` 的 `execFileSync` / `spawnSync`，并同步 ESM exports。Git 次数与累计时间来自额外一次插桩调用，不属于表中未插桩的 median，不能直接相减当精确时间剖面。
- 测量对象是当前仓库 `bin/comet.js`、已提交的命令 bundle，以及 fallback 路径实际加载的本地 `dist/`；没有发布、安装或运行新的 npm 包。

临时原始证据位于 `C:/Users/BENYM/AppData/Local/Temp/comet-latency-audit-0vyiI1/`：`config.json`、`measure.cjs`、`scale.cjs`、`profile.cjs`、`baseline-results.json`、`scale-results.json`、`task-origin-results.json`、`task-stack.txt`。它们不是仓库发布资产，也不含用户密钥。复测应创建新的临时根和新的 fixture，不能在已推进的状态上盲目重跑初始化步骤。

## 基线结果

`public` 指通过 `node bin/comet.js ...` 调用；`direct` 仅用于测量对应自包含 bundle，不是推荐给 Skill 的调用方式。除特别标记外，均为一个工作区、一个活跃 change。

| 命令 / 场景                        | median ms | p95 ms | stdout 字节 | 插桩 Git 次数 | 插桩 Git 累计 ms |
| ---------------------------------- | --------: | -----: | ----------: | ------------: | ---------------: |
| Node 空进程                        |      58.1 |   61.3 |           0 |             0 |              0.0 |
| public --version                   |      95.7 |  116.2 |           6 |             0 |              0.0 |
| public --help                      |      99.3 |  106.4 |        2616 |             0 |              0.0 |
| direct workflow resolve            |     113.9 |  127.0 |         128 |             0 |              0.0 |
| public workflow resolve            |     109.9 |  121.1 |         128 |             0 |              0.0 |
| public workflow resolve --activate |     237.5 |  248.9 |         128 |             0 |              0.0 |
| public task，空 context，无 origin |    1246.3 | 1320.5 |          20 |            12 |            867.6 |
| direct state current               |     224.6 |  235.5 |          62 |             1 |             81.2 |
| public state current               |     224.0 |  237.4 |          62 |             1 |             75.5 |
| `public state get <change> phase`  |     143.0 |  150.5 |          51 |             0 |              0.0 |
| `public state next <change>`       |     144.0 |  147.2 |        1121 |             0 |              0.0 |
| `direct native status <name>`      |     547.8 |  576.4 |        1939 |             5 |            400.6 |
| `public native status <name>`      |     521.6 |  547.9 |        1939 |             5 |            373.4 |
| `public native show <name>`        |     131.0 |  137.1 |        2400 |             0 |              0.0 |
| direct native next，准备 Shape     |    1033.0 | 1059.8 |        2922 |             9 |            659.3 |
| public native next，准备 Shape     |    1045.1 | 1079.9 |        2922 |             9 |            659.0 |

## 为什么会慢，以及如何改

### 1. Native status 把单项查询做成全量发现

当前调用链：

1. `native-status-discovery.ts:543` 的 `inspectDiscoveredNativeStatus` 调用 `discoverSources`。
2. `discoverSources` 在所有 Git worktree 读取配置、发现 changes、读取 archive records。
3. `discoverCandidates` 为所有候选执行 `inspectNativePortableStatus`；后者读取 Runtime、children、supervisor overlay、supervisor state，并调用 `workspaceProjection`。
4. `workspaceProjection` 再调用 `inspectGitWorktree`，每项启动 `rev-parse --show-toplevel`、`worktree list --porcelain -z`、`symbolic-ref --quiet --short HEAD` 三个 Git 进程。
5. 完成上述操作后才 `.filter(candidate => candidate.name === options.name)`。

此外，列表分页也是在 `discoverCandidates` 之后才 `.slice`，因此小页面并不意味着只检查这一页的候选。相关源码：`domains/comet-native/native-status-discovery.ts:169,223,536,576`，`native-portable-status.ts:187,335`，`platform/paths/git-worktree.ts:15,32,69`。

| 真实工作区 / change 数 | 查询               |   n | median ms | p95 ms | Git 次数 | Git 累计 ms | 输出字节 |
| ---------------------: | ------------------ | --: | --------: | -----: | -------: | ----------: | -------: |
|                      1 | status latency-one |   7 |     521.6 |  547.9 |        5 |       373.4 |     1939 |
|                     10 | status latency-one |   3 |    2783.1 | 2869.3 |       32 |      2570.3 |     1939 |
|                     30 | status latency-one |   3 |    8225.1 | 8260.8 |       92 |      7706.1 |     1939 |

`show latency-one` 只读取指定 change，在三种规模下约 129–133 ms，输出为 2,400 字节；它不是 `status` 的可互换替代，因为其 workspace/discovery 语义不同，但可用来排除“项目多了，所有 Runtime 都不可避免变慢”的解释。

建议：

- 给指定名称的 discovery 传入名称过滤条件，在跨工作区查找同名 active/archive 记录时即限定目标，不投影其他 change。保留同名冲突、active/archive 稳定身份、提交一致性及 Git 祖先关系校验。
- 一次请求中解析一次 Git worktree 列表，保留其中已有的 root、branch、detached 信息；状态投影复用该请求内的上下文，避免为每个候选重新启动完整三条 Git 命令。
- 列表接口分离轻量候选发现与当前页的详细投影；不能为提速跳过会改变候选选择结果的冲突判断。
- 用 1 / 10 / 30 worktree 场景建立预算，同时断言 Git 调用数。首要标准是“查询一个名称时，Git 进程数不随其他无关 change 增长”，而不是在 CI 上强压固定毫秒数。

收益边界：30 个工作区的测量中，单次插桩 Git 累计 7.71 s，说明减少重复进程有数秒级优化空间；这不是已经实现的提速承诺。最终仍需读取相关工作区与同名 archive 的真实记录，不能把复杂恢复路径承诺为固定 100 ms。

### 2. Native next 重复读取同一个 Git 工作区

Shape 准备的插桩序列为以下三条命令重复三次，总计 9 次 Git、约 659 ms：

```text
git -C <project> rev-parse --show-toplevel
git -C <project> worktree list --porcelain -z
git -C <project> symbolic-ref --quiet --short HEAD
```

源码上可见：`nativeNextCommand` 先进行 `nativePortableWorkspaceMismatch`，恢复路径再次检查 workspace，推进后写 local execution 时 `currentBranch()` 又调用完整 `inspectGitWorktree`。相关位置为 `native-next-command.ts:199,326`，`native-portable-recovery.ts:52,125`，`native-portable-runtime.ts:192,522`。

建议把需要的 Git 事实与使用边界显式传递：只需 branch 的位置不要重新查完整 worktree 列表；在同一个没有 Git mutation 的读阶段复用 worktree context。实际状态写入前、锁内关键条件和执行了 branch/worktree 变更之后继续重新验证，不能简单用跨命令 TTL 缓存覆盖这些校验。

收益边界：减少两组重复检查，理论上可减少本机约 0.44 s 的 Git 启动时间；是否能减少到这一程度取决于哪些边界必须重新检查，仍需状态迁移、并发与工作区变更回归验证。

### 3. comet task 重复计算项目身份

返回空 context 的一次调用已通过 stack 插桩确认有六轮身份/名称解析：

1. `comet-entry/plugin-context.ts` 的 `createBridge` 解析项目 ID。
2. `comet-plugin/integration.ts` 的 `createDefaultCometPluginBridge` 解析项目名称。
3. `project-knowledge/readiness.ts` 准备知识时解析项目 ID。
4. `project-knowledge/local-store.ts` 构造存储位置，再次解析项目 ID。
5. `project-knowledge/deterministic-extractors.ts` 提取记录时再次解析项目 ID。
6. `project-knowledge/host-review.ts` 构造待审核记录存储位置，再次解析项目 ID。

`platform/paths/project-identity.ts:15,51` 对 ID 与名称分别使用 `git remote get-url origin`，无 origin 时再使用 `git rev-parse --git-common-dir`。结果是同一事实被重复查询六次。

| fixture                 |   n | median ms | p95 ms | Git 次数 | Git 累计 ms |
| ----------------------- | --: | --------: | -----: | -------: | ----------: |
| 无 origin，主串行窗口   |   7 |    1246.3 | 1320.5 |       12 |       867.6 |
| 配置 origin，非独占补测 |   5 |     749.1 |  759.7 |        6 |       439.1 |

建议在单次 task/bridge 请求中建立一个包含规范化根目录、稳定 ID、可读名称和存储定位所需信息的解析结果，由 readiness、provider、extractor 和 host review 复用。保持 remote/common-dir/path 的现有身份语义；不同 CLI 调用重新解析。然后再分解没有必要的读取、维护与 context selection 是否需要在同一前台路径重复完成。

配置 origin 的实验中，六次相同命令若收敛为一次，单 Git 进程启动节省上限约 0.37 s；无 origin 时十个重复进程约 0.72 s。这里未计入真实知识库、索引维护、远端 provider、外部模型等成本，不能把空库数据当成所有 task 的最终预算。

### 4. 启动开销应在公开 CLI 内优化

`bin/fast-runtime-router.js` 已在同一 Node 进程中加载 package-owned 独立 bundle；Classic state/check/guard/handoff/archive、Native 常用命令和纯 `workflow resolve --json` 已在该路径。`app/cli/index.ts` 也已按命令懒加载，不能再用“CLI 总是加载所有子命令”解释当前成本。

Classic / Native / Entry 构建脚本均已启用 `bundle`、`treeShaking`、`minify`。当前文件大小分别包括 Native status 545,562 字节、Native next 551,673 字节、Classic state 349,489 字节、Entry resolve 136,055 字节。Native aggregate runtime 为 972,995 字节，但常用 fast path 不加载它。

`assets/skills-zh/comet/SKILL.md:15` 使用的 `--activate` 不在 entry fast router 的参数白名单中；entry runtime 本身也只支持 path / `--json`。优化应让 public entry bundle 正式支持与 facade 等价的 activation 契约，完成错误、幂等、部分初始化、context flags 的行为对照。不能只放宽 router，把未支持的参数交给 bundle。

`--help` / `--version` 约 96–99 ms，Node 空进程约 58 ms。对这些已是百毫秒量级的路径，先引入 daemon、换运行时或教 Agent 找内部安装路径，收益与复杂度不匹配；应先消除测量已证明的重复操作。

## 验收与后续观测

审核基线中的 `scripts/benchmark/runtime-coldstart-benchmark.mjs` 适合追踪进程启动趋势，但不能单独证明正常流程性能：`measureOne` 没有检查退出码与 error，没有指定 fixture cwd / HOME，Native status 可能只是缺配置或空项目路径，Hook 也没有构造真实写入 payload。其本地既有 baseline 的数字不是本次正常工作流实测数据；该 JSON 被 `.gitignore` 忽略，并非已提交的发布资产。

应补充独立、合法、可恢复的 scenario benchmark，输出场景、HEAD、Node/OS、是否 origin、worktree/change 数、退出码、stdout 字节、median、小样本 p95、Git 次数。计时之外分别断言实际状态和 continuation；不得让无效命令因“报错更快”通过性能检查。

真实 Agent Eval 另行记录以下分段，才能验证自我纠正是否下降：首次命令是否有效、每阶段错误/重试次数、每次 runtime wall time、工具排队和返回时间、LLM 思考/输出时间、宿主测试/编译时间、外部 verifier 时间、是否因 context 压缩恢复而重新查询。测试与模型验收运行时间不应被归因给 CLI 冷启动。

本次完成：源码调用链与生成入口阅读；独立真实 Git fixture；16 个成功目标的串行基线；1 / 10 / 30 worktree 扩展；Git 次数/耗时与 task 调用栈插桩；origin 配置补测。没有测量真实平台 Hook、真实模型 Eval、Build/Verify/Archive 全生命周期、远端网络或新 npm 安装包，也未执行全量测试；这些不属于本次耗时定位的已验证结论。
