# Native Skill 语言优化设计

## 目标

在不改变 Comet Native 工作流行为的前提下，全面优化中文 Skill 文案。新文案参考 Comet Classic 的专业、直接、面向 Agent 的语气，但不移植 Classic 的流程结构、外部 Skill 依赖或 OpenSpec 机制。

## 范围

本轮中文优化覆盖：

- `assets/skills-zh/comet-native/SKILL.md`
- `assets/skills-zh/comet-native/reference/commands.md`
- `assets/skills-zh/comet-native/reference/artifacts.md`
- `assets/skills-zh/comet-native/reference/recovery.md`

中文版本完成并经用户确认后，才同步英文版本并更新 Changelog。

## 行为守恒

以下机制必须保持不变：

- Native 仍是自包含的 Shape → Build → Verify → Archive 四阶段流程，不调用外部 Skill。
- 需求澄清仍区分用户决定与实现选择；存在用户决定时一次只问一个最上游问题。
- 调用方指定阶段停点时，只完成允许的 transition；成功后不再调用工具。
- 开始或恢复时仍以磁盘状态为准，读取 `status`、`show`、selection、brief、规格、仓库事实与测试。
- 多个 active change 的选择、`new`、`select` 和共享 `.comet/current-change.json` 规则保持不变。
- 没有用户决定或 Runtime 阻塞时，仍在同一个 Skill 内连续推进。
- Shape 的 brief、完整目标规格、blocking question、approval 与 `--confirmed` 语义保持不变。
- Build 的实现自主权、implementation scope、artifact、partial scope 与 checkpoint 规则保持不变。
- Verify 的 acceptance evidence、验证报告、内置 check、receipt、失败回 Build 与 repair stop 规则保持不变。
- Archive 的 dry-run、preflight hash、canonical 冲突处理与事务恢复规则保持不变。
- Runtime 管理字段、证据新鲜度、凭据保护和禁止手改状态的约束保持不变。

## 文案调整

允许的调整只有：

- 把长句和长段拆成可扫描的 Agent 指令。
- 使用明确的条件、动作和停止条件，减少抽象自我描述。
- 删除重复表达，但每项行为约束至少保留一个明确、可执行的表述。
- 统一术语、标题层级、命令格式和中英文标点。
- 参考 Classic 的专业语气，不复制 Classic 的阶段路由、确认点或子 Skill 机制。

不得通过改标题、合并段落或缩写规则改变 Agent 的决策顺序、默认动作、停止条件或失败处理。

## 未发布兼容叙事

Native 尚未发布，不在 Skill 中保留旧格式兼容历史。删除以下内容：

- v1/v2 → v3 的迁移说明。
- 旧 schema、旧 workspace identity、旧 baseline 的兼容路径。
- 面向尚不存在用户存量的升级建议和版本比较。

Runtime 当前实际使用的 schema 字面值可以保留在产物示例中；它们用于说明当前文件格式，不用于讲述版本演进。当前锁、事务、证据失效、root move 和 canonical 冲突仍是有效恢复机制，必须保留。

## 测试策略

先增加失败的仓库契约测试，再修改中文 Skill：

1. 固定上述核心机制必须出现的操作语义和命令入口。
2. 禁止中文 Native Skill 出现旧 schema 迁移和版本比较措辞。
3. 检查主 Skill 不再包含影响可读性的超长普通段落。
4. 检查四个中文文件仍被发布清单和 Skill 测试覆盖。
5. 运行相关 Skill、Native runtime、格式、lint 和生成物检查。

测试只验证可观察契约，不把具体句子快照锁死，避免妨碍后续正常润色。

## 非目标

- 不修改 Native Runtime、状态机、CLI、schema 或目录结构。
- 不改变 Native 与 Classic 的产品定位。
- 不把 Native 改造成 Classic 的五阶段或外部 Skill 编排流程。
- 中文确认前不修改英文 Skill。
- 不在中文与英文尚未同步时写 Changelog。
