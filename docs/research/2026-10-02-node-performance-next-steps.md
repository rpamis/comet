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

### 最终打包比较

将基线提交与候选分别构建、打包并解包到独立目录，执行各自的 `bin/comet.js`。二者复用相同版本的依赖目录，以排除依赖版本差异；实际 npm 安装与平台路由另由 package E2E 验证。使用同一个临时 Git 项目，每组预热 2 次、正式采样 15 次，交替改变基线与候选的顺序。两份包都为 0.4.4，使用不同诊断环境标识隔离 daemon endpoint，避免固定的 tar 文件时间戳造成构建 ID 相同而误用另一个包的 daemon。统计不含安装和启动准备。

| 场景                   | 基线中位 ms | 候选中位 ms | 基线 P95 ms | 候选 P95 ms |
| ---------------------- | ----------: | ----------: | ----------: | ----------: |
| 热 daemon 的公开 CLI   |      457.34 |      376.36 |      783.16 |      775.58 |
| 关闭 daemon 的公开 CLI |      926.29 |      510.37 |     1264.49 |     1042.02 |

本轮中位耗时分别下降约 18% 和 45%；热 daemon 内部请求中位为 313 → 216 ms。每份包热路径均复用一个 PID，60 次正式查询的 data SHA-256 全部为 `4a5c5ca6b4aa0f0a18072fc40ff266283917f41810de31f23fc346eccaa672b6`。临时插桩确认直接 CLI 的 Git 进程数为 5 → 2，模拟包目录 daemon 上下文为 3 → 2；候选 daemon 自身统计也稳定为每请求 2 次。基线的诊断计数为 0 是已说明的漏计，不能当作实际工作量。

这是小型 Status fixture 的本机结果，尾部耗时仍受系统负载影响，热路径 P95 改善很小。先前一轮同样的交替采样中位为 399 → 334 ms、731 → 419 ms，说明绝对时长有明显波动；不把上述百分比作为所有仓库的加速承诺。未对冷 daemon 启动或完整工作流作提速结论。

原始结果及包 SHA-256 位于系统临时目录 `comet-perf-044-delivery-20261002/package-results.json`。先前一次仓库 benchmark 在收尾时未找到 daemon，打包比较准备阶段也遇到 daemon 启动失败；这些未完成的尝试没有计入上述采样或作为启动验收。最终交替比较完整结束，两份 daemon 均已停止。

## 验证边界

本地执行了相关回归、完整构建、TypeScript、lint / 架构、生成物与格式检查，以及 npm 打包安装 E2E；仓库全量测试与跨平台兼容由本次提交的线上 CI 执行。性能测量针对 Windows 上一个 Shape change 的 Native Status，不代表完整 Classic / Native 流程收益。未测大仓库、多 change、macOS/Linux 的性能、真实模型 Eval、Agent 宿主 Hook 或 CPU profile。未引入跨请求缓存、Worker、snapshot、SEA 或新的 SDK / MCP 入口。
