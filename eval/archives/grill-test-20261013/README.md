# grill-test@3 历史实验

本归档随 Comet 主仓库提交。克隆后，从主项目启动当前版本的 `comet dashboard`，在 **Comet Any** 中搜索 `grill-test`：可查看原 Creator、根 Run 和四个子 Run 的步骤、审批、产物及报告。**评估 Eval** 中的 `archive-grill-test-20261013` 是同一次任务的专项复核，所有记录只读。

业务任务已完成，原始测试 4 项通过，含新增回归测试共 13 项通过。首次 900 秒超时后扩大预算续跑，并加入额外宿主指导；Creator 原流程跳过了模型 Eval。本次不能证明完整应用 Eval 通过或与 Native 的效率、稳定性同级。详见[专项复核报告](reports/summary.md)。

- `application/`：测试时冻结的 31 个应用与 Skill 文件，保持原始字节。
- `task/original/`、`task/final/`：原任务与最终实现；`task/artifacts/` 保存 Spec、Tickets、实施和验证记录。
- `runs/`：保留原 Run ID、revision、状态和业务输出。较大的 Creator 快照使用无损 gzip 压缩；SDK 领取凭据已脱敏，受影响的原始和脱敏结果摘要记在 `evidence/snapshot-redactions.json`。
- `evidence/`：首次超时、续跑、独立验收、三份 Native 原报告及文件来源摘要。
- `reports/`：结果、轨迹、干预审计和增强分析。原报告的绝对路径是历史来源，可移植入口见本归档的相对链接。

`archive.json` 声明原身份、相对文件引用和 SHA-256。Dashboard 不加载归档应用、不恢复原 Runtime，不提供重跑、基线写入或推进操作。修改被引用的文件会产生校验错误。新增归档也须显式登记其中的应用模块。

归档不包含 API 凭据、提供商配置、依赖缓存或临时修复工具；不进入 npm 发布包。原实验现场仍保留在原目录。

可从 `eval/` 的锁定 Python 环境重新检查业务实现：

```powershell
uv run python -B -m pytest archives/grill-test-20261013/task/final -q -p no:cacheprovider
```

这只是对最终业务代码的测试，不会重新启动模型 Eval 或推进历史 Run。
