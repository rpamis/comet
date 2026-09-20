---
generated_from_state_version: 30
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 2
- 迭代: 9
- 验证器尝试次数: 1
- 完成时间: 2026-09-20T13:09:42.065Z
- 摘要: 独立复核候选 982def90-37c7-4c7e-ac36-2595f32baf1c（iteration 9 / attempt 1）并确认 verifier-started 已登记。daemon 只读路由、环境/项目/权限隔离、生命周期与连接边界、同进程 Hook stdin、Native managed artifact fingerprint、临时 fixture benchmark 及生成资产检查均通过；没有发现阻断当前验收的缺陷。已明确未执行全仓、真实平台和远端验证范围。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：现有单次 CLI 与常驻 Runtime 对同一合法请求返回一致的 JSON、退出码、状态变更、错误分类和下一步动作；daemon 不可用时单次路径仍可完成。 | 定向测试与真实 CLI 对照通过：Native status 的 daemon/单进程路径 command、exitCode、24 个条目及 summary 一致；Classic state current 的错误结果也一致。 |
| A2 | passed | brief.md | A2：第一次请求按需启动一个与项目、构建版本和权限上下文匹配的 Runtime；同一上下文的后续请求复用该进程，空闲退出后能重新启动，停止命令不会留下可继续接收请求的实例。 | daemon 协议测试覆盖按需服务、状态、静默连接超时和 stop；基准显示 cold 与 idle restart 启动新 PID，warm 样本复用同一 PID。 |
| A3 | passed | brief.md | A3：两个不同项目或 worktree 的并发只读请求不能共享 cwd、环境、当前 change、授权、锁、缓存或输出；写入请求不进入 daemon，继续由现有 mutation lock 和 state-version 检查保护。 | endpoint 绑定项目根、构建、权限和环境指纹；不同 COMET_TEST_ENV_BINDING 得到不同 PID/endpoint，协议测试拒绝环境不匹配请求，写入命令不在只读路由集合。 |
| A4 | passed | brief.md | A4：慢 Git、文件扫描或 Native 检查运行时，Hook 请求仍在有界时间内得到结果；慢任务失败、取消或超时不会阻塞后续 Hook，也不会留下无法恢复的锁。 | Hook 使用同进程异步有界 stdin，daemon 请求在独立进程中执行；定向 Hook/IPC 测试通过，正常输入实测约 510ms 返回，静默连接有界结束。 |
| A5 | passed | brief.md | A5：daemon 启动竞争、IPC 断开、协议错误、版本不匹配和进程崩溃均返回可解析诊断并回退到单次 CLI；不会无限重试或重复派发写操作。 | 构建版本不匹配、非法/静默 IPC 连接均返回可解析错误；客户端启动重试为固定有限序列，失败后保留单进程回退路径。 |
| A6 | passed | brief.md | A6：写入请求不进入首版 daemon；因此响应丢失仍由现有持久化状态、请求恢复和确认路径处理，客户端不会把 daemon 失败当成“未执行”并重放写入。 | daemon router 仅允许 Classic/Native 只读查询；next、确认、验证派发及其他写命令继续走现有单进程路径，未增加写重放。 |
| A7 | passed | brief.md | A7：Hook 输入读取不再为正常已关闭输入额外启动 Node 子进程；无输入、超时、超限和非法输入仍在有界时间内失败关闭，并保持平台输出协议。 | stdin reader 改为当前进程异步读取，保留 2 秒/1 MiB 边界；定向 stdin 与 Hook 测试通过，超限输入实测快速失败关闭。 |
| A8 | passed | brief.md | A8：首版 daemon 不自动合并或重排命令；现有 Skill 的确定性批处理继续由调用方显式组织，遇到状态变化、权限边界、检查失败或需要确认时仍按原命令边界停止。 | 路由器每次只转发一个明确命令，不合并或重排请求；Classic/Native 原始命令入口仍可独立执行。 |
| A9 | passed | brief.md | A9：合法成功 fixture 的冷启动、热调用和回退基准记录 Node/OS、构建身份、样本、进程数、Git/文件读取、median/p95 和内存；热调用不得重新创建 Runtime 进程，且报告不把失败快速退出算作收益。 | benchmark v2 自动创建并清理临时 Git/Native fixture，实测输出 Node/Windows、source/generated build identity、warmup/sample、PID/process starts、Git/fs、queue、median/p95、RSS/heap；warm PID 保持复用且成功 postcondition 已校验。 |
| A10 | passed | brief.md | A10：源码、Classic/Native/Entry 生成 Runtime、打包资产和测试保持一致；现有锁、指纹、恢复、授权、插件失败隔离和独立验收回归全部通过。 | pnpm check:generated、TypeScript、lint/architecture 及定向测试通过；Native fingerprint 测试 9/9 通过，managed artifact 只排除配置 artifact root 下 comet changes/archive 元数据，同名源文件仍改变指纹。 |
| A11 | passed | specs/node-runtime-performance/spec.md | Single CLI and daemon return the same result - **WHEN** a supported Classic or Native request is executed once through the existing single process path and once through the Node daemon path with the same project root, arguments, environment binding and request payload - **THEN** both paths MUST return the same JSON fields, exit code, error classification, state transition and continuation action - **AND** a daemon startup, handshake or protocol failure MUST return an actionable diagnostic and allow the caller to use the single process path | 同一 Native status 请求的 daemon/单进程 JSON 结果、退出码、条目和摘要已实测一致；daemon 不可用时路由函数返回 false 进入 fast/single runtime。 |
| A12 | passed | specs/node-runtime-performance/spec.md | Runtime starts once and exits when idle - **WHEN** the first request for a project, Runtime build identity and permission context arrives - **THEN** exactly one matching Node Runtime MUST be started and acknowledged through a bounded handshake - **AND** subsequent requests in that context MUST reuse the same Runtime process without creating another Node process - **AND** after the configured idle timeout the Runtime MUST exit cleanly and the next request MUST start a fresh matching process - **AND** an explicit stop operation MUST prevent new requests from reaching the stopped instance | 启动锁、协议握手、空闲计时、stop 和回启均有实现及测试/基准证据；warm PID 不变，idle restart PID 改变。 |
| A13 | passed | specs/node-runtime-performance/spec.md | Concurrent read-only projects remain isolated - **WHEN** requests for two different projects or linked worktrees execute concurrently - **THEN** each request MUST retain its own project root, cwd, environment, current change, authorization context and output - **AND** no request MAY read or write the other request's locks, transactions, state, cache entries or evidence - **AND** write, confirmation, and verification-dispatch requests MUST bypass the daemon and obey the existing mutation lock and state-version checks | 项目根、cwd、permissionContext、environmentFingerprint 和 endpoint key 均按请求/实例绑定；不同环境隔离实测通过，写入/确认/验证路径未进入 daemon。 |
| A14 | passed | specs/node-runtime-performance/spec.md | Hook stays responsive during a slow Runtime operation - **WHEN** a Native Git or file scan, verification preparation, or another bounded slow operation is running - **AND** a Hook request arrives for the same or another project - **THEN** the Hook request MUST complete within its configured bound or fail closed with a structured diagnostic - **AND** cancellation, timeout or failure of the slow operation MUST release its resources and MUST NOT block the next Hook request | Hook stdin 与 daemon 为独立进程，输入和连接都有界超时；定向 Hook、stdin、IPC 测试通过，失败连接不会保留可用请求。 |
| A15 | passed | specs/node-runtime-performance/spec.md | Broken daemon falls back without a retry loop - **WHEN** daemon startup races, the IPC endpoint disappears, the protocol version is incompatible, the request is malformed, or the daemon exits unexpectedly - **THEN** the client MUST stop retrying after the configured bounded attempts - **AND** it MUST return a structured diagnostic and run the compatible single process path when the request is safe to retry - **AND** it MUST preserve the existing failure-closed behavior when the request cannot be safely retried | 协议/构建错误返回结构化响应，客户端只做固定次数启动尝试并随后回退；无自动写操作重放。 |
| A16 | passed | specs/node-runtime-performance/spec.md | Write requests keep the existing at-most-once recovery boundary - **WHEN** a write, confirmation, or verification-dispatch request is submitted - **THEN** the client MUST bypass the read-only daemon and use the existing single-process Runtime path - **AND** a lost response MUST continue to use the existing request identity, persisted state, recovery, or confirmation path - **AND** daemon startup or IPC failure MUST NOT cause that write to be replayed automatically | 首版路由白名单排除了写入和验证派发，现有 mutation/state-version/recovery 代码路径未被 daemon 替换。 |
| A17 | passed | specs/node-runtime-performance/spec.md | Hook input does not create a normal-path child Node process - **WHEN** a supported Hook host sends a valid, closed input payload within the configured size and time limits - **THEN** the Hook MUST read it in the current process or through a reusable bounded reader without creating a per-request Node child process - **AND** a silent pipe, oversized payload, invalid JSON or timeout MUST finish within the configured bound and fail closed with the existing platform output contract | 正常 Hook 输入不再 spawn Node 子进程；有界 reader、非法/空/超限处理和平台输出契约的定向测试通过。 |
| A18 | passed | specs/node-runtime-performance/spec.md | Deterministic actions are not implicitly reordered - **WHEN** multiple commands are listed by a Skill or caller - **THEN** the daemon MUST NOT infer a batch, reorder commands, or combine requests across a state or authorization boundary - **AND** explicit deterministic batching remains the caller's responsibility and keeps the existing stop-and-recover behavior - **AND** each individual command path MUST remain available with equivalent results | daemon 协议没有批处理或排序字段，路由保持单命令边界；现有 Skill 显式组织流程的状态机未合并。 |
| A19 | passed | specs/node-runtime-performance/spec.md | Cold, warm, fallback and idle restart are measured on valid fixtures - **WHEN** the benchmark runs on an isolated temporary project with a successful postcondition - **THEN** it MUST record the Node and OS versions, source and generated build identity, sample and warmup counts, process starts, Git and filesystem work, queue time, median, observed p95 and memory - **AND** the warm path MUST show Runtime process reuse without counting fixture setup, cleanup, failed commands or invalid postconditions as performance wins - **AND** the report MUST keep external shell, Agent and model time separate from Runtime time | 临时 fixture benchmark 成功完成 cold/warm/fallback/idle restart 四类测量，记录构建身份、样本/预热、进程、Git/fs、queue、median/p95、内存，并将外层 setup/cleanup/sleep 时间排除。 |
| A20 | passed | specs/node-runtime-performance/spec.md | Generated and packaged entrypoints preserve existing safety contracts - **WHEN** the source Runtime, CLI entrypoints or IPC implementation changes - **THEN** the Classic, Native and Entry generated bundles MUST be rebuilt and checked for deterministic equality - **AND** existing input fingerprints, mutation locks, recovery boundaries, authorization checks, plugin failure isolation and independent verification MUST continue to pass - **AND** the package and installed Skill paths MUST expose the same supported command behavior | Classic/Native/Entry 生成资产确定性检查通过，TypeScript/lint/定向 runtime、stdin、daemon、fingerprint 测试通过；安全边界与独立 Verifier 流程未被移除。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| daemon protocol, Hook, and Native fingerprint regression tests | exec vitest run test/platform/process/comet-daemon.test.ts test/platform/process/stdin-read.test.ts test/domains/comet-entry/hook-router-entry.test.ts test/app/classic-command.test.ts test/app/native-command.test.ts test/domains/comet-native/native-check-input-fingerprint.test.ts | . | passed | 0 | 47041 ms |
| TypeScript typecheck | exec tsc --noEmit | . | passed | 0 | 9790 ms |
| repository lint and architecture | lint | . | passed | 0 | 13485 ms |
| generated Runtime determinism | check:generated | . | passed | 0 | 2486 ms |
| daemon cold warm fallback benchmark | benchmark:daemon | . | passed | 0 | 20892 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- focused runtime and fingerprint tests: passed — 6 个文件，53 个测试通过、1 个跳过，含环境绑定、IPC 静默连接超时和 Native artifact 输入边界
- TypeScript: passed — pnpm exec tsc --noEmit 通过
- lint and architecture: passed — pnpm lint 通过
- generated assets: passed — pnpm check:generated 通过
- daemon benchmark: passed — Node v22.20.0 / Windows win32-x64；默认创建隔离临时 Git/Native fixture，预热 1 次、3 次热样本 median 605.20ms，单进程回退 median 659.61ms；冷启动 1030.74ms，空闲重启 1028.00ms；报告含构建身份、PID、内存、Git/文件读取和请求边界时间
- 已知限制: 未运行全仓库测试，按用户要求仅执行与改动直接相关的定向测试；未运行真实平台 Hook、真实模型 Eval 或远端 CI。
- 已知限制: 首版 daemon 只复用只读 CLI；写入、确认和验证派发仍由现有单进程 Runtime 处理，未新增跨请求授权或验证结果缓存。
- 已知限制: 性能基准只代表当前 Windows/Node 22.20.0 与本地项目负载，不代表 Agent、模型或跨机器端到端时延。

## 阻塞项

_无。_

## 风险与跳过的工作

- 未运行全仓测试、远端 CI、真实平台 Hook 宿主或模型 Eval；结论仅覆盖当前候选和定向 Runtime 证据。
- pnpm lint 无错误但报告 native-portable-checks.ts 的 managedArtifactRoot 未使用警告，建议后续清理。
- benchmark 的 Git 计数来自共享 Runtime Git adapter，文件计数使用 Node resourceUsage；未宣称覆盖所有外部集成命令。
- 未进行跨两个真实 worktree 的长时间并发压力测试；隔离结论来自 endpoint/协议实现、单元测试和不同环境实测。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-09-20T11:40:48.540Z |
| 2 | 1 | 0 | recovery | — | Builder handoff Runtime checks failed: generated-runtime-check, daemon-benchmark | 2026-09-20T11:43:09.780Z |
| 2 | 2 | 0 | recovery | — | Native check input changed after the candidate was built; a new Builder candidate is required before checks can run again. | 2026-09-20T11:47:06.675Z |
| 2 | 3 | 0 | recovery | — | Native check input changed after the candidate was built; a new Builder candidate is required before checks can run again. | 2026-09-20T11:50:36.276Z |
| 2 | 4 | 0 | recovery | — | Native check input changed after the candidate was built; a new Builder candidate is required before checks can run again. | 2026-09-20T11:55:20.497Z |
| 2 | 5 | 0 | recovery | — | Native check input changed after the candidate was built; a new Builder candidate is required before checks can run again. | 2026-09-20T12:08:58.100Z |
| 2 | 6 | 1 | fail | A2, A3, A5, A9, A12, A13, A15, A19 | 独立验证完成。Native 只读结果等价和主要生成检查通过，但环境绑定、IPC 悬挂连接和 benchmark 合约存在具体缺口，故当前候选不能通过，需回到 Build 修复后重新验证。 | 2026-09-20T12:24:04.459Z |
| 2 | 7 | 0 | recovery | — | Native check input changed after the candidate was built; a new Builder candidate is required before checks can run again. | 2026-09-20T12:35:06.947Z |
| 2 | 8 | 1 | execution-error | — | 候选构建完成后又修正了 Native artifact 输入边界并重建了生成资产；旧候选已不再对应当前实现，原独立验收已终止，需按当前源码重新提交 Builder 候选。 | 2026-09-20T12:58:02.127Z |
| 2 | 8 | 1 | recovery | — | Native check input changed after the candidate was built; a new Builder candidate is required before checks can run again. | 2026-09-20T12:58:37.744Z |
| 2 | 9 | 1 | pass | — | 独立复核候选 982def90-37c7-4c7e-ac36-2595f32baf1c（iteration 9 / attempt 1）并确认 verifier-started 已登记。daemon 只读路由、环境/项目/权限隔离、生命周期与连接边界、同进程 Hook stdin、Native managed artifact fingerprint、临时 fixture benchmark 及生成资产检查均通过；没有发现阻断当前验收的缺陷。已明确未执行全仓、真实平台和远端验证范围。 | 2026-09-20T13:09:42.065Z |



## 结论

独立复核候选 982def90-37c7-4c7e-ac36-2595f32baf1c（iteration 9 / attempt 1）并确认 verifier-started 已登记。daemon 只读路由、环境/项目/权限隔离、生命周期与连接边界、同进程 Hook stdin、Native managed artifact fingerprint、临时 fixture benchmark 及生成资产检查均通过；没有发现阻断当前验收的缺陷。已明确未执行全仓、真实平台和远端验证范围。
