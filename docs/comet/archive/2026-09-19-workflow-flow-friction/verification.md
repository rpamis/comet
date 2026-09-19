---
generated_from_state_version: 23
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 4
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-09-19T06:31:20.565Z
- 摘要: Third independent verification: the fifteen-minute takeover-threshold correction is consistent across source, tests, user-facing text, CHANGELOG, brief decision record, and the built bundle (6/6 checks, 40 tests green). All thirteen acceptance scenarios remain satisfied; the implementation logic was otherwise unchanged from the round the user already reviewed.

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | Scenario: 跨主机残留锁恢复 —— 在设备 B 上面对设备 A 崩溃留下的 Native 变更锁（hostname 不同、owner 不可达），`comet native doctor <change> --repair` 在锁龄超过约定阈值后能够接管，后续变更命令不再每条空转 5 秒后失败。 | Aged unknown-lock takeover now at fifteen minutes: constant, doctor text, countdown, tests, CHANGELOG, brief record, and bundle all consistent (6/6 checks). |
| A2 | passed | brief.md | Scenario: Windows 进程探测降级 —— 在进程身份探测工具不可用（PowerShell 被禁用或超时）的 Windows 主机上，僵尸检查 owner 在合理时限内可被 doctor 判定并接管，不再出现"探测失败即永远判活"。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A3 | passed | brief.md | Scenario: Classic 空锁快速自愈 —— 模拟 crash 留下的空 `.comet-state.lock`，后续命令在秒级（而非 5 分钟）内完成清理或自动恢复，不再每条命令等待 30 秒。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A4 | passed | brief.md | Scenario: Hook stdin 超时退出 —— 宿主进程不写入也不关闭 stdin 时，hook 进程在约定超时内以非零码退出并输出可诊断错误，而不是永久阻塞。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A5 | passed | brief.md | Scenario: 指纹复用先于全价 —— 工作树与状态版本未变时，连续两次 Runtime 检查保留判定中第二次不再重新执行全量 `diff --binary` 与 ignored 目录哈希，复用路径在计算指纹前命中。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A6 | passed | brief.md | Scenario: guard --apply 校验去重 —— `comet guard <change> build --apply` 对同一份证据的昂贵部分只计算一次：策略文件每次评估只读一次、可执行文件路径按进程缓存；锁内的第二次校验作为防并发篡改保护保留，但其复验走 manifest 差分快照。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A7 | passed | brief.md | Scenario: check run 去重 —— `comet check run` 执行期间环境未变化时，只计算一次环境指纹；after 快照复用 before 快照的枚举结构。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A8 | passed | brief.md | Scenario: select 优先复用 —— `.comet/current-change.json` 有效时，`state select` 不再对每个 worktree 发起 3 次 git 调用。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A9 | passed | brief.md | Scenario: Open 阶段产物刷新本地化 —— OpenSpec status 刷新改为本地 `state artifacts` 判定，仅在依赖报错时回退真实 status；Open 阶段外部子进程调用次数显著下降。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A10 | passed | brief.md | Scenario: 阶段入口免重复读取 —— design/verify/archive 入口在上一阶段 guard 已返回本阶段状态时不再重复 `state select` + `state check`（与 build 的豁免对齐，Skill 中英文同步）。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A11 | passed | brief.md | Scenario: status→select 单条化 —— 已知 change 名时 Native 入口一条命令完成发现与选择（select 返回发现结果或 status 复用 select 上下文），Skill 中英文同步更新。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A12 | passed | brief.md | Scenario: 默认输入绑定走 manifest 差分 —— 未声明 check-policy `files` 的命令，第二次 `check run` 的输入指纹基于上次 manifest 差分与新增文件计算，不再全树枚举；与上次无关的文件改动不使证据失效，新增匹配文件仍使证据失效。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |
| A13 | passed | brief.md | Scenario: A5 四条循环出口 —— status blocked 指向外部 worktree 时返回指向该 worktree 的可执行修复命令；migration 双轨指令统一为单一推荐路径；liveness unknown 给出带时限的接管出口。 | Carried over from the second-round verification (unchanged implementation); parameter round re-verified lock/doctor suites. |

## 检查

_没有记录 Runtime 检查。_

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- lock and doctor suites: passed — native-lock 13 passed 2 skipped (platform-specific), doctor 13 + v4 14 passed after an initial parallel-jitter rerun
- bundle rebuild: passed — build:native-runtime rerun
- prettier: passed — changed files formatted

## 阻塞项

_无。_

## 风险与跳过的工作

- Same declared risks as the second round: ignored generated directories stay the gate exception; two assertion gaps and one zh explanatory-clause asymmetry noted for follow-up

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 0 | recovery | — | Native Shape artifacts changed | 2026-09-19T03:17:43.087Z |
| 2 | 1 | 1 | fail | A5, A11 | 12 of 14 scenarios verified with evidence; A5's reuse-before-fingerprint ordering was missing at verification time (Builder added the gate afterwards); A11 is an intentionally unimplemented declared non-goal whose acceptance example text still needs removal from the brief. | 2026-09-19T03:50:17.326Z |
| 2 | 2 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-09-19T03:51:01.759Z |
| 3 | 1 | 1 | pass | — | Second independent verification round for the current candidate: 13/13 scenarios pass. The two first-round failures were substantively fixed (A5 input gate with tests; A11 resolved by the user-confirmed requirement revision) and the remaining scenarios were not regressed. Random-run spot checks across five test files all green. | 2026-09-19T06:08:14.840Z |
| 3 | 1 | 1 | recovery | — | Native Shape artifacts changed | 2026-09-19T06:24:56.310Z |
| 4 | 1 | 1 | pass | — | Third independent verification: the fifteen-minute takeover-threshold correction is consistent across source, tests, user-facing text, CHANGELOG, brief decision record, and the built bundle (6/6 checks, 40 tests green). All thirteen acceptance scenarios remain satisfied; the implementation logic was otherwise unchanged from the round the user already reviewed. | 2026-09-19T06:31:20.565Z |



## 结论

Third independent verification: the fifteen-minute takeover-threshold correction is consistent across source, tests, user-facing text, CHANGELOG, brief decision record, and the built bundle (6/6 checks, 40 tests green). All thirteen acceptance scenarios remain satisfied; the implementation logic was otherwise unchanged from the round the user already reviewed.
