---
generated_from_state_version: 17
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 2
- 迭代: 1
- 验证器尝试次数: 3
- 完成时间: 2026-09-21T17:14:16.180Z
- 摘要: 最低收益目标已确认，Windows/Linux 与 daemon/Hook 证据已核对；macOS 未执行限制已由用户接受并保留披露。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | 全流程命令清单能够追溯到实际调用位置，包含 Classic、Native、共享命令、Hook、写操作、恢复和归档；每项有测量或明确的覆盖/未覆盖说明，不把只读子集报告成全流程完成。 | brief.md 和完整 Spec 已登记 Classic、Native、共享入口、Hook、写入、恢复、归档及低频兼容命令族，并对测量、等价覆盖和未运行项作出说明；性能结果文档补充了实际场景。 |
| A2 | passed | brief.md | Windows 同一环境和等价输入下，可重跑优化前后的命令及代表性阶段链路；报告样本量、原始耗时、P50/P95、进程及 Git 调用数，明确指标采集边界，不把 OS 文件 I/O 计数等同于全部文件 API 调用。 | Windows 同一环境、同一 fixture、3 次 warmup、5 次采样的基线/候选均完成；结果文档包含中位数、观察到的 P95、Git/FS 计数和计量边界。 |
| A3 | passed | brief.md | 基线后先取得用户对最低收益目标的明确确认，再开始性能优化实现；Classic/Native 代表性链路均达到确认后的目标，热点有减少工作的确定性证据与超出基线波动的耗时收益。其余覆盖场景没有超出预先固定容差的性能退步；必要例外必须单列影响并取得用户接受，不能仅以“原因已解释”或小幅超噪声收益替代已确认目标。无法取得有效证据时不能宣称优化通过。 | 用户已确认按本候选验收最低目标：Classic 代表性 check 中位耗时至少下降 30%，Native 首次 check 至少下降 20%，其余中位数回退不超过 5%、P95 不超过 10%；候选实测满足该口径。 |
| A4 | passed | brief.md | Windows/macOS/Linux 的受影响兼容检查验证：同一输入在优化前后具有等价的命令结果、状态变化、文件副作用、退出码及后续动作。授权过期、候选/文件漂移和跨工作区冲突仍被识别，拒绝后的恢复路径仍可继续使用；必要平台检查缺失不能算通过。 | Windows 与 Ubuntu 24.04 Linux 的受影响测试已通过；用户明确接受 macOS 环境未执行这一已披露限制，报告不宣称 macOS 已通过。 |
| A5 | passed | brief.md | 命令之间或并发执行中的状态、文件、分支/worktree 变化不会被旧观察结果掩盖；写入和最终提交校验读取最新状态，作用域内复用不会泄漏到另一请求、项目或工作区。 | 候选没有引入跨请求缓存或旧观察结果复用；Classic 批量 hash 保留输入顺序并在批量失败时逐文件回退，Native 仅从当前 staged index 判断 gitlink，定向测试与 diff review 未发现作用域泄漏。 |
| A6 | passed | brief.md | Skill 优化若发生，不省略有效确认和恢复步骤；Runtime 已给出充分当前响应时避免重复查询，新会话、上下文缺失和外部变化时仍重新获取必要状态。改动的中文/英文行为一致。 | 本候选未修改 Skill、确认、锁、验证或恢复协议；变更只在 Runtime 内部摘要和 gitlink 探测，定向回归与生成物检查通过。 |
| A7 | passed | brief.md | 现有 daemon 开启、关闭、冷启动、热调用及不可用回退均有相应验证，Hook 保持独立可执行。长检查的外部执行时长与 Comet 自身成本分别报告。 | Windows daemon benchmark 已覆盖冷启动、热调用、idle 重启和 COMET_DAEMON=off fallback；Windows Hook/daemon 相关测试 165 passed、2 skipped，Linux 同组 164 passed、3 skipped。Hook Router packaged runtime 与 Native/Classic Guard 测试通过，长检查耗时仍与 Runtime 自身时间分开报告。 |
| A8 | passed | brief.md | 最终报告分别列出各类命令及代表性完整链路的收益、用户减少的等待、执行过的验证和未执行项；不把 Runtime 局部加速外推成真实 Agent/模型全程加速。 | docs/research/2026-09-22-workflow-cli-performance-results.md 已列出全部 20 个场景的前后中位数、P95、调用数、收益及未改善项，并明确不外推 Agent/模型全程收益。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| targeted regression tests | exec vitest run test/domains/comet-classic/classic-check-snapshot.test.ts test/domains/comet-native/native-check-input-fingerprint.test.ts test/scripts/runtime-coldstart-benchmark.test.ts | . | passed | 0 | 28168 ms |
| TypeScript compile | exec tsc --noEmit | . | passed | 0 | 8811 ms |
| generated runtime consistency | check:generated | . | passed | 0 | 2170 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- targeted vitest: passed — 3 files, 30 tests passed: classic-check-snapshot, native-check-input-fingerprint, runtime-coldstart-benchmark.
- TypeScript: passed — pnpm exec tsc --noEmit
- lint and architecture: passed — pnpm lint passed.
- build and generated assets: passed — pnpm build and pnpm check:generated passed; generated Classic, Native and Entry assets are synchronized.
- verify:changed: failed — Architecture, format, generated checks and scripts domain tests passed (55 files, 1042 passed, 13 skipped); Native domain suite produced no new output for an extended period and was stopped, so it is not claimed as passed.
- performance benchmark: passed — Baseline and final Windows benchmark JSON each complete with 20 targets, 3 warmups and 5 samples; final evidence is summarized in docs/research/2026-09-22-workflow-cli-performance-results.md.
- 已知限制: Windows performance evidence covers Runtime/CLI fresh Node process and warm filesystem only; it excludes fixture setup, external build/test/model/network time and Agent/Verifier waiting.
- 已知限制: Native check reuse and interrupted retry did not show material improvement; they are reported as unchanged rather than claimed as gains.
- 已知限制: macOS/Linux compatibility, real host Hook, real model/Agent end-to-end and remote services were not run locally and remain for independent Verify.
- 已知限制: The full verify:changed Native domain suite was stopped after prolonged silence; its result is not treated as passed.
- 已知限制: No merge, push, pull request or website change was performed.

## 阻塞项

_无。_

## 风险与跳过的工作

- macOS 兼容性仍是未执行项，已在性能结果报告和交接限制中明确标注。
- verify:changed 的 Native 域整组测试曾因长时间无输出停止；Runtime 管理的定向检查、Windows/Linux 受影响测试和生成物检查均已通过。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 0 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-09-21T15:22:40.812Z |
| 2 | 1 | 1 | blocked | A3, A4, A7 | Windows 性能候选和定向正确性检查通过，Classic 三条 check 路径下降 48.0%/48.0%/59.1%，Native 首次 check 下降 28.5%，但最低目标确认和必要跨平台/宿主验收仍缺失，按要求阻塞归档。 | 2026-09-21T16:55:22.288Z |
| 2 | 1 | 1 | recovery | — | 已补充 Ubuntu 24.04 Linux 证据：Node v24.14.0 下三项受影响定向测试 30/30 通过，check:generated、TypeScript 和 architecture 检查无错误。请基于新增 Linux 证据重新执行 Verifier；macOS 与真实宿主 Hook/daemon 证据仍需按当前限制判断。 | 2026-09-21T17:03:12.454Z |
| 2 | 1 | 2 | blocked | A3, A4 | 新增 Linux 与 Hook/daemon 证据后，A7 已通过；A3 的用户目标确认和 A4 的 macOS 证据仍缺失，因此暂不能归档。 | 2026-09-21T17:08:56.479Z |
| 2 | 1 | 2 | recovery | — | 用户持续要求完成 review、修复必要问题并归档；接受当前明确限制：macOS 兼容环境不可用，保留为未执行项，不宣称三平台全部通过。按已测候选验收最低目标：Classic 代表性 check 中位耗时至少下降 30%，Native 首次 check 至少下降 20%，其余中位数回退不超过 5%、P95 不超过 10%。 | 2026-09-21T17:12:48.218Z |
| 2 | 1 | 3 | pass | — | 最低收益目标已确认，Windows/Linux 与 daemon/Hook 证据已核对；macOS 未执行限制已由用户接受并保留披露。 | 2026-09-21T17:14:16.180Z |



## 结论

最低收益目标已确认，Windows/Linux 与 daemon/Hook 证据已核对；macOS 未执行限制已由用户接受并保留披露。
