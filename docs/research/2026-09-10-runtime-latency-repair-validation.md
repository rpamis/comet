# Runtime 修复后的实际 CLI 对照

本报告记录 `repair-cli-reliability-and-runtime` 的真实进程验证。最终完整对照已满足 A13–A17 的成功场景与 Git 进程预算，task、Native status/next 和已配置 activation 的耗时下降。Classic 公共命令恢复了旧快捷路径遗漏的插件门面，结果记录中的身份查询也已去重；其耗时仍高于旧快捷路径，下面完整保留这项用户可见成本，并说明两者行为不完全等价。

## 构建与测量身份

- before：固定提交 `1617fa06da8a9bfbf5dd424316a1ba35072a289a` 的 Git archive 临时包；使用当前同一份依赖重新编译该提交的 `dist`，Runtime bundle 使用该提交的发布资产。
- after：以同一 HEAD 为基线的修复工作区，完成 `node build.js`，并在 Classic 结果记录阶段的身份复用修改后重新编译 `dist`。三套 Runtime bundle 保持与其源码同步。这里的 HEAD 仍是旧提交，实际已包含未提交修改，因此不能仅用 HEAD 区分两个产物。
- before 构建 SHA256：`d39dd82e1dd3fa55f21d3c4215e1fa0fde26d6cdc925abdcf59da28cd96e0355`。
- 最终 after 构建 SHA256：`ee73e3f0d9e3b61ee8d383c5cbcb0fb049a88bf16ff2cfeb92cec3ee0e8b5a3b`。
- 两轮脚本 SHA256 均为 `9c94b86afcfdece9e3537ff3afd8539cee2b3c863ac9363f9229a15f78e4ea2a`。构建哈希覆盖 public bin、package.json、实际 `dist` JavaScript 及两组 Skill Runtime 目录。
- before / 最终 after 报告起始时间分别为 `2026-09-10T11:51:58.132Z` / `2026-09-10T12:05:27.021Z`。
- 环境：Windows `10.0.26200`、x64、Node `v22.20.0`、Intel i5-10600KF @ 4.10 GHz、12 个逻辑 CPU。

所有目标串行运行，每个目标一次文件缓存预热、五个未插桩样本及一个独立 Git 插桩样本。每次都是新的 Node 进程；未清空操作系统文件缓存。计时包含 Node 与其子进程，排除 fixture 构造、状态快照恢复、结果校验及外层 PowerShell / Agent 工具往返。五个样本的 nearest-rank p95 就是最大值，只能视为观察值。

正式窗口内其他 Agent 暂停了进程测试和构建。首次启动曾可能与 reviewer 的短暂 Node/Python 检查重叠，已中止并丢弃，从头运行全部 before；以下结果没有混入该次数据。仍无法排除操作系统或用户其他应用的后台负载。

## 合法 fixture 与失败边界

- 全部 HOME、USERPROFILE、APPDATA、LOCALAPPDATA、XDG 配置/缓存/数据根和 Git global/system config 均位于独立临时目录；没有禁用知识或记忆插件。
- task 固定使用 `--session benchmark-context`。构造阶段先通过真实命令确认 Project Knowledge manifest 成功交付，再测同一会话没有新上下文的调用；计时输出均为 20 字节的空 context，没有知识降级诊断。该 precondition 经过明确验证，不从旧审核中的空输出推断其原因。
- 新 fixture 的 before task 有 / 无 origin 分别产生 7 / 14 次 Git。它与旧审核中的 6 / 12 次不同，因此本报告所有改善比例均使用此次同 fixture 对照，不混用旧报告数字。
- Native 每个 worktree 通过 Git 正式创建，并执行公开 `native new`，各有一个不同名称的活跃 change。规模为 1、10、30 个真实 worktree，没有复制或伪造多个 active 状态。
- Shape prepare 每次都恢复由真实 `native new` 创建的原始文件快照；恢复在计时之外。每次命令验证输出的 `confirm-shape` continuation，以及落盘的 `phase=shape`、`status=await-user`、`state_version=2`。没有通过直接改版本号凑出计时前置条件。
- 非零退出、signal、spawn error、timeout、错误 JSON / continuation / 持久状态、缺少 Git 插桩或未知 target 都会使运行失败；不完整或未满足 Git 预算的结果不能写成 baseline。

before 与 after 各有 15 个目标、每目标五个成功样本，所有采样退出码均为 0。所有 after Git 预算均达标。

## 最终完整结果

单位为毫秒；两组耗时列分别为 median / 观察 p95。Git 来自另外一次成功插桩，不能将其累计时间直接从 median 中相减。输出列为 stdout UTF-8 字节数。

| 目标                             | before median / p95 | after median / p95 | Git before → after | stdout 字节 before → after |
| -------------------------------- | ------------------: | -----------------: | -----------------: | -------------------------: |
| Node 空进程                      |         74.0 / 77.8 |        75.1 / 76.4 |              0 → 0 |                      0 → 0 |
| CLI version                      |       114.3 / 115.3 |      110.7 / 117.9 |              0 → 0 |                      6 → 6 |
| CLI help                         |       113.9 / 114.9 |      111.0 / 119.8 |              0 → 0 |                2616 → 2616 |
| workflow resolve                 |       130.1 / 131.3 |      136.9 / 161.5 |              0 → 0 |                  128 → 128 |
| workflow resolve --activate      |       276.0 / 280.6 |      165.9 / 168.1 |              0 → 0 |                  128 → 128 |
| Classic current                  |       245.9 / 252.3 |      775.9 / 827.9 |              1 → 3 |                   64 → 166 |
| Classic next（Open）             |       168.1 / 172.8 |      711.8 / 780.2 |              0 → 2 |                1127 → 3747 |
| Native show                      |       154.2 / 166.8 |      154.6 / 160.6 |              0 → 0 |                2429 → 3589 |
| Native next public               |     1060.0 / 1073.1 |      923.0 / 956.8 |              9 → 7 |                2947 → 4913 |
| Native next direct bundle        |     1058.8 / 1066.9 |      911.7 / 931.6 |              9 → 7 |                2947 → 4913 |
| task 无 origin                   |     1418.1 / 1466.2 |      529.3 / 547.9 |             14 → 2 |                    20 → 20 |
| task 有 origin                   |       895.5 / 926.3 |      461.8 / 475.7 |              7 → 1 |                    20 → 20 |
| Native named status：1 worktree  |       546.5 / 574.3 |      327.0 / 335.9 |              5 → 2 |                1968 → 3128 |
| Native named status：10 worktree |     2789.0 / 2818.2 |      409.6 / 419.6 |             32 → 2 |                1968 → 3128 |
| Native named status：30 worktree |     8248.1 / 8284.1 |      577.1 / 600.4 |             92 → 2 |                1968 → 3128 |

命名 status 的 Git 次数已经不随无关 worktree 增加；目录、配置和必要 portable state 的轻量发现仍有文件读取成本，因此总时间并非完全不随规模变化。30 worktree 的 median 下降约 93%；task 有 / 无 origin 分别下降约 48% / 63%；Native next public 下降约 13%；已配置 activate 下降约 40%。Node 基线基本稳定。

Classic 两条公共命令的耗时显著增加，不能用其他改善抵消或隐去。before 的快捷路径遗漏插件，after 恢复完整门面及插件记录，因此该对照衡量的是用户实际执行的公开命令，行为并不完全等价；不能将全部差额称为纯 Runtime 效率回归。结果记录阶段的重复身份查询已经去除，剩余成本仍存在。Native 和 Classic 的结构化输出也有所增加，因此这些结果不能证明模型 token 或端到端 Agent 时间减少。

## Classic 新增成本的定位与复测

第一轮 after（构建 `b0d87e0802709afef015a6590b199f436d357e828bc4aff7f638ef42846e76e8`）的 current / next median 分别为 876.7 / 823.4 ms，Git 为 5 / 4 次。在全新、合法且配置隔离的 Classic fixture 中，独立插桩确认成功的 `state current` 共调用五次 Git：

1. 原有 `rev-parse --abbrev-ref HEAD`，确认 selection 的工作区分支。
2. `recordClassicResult → recordCometWorkflowResult → createBridge → resolveStableProjectId`：一次 `remote get-url origin`，无 origin 后一次 `rev-parse --git-common-dir`。
3. 同一次 `createBridge → createDefaultCometPluginBridge → resolveProjectName`：重复上述两条 Git 查询。

额外四次 Git 在独立插桩中累计约 295 ms，均属于命令执行完成后的结果记录阶段。随后仅在该阶段内部共享身份观察，没有把缓存范围跨越整个可能修改 Git 的 Classic 命令，也没有省略 Bridge、分支绑定检查或插件事件。重新编译并重跑全部 15 个目标后，current / next 的 Git 分别降到 3 / 2 次，median 降到 775.9 / 711.8 ms；与旧快捷路径的剩余差额仍如实列在主表。没有另行测量旧/新完整门面的时间，因此不对插件恢复以外的剩余成本作精确拆分。

## A16 的真实发布入口验证

构建后的 public bin 与完整 CLI 实际对照覆盖已配置项目的 JSON / 人类输出、重复激活、context / help / 未知参数回退、非法及不完整配置。非法配置的退出和错误输出一致，文件没有被修改。context 比较只规范化每次依法新建的 application UUID。

未配置 Native 项目使用隔离 global config 和已安装平台目录，通过 public / full CLI 两条路径成功创建 Native artifact 根，复制包内 `comet-hook-router.mjs` 到项目 `.agents`，并写入引用正确项目路径的 `.codex/hooks.json`。快路径仅处理已配置解析；所有真实激活继续经过完整门面，没有把依赖 `import.meta.url` 的安装图打入 Entry bundle。

## 原始证据与复跑

临时证据根为 `C:/Users/BENYM/AppData/Local/Temp/comet-runtime-baseline-2088180dedc74bc3a30404fe7b3b2e72/`，其中 `before.json`、`after-final.json` 保存主表所有样本、字节数、Git 参数、构建与脚本身份；`after.json` 保留第一轮 after；`classic-extra-git.json` 保存独立调用栈。`package/` 为旧提交临时包，只有 node_modules 链接复用当前依赖。预检和被中止的采样没有进入这些报告。

最终报告通过完整性、样本数、退出状态、脚本身份和全部 Git 预算检查后，已写入本机 `scripts/benchmark/runtime-coldstart-baseline.json`。该路径由 `.gitignore` 忽略，是用户本机性能基线，不是版本化发布资产；没有强制暂存或改动忽略规则。格式化 JSON 不改变其中的数据和构建身份。

```text
node scripts/benchmark/runtime-coldstart-benchmark.mjs --measure-before --runs=5 --worktrees=1,10,30 --package-root=<frozen-package> --source-head=1617fa06da8a9bfbf5dd424316a1ba35072a289a --output=<before.json>
node scripts/benchmark/runtime-coldstart-benchmark.mjs --runs=5 --worktrees=1,10,30 --output=<after.json>
```

这次测量没有运行真实模型 Eval，也不包含外部 verifier、项目测试、宿主 Hook 调度或网络等待。不能据此认定用户报告的“三分之一纠正时间”已经减少到某一比例。真实 CLI 对照和相关最小测试也不代替最终全量检查。
