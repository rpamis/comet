# 目标

缩短大型 Native change 在 Build、Review、Repair 和 Verify 之间反复推进的时间，减少重复状态正文和重复验收阅读，同时保持归档前的一次完整独立验收。

# 范围

- 默认 `native status` 和 `native next` 只返回当前推进所需的紧凑摘要；完整验收、历史、Builder 交接和验证详情通过有界详情页读取。
- Verifier 分派只携带当前验收范围、详情页读取命令、brief/Spec 引用和检查摘要，不再内联完整验收正文。
- Builder 每轮提交候选前必须完成一次新的只读代码审查，并在交接中提供通过结果、审查摘要和独立审查任务标识；未通过审查不能进入 Verify。
- 首轮 Verify 检查全部验收场景。修复轮只检查上一轮失败/阻塞项和 Builder 明确受影响的已通过项；修复范围全部通过后，再启动一个新的全量 Verifier，只有该轮通过才能进入 Archive。
- 新 Native change 只从 brief 的验收示例和目标 Spec 的显式 `Scenario:` 块生成验收项；普通说明、列表和表格不再各自变成验收项。
- 同步中英文 Native Skill、帮助文字、Runtime 生成资产、正式 Spec 和相关测试。

# 非目标

- 不新增根据文件内容生成身份或决定复用范围的机制。
- 不增加另一套复杂证明流程或新的命令族。
- 不新增 Native phase，不改变 Classic，不重设计 Dashboard。
- 不为未上线格式保留双写、别名或迁移分支。
- 不处理 Supervisor 自动拆分、自举 Runtime 固定或检查并行化；这些属于后续优化。

# 验收示例

- 默认查询一个包含大量验收和历史的 Native change 时，JSON 只包含阶段、状态版本、循环摘要、验收计数、未解决 ID、工作区摘要和下一动作；不包含完整验收文字、完整历史、Builder 交接正文或完整验证结果。
- 请求详情时，Runtime 返回固定大小的一页详情和下一页命令；连续翻页能够稳定读取全部验收及历史，不重复、不遗漏。
- Builder 没有提供通过的独立代码审查，或审查任务与 Builder 是同一个执行标识时，Runtime 拒绝候选；有效审查通过后才能进入 Verify。
- 修复轮只向新的 Verifier 提供上一轮未解决项与 Builder 标记受影响项；这些项通过后，Runtime 自动安排一次新的全量验收，最终全量通过后才允许归档。
- 目标 Spec 中一个 `Scenario:` 标题及其 Given/When/Then/And 正文形成一个验收项；Scenario 外的说明文字不增加验收项。
- 中英文 Skill 都要求先审查再提交候选、修复轮按影响范围复验、最终全量验收，并且默认不重复读取详细状态。

# 约束与不变量

- Runtime 仍保存完整、可恢复的 Native 状态；本次只减少默认输出和 Verifier 分派载荷。
- 验收 ID 继续使用 `A1..An` 顺序编号，不从内容生成。
- 已通过项只有在 Builder 明确标记受影响时才进入修复范围；上一轮失败和阻塞项始终自动进入修复范围。
- 修复范围通过不等于最终通过；Archive 前必须存在当前候选的一次全量独立 Verifier 结果。
- 必要检查失败仍阻止通过；Archive 不重新运行检查或 Verifier。

# 决策

- 四项优化修改同一套 Native 状态、Runner 输入和验收循环，使用单一 current-isolation change，在 `040rc1` 上完成。
- 使用现有 `addressed_acceptance_ids` 表示本轮修改可能影响的验收项；Runtime 自动并入上一轮未解决项。
- Builder 交接新增结构化 review 字段，保存 `passed`、简短摘要和 reviewer execution ref；Runtime 只做必要字段与角色分离检查。
- 详情使用带类型的固定大小分页项；默认 status/next 不携带详情页正文。
- 用户在上一轮明确列出的四项后回复“修复前4项”，已确认本 change 的目标、范围、关键决定、验收示例和非目标。

# 待解决问题

- 无。

# 验证预期

- 先运行覆盖状态投影、Runner 输入、Build/Verify Loop 和验收提取的最小 Vitest 测试。
- 运行 Native CLI/Portable Runtime/Skill 相关测试，验证紧凑输出、分页、审查门槛、增量修复和最终全量验收。
- 同步生成 Native Runtime 与命令 bundle，运行生成物一致性检查、TypeScript、lint、格式、build 和最终全量测试。
- 使用新的只读 Verifier 检查全部确认场景，归档后精确提交并推送 `040rc1`。
