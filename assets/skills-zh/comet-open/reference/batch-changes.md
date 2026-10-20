# PRD 拆分与批量恢复

用户提供大型 PRD、路线图或完整产品方案，或澄清摘要显示包含多个独立功能、模块、用户操作流程或里程碑时，必须先评估是否需要拆分为多个 change，再创建 OpenSpec 产物。

拆分预检必须基于已澄清的信息，输出候选拆分清单。每个候选拆分项必须包含：

- 建议 change 名称
- 目标与范围边界
- 明确非目标
- 依赖关系或推荐执行顺序
- 对应的核心验收场景

满足任一条件时，应推荐拆分：

- PRD 包含多个可以独立设计、构建、验证和归档的功能
- 涉及多个模块或用户路径，且其中一部分可独立交付
- 存在明显分阶段里程碑
- 多个 delta spec 对应可分别验收与交付的独立目标；文档或任务数量本身不决定拆分
- 任一部分失败或延期不应阻塞其他部分进入后续阶段

如推荐拆分，必须按 `comet-classic/reference/decision-point.md` 的协议暂停并等待用户选择。

用户选择必须包含：

- 「创建多个 OpenSpec changes」— 按候选拆分逐个创建独立 change
- 「保持为一个 change」— 继续单 change 流程，并在 proposal/design/tasks 中记录不拆分原因
- 「调整拆分方案后继续」— 用户说明调整方向后，重新输出候选拆分清单并再次确认

每个被接受的拆分项都必须通过 `/comet-open` 创建独立 change，不得直接调用 `/opsx:new`。`/comet-open` 负责创建 OpenSpec 产物并初始化独立的 SDK Run，确保每个 change 都由 Comet 管理。

不得在用户完成 PRD 拆分选择前创建 proposal.md、design.md 或 tasks.md。若用户选择创建多个 change，当前 `/comet-open` 调用只负责完成拆分确认与调度，随后按用户确认的顺序分别进入每个拆分项的 `/comet-open`。

用户确认创建多个 changes 后，必须立即把确认结果保存到 `.comet/batches/<batch-id>.json`。`batch-id` 使用固定的 kebab-case 标识。文件至少记录 `version`、原始目标摘要、创建时间、按顺序排列的 change 名称，以及每项的目标、范围、非目标、验收场景和 `pending|open-complete|selected` 状态。每创建或完成一个拆分项，都要原子更新该文件。这份清单用于记录批量创建顺序和进度，不替代各 change 的 SDK Run。

批量拆分模式下，进入每个拆分项的 `/comet-open` 时，必须明确标注「已确认拆分项」，并传入该项的目标、范围、非目标和验收场景。已确认的拆分项默认跳过 PRD 拆分预检，除非该项本身仍明显包含多个独立功能。

批量拆分模式下，单个拆分项完成 open 阶段后，不得自动进入 `/comet-design`。拆分完成后，必须暂停，请用户选择从哪一个 change 开始。只将用户选中的 change 推进到 `/comet-design`；其他 change 保持未归档状态，稍后通过 `/comet-classic` 恢复。

**逐项检查批量创建结果（不得跳过）**：全部拆分项完成各自的 open 阶段后，对用户确认清单中的每个 `<name>` 逐个运行：

```bash
comet state check <name> design --json
```

该入口已检查 OpenSpec 的全部必需依赖、实际输出和 Comet 状态，不再额外重复查询 status。`isComplete` 仅用于诊断，非必需产物不会阻止流程继续。检查失败时，再查询 status，找出尚未生成的依赖，或处理已报告的路径错误、缺少必需能力等问题。

任一拆分项未通过检查时，不能宣告拆分完成，也不能询问用户开始哪个 change。应停止后续推进，从该 change 的第一个 `ready` 或 `blocked` 产物恢复 `/comet-open`。OpenSpec 检查通过、但 Comet state 检查失败时，先核对该 change 的 Runtime 归属、Run 和 phase，再重新执行整批检查；`compat` change 按原状态机恢复。

只有所有拆分项都通过入口检查后，才暂停，请用户选择从哪一个 change 开始。用户选择后，将批量清单中的该项标记为 `selected`，只推进该 change 进入 `/comet-design`；其他 change 保持未归档状态，稍后通过 `/comet-classic` 恢复。

中断后恢复时，先读取 `.comet/batches/<batch-id>.json`，再对清单中已创建且未归档的 changes 运行上述 CLI 检查。已完整通过的拆分项不得重复创建；未通过的拆分项，从 OpenSpec 返回的第一个 `ready` 产物继续。尚未创建的项，按已保存的清单继续创建。清单缺失或损坏时，停止并请用户重建或确认，不能从目录列表猜测原来这一批包含哪些 change。
