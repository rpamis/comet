# Issue #531：Windows 交付恢复与证据边界

来源：[Issue #531](https://github.com/rpamis/comet/issues/531)。报告版本为 0.5.1；本次比较基线为 `07bd301bb4c4bf65a21b2b47727c577816b7b970`，在 `052` 分支现有工作区实施。原有 Eval、Dashboard、版本与生成物改动保留，未修改 website 子模块。

## 结论与未解决部分

已分别复现并修复：预检结果拒收后的恢复死角、瞬时输入采样失败导致验收清空、旧 PID 的 EPERM 对账阻塞、交接逐字段报错、同一接受决定重复提交被当成 stale，以及测试副产物导致候选拒收。每项关联独立回归案例。

报告①“任意 Python 子进程均挂起”仍标记为**未复现，尚不能宣称解决**。本机通过 PowerShell、Git Bash 分别执行实际 venv Python 的 `print('ok')` 和 `import pathlib`：0.5.1 源码装配的执行器约 518–556 ms，当前构建约 522–788 ms，全部返回通过。不能由本机结果推断企业环境的 EDR、句柄继承或进程探测行为。已向报告者询问原环境是否仍可复现；后续需要原执行登记、检查日志、监管器收到的完成消息及停止收据，不需要凭据或未脱敏环境变量。

另已复现并修复一个挂起边界：系统确认整树终止后，继承管道仍没有 `close` 事件，旧执行器永久等待。新实现给管道收尾 1 秒期限，仍未关闭则记为 `interrupted` 并保存停止事实；日志不完整不能算通过。它是①的相关缺陷，不能直接视为原始症状的已证实根因。执行器继续采用调用方退出后停止原进程树的归属契约，没有引入无人监管的后台检查。

## 根因和修复

### 另一台电脑的现场摘要补充

2026-11-03 读取用户转交的桌面 `日志.txt`，原 change 为 `data-agent-plan-execute`。报告者确认问题仍在原企业电脑复现。该文件提供三次失败检查与后续空计划的摘要；完整 `iss-status.json`、`iss-doctor.json`、执行记录及检查日志仍在另一台机器，TXT 只列出了它们的位置，没有包含完整原件。

- `:7`、`:10`、`:13` 均中断、`terminationUnconfirmed=true`、`checks=[]`；`:16/:19/:26` 是空计划完成，不能算真实命令执行通过。
- 执行记录中的 `owner` 是检查调用方，`child` 登记的是检查监管器，并非实际 Python 子进程。因此不能仅由两个 PID 的事后死亡判断 Python 是否成功启动或退出，也不能把归档后的 quiescent 状态当成事故当时的停止证明。
- 六条记录缺少 owner 创建身份，但这一条件并不足以复现挂起：在隔离装配的 0.5.1 执行器中，仅强制 `readProcessIdentity` 返回 null，同一 venv Python 的 print/pathlib 在 PowerShell 和 Git Bash 下四次仍通过，约 540–908 ms。该对照不模拟企业安全软件的其他影响。
- 摘要未给出实际 `timeoutMs`、原 Action 的具体 reason 和检查日志内容，尚不能区分“命令超时后整树终止未确认”与“命令启动/完成通信没有返回”。不据此新增后台存续机制、放宽停止证明或修改产品超时。
- 下一步先核对原机器已有的完整 `/tmp/iss-status.json` 与 `/tmp/iss-doctor.json`，读取三次计划时限及原 Action 的错误；如历史错误已被后续人工处理覆盖，再读取 `:7/:10/:13` 的执行 JSON、停止旁证和对应 `logs/checks` 原始日志。继续调查不需要重跑模型 Eval 或整轮验收。

### 完整 JSON 核对与隔离诊断程序

随后收到完整 doctor/status JSON。`:7`、`:10`、`:13` 的原始 Action reason 均为 `检查进程树的停止尚未确认；保留原执行登记，不能验收或重试`，可对应到 `NativeCheckTerminationUnconfirmedError`。这是停止确认失败的明确证据；并不证明命令启动失败，也不证明 Python 超过了计划时限。三个 supervisor 登记均包含 instanceId 和 ownerPid，缺少可读的 OS 创建身份。

`status --details` 仍是公开状态投影，包含最终业务状态但不包含旧 Builder Action 的完整输入、检查计划、执行输出及逐事件时间。因此这两份 JSON 仍未提供三次真实 timeoutMs；不将它们描述为完整 SDK Run 存储副本。也没有以事故后的手工归档状态推断原归档正确完成。

已在仓库外构建独立 `comet-531-diagnostic.mjs`（SHA-256：`3efb2a14df73eb3b651b879cf3c38a50c6fda31396ab2487836a1db2d1cb5b50`），装配 tag 0.5.1 的检查执行器，在 supervisor 增加命令创建、spawn、exit 的观测消息；父进程记录 IPC ready/completed、监管器生命周期和 taskkill 耗时。程序仅执行固定的 Python `print('comet-531-ok')`，在系统临时目录保存诊断；不加载项目应用、不推进真实 Run、不收集环境变量值或领取令牌。命令与诊断整体分别设有 10 秒和 30 秒期限。

本机验证：PowerShell、Git Bash 及独立临时 cwd 的正常对照均完成；直接命令退出0、输出匹配，受管命令返回 passed。故障注入仅拒绝启动 taskkill，Python 已退出0且已收到 completed，仍复现与现场相同的 `NativeCheckTerminationUnconfirmedError`。这证明旧错误会丢失“命令已完成但收尾失败”的区分，不证明企业现场 taskkill 失败的具体原因。一轮将 SystemRoot 改为不存在路径的注入在 Node 启动期触发 CSPRNG 断言，未进入产品执行路径，已弃用该注入方法；未把它记为产品失败或通过。

该程序保留为可选现场复核工具，当前修复不以用户继续运行或采集为前提。原机器专属触发条件尚未直接验证；继续从现有代码的可复现缺陷推进，也不降低停止证明要求。

### 本机故障注入发现的执行器缺陷

依据现场已确认的停止异常，继续检查失败和启动路径，修复以下可独立复现的问题。它们与原报告的执行边界有关，但不能仅凭这些结果断言企业电脑的全部触发条件已被复现。

1. **taskkill 成功退出被误判失败**。旧代码只等 taskkill 的 close 事件；注入 exit 0 后 close 延迟、原监管器已退出时，旧代码在一秒兜底后返回 false。修复为同时消费真实 exit 结果并且只结算一次。非零退出、信号退出、仅组长死亡仍不能确认成功，未更改检查或 taskkill 时限。Node 22.19 官方区分[进程退出和句柄关闭事件](https://nodejs.org/download/release/v22.19.0/docs/api/child_process.html#event-close)，两者不应合并解释。
2. **已报告的监管器错误仍等待命令超时**。旧 error 监听只写日志，没有启动停止流程；模拟 IPC 错误且不发送 close 后，结果被标为 timedOut。身份探测未完成时，原始 IPC 错误还会被登记超时覆盖。修复为立即停止，取消尚未完成的登记，保留实际错误；成功停止才结束，不假定仅组长退出就足够。
3. **未消费 ready 握手**。平台已经提供 ready Promise，但 Native 和通用受管命令调用方在 ready 前即可放行 start。Native 现在将等待 ready 纳入原登记时限；登记取消后再次收到 ready 也不能启动命令。未创建第二套进程归属或后台任务。
4. **收尾错误丢失已完成命令的事实**。停止未确认异常新增可脱敏的诊断字段，并将计划时限、真实超时标志、是否已收到完成回报、命令退出码及监管器错误保存在错误消息中；底层终止异常保留为 cause。它们用于后续定位，不能把停止未确认转成检查通过。

上述新增选择在固定基线 `07bd301b` 下为 7 失败、2 安全反例通过（`coverage/issue531-process-baseline.json`）。修复后的四个进程相关文件共 47 项通过，随后补充迟到 ready 的安全反例通过；SDK 检查停止证据另 23 项通过，合计 71 项不同的定向进程/执行断言。三条 SDK 路径——生成归档命令、检查失败不派发 Verifier、Verifier 补充检查后提交结果——均通过（`coverage/issue531-process-sdk.json`）。新版构建经 PowerShell/Git Bash 运行实际 venv Python 的 print/pathlib 四次均通过，约 556–914 ms。

四项新增登记通过 core runner 精确执行，共 2 组、10 项通过，其中包含同文件原管道案例；结构与历史保留校验通过。`pnpm build`、TypeScript、SDK API、生成物新鲜度、受影响源文件 ESLint、Prettier、`git diff --check` 通过。完整 `pnpm lint` 的 ESLint 阶段无错误、有 8 项既有 Dashboard 警告；随后架构检查因新收到的 `.codex-remote-attachments` 顶层附件目录失败。本次保留附件，不删除、搬走附件或扩展产品架构白名单来取得通过；不宣称完整 lint 已通过。

本轮不再要求原机器继续运行诊断脚本。正常命令、异常停止及审批边界由本机隔离测试覆盖；未执行模型 Eval、真实平台 Hook、仓库全量或原企业环境复核，仍不能证明原电脑的全部触发条件都由这些缺陷造成。

| 行为                              | 根因                                                                      | 修复与禁止结果                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 预检输出被拒后 running 无出口     | 校验失败事实时又采样一次，要求输出完全一致；恢复只发现 unknown            | 保存 Runtime 失败事实；对原执行器已有拒收记录的只读 prepare，公开 `archive --recover` 核对原 Action。成功结果继续核对完整当前输入；不扩展 execute/finalize 的重放权限           |
| 采样瞬时不完整后验收归零          | 无法完整观察和已证实的候选变化共用 candidate-drift                        | 使用 candidate-unavailable 保存失败预检，保留原验收、报告和批准；输入稳定后重试。真实漂移仍阻塞                                                                                 |
| 无 identity 的旧 PID 永远 unknown | 人工停止证明仍强制要求裸 PID 探测 dead；已绑定停止收据也继续受旧 PID 影响 | 原 owner 已死、原领取和执行快照匹配、用户明确确认全部后代已停止、Windows 新鲜枚举证明旧 PID 不在时才收据对账。枚举失败、仍存在或 claim 错误均拒绝；不按年龄自动接管，不杀裸 PID |
| Builder 一次仅见一个字段错误      | 各字段解析遇首错即退出，执行计划只给笼统错误                              | 同次响应列出验收自查、检查结果、计划的独立字段错误和当前 A 编号；提示新 outcomeId，保留原领取。Verifier 错误明确 verifierExecutionRef 应取 claim.sessionId                      |
| 重复接受原结果报 stale            | 只查 pending Wait，忽略已接受的完全相同请求                               | 原 proposal、候选和报告均匹配时返回原继续入口，不写状态、不推进归档。其他候选或报告不能复用                                                                                     |
| dist/eval 测试留痕拒收            | 快照未区分已声明测试输出和应用生成输入                                    | Builder 交接前以检查计划 outputs 固定精确输出范围。已跟踪文件、未声明生成输入继续绑定，不能默认豁免整个 dist                                                                    |

## 测试产物声明

沿用仓库已有 `outputs` 名称，不新增 `.comet/config.yaml` 字段或预算。路径为项目相对路径，必须位于生成目录内部，禁止绝对路径、上行路径、Git/Comet 管理路径及 glob。示例：

```json
{
  "id": "e2e",
  "name": "Live E2E",
  "executable": ".venv/Scripts/python.exe",
  "argv": ["-m", "pytest"],
  "cwdRef": ".",
  "timeoutMs": 120000,
  "repeatable": true,
  "outputs": ["dist/eval"]
}
```

只排除上述范围内的未跟踪输出。若 `dist/eval/input.json` 已跟踪，它仍被读取；`dist/application.js` 等未声明输入也仍参与核对。只应声明纯输出，不能把检查实际读取的输入放进输出范围。声明绑定 Builder 原始快照和检查计划；不能在验收失败后通过扩大排除范围接受旧结果。已有候选须沿原实现修订流程建立新声明。

## 复现和验证记录

- 用 Vite 只读加载固定基线源码，对同一批新增测试做旧代码对照：8 个失败、2 个安全反例通过。失败覆盖管道等待、预检恢复、PID unknown、字段汇总、重复接受和输出声明；未修改或重置原工作区。
- Windows PID EPERM 通过精确进程探测模拟建立确定性回归；另外实际执行 Windows 系统枚举验证当前 PID 与不存在 PID。模拟不等于复现原企业机器中的受保护或隐形对象。
- 公开 Native CLI 在临时项目执行 Archive、恢复、Doctor 和交接；断言原候选、验收、报告、批准及领取归属保留，稳定后能完成归档。
- 当前交付定向测试 8 项通过（`coverage/issue531-delivery.json`）；其中输出声明归档及拒收预检恢复执行真实生成的 `comet-native-archive.mjs`。原进程执行器、停止边界及 Windows 身份/枚举共 29 项通过；新增输出路径安全校验 1 项通过；交接批量诊断和已跟踪输入保护另 2 项通过。以上共 40 项不同断言，未选用例的 skipped 只表示本轮筛选范围，不代表其验证通过。
- 补充相邻 Archive 边界共 14 项中 13 项通过、1 项失败：`rejects Archive document drift before overwriting the confirmed report` 在当前代码返回 `EXECUTION_UNKNOWN`；只读加载固定基线 `07bd301b` 后同一断言也以相同错误失败。没有改写或跳过原断言，保留为基线限制；本次不宣称相关正式文档漂移分支已经通过。
- `pnpm build`、三类 Runtime 构建、`pnpm check:generated`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm check:sdk-api`、受影响文件 Prettier 与 `git diff --check` 通过。Lint 有 8 个既有 Dashboard 警告，无错误。`pnpm check:badcase-registration --base 07bd301bb4c4bf65a21b2b47727c577816b7b970` 通过，原有来源与行为映射保留。
- `verify:changed --base 07bd301b --plan` 返回包含当前工作区其他 Eval/Dashboard 改动的 10 组检查计划，未执行该扩大范围的整组检查。已登记案例的 core runner 会按同文件合并历史用例：第一组管道用例通过后发现范围扩大，主动停止该轮，退出 1，不能宣称 core runner 整轮通过；改为精确测试名执行以上 40 项。本次没有修改运行器或缩减历史登记。
- 源码交接测试的可选任务上下文 worker 提示缺少 `.js` 文件并按既有降级路径继续；相关交接断言通过。这不构成上下文 worker 功能验证，本次未修改该相邻功能。
- 未启动真实模型 Eval：用户没有要求启动。未执行真实 Agent 平台 Hook、npm 安装包验收、仓库全量测试或正式发布；本次不以这些层级宣称通过，也未在 GitHub 评论、提 PR 或关闭 Issue。

## 回归映射

`config/workflow-regressions.json` 登记以下案例，各自保存来源、实际边界、预期与禁止结果：

- `native-531-check-pipe-settlement`
- `native-531-archive-preflight-recovery`
- `native-531-transient-snapshot-preserves-acceptance`
- `native-531-legacy-eperm-stop-recovery`
- `native-531-builder-batch-validation`
- `native-531-accepted-decision-idempotency`
- `native-531-declared-check-outputs`
- `native-531-taskkill-exit-confirmation`
- `native-531-supervisor-startup-errors`
- `native-531-supervisor-ready-handshake`
- `native-531-check-failure-facts`

当前 `origin/master` 经 fetch 核对为 0.5.3，本分支已有 0.5.4，故追加到同一英文 Changelog，不再升级版本号。上一个发布 tag 为 0.5.1；本次仅登记升级用户可感知的最终行为，不记录调试过程为新功能。
