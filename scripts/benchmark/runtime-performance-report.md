# Classic / Native performance results — 2026-09-12

## Status

本轮已完成可验证的 Runtime 优化、经用户确认的中英文 Skill 同步及前后性能对比。原计划尚未全部完成：完整测试未通过，内部阶段计时及部分扫描/汇总优化未实施，真实模型 Eval 未运行。用户要求本轮收尾后等待另一个工作区的 Skill 优化；不提交、不推送、不启动 Eval。

## Method

- 基线：`e95b1f4d5a6e796cba2de4513afd2592dccc5646` 的独立导出与构建。
- 候选：同一 HEAD 加当前工作区差异，包含本轮开始前已有的 Classic 默认只读查询和 Native next 优化。结果是这些未提交性能修改的累计对比，不能全部归因于本轮新增代码。
- Node `v22.20.0`、Git `2.51.0.windows.1`、Windows `10.0.26200`、包版本 `0.4.1`；两侧共用当前安装依赖。
- 同一 benchmark 文件（两份报告的 `benchmarkSha256` 相同）。新 Node 进程、文件系统预热；每场景预热 3 次，正式采样 30 次，另用独立进程采集 Git/FS 数据。10 个场景、两组共 600 个正式样本。
- 每个样本都验证退出结果、状态或检查证据。fixture 准备、恢复、结果断言不计入时间。检查场景恢复文件及目录结构，保留 Git 对象库；这些场景不修改 Git 历史或暂存区。
- `*-public` 通过真实 CLI；Native check 场景通过新 Node 进程直接调用构建后的 Runtime API，用于测量检查执行边界，不代表完整公开 CLI 协议耗时。
- 中断重试场景故意使用会超时的可重复检查。正确结果是通过项执行次数保持 1，中断项变为 2；该场景不是业务检查成功率证据。
- FS 指标覆盖被插桩的异步 `readFile/stat/lstat/readdir`，不包含所有同步文件访问、模块加载器内部读取或 Git 子进程内部 I/O。
- 基线包位于临时目录，候选位于工作区；测试顺序为先基线后候选。时间差包含机器负载、缓存及包位置的影响。Git/FS 次数减少是更直接的工作量证据。

Raw reports: [before](runtime-performance-before.json), [after](runtime-performance-after.json).

## Results

单位：ms。p95 是 30 个样本的观测分位数，不是跨机器承诺。

| 场景                          |  median 前 → 后 |   变化 |     p95 前 → 后 | Git 前 → 后 | FS 前 → 后 |
| ----------------------------- | --------------: | -----: | --------------: | ----------: | ---------: |
| Classic current               |   989.8 → 291.1 | -70.6% |  1059.9 → 336.4 |       3 → 1 |   186 → 85 |
| Classic next                  |   918.3 → 211.8 | -76.9% |   954.9 → 227.7 |       2 → 0 |  274 → 161 |
| Classic 检查首次执行          | 1426.1 → 1130.4 | -20.7% | 1503.7 → 1159.0 |       6 → 6 |  888 → 888 |
| Classic 检查复用              |   742.9 → 569.7 | -23.3% |   764.0 → 590.7 |       3 → 3 |  372 → 372 |
| Classic 输入变化后检查        | 1633.0 → 1317.6 | -19.3% | 1733.1 → 1348.6 |       9 → 9 |  763 → 763 |
| Native 检查首次执行           | 3572.9 → 2852.8 | -20.2% | 3737.5 → 3006.9 |     11 → 10 |  462 → 462 |
| Native 检查复用               | 2671.5 → 2465.2 |  -7.7% | 2793.4 → 2540.5 |      11 → 9 |  114 → 114 |
| Native 指定中断项重试         | 3260.7 → 3052.2 |  -6.4% | 3328.1 → 3181.8 |     12 → 10 |  448 → 448 |
| Native next（Shape 确认准备） |  1050.5 → 777.8 | -26.0% |  1075.4 → 816.6 |       7 → 4 |  344 → 344 |
| Native status（1 worktree）   |   367.7 → 364.4 |  -0.9% |   387.6 → 382.7 |       2 → 2 |    43 → 43 |

两组正式结果没有触发计划中的 median/p95 回退复测条件。Classic current 的读取字节数从 6,792 降至 558；next 从 6,406 降至 86。其他场景读取字节数相同，详见 JSON。

Classic 检查没有修改指纹扫描算法，不能把其时延下降表述为减少了扫描工作。Native 并发上限的直接作用是限制同时读取的文件数；本轮未做大规模未跟踪文件压力测试，不宣称该项独立带来了时延收益。

## Retained changes and boundaries

- Classic：保留默认 `state current/next` 跳过无收益学习记录的改动；把学习记录所用 experience 模块延迟到实际记录时加载。显式集成参数及写入后的身份获取仍按原语义执行。
- Native next：保留当前工作区已有的普通 continuation 工作区检查去重；Verify、Archive、Runner input 的前置校验保留。
- Native checks：在一次锁内预约中复用分支值，计划匹配不再次查询分支；未跟踪文件读取改为并发上限 4，保持输入顺序和读取失败行为。
- 指纹：保留原 `branch --show-current`、`ls-files` 及哈希字段/顺序。撤回了用 status 枚举替换 ls-files 的尝试，也未用不同语义的 symbolic-ref 输出替代指纹中的 branch 字段。并发映射返回原输入顺序，未改变哈希序列。
- Skill：四个入口文件经中文确认后同步英文。工作包内复用状态/上下文，按状态或工作区变化刷新；Verifier 只补跑缺失或失效检查，仍独立覆盖全部验收项；交接使用证据位置，等待工具超时继续等待同一执行。
- 未引入常驻进程、跨命令缓存或文件监听；未移除锁、CAS、恢复、指纹、日志完整性或独立验收机制。

Skill merge paths:

1. `assets/skills-zh/comet-classic/SKILL.md`
2. `assets/skills/comet-classic/SKILL.md`
3. `assets/skills-zh/comet-native/SKILL.md`
4. `assets/skills/comet-native/SKILL.md`

## Validation

- 最终 `pnpm build`、`pnpm lint`、`pnpm check:generated` 通过；构建中的 Hook Router 写入曾出现 Windows `UNKNOWN open`，单独重建及后续完整构建通过。不能仅凭重试通过确定其底层原因。
- 最终定向测试：7 个文件、126 个测试通过，含 Native portable Runtime、Supervisor user-options、并发映射、Classic facade、中英文 Skill 和 benchmark 契约。
- 一轮 `pnpm test` 在约 26 分钟后终止，未取得完整汇总，不算通过。已观测到 Native contract-files 的旧总字节限制断言失败，以及两个 Supervisor 120 秒级超时。
- contract-files 的 HEAD 源码已经使用 `maxBytes: null`，测试仍期待总大小超限被拒绝；本轮未修改该模块或放宽其断言。
- 两个 Supervisor 场景在随后的定向测试中通过，因此全量时的超时暂归为负载相关；未重新运行全量以宣称 CI 等价通过。
- 未运行真实平台 Hook 验证、真实模型 Eval 或远端 CI。未提交、未推送，website 子模块状态保持不变。

## Outstanding plan items

- 尚未实现 Native recovery / acceptance / children / supervisor 的分别计时、独立哈希耗时和模块加载数量统计。
- 尚未实施 Classic 快照内部重复读取/枚举的进一步优化、facade 聚合 Runtime 拆分，以及 Native children/supervisor 汇总读取去重；本轮不能宣称这些方案已经实测无收益。
- 未对全部失效条件逐项建立新的前后差分矩阵；现有定向测试通过不能替代完整计划验收。
- 完整仓库测试仍未完成。真实 Eval 等用户合并其他工作区 Skill、完成工程验收并确认模型/凭据/费用后再安排。

## Historical Eval boundary

已核对 `experiment_20260704_185819` 的原始 `comet_full_workflow_COMET_FULL_040_BETA_r1_rep1_report.json`：19s、135 tools、370,733 tokens、约 $0.2008、20/20 checks。该旧报告缺少 case hash 和模型配置，而且带有 sample-quality flag，仅作为历史参考。

`experiment_20260704_125640/summary.md` 中同任务两条记录为 33s、16s。未把这些记录混成与当前候选严格匹配的基线。README 指向的 `experiment_040_PASS3` 当前未提供可用的对齐报告；Native 历史 comparison unavailable。

真实 Eval 保持约定范围：仅 `comet-full-workflow`，Classic 3 次、Native 3 次。当前实际执行次数为 0，未据 Runtime 毫秒级改善推断模型端到端收益。
