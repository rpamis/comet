# native-archive-completion

## 目标

Native Archive 必须通过完整、单向的 continuation 和一致的预检完成工作区收尾。正常路径不要求 Agent 猜测缺失参数、重复读取状态或手工提交 Runtime 刚生成的 change 产物。

### Scenario: 隔离工作区先选择收尾方式

- **Given** change 已接受最终验收并进入 Archive-ready
- **And** workspace isolation 为 `branch` 或 `worktree`
- **And** 尚未持久化 finish 方式
- **When** Runtime 生成 continuation
- **Then** disposition 为等待用户选择工作区收尾方式
- **And** `keep`、`merge`、`push`、`pull-request` 各自提供包含 `--dry-run --finish <mode>` 的完整命令和实际影响
- **And** 不得返回缺少 finish 选择的 confirmed 命令

### Scenario: 当前工作区直接进入完整预检

- **Given** change 已进入 Archive-ready
- **And** workspace isolation 为 `current`
- **When** Runtime 生成 continuation
- **Then** 下一命令是该 change 的 `archive --dry-run`
- **And** 不要求 `--finish` 或工作区收尾选择

### Scenario: dry-run 与正式收尾检查一致

- **Given** Agent 按 continuation 执行 Archive dry-run
- **When** 工作区存在归档授权范围之外的未提交路径
- **Then** dry-run 返回 `ready: false` 和有边界的完整阻塞路径
- **And** continuation 保持阻塞并提供恢复方向
- **And** 结构化 workspace blocker 中包含完整路径清单，不截断或要求 Agent 解析错误文本
- **And** dry-run 不归档、不提交、不推送、不合并、不创建 PR，也不删除路径

### Scenario: change 产物由归档提交接管

- **Given** 未提交路径只属于当前 change、其 verification、状态、规格或 selection
- **When** Runtime 执行 workspace finish 预检
- **Then** 这些路径属于允许的归档范围，不要求 Agent 预先手工提交
- **And** confirmed Archive 将最终 change、归档目录与 canonical spec 变化统一纳入自动归档提交

### Scenario: ready 预览返回唯一执行命令

- **Given** Archive dry-run 已持久化必要的 finish 方式
- **And** 内容、验收、工作区与 Git 收尾检查均通过
- **When** Runtime 返回 preview continuation
- **Then** `ready` 为 true
- **And** 下一命令完整包含 change 名和 `--confirmed`
- **And** 再次执行时不要求重复 dry-run、finish 选择或 status 查询

### Scenario: dry-run 后的新漂移仍安全阻塞

- **Given** dry-run 曾经通过
- **And** confirmed 执行前工作区出现新的越界脏路径或目标工作区漂移
- **When** Runtime 重新执行正式安全检查
- **Then** Archive 不继续产生不可逆操作
- **And** 返回结构化阻塞原因、路径和恢复 continuation

### Scenario: 任务完成不依赖环境变量

- **Given** Native Skill 在任务开始时已保存原始用户请求和稳定 session
- **When** Archive 完成并记录任务结果
- **Then** Skill 直接复用已保存参数调用 `comet task --complete`
- **And** 不通过 `COMET_TASK` 或其他未声明环境变量猜测任务内容
