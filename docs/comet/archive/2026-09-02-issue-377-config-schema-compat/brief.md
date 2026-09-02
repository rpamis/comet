# 目标

修复 Comet init 和 update 在用户 Home 目录共享 `.comet/config.yaml` 时的 schema 作用域冲突。正常初始化和更新不得要求用户手改或删除配置文件。

# 范围

- 保留现有 `.comet/config.yaml` 路径。
- 全局初始化遇到旧的 `comet.project.v1` 或历史 legacy 配置时，自动迁移为 `comet.global.v1`，尽量保留合法的全局偏好。
- 从 Home 执行 update 时，不得把 global schema 当作 project schema 读取，也不得覆盖全局配置。
- 覆盖 workflow-contract 配置解析、init/update 路由及必要的 Native 生成运行时同步。

# 非目标

- 不更改全局配置路径。
- 不删除用户文件。
- 不改变 Classic workflow 语义。
- 不修改 CodeGraph 检测规则。

# 验收示例

- Scenario: Home 下已有 project schema 配置时执行 global init，命令成功完成并写出 global schema。
- Scenario: Home 下已有 global schema 配置时执行 update，不再报 Unsupported Comet project schema。
- Scenario: 新用户无配置执行 init，仍按现有默认行为成功。
- Scenario: 合法已有全局偏好在迁移后保留。

# 约束与不变量

- global schema 和 project schema 的作用域仍保持独立；只在明确的全局生命周期操作中执行兼容迁移。
- 配置写入保持原子性。
- 只提交当前 change 的实现、测试、生成物和用户可见 Changelog。

# 决策

- 采用保留路径、schema 感知迁移和 Home 目录 update 路由修复的最小兼容方案。
- 对用户可识别的旧 schema 自动修复；不通过静默删除文件掩盖配置问题。

# 待解决问题

# 验证预期

- 运行 workflow-contract、init 和 update 的最小相关回归测试。
- 涉及 Runtime 生成物时运行对应 build 和资产一致性检查。
- 最终按风险运行 lint、build、全量测试或记录真实基线阻塞。
