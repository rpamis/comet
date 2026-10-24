# 发布前必须复查的核心故障

这份记录保存已复现的失败行为及必须维持的反例。它不是“永远不会再有缺陷”的承诺，也不能用一组单元测试的通过数替代当前候选的完整流程证据。

## 两层检查

1. `pnpm test:release-regressions` 执行无模型检查：构建、实际发布文件扫描、SDK API、发布元数据、核心历史回归以及 Eval 判定器自身的反例。它明确不提供模型 Eval 放行。
2. `pnpm release:verify --eval-report <release-gate.json>` 在上述检查之外核对完整 Eval 凭证。`npm publish` 的 `prepublishOnly` 使用同一入口，凭证路径也可由 `COMET_RELEASE_EVAL_REPORT` 提供。没有凭证、候选不符、场景缺项或检查失败都会阻止发布。该命令不自动调用付费模型，不会初始化或降低评分基线。

先按 Eval 文档准备锁定依赖与完整场景；首次没有有效基线时先收集完整实验、审核并显式建立基线，再复核同一实验，不必仅为迁移基线重跑模型。不能通过旧报告目录的修改时间选择候选，更不能在正常验证中自动接纳缺失维度。

常规 CI 增加 Linux、macOS、Windows 的 `core-regressions` 必过任务。模型 Eval 仍由明确的手动工作流运行，静态 CI 通过不代表真实模型 Eval 通过。是否已经在远端真实执行，需以对应候选的结果为准。

## 回归清单

### ENTRY-01：提交代码被误认为恢复流程

- 原始失败：存在唯一或选中的 active change，用户说“只提交现有代码，不要启动/继续 Comet 流程”或“提交另一个修改，不要处理当前 change”，仍返回高置信 `auto_resume`。
- 必须通过：明确否定、范围排除优先于恢复词；中英文、空格差异、selected/multiple/empty 均覆盖。单纯提交不能隐式授权新需求流程。
- 必须保留：明确要求恢复当前或命名 change 时仍可继续；归属不清时只询问最少必要信息；真正的交付校验不能被绕过。
- 回归：`resume-probe-intent.test.ts`。

### SHAPE-01：辅助记录导致整份需求重新确认

- 原始失败：批准后将测试计划中的“计划行号”补为实际行号，验收项不变，Builder 仍被阻止；旧兼容路径回 Shape。
- 必须通过：只有批准时已经明确划定的辅助字段允许增量更新；格式等价不应丢进度。真实要求、验收、表格断言或新增未知附录仍绑定原批准。
- 注释不能无条件忽略：可能包含 Agent 或工具指令，无法证明等价时应局部复核，不自动认可其语义。相同注释跨章节、列表项或行内位置移动也必须重新复核，不能只比较注释文本而丢掉作用范围。
- 旧状态只有摘要时，不能拿修改后的文本伪造原批准快照。
- 回归：`native-shape-incremental.test.ts`；保留 #504 的 Markdown 边界测试。

### SHAPE-02：Hook 回退分叉 SDK 状态

- 原始失败：SDK Verify 中写入 brief 注释后再编辑源码，Hook 调用兼容模式回退，只把投影改成 Shape；SDK Run 不变，后续读取报状态冲突。
- 必须通过：所有 SDK 写入由 SDK Run 管理；拒绝或局部复核不能越过权威状态修改投影。原 Action、claim 和批准身份必须保留。
- 回归：`native-shape-incremental.test.ts` 的实际 Hook 入口。

### NATIVE-01：其他 worktree 被当作坏的生成输入

- 原始失败：主仓库保留 `.worktrees/side` linked worktree，Git ignored 枚举返回目录，快照不完整，检查执行成功仍无法提交结果。
- 必须通过：物理扫描和 Git 枚举采用一致的输入边界；子工作区不能污染主仓库快照。
- 必须保留：Next 类型、生产输出和真实受检输入变化仍使证据失效；不能以忽略全部非普通文件代替完整性检查。
- 回归：`native-check-input-fingerprint.test.ts` 及 Supervisor 修订后普通 change 的公开流程。

### NATIVE-02：公布无法执行的复验命令

- 原始失败：一次性检查之后已通过的 Verify 确认界面仍给出 `retry-verifier`，执行必然失败，且没有可用后续提示。
- 必须通过：公布的能力与当前检查计划一致；旧 Supervisor 输出不能决定新普通 Builder 的复验能力。
- 必须保留：一次性检查不被重放；blocked 恢复可以保留仍有效候选与证据；过期批准继续拒绝。
- 回归：`native-sdk-blocked-recovery.test.ts`。

### CLASSIC-01：归档后夹带未经批准的内容

- 原始失败：Archive 执行完，再替换归档 proposal 或加入无关 Spec，提交后仍得到 `completed/local-verified`。
- 必须通过：将实际归档和规格同步产物的路径、字节与原 Action 绑定；不能允许整个归档/规格目录的任意后续内容。清单本身也必须防替换。原活动文件即使最终删除，也要逐提交核对原批准内容，不能先夹带未批准内容再删掉，以最终 HEAD 正确掩盖历史。
- 必须保留：合法归档注记、规格同步、实现和归档分拆提交、原收据中断恢复与便携恢复。旧证据不足时明确缺口，不批准当前未知内容。
- 回归：`classic-sdk-delivery-scope.test.ts` 的源码与独立生成 Runtime。

### CLASSIC-02：目录输入遗漏已删除文件

- 原始失败：`files: ['src']` 中删除已跟踪文件，Build/Verify 通过，交付却称删除路径未经批准；换成 `src/**` 才能成功。
- 必须通过：目录声明的后代语义在快照与删除所有权中一致，包括整个目录被删的情况。
- 必须保留：相邻目录、范围外文件和显式输出不被混入交付。
- 回归：`classic-sdk-delivery-inputs.test.ts` 及完整交付正例。

### EVAL-01：失败、旧报告或零分被判通过

- 原始失败：本轮 pytest 失败且没有新报告，却读取旧实验；报告有任务失败但 rubric 相对分没降；新维度缺少基线、得零分也被接受并保存。
- 必须通过：绑定本次实验、当前候选、明确场景和样本数量；失败、跳过、缺失、错误身份均硬失败。基线建立/迁移与正常验证分离。退出码、样本编号与计数必须是真正的 JSON 整数，不能因为 Python 中 `false == 0` / `true == 1` 而接受畸形证据。
- 被测对象必须是当前 Native/Classic，而不是仅运行冻结 039/040 对比 Skill。当前 SDK 与 bundled Runtime 场景要分别标识，不能混称全部 SDK 验证。
- 回归：`eval/local/tests/scaffold/test_regression_check.py`。这些是无模型的判定器反例，不冒充真实模型执行结果。

### CLASSIC-03：交付完成又改脏已提交状态（#237）

- 原始失败：提交并推送批准的归档后，`complete-delivery` 虽返回 completed，却改写已跟踪的 checkpoint，留下新的未提交状态。
- 必须通过：Git 中归档保留精确的交付前便携基线；后续交付状态存于权威 Run。仅允许经过校验的 delivery 后缀，不笼统豁免 archived/completed 状态。
- 覆盖 local/push 的 HEAD、远端 SHA、状态字节、工作区 clean、冷重开、失败重试及篡改拒绝。跨设备只恢复 pending 基线时，不能假报已交付；核对同一批准提交后继续原 Run。
- 不使用 assume-unchanged、忽略已跟踪文件或追加自动提交来掩盖问题。
- 回归：`classic-sdk-delivery-scope.test.ts`、`classic-sdk-delivery-checkpoint.test.ts`。

### HOOK-01：允许目录别名绕过保留根（#295）

- 原始失败：allow_paths 中的软链可以指向 Native/Classic 文档、Runtime 或 Git 保留根；悬空文件链接在 realpath 返回 ENOENT 后又被错误当作普通待创建路径。
- 同源反例：`link/../new.json` 或 raw cwd 的 `link/..` 经词法折叠后与真实文件系统逐段解析的结果不同，可能写入 Runtime。
- 必须通过：先检查真实路径归属，识别悬空目标、相对/绝对/多层链接；链接后再返回父级的歧义拒绝并要求规范物理路径。循环和过深链接失败关闭。
- 必须保留：普通缺失路径、没有软链的 `..`、明确的项目外用户规则目录仍按原约定处理；Runtime 即使在项目外也不能通过别名写入。
- 回归：`hook-allow-path-symlinks.test.ts`、`hook-target-scope.test.ts`，包含实际 `fs.writeFile` 对照而非只看提示。

## 既有问题必须继续覆盖

#500/#501 的跨会话证据、生产输入与完整性，#502 的项目超时/显式 ignored 输入，#503 的多 change/线性提交范围，#504 的 Markdown 章节边界，#505 的 blocked 后独立复验，均保留在 `scripts/lint/core-regressions.mjs`。新增修复不能删掉这些安全反例来获得通过。

每个发布候选记录实际运行结果、未运行项、环境和依赖差异。失败测试修正夹具时要解释真实场景为何不同；不能把过滤、超时、空报告或环境不可用算作通过。
