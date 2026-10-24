# 当前候选发布 Eval

发布检查默认运行当前候选，不再使用冻结的 `COMET_FULL_040_BETA`。历史 039/040 对比仍由 `local/scripts/compare_baselines.py` 提供，不能作为发布通过证据。

## 覆盖范围

`--suite current` 固定为 16 组，每组 1–5 个样本。每次运行必须完成全部组合，不接受 `-k`、任务筛选或只重跑失败样本代替完整矩阵。

当前 SDK CLI 核心发布矩阵共 5 组，直接使用当前已构建候选的 CLI 和完整 dist：

- Native workflow：Shape → Build → 失败 Verify → 修复 → 独立 Verify → Archive。
- Native SDK recovery：同一 candidate 的 blocked Verify → fresh session → 新独立 Verifier → Archive；检查原 Builder/check receipt 保留、不可重复检查只运行一次、Shape 测试计划行号更新不重开目标周期。要求跨 shell 保持 PATH/工作目录一致；离线 CLI 驱动另验证 TEMP/proxy 差异不使当前 v2 检查失效。模型侧在清除会话前由只读 harness 检查实际 blocked wait，并保存 candidate、原始 Action/outcome 与 Shape 摘要；最终必须绑定同一恢复 wait、保留原证据且出现新的 subject session。Agent stderr 不参与这些控制记录。独立 claim 属于协议证据，不声称能从 Run 反推出模型执行进程环境。
- Classic layout lifecycle：docs 和 legacy 两个布局各一组完整生命周期。
- Classic SDK recovery：同组必须完成 full、tweak、hotfix 的 Archive 和 delivery，并保留并存的 parked change；不能只完成其中一种路径。

11 组 portable v4 场景保留为 `legacy-supplemental`，仍是发布必过的补充历史覆盖，不计入 SDK 核心覆盖：clarification、clarification-depth、clarification-modes（Sequential、Batch）、repository-fact、interrupted-transition、wave-b decision/resume、wave-c verification、wave-d stagnation、wave-e parallel、wave-f dashboard。wave-f 同时验证当前 CLI Dashboard 投影，但仍不算 SDK 生命周期验收。

矩阵新增后必须重新收集并审核 baseline。任务、validator、执行上下文、完整候选的身份校验不变；静态测试生成的报告和协议 fixture 不能初始化真实发布 baseline。这个矩阵不代表所有历史 issue、模型和外部平台已覆盖，历史 badcase 另由确定性发布回归登记表强制执行。

`--plan` 输出精确 task/treatment/profile、覆盖层级、维度底线及样本矩阵，不调用模型。

## 环境与执行

从仓库根安装 Node 依赖并完成构建及生成物检查，然后在 `eval/` 中安装锁定 Python 依赖。凭据只通过环境变量配置。真实运行需要 Docker 和可用的模型账号，不会由无模型检查自动启动。完整运行（包括启动模型的 collect）会先通过本地 Node 执行生成物检查、build、SDK API 和核心 badcase 回归；任一步失败就不启动模型，也不会隐式安装包管理器。--plan、--experiment 和 --verify-receipt 均不构建。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:generated
pnpm build
pnpm check:sdk-api
cd eval
uv sync --locked
uv run --locked --no-sync --no-python-downloads python -m pytest -q local/tests/scaffold/test_regression_check.py
uv run --locked --no-sync --no-python-downloads python local/scripts/regression_check.py --plan --count 1
```

提供 `ANTHROPIC_AUTH_TOKEN`（或运行器支持的 `ANTHROPIC_API_KEY` / `BENCH_API_KEY`），按供应商配置 `ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`。可用 `--model` 明确选模型。`--workers` 允许 1–4，默认 2；每个任务保留自己的交互次数限制，不能用统一 8 轮截断所有任务。更多样本会增加模型预算。没有承诺整个运行能在固定时间内完成；超时仍然阻塞发布。

已有审核后的 `local/release_baseline.json` 时：

```bash
uv run --locked --no-sync --no-python-downloads python local/scripts/regression_check.py --suite current --count 1 --workers 2
```

第一次运行或矩阵/schema 升级时，旧的 `local/regression_baseline.json` 不能迁移成有效新基线。先运行、审核原始结果，再明确初始化新文件；这三步复用同一实验，不需要仅因缺基线而重新付费运行：

```bash
uv run --locked --no-sync --no-python-downloads python local/scripts/regression_check.py --collect-only --count 1 --workers 2
# 将下面的 release_<id> 换成上一条命令明确输出的实验 ID。
uv run --locked --no-sync --no-python-downloads python local/scripts/regression_check.py --experiment release_<id> --count 1 --initialize-baseline local/release_baseline.json
uv run --locked --no-sync --no-python-downloads python local/scripts/regression_check.py --experiment release_<id> --count 1 --baseline local/release_baseline.json
```

初始化不会覆盖已有文件，并且仍要求全部样本、全部硬检查、真实候选身份和绝对底线通过。需要调整基线时写一个新文件，审核后通过 `--baseline` 明确选择。普通验证永远不刷新基线，防止每次允许小幅回退导致长期滑落。`--collect-only` 和初始化成功只说明该步骤完成，不产生发布通过凭证。

先提交候选再运行真实 Eval。评估之后修改产品源码、资产、依赖锁文件、任务/验证器/harness 或 Git commit/tree，会使旧实验失效。初始化的基线本身不是产品内容，因此在同一 checkout 中审核并复核同一实验是支持的；若之后提交了基线或其他文件导致 HEAD 改变，需对最终候选重新评估。

## 通过标准与凭证

- pytest 必须退出 0；setup、teardown、跳过、缺少报告、重复报告、损坏 JSON 和 Agent 非零退出均阻塞。
- 每个样本必须有明确通过状态、空 `checks_failed`、实际任务检查，以及完整的当前 profile 维度。缺失、N/A、NaN、无穷值、越界值不能按 0 补齐或忽略。
- 任务完成、工作流完成、安全、交互/审批、协议检查、规格同步与恢复维度最低 1.0；效率最低 0.33（至少满足三项预算指标之一）。Classic 的启发式阶段产物分和 Skill 调用顺序分最低 0.8、产物深度分最低 0.75；实际失败的任务检查与缺失的必要 Skill 仍然硬失败，不能用这些阈值放行。任务完成、工作流完成、交互、隔离和安全失败不能靠平均值掩盖。比较按 task/treatment 分组进行，均值相对审核基线最多允许 0.10 回退，且不能突破绝对底线。
- 固定候选同时绑定 Git revision/tree、完整源码/资产/bin/dist 内容摘要、构建/安装/发布脚本、依赖锁文件、Eval harness、完整矩阵与重复次数。CLI 场景直接使用预先构建的完整 dist，记录实际快照摘要并与当前发布树逐字节摘要匹配，不用另外临时编译的 CLI 替代；Native bundled 场景绑定当前 Skill 内容，但不伪装为 CLI 验收。
- flagged/excluded 的环境噪声也会阻塞发布，不筛掉低分样本后再宣称通过。失败归因仍保留在原报告中供排查。

正常验证通过后，在实验目录写入 `release-gate.json`，schema 为 `comet.eval.release-receipt.v1`。它包含候选、矩阵/样本数、每例任务/执行环境摘要、检查数量、完整维度及当次基线快照。复核会重新读取完整原始报告，不只信任 JSON 中的 `verdict`：

```bash
uv run --locked --no-sync --no-python-downloads python local/scripts/regression_check.py --verify-receipt local/logs/experiments/release_<id>/release-gate.json
```

必须保留整个实验目录，不能只复制凭证 JSON。正式发布脚本通过 `--eval-report` 或 `COMET_RELEASE_EVAL_REPORT` 指向这个文件；无模型 badcase 通过不等于真实模型通过。

## GitHub 手动工作流

`eval-regression` 的输入为 `mode=validate|collect`、`count=1|2|3`、`workers=1|2|4`。默认 validate；首次无新基线时显式选择 collect。工作流不自动初始化或更新 baseline，不在 push/PR 上消耗模型预算。完整实验作为带候选 SHA 的 artifact 上传。下载整个 artifact、恢复相同候选与依赖后，可以在本地复核/初始化，不需要重复调用模型。

## 已固定的 badcase

`local/tests/scaffold/test_regression_check.py` 使用合成报告与模拟进程，覆盖以下已复现问题及相邻失效情况：

1. 默认运行冻结 040 而非当前 Native/Classic。
2. pytest 退出 2 后从 mtime 选择旧实验，并让旧失败报告通过。
3. `checks_failed` 非空、业务/归档未完成仍被 rubric 均值放行。
4. 缺基线、旧 `completion` schema、缺少新维度或零分被自动接受并保存。
5. 成功验证自动刷新较差 baseline，逐步降低发布标准。
6. 当前工作区未提交内容变化，或 CLI 快照/用例/执行身份不匹配。
7. 样本缺失、重复、跳过、环境标记、损坏/非有限 rubric、伪造通过状态，以及凭证后的报告变化。

这些是静态 harness 回归，不替代 Docker、真实 Agent、完整当前候选 Eval，也不证明所有模型/平台均已通过。

## 新场景的无模型验证

新增 `test_native_sdk_recovery.py`、`test_classic_sdk_recovery.py` 是本地脚本化协议验收：用当前构建的 `bin/comet.js` 子进程推进实际 SDK Run，并让 task validator 检查真实 owner、checkpoint、Archive 与恢复结果。负控覆盖省略恢复、错误独立会话、丢失交付及篡改 checkpoint 等。测试中的用户决定和 host outcome 明确是离线模拟，不是模型行为或真实用户审批证据。

Classic 离线测试若以本地替身执行 OpenSpec archive 的目录移动，会明确保留此边界；真实 Docker 任务仍运行已支持的 OpenSpec 依赖。离线 CLI 验收、Docker 场景和真实模型 Eval 必须分别报告；新增 task 或离线通过均不能宣称该组真实模型通过。
