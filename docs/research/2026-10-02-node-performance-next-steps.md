# Comet 下一步 Node 性能优化建议

调研及实施日期：2026-10-02。范围为 `hotfix044` / Comet 0.4.4，比较基线为提交 `92fc4b6012fdaa42346888269b305aeebaa0d220`。本文保留优化前的实验，并记录本轮 Runtime 修正和打包测量。官方能力核对采用固定的 Node 22.18.0 与 24.18.0 文档，本机使用 22.20.0，不能把整个 22/24 大版本视为相同能力。版本保持 0.4.4，未纳入 045 SDK 改造。

## 建议顺序

先把一次调用拆成 Node 启动、模块加载、客户端连接、服务端排队、领域执行、Git/文件操作和输出，再选择优化对象。CPU profile 定位 JavaScript 热点；父进程的端到端计时和各阶段耗时补充启动、排队与外部程序等待。这个测量顺序是针对 Comet 的建议，不是官方给出的性能结论。[Node CPU profiling](https://nodejs.org/download/release/v22.18.0/docs/api/cli.html#--cpu-prof)、[Node performance APIs](https://nodejs.org/download/release/v22.18.0/docs/api/perf_hooks.html)

| 优先级 | 候选方向                             | 能减少的成本                        | 采用条件                                                             |
| ------ | ------------------------------------ | ----------------------------------- | -------------------------------------------------------------------- |
| 1      | 显式传递 Native 调用者目录           | 查询守护进程包目录的 Git 上下文     | 使用每请求上下文，不修改服务端全局 cwd；保留原 worktree 归属语义     |
| 1      | 请求内复用 Git 工作区观察            | 根目录解析与状态发现的重复 Git 调用 | 统一采集 root、branch、worktrees；发生写入后失效，关键动作仍须复验   |
| 2      | 精简客户端入口，按命令延迟加载重模块 | 未使用模块的编译、求值和初始化      | 本地调用链及 profile 确认入口加载了无关能力                          |
| 2      | 请求内复用解析与文件摘要             | 同一次操作的重复文件工作            | 大项目样本确认成本显著；不直接跨请求信任旧结果                       |
| 2      | 复核已有 module compile cache        | 相同模块的重复编译                  | 入口已启用，继续区分冷调用、缓存填充与热调用；覆盖率任务禁用         |
| 2      | 增加可复用的进程内请求入口           | 每条短命令重复启动客户端与加载模块  | 宿主确实保持连接，并直接调用同一领域实现；不再逐请求 spawn Comet CLI |
| 3      | 常驻 Worker 池                       | 经测量的 CPU 密集 JavaScript 热点   | CPU 占比高，任务足够大，序列化和调度成本可接受                       |
| 4      | Startup snapshot / SEA 原型          | 可预先初始化的固定代码和数据        | 前面优化仍被初始化成本限制，且能承担按版本、平台构建及安装维护       |

这里的优先级由下文的 Native status 定向样本支持，完整 Classic / Native 流程仍需分别测量。MCP 或 socket 是接入方式；是否消除客户端启动，取决于请求是否复用已有进程。Node CLI 每次仍启动进程时，服务端常驻不能单独消除这部分成本；本次不扩大为新的连接协议或 SDK 项目。

## Node 官方能力与限制

### Module compile cache

- `NODE_COMPILE_CACHE=dir` 从 Node 22.1.0 提供；`module.enableCompileCache()` 从 22.8.0 提供，支持 CommonJS 与 ESM。它复用 V8 编译缓存；第一次加载可能增加成本，源码不变时后续加载才可能受益。[Node 22 module compile cache](https://nodejs.org/download/release/v22.18.0/docs/api/module.html#module-compile-cache)
- API 只影响启用后的模块加载。若入口先静态导入整套 CLI，再调用 API，不能指望它缓存已经加载的依赖；实验应在进程启动前设置环境变量，或在小入口启用后再加载产品入口。[Node 22.8.0 release](https://nodejs.org/en/blog/release/v22.8.0)
- 缓存不保存业务状态，也不省掉模块求值、Git、业务文件读取或 Node 进程启动。这是根据缓存对象为编译结果作出的推断。不同 Node 版本不能共用编译结果；V8 coverage 可能不够精确，覆盖率检查使用 `NODE_DISABLE_COMPILE_CACHE=1`。[Node 22 module cache limitations](https://nodejs.org/download/release/v22.18.0/docs/api/module.html#module-compile-cache)
- Node 24.12.0 新增 `portable`，在符合相对目录布局的情况下尽力支持移动目录；24.15.0 的相关 API 不再处于实验状态。不能将 `portable` 配置直接作为 Node 22 的能力。正常缓存默认在退出时写盘，长期运行的父进程可用 `flushCompileCache()` 提前供子进程复用。[Node 24 enableCompileCache](https://nodejs.org/download/release/v24.18.0/docs/api/module.html#moduleenablecompilecacheoptions)

### Profiling 与 perf_hooks

`--cpu-prof` 自 Node 22.4.0 稳定，启动时开启 V8 CPU profiler，退出前写出 profile。`performance.mark()` / `measure()` 可记录应用阶段，`performance.nodeTiming` 可观察 Node 启动里程碑；常驻进程还可用事件循环延迟与利用率识别阻塞。CPU profile 与端到端耗时必须分开报告：CPU 热点不能单独解释 Git 等待或启动外部进程的全部时间。[Node CPU profiler](https://nodejs.org/download/release/v22.18.0/docs/api/cli.html#--cpu-prof)、[Node perf_hooks](https://nodejs.org/download/release/v22.18.0/docs/api/perf_hooks.html)

### Worker threads

Node 22/24 的 Worker 用于并行执行 CPU 密集 JavaScript；官方明确指出，对 I/O 密集任务帮助有限，内置异步 I/O 更合适。逐任务创建 Worker 的成本可能超过收益，应该评估常驻池。Worker 不会替宿主复用另一个命令启动的 Node 客户端；在每次 CLI 进程里新增 Worker，也不能消除该进程本身的启动。[Node 22 Worker guidance](https://nodejs.org/download/release/v22.18.0/docs/api/worker_threads.html#worker-threads)、[Node 24 Worker guidance](https://nodejs.org/download/release/v24.18.0/docs/api/worker_threads.html#worker-threads)

### Startup snapshot

`--build-snapshot` 从 Node 18.8.0 提供；Node 22 文档标为实验功能，Node 24.13.1 的构建过程不再处于实验状态。仍需要单个入口，额外用户模块应先 bundle，只有部分内置模块适合构建时序列化；不适合序列化的模块延迟到恢复后加载。[Node 22 snapshot](https://nodejs.org/download/release/v22.18.0/docs/api/cli.html#--build-snapshot)、[Node 24 snapshot](https://nodejs.org/download/release/v24.18.0/docs/api/cli.html#--build-snapshot)

快照要求生成与运行的 Node 版本、架构、平台一致，V8 参数与 CPU 特性兼容。它恢复预先初始化的状态，每次运行仍然启动 Node。针对 Comet，工作区、授权、锁、Git 状态及当前文件应在运行时重新读取；这部分是对应用边界的建议，不能预装进固定快照。[Node snapshot compatibility](https://nodejs.org/download/release/v22.18.0/docs/api/cli.html#--snapshot-blobpath)

### Single executable application（SEA）

Node 22/24 的 SEA 把单个 CommonJS bundle 注入 Node 可执行文件；它解决分发和无预装 Node 的运行，不等于转换成原生业务代码。`useSnapshot` 与 `useCodeCache` 可复用构建结果，但仍启动内置 Node Runtime；`useCodeCache` 开启时 `import()` 不可用。跨平台生成时这两个选项应关闭，避免不兼容结果。[Node 22 SEA](https://nodejs.org/download/release/v22.18.0/docs/api/single-executable-applications.html)、[Node 24 SEA](https://nodejs.org/download/release/v24.18.0/docs/api/single-executable-applications.html)

因此，应把 SEA 放在独立原型里验证 bundle、动态加载、平台构建及签名流程，再决定是否采用；不能以生成了 `.exe` 就宣称已消除 Node 启动成本。

## 本地测量

### 公开 CLI 基线

环境：Windows `10.0.26200` x64、Node `v22.20.0`、Comet 0.4.4。使用已构建的 hotfix044 工作区和新建临时 Git 项目，项目仅有一个 Shape change。7 次正式采样、1 次 warmup、daemon idle timeout 5000 ms；fixture 准备、状态查询辅助采集和收尾不计入单次命令时间。测量命令为仓库现有 `scripts/benchmark/runtime-daemon-benchmark.mjs`，仅通过进程环境设置样本及临时项目目录。

| 场景                          | 中位数 ms | 样本 P95 ms |
| ----------------------------- | --------: | ----------: |
| 关闭 daemon，新 Node 客户端   |    673.67 |      852.01 |
| 热 daemon，仍启动 Node 客户端 |    723.40 |      930.21 |
| daemon 内部请求处理           |    618.00 |      821.00 |

首次调用为 3615.75 ms，空闲重启为 3268.18 ms，均只有一个样本。热路径复用同一个 daemon PID。小样本先测热 daemon、再测关闭 daemon，结果包含当时机器负载与采样顺序影响，不能据此宣称产品回退或外推整个流程；本轮没有观察到提速。

原始 JSON 位于系统临时目录的 `comet-node-perf-044-20261002.json`，包含源提交、工作区差异摘要和生成构建摘要。源码测量前为干净状态；研究文档是在测量后新增的。

### Git 计数与服务端处理路径

基线的 `gitCommands: 0` 不是完整计数。现有计数由 [共享 Git 执行器](../../platform/process/git.ts) 记录；[工作区检查](../../platform/paths/git-worktree.ts) 直接调用 `execFileSync`，未进入该计数器。`filesystemReads` 也来自进程资源计数，与下面仅覆盖指定异步文件函数的次数不同。

用临时 preload 拦截 `execFileSync` / `spawnSync` 的 Git 调用及异步 `readFile/stat/lstat/readdir/access/realpath`，直接回放 daemon 使用的 `runNativeCliDetailed(['status', '--project-root', root, '--json'])`。模块在同一 Node 进程中加载一次，每组预热 2 次，再采样 5 次；不计客户端启动、IPC 或模块初次加载。

两组只改变进程调用目录，固定同一个临时项目与 argv；没有修改任何产品源码：

| 调用目录                                  | 处理中位 ms | Git 次数 / 请求 | Git 累计中位 ms | 异步文件操作 / 请求 |
| ----------------------------------------- | ----------: | --------------: | --------------: | ------------------: |
| hotfix044 包目录，位于 secondary worktree |      734.07 |               8 |          715.55 |                  74 |
| 请求项目根目录                            |      459.41 |               5 |          443.19 |                  74 |

两组全部样本的返回 data SHA-256 一致：`4a5c5ca6b4aa0f0a18072fc40ff266283917f41810de31f23fc346eccaa672b6`。第一组约 97% 的处理时间落在串行 Git 调用跨度内，普通 JS 与异步文件工作的剩余跨度较小。异步文件时长只能累计，不能和总耗时相加，因为操作可能重叠。

额外三次 Git 来自 `rev-parse --show-toplevel`、`worktree list --porcelain -z`、`symbolic-ref --quiet --short HEAD`。代码路径为：

1. 基线的 [daemon Native handler](../../app/commands/daemon-server.ts) 将请求项目加入 argv，但没有像 Classic 一样传递 `request.cwd`。
2. 基线的 [Native 根目录解析](../../domains/comet-native/native-cli-shared.ts) 读取 `process.cwd()`；在包目录为 secondary worktree 的此实验中，先查询包目录，再查询请求项目。
3. 基线的 [status 发现](../../domains/comet-native/native-status-discovery.ts) 再次调用工作区列表查询。

这说明应先消除与调用者无关的工作区检查，并复用一次请求的 Git 观察。它不证明简单切换 cwd 就是可发布修复：服务端并发请求不能修改全局 cwd，worktree 绑定和原有显式项目覆盖规则也必须保留。正常安装包目录未必位于 Git worktree，其额外调用次数和收益需另测。

两个定向报告位于系统临时目录的 `comet-node-perf-profile-package-cwd-044.json` 和 `comet-node-perf-profile-project-cwd-044.json`；插桩与驱动为临时 `comet-node-perf-probe.cjs` / `.mjs`。

### 本轮实施

Native 入口显式接收 `invocationCwd`，守护进程传入 `request.cwd`；相对 `--project-root` 同样按调用者目录解析。linked worktree 的原归属规则保持有效，没有修改全局 cwd。

只在 Status、Show、Root Show 查询中建立 Git 观察作用域。根目录、分支和工作树列表来自同一份请求内观察，作用域通过 AsyncLocalStorage 隔离并发请求，每次调用重新建立。`root move`、检查执行、提交和归档等修改动作继续实时检查，不使用这份只读观察。

Runtime 自行发起的同步、异步和流式 Git 调用计入诊断，包括 Native Snapshot / Receipt、Classic / Entry Resume Probe 和交付 Git。守护进程按请求统计 Git 次数及累计子进程耗时；并发请求不再通过进程总计数之差归属工作量。benchmark 增加 Git 耗时和客户端余量。Git 累计耗时在异步进程重叠时可能超过请求墙钟耗时；客户端余量包含路由、IPC、启动和输出成本，不能全部称为 Node 启动。原有文件系统计数是进程资源指标，不是文件 API 调用次数。

生成 Native、Classic 和 Entry bundle 已同步。回归覆盖调用者目录、相对根路径、主工作区与 linked worktree、并发隔离、下一次请求的分支切换及 detached HEAD、失败 Git 计量，以及 CLI 根解析后切换分支仍会阻止 Root Move 事务。

线上 Windows 并发工作树 smoke 暴露了锁协调超时，随后补充了确定性回归：如果进程探测期间前序 claim 已释放，旧逻辑仍用探测前快照作阻塞依据。现在探测后复读并核对 claim 的 owner 和文件版本；已释放的 claim 不再阻塞，存活或替换的 claim 保持受保护。原超时、夺锁权限与隔离删除校验没有放宽。修改前该回归报 busy，修改后释放、存活与替换三种情况均通过，真实并行工作树回归也通过。

### 最终打包比较

将基线提交与性能提交 `1591a1f2` 分别构建、打包并解包到独立目录，执行各自的 `bin/comet.js`。二者复用相同版本的依赖目录，以排除依赖版本差异；实际 npm 安装与平台路由另由 package E2E 验证。使用同一个临时 Git 项目，每组预热 2 次、正式采样 15 次，交替改变基线与候选的顺序。两份包都为 0.4.4，使用不同诊断环境标识隔离 daemon endpoint，避免固定的 tar 文件时间戳造成构建 ID 相同而误用另一个包的 daemon。统计不含安装和启动准备。

| 场景                   | 基线中位 ms | 候选中位 ms | 基线 P95 ms | 候选 P95 ms |
| ---------------------- | ----------: | ----------: | ----------: | ----------: |
| 热 daemon 的公开 CLI   |      457.34 |      376.36 |      783.16 |      775.58 |
| 关闭 daemon 的公开 CLI |      926.29 |      510.37 |     1264.49 |     1042.02 |

本轮中位耗时分别下降约 18% 和 45%；热 daemon 内部请求中位为 313 → 216 ms。每份包热路径均复用一个 PID，60 次正式查询的 data SHA-256 全部为 `4a5c5ca6b4aa0f0a18072fc40ff266283917f41810de31f23fc346eccaa672b6`。临时插桩确认直接 CLI 的 Git 进程数为 5 → 2，模拟包目录 daemon 上下文为 3 → 2；候选 daemon 自身统计也稳定为每请求 2 次。基线的诊断计数为 0 是已说明的漏计，不能当作实际工作量。

这是小型 Status fixture 的本机结果，尾部耗时仍受系统负载影响，热路径 P95 改善很小。先前一轮同样的交替采样中位为 399 → 334 ms、731 → 419 ms，说明绝对时长有明显波动；不把上述百分比作为所有仓库的加速承诺。未对冷 daemon 启动或完整工作流作提速结论。

原始结果及包 SHA-256 位于系统临时目录 `comet-perf-044-delivery-20261002/package-results.json`。先前一次仓库 benchmark 在收尾时未找到 daemon，打包比较准备阶段也遇到 daemon 启动失败；这些未完成的尝试没有计入上述采样或作为启动验收。最终交替比较完整结束，两份 daemon 均已停止。

## 检查与 Classic 入口优化（基线 94b48c7e）

本轮只实施已确认的三项工作，仍为 hotfix044 / 0.4.4：

1. Native 在一次检查预留中只采集一份基础 Git、Runner 输入和脏文件观察，分别计算检查输入与候选输入的摘要。计划依赖的 ignored 输入仍单独处理；不完整快照继续禁止复用。观察不跨请求保存，修改源文件后再次调用会返回 Build，要求新候选。
2. Classic 在本次快照内合并重叠文件声明，普通文件读取最多四并发；摘要和 manifest 按原遍历顺序写入，读取失败前等待当前批次全部结束。legacy 保留单并发及原有重复绑定，路径保护、符号链接拒绝和策略变化检查保持有效。
3. 公共 Classic State、Check、Guard、Handoff、Archive 继续通过原有 facade，加载各自的独立 bundle。上下文注入与结果记录保留，命令尾部、JSON、项目上下文及退出码与原入口核对一致。独立脚本在普通目录、目录链接和 `--preserve-symlinks-main` 下仍能启动，导入 bundle 不会先执行一条命令。

现有 cold-start benchmark 的 Native fixture 补齐当前 Runtime 已要求的 A1 实现及证据自查，没有放宽验收条件。测量使用同一份 harness 和基线创建的真实 Git 项目；候选直接读取旧检查记录，额外验证了旧中断记录可以只重试中断项。包分别由固定基线与本轮工作区构建，依赖版本相同；关闭 daemon，每个场景预热三次、正式采样十五次，交替改变基线和候选顺序。Git/文件次数来自另一次成功的插桩调用，不和正式采样时间混算。

| 场景                                        | 基线中位 ms | 候选中位 ms | Git 次数 | 指定异步文件 API 次数 |
| ------------------------------------------- | ----------: | ----------: | -------- | --------------------- |
| Classic current，公开 CLI                   |      765.16 |      761.99 | 1 → 1    | 85 → 85               |
| Classic next，公开 CLI                      |      685.88 |      685.89 | 0 → 0    | 161 → 161             |
| Classic 首次检查，公开 CLI                  |     1917.22 |     1854.48 | 8 → 8    | 900 → 900             |
| Classic 检查复用，公开 CLI                  |     1161.88 |     1157.47 | 4 → 4    | 372 → 372             |
| Native 首次检查，独立 Node 调用 Runtime API |     3727.16 |     3242.61 | 20 → 15  | 588 → 577             |
| Native 检查复用，独立 Node 调用 Runtime API |     1976.11 |     1556.01 | 12 → 7   | 126 → 115             |

Native 两种检查的中位分别下降约 13.0% 和 21.3%。小型 Classic 项目没有观察到稳定的端到端收益，单次略快不能作为提速承诺。空 Node 对照中位为 83.86 → 83.41 ms，版本查询为 120.57 → 122.71 ms。原始样本保留了观察到的尾部耗时，部分 Classic 场景的尾部更慢，说明系统负载仍会影响结果；不据此宣传尾延迟已改善。

Classic 入口从 698,809 字节的聚合 bundle 换为 State 的 412,162 字节或 Check 的 251,876 字节命令 bundle。这是被选中 Runtime 文件的体积，不是整个进程加载量，当前小项目测量也没有证明相同幅度的启动提速。

额外构造 200 个各 4 KiB 的源文件，策略同时列出全部文件、`src/*.txt` 和配置文件。使用公开 Classic Check CLI、相同的三次预热和十五次交替采样，检查复用中位为 1668.35 → 1141.76 ms，下降约 31.6%；Git 均为一次，指定异步文件 API 为 3394 → 3192 次。候选能直接复用基线留下的重叠声明证据，修改一个源文件后必须实际重跑检查。这是人工压力样本，不是用户业务仓库；不会将它推广为所有 Classic 项目的提升幅度。

原始 JSON、包 SHA-256、构建 SHA-256、正式样本与独立插桩结果保留在系统临时目录 `comet-perf-044-three-83bb6f35075e475299f3169b0b121bc8` 的 `paired-results.json` 和 `classic-overlap-results.json`。八个基础场景、240 次正式调用及额外多文件样本均完成输出检查；本轮表中的 Native 检查是新 Node 进程直接调用 Runtime API，阶段推进的性能尚未测量。测量包由未提交候选构建，其构建摘要绑定实际文件，不把基线 HEAD 标识当作候选已经提交的证明。交付前重新读取构建，摘要与测量包一致：`20d47ad55bee008e00dd0e898224b6f89648a56a0247a5cb6b1ae81d73b57e53`。

### 上一轮提出的继续优化方向

| 顺序 | 工作                                    | 当前证据与收益条件                                                                                                                   | 成本及边界                                                                                      |
| ---- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1    | 合并 Native 剩余的重复 Git 观察         | 复用场景仍有两次 status，以及 symbolic-ref / branch 两种分支读取；插桩中每次约 90–100 ms。先验证能否共享解析结果，再决定删掉哪些调用 | 中等；必须保持 rename、untracked、Runner 排除、子模块和旧摘要兼容，不能直接删掉安全检查         |
| 2    | 单独测 Windows 进程身份探测             | 已有自身身份与外部 PID 的进程内缓存；新 CLI 的首次探测仍可能启动 WMIC 或 PowerShell。先补全外部进程计时，确认真实占比                | 测量成本低，替换实现成本较高；PID 复用、权限不足和 unknown 判定继续保守，不能把失败当作进程退出 |
| 3    | Native next/show 与 Hook 请求内文件复用 | 进一步定位重复状态、配置、验收文档和目录读取；只有同一请求中内容未被修改的解析结果可共用                                             | 中等；写入后失效，下一请求重新读取；Hook 需要真实宿主触发证据，不能只用构造数据宣称体验改善     |

这些建议提出时尚未实施。下一节记录健康查询、分支观察与 Hook 读取的后续优化；Windows 进程身份探测的底层实现没有替换。

## 健康查询与 Hook 读取优化（基线 7f758aa0）

这一轮继续使用 hotfix044 / 0.4.4，比较基线固定为 `7f758aa0d2bc51b50945ac36f5d67a690cb301c9`。优化针对每次调用中已经定位的重复工作：

1. Classic 健康状态查询先尝试一致性只读路径。读取前后核对状态 YAML 和 Run 文件的身份、大小及纳秒时间，并确认没有写锁或事务日志；只有两份文件都稳定才返回。遇到并发写入、待恢复事务、旧格式迁移、不可比较的文件身份或读取异常，回退到原有加锁读取。状态内容不跨请求缓存，手工修改文件或切换状态后重新读取。Windows 上健康查询因此不再为写锁启动 PowerShell 身份探测；文件校验次数有所增加。
2. Native 检查预留复用输入观察已经读取的分支，普通检查少执行一次 Git 查询。旧记录中由同名 tag 导致的 `heads/<branch>` 绑定仍按原逻辑核对。两次 status 分别服务于 Runner 排除规则和实际工作树字节绑定，继续保留；候选、检查证据及旧中断记录的兼容规则没有改变。
3. Native Hook 的目标识别和检查在同一次调用内共享配置及已选 change 的解析结果。作用域通过 AsyncLocalStorage 隔离并发调用，下一次调用重新读取；状态修改前清空，修改完成或失败后再次清空，避免修改期间产生的旧读取残留。Native Next 的恢复前后读取继续获取新状态，没有将缓存扩大到恢复过程。

### 打包比较与边界

基线和候选分别完整构建、npm 打包并解包，依赖版本一致，复用基线创建的真实临时 Git 项目。Windows `10.0.26200` x64、Node `v22.20.0`，关闭 daemon，每份包每场景预热三次、正式十五次，交替改变执行顺序。七个场景共 210 次正式调用全部完成退出码及输出/持久化结果检查。Git、PowerShell 与指定异步文件 API 次数来自额外成功的插桩调用，不包含在正式计时中。

| 场景                                        | 基线中位 ms | 候选中位 ms | 基线样本 P95 ms | 候选样本 P95 ms | Git 次数 | 文件 API 次数 | PowerShell 次数 |
| ------------------------------------------- | ----------: | ----------: | --------------: | --------------: | -------- | ------------- | --------------- |
| Classic current，公开 CLI                   |      748.35 |      260.72 |         1269.22 |          407.48 | 1 → 1    | 85 → 102      | 1 → 0           |
| Classic next，公开 CLI                      |      680.87 |      202.81 |         1295.01 |          336.21 | 0 → 0    | 161 → 178     | 1 → 0           |
| Native 首次检查，独立 Node 调用 Runtime API |     2975.20 |     2830.43 |         3510.20 |         3068.44 | 15 → 14  | 577 → 577     | 2 → 2           |
| Native 检查复用，独立 Node 调用 Runtime API |     1460.58 |     1347.89 |         1952.38 |         2426.41 | 7 → 6    | 115 → 115     | 1 → 1           |
| Native Hook，生成 Router 入口               |      375.15 |      357.12 |          563.19 |          557.84 | 2 → 2    | 99 → 65       | 0 → 0           |

Classic 两个查询中位分别下降约 65.2% 和 70.2%；Native 首次检查、复用和 Hook 分别下降约 4.9%、7.7% 和 4.8%。Hook 的文件 API 次数减少约 34.3%。空 Node 对照为 74.40 → 75.49 ms，版本查询为 114.81 → 112.72 ms，没有据此宣称 Node 启动本身提速。Native 复用样本的 P95 更慢，不宣称尾延迟全面改善，也不把不同基线的百分比相加。

Classic 测量实际执行两份包的公共 `bin/comet.js`。Native 检查在新 Node 进程中直接调用 Runtime API，不能作为公共 Native CLI 或整条流程的端到端结果。Hook 执行生成的 `comet-hook-router.mjs`，使用 Codex 格式的 Write 输入，核对允许结果为空且候选状态文件未变；这是生成入口回放，没有触发真实 Agent 宿主 Hook。文件计数仅覆盖 `readFile`、`lstat`、`stat` 和 `readdir`，不代表所有文件系统调用。

候选可以复用基线留下的通过证据；额外将基线检查中断后交给候选，已通过项保持执行一次，中断项只重试到第二次。回归还覆盖同大小手工修改并恢复 mtime、读取中跨越写事务、活跃写锁、不可比较文件身份、同名 tag、并发 Hook 隔离，以及 Hook 修改期间缓存产生后再失效的情况。授权、候选输入、证据绑定、路径保护、迁移和事务恢复条件保持有效。

原始样本、插桩、包及构建摘要保留在系统临时目录 `comet-perf-044-readonly-050b085c94cd4ca3a2e6f226f23e32af/paired-results.json`。测量候选由相对基线的未提交代码差异构建，最终交付前另行核对构建摘要；报告中的基线 HEAD 不能当作候选提交身份。基线构建 SHA-256 为 `20d47ad55bee008e00dd0e898224b6f89648a56a0247a5cb6b1ae81d73b57e53`，候选为 `f1d33ca45158685eed0267313d2a16609d7ecf8032108bea11de655951947445`。tarball SHA-256 分别为 `cbbc3291fa3893976d634fabf1f6d719d74392d2443a4b608db5b0de85f3d726` 和 `decb059407779fe34aec772043b15b7717e022f3bba304545c57a6f46a2f75f5`。

后续是否替换 Windows 身份探测或合并 Native 剩余 status，仍需单独设计和测量。这里保留现有探测实现及状态语义，没有引入 Worker、跨请求业务缓存或新的 SDK 入口。

## 验证边界

本地执行了相关回归、完整构建、TypeScript、lint / 架构、生成物与格式检查，以及 npm 打包安装 E2E；仓库全量测试与跨平台兼容由本次提交的线上 CI 执行。性能测量包括 Windows 上的小型 Native Status、检查及 Classic 公开查询/检查，以及构造的 200 文件样本，不代表完整 Classic / Native 流程收益。未测生产大仓库、多 change、macOS/Linux 的性能、真实模型 Eval、Agent 宿主 Hook 或 CPU profile。未引入跨请求缓存、Worker、snapshot、SEA 或新的 SDK / MCP 入口。

## Daemon 增量观察与 Windows 进程探测（2026-10-03，基线 4861f389）

本节更新上一轮的实现边界，仍为 hotfix044 / 0.4.4，没有引入 045 SDK 代码。前文的“没有跨请求缓存或替换 Windows 探测”描述对应此前候选。

### 实施范围

Native daemon 的 Status、Show、Root Show 现在可以跨请求复用 Git 工作树观察。每次请求先核对调用目录、最近的 `.git`、HEAD、commondir、本地及全局配置、工作树注册表和各工作树绑定。分支变化、detached HEAD、工作树添加或移除、目录中出现新的独立仓库，以及 Git 可执行文件或相关环境变化都会重新获取观察。include/includeIf、符号链接、文件身份不可比较、读取异常或超出元数据限额时，不保存跨请求观察。

缓存只包含 Git 根目录、分支和工作树列表，最多保存八组调用路径；状态 YAML、验收文档、事务、授权和候选证据每次请求重新读取。真实 Native handler 回归确认：第一次 Show 后手工修改 brief，下一次 Show 返回新内容且不启动 Git。修改动作继续实时复验，不使用查询缓存。

元数据检查有 100 ms 预算；配置路径发现的单次 Git 调用最多 500 ms，工作树刷新最多 1000 ms。刷新通过异步外部进程执行，不占住 daemon 的事件循环；控制请求在刷新等待期间仍能响应。准备异常由既有 CLI 路由回退到本地执行，不以空工作树列表代替失败查询。确定性回归覆盖慢刷新时的控制响应、同大小 HEAD 编辑后恢复 mtime、工作树增删、子目录调用和嵌套仓库。

Windows 身份探测使用一个可选的本地小程序读取 OpenProcess / GetProcessTimes，保持原有 `win32-ps:<UTC ticks>` 身份格式。准备和探测采用异步进程并有超时；首次准备可以同时尝试旧探测。准备失败冷却十秒后可以重试，不让编译超时或临时锁占用永久禁用快路径；在途准备仍去重，成功后不保留未校验的程序路径。不可用、权限不足或超时继续按 unknown 保守处理，不当作 owner 已退出。自身成功身份可复用，其他 PID 的成功身份下一次重新探测，避免长期 daemon 使用旧身份错误识别被复用的 PID。缓存清单、普通文件类型和程序摘要在执行前核对，测试与缓存都不写开发者 HOME。

### Windows 自动启动修复

扩大验证时，上一版包与本轮候选都能复现：公开查询已经返回，PowerShell 还没有完成 WMI 交接，之后 daemon 始终未就绪。直接运行服务和保留启动器父进程都能成功。libuv 的 Windows 实现会在 Node 退出时终止未 detached 的直接子进程；直接 detached PowerShell 还存在脚本未执行就退出的兼容问题。[libuv Windows process implementation](https://github.com/libuv/libuv/blob/v1.51.0/src/win/process.c)、[Node issue 51018](https://github.com/nodejs/node/issues/51018)

现在前台启动一个短暂的后台 Node launcher，由它持有 PowerShell，完成 WMI 交接后退出，十秒超时后终止未完成交接。固定 launcher 以 `.cjs` 保存到临时缓存，逐次核对类型、完整内容和文件状态，使用独立临时文件及原子重命名准备。缓存不保存目标命令、项目路径、用户环境或凭据；准备失败继续本地执行。`.cjs` 也确保继承 `NODE_OPTIONS=--experimental-default-type=module` 时仍能运行，临时协议变量在交接前删除。

诊断原型中，同一 launcher 通过 `node -e` 首次调用仍使前台等待约 2395 ms；改为文件入口后首次调用约 20 ms，二者都完成实际 WMI 操作。独立复审在新临时缓存中测得 20.80 ms。公开首次查询的一个成功样本为 546.56 ms，daemon 后续就绪、状态和停止均通过。这些是诊断样本，不能作为冷启动中位数或所有机器的耗时承诺。

Windows 自动查询不等待 daemon 就绪，继续执行本地 Runtime。显式 `daemon start` 则需要返回已就绪的服务：退避和 IPC 请求共用 10 秒启动预算，剩余时间不足时缩短单次 IPC 超时，也能等待已经开始的交接而不重复启动。其他平台的自动查询遇到已有启动锁时继续立即本地执行。预算约束启动请求和重试，不包含模块加载、系统创建进程等耗时。回归覆盖缺失 endpoint、IPC 无响应、已经启动的后台交接，以及真实自动启动、默认模块环境和显式冷启动，并核对 daemon 的父进程为 WMI 服务。

### 最终打包比较与验证

固定基线为 `4861f3893d1af955cea19b44dbee5e6d952848f3`。两份包均为 0.4.4，使用相同依赖、基线创建的临时 Git 项目和独立 daemon endpoint；每份包每场景预热两次、正式采样九次，交替执行顺序。三个查询场景分别通过公开 CLI 根目录、公开 CLI 子目录和直接 daemon IPC；两个 Native 检查场景通过新 Node 进程调用 Runtime API，关闭 daemon。它们的计时入口不能混同。

| 场景                                        | 基线中位 ms | 候选中位 ms | 基线样本 P95 ms | 候选样本 P95 ms | 中位下降 |
| ------------------------------------------- | ----------: | ----------: | --------------: | --------------: | -------: |
| Native Status，公开 CLI，项目根目录         |      339.36 |      171.02 |          349.14 |          186.88 |    49.6% |
| Native Status，公开 CLI，项目子目录         |      340.86 |      165.64 |          402.87 |          188.84 |    51.4% |
| Native Status，直接 daemon IPC              |      205.07 |       30.48 |          214.57 |           43.94 |    85.1% |
| Native 首次检查，独立 Node 调用 Runtime API |     7713.14 |     7362.41 |        10981.97 |         9825.06 |     4.5% |
| Native 检查复用，独立 Node 调用 Runtime API |     2303.79 |     1705.03 |         3472.84 |         3678.14 |    26.0% |

五个场景共 90 次正式调用全部完成退出码、结果和持久化检查。热查询的请求内 Git 启动次数从 2 降到 0，根目录与子目录的返回数据相同。P95 是九个样本中的观测值，不代表生产尾延迟保证；不同轮次的改善比例不相加。本轮首次检查中位只下降 4.5%，检查复用的 P95 略慢，不能宣称所有检查或尾延迟全面改善。两份包的首次检查绝对耗时都比前一轮更高，没有 CPU profile 证据解释这次差异，不把前一轮的较大改善比例代替最终包结果。

本轮摘要覆盖 `package.json`、全部 `bin/*.js`、`dist/app`、`dist/domains`、`dist/platform` 和两套 Runtime 脚本，与前文只覆盖两个 bin 文件的摘要口径不同。基线构建 SHA-256 为 `8a6c267bf6c3ea9ee1ae2db97b70d669309025cdfd4ac683dbfa5fd69ba48b72`，候选为 `b2ac97dc1065f659af6ecbeb5a4b03045d115041fd37cd944fbfbee1a1616627`；tarball SHA-256 分别为 `decb059407779fe34aec772043b15b7717e022f3bba304545c57a6f46a2f75f5` 和 `f733b323a56f3d4f6b00ae56556a9c47c2312dafc234d3e4ddd1c6773a2d548d`。原始样本、解包产物和兼容结果位于系统临时目录 `comet-perf-priority-a1b9139724024ab6bbe883f72a8acafc/review-priority-results.json`，`complete: true`。测量候选来自未提交差异，报告中的基线 HEAD 不作为候选提交身份；交付前核对工作区构建摘要与测量包一致。

初版候选 `2a0b6200` 的 `pnpm verify:changed --base 4861f3893d1af955cea19b44dbee5e6d952848f3` 通过架构、TypeScript、全范围格式、生成物确定性及 App / 平台检查：App 657 项通过，平台 231 项通过、4 项跳过。Native 锁、检查摘要、进程、归档及 Runtime 资产十文件为 74 项通过、2 项跳过，npm 打包安装 E2E 通过。补充 Windows 恢复边界后，完整构建及变更检查的静态项通过；平台套件以 `--maxWorkers=1` 执行，235 项通过、4 项跳过，真实启动、启动预算及命令 shim 回归三文件为 9 项通过、1 项非 Windows 条件跳过。锁与生成资产五文件仍为 47 项通过、2 项跳过。新增回归先复现后台交接过早终止及准备失败永久缓存，再验证六秒交接完成、十秒终止、编译超时和临时锁占用后的冷却重试；相关三文件 16 项通过。并发批次曾出现临时目录占用和后台启动超时，探测器清理加入有界重试，进程密集测试改为顺序执行后通过，没有改动旧命令启动测试。测试批次有重叠，不相加为唯一总数。ESLint / 架构和两项独立代码审核通过。本地未重跑仓库全量套件，最终候选的全量及跨平台打包安装交由新提交的线上 CI 执行；非 Windows 专属启动回归也由该 CI 验证。

结果只描述 Windows / Node 22.20.0 上的小型 fixture。热查询已复用同一 daemon PID，返回数据一致；检查仍能复用基线通过记录，并仅重试基线中断项。Windows 探测小程序在预热中已经准备，不把检查耗时作为首次安装或准备耗时。没有测试生产大仓库、多 change、完整工作流、macOS/Linux 性能、真实模型 Eval、Agent 宿主 Hook 或 CPU profile；不承诺归档、检查或新 Node CLI 全部达到毫秒级。
