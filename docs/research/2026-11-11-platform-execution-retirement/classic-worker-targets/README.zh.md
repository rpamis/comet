# Classic 旧受管检查选择器收尾

来源：`report:2026-11-10-agent-platform-execution`。

用户已撤下普通工作流的受管检查运行器、进程监管、停止握手和自动重放。此处只为两个已有案例追加精确迁移节点，不改产品、测试、原登记字段或既有迁移链，也不宣称旧执行协议已修复。

两个失效名称确实存在于各自上一段 `testMigration.evidence.tests` 保存的完整文件中。每个案例的 `tests.json` 保存真实旧来源和摘要，`original/` 保存原文，`current/` 保存本次追加前的完整当前文件，`mapping.json` 保存旧函数正文及逐行为去向。没有将当前文件伪称为曾含失效名称的旧版本。

- `classic-ci539-interrupted-check-plan`：退休的是旧输入快照不完整时保留检查计划、提示 `check rerun` 并自动重新执行的协议。该原例尚未执行命令，不能把它描述成已证明真实进程停止。当前保留原 corrupted SDK claim/Action 拒绝及原 Run 不变，增加平台 argv 指引、不推断替代 build、实际失败报告不回退旧成功的精确目标。
- 历史 `issue-192-checks`：退休的是 `classic-check` 运行器的 start/completion Action、收据及 trajectory 记录。原 argv 目标保留；failed-build 与 archived-delivery-repair 两个目标对象完整不变。补充 source/bin/dist 平台指引、实际失败报告和原 claim 拒绝；不恢复旧执行器或伪造停止/成功。

一项来源差异已明确保留：`issue-192-checks` 上一段新增的 delivery-repair 目标不在其自身更早的 `evidence.tests` 中。该目标此次没有修改，因此保存当前原文作为追加前 endpoint 快照；`snapshotOrigins` 明确标注其来源，不把它归入上一段旧文件。

当前选择器实际执行 8 项通过，包括 source、`bin/comet.js`、`dist/app/cli/index.js` 与真实归档交付修复；另外 29 项未选中，没有新增 skip。每个 `requiredNames` 都核对过当前报告的真实 `fullName` 或 `title`，没有仅以脚本结构校验冒充测试存在。

每个案例各有完整四份证据：`registry.json`、`tests.json`、`mapping.json`、`tests.patch`。追加脚本默认 dry run，核对同 ID 原对象/尾链、冻结历史原对象、subset schema 与 evidence，并证明删除新节点后整个 catalog 恢复原样。只有根 Agent 执行 `--apply` 才写 registry；并发修改时拒绝覆盖。

未运行全量、build、Eval、真实平台 Hook 或安装发布。本次不包含产品或测试代码变更。
