# Supervisor 计划与兼容

## 功能需求

### Scenario: 新父级保存精简的 children.v2 计划

- **Given** 用户确认一个新的 Supervisor v2 拆分
- **When** Runtime 保存 `children.yaml`
- **Then** 文档 schema 为 `comet.native.children.v2`
- **And** 每个 Child 只包含 `name`、用户语言 `summary` 和 `depends_on`
- **And** 文档不包含 `covers`、`owns` 或位置型验收映射

### Scenario: Runtime 确定性校验 v2 结构

- **Given** Runtime 读取 `children.v2`
- **When** Child 名称重复或非法、依赖不存在、或依赖图成环
- **Then** Runtime 拒绝该计划并指出确定性的结构错误
- **And** Runtime 不通过解析 Markdown 标题推断语义 ownership

### Scenario: Shape 明确跨模块集成责任

- **Given** 目标跨越至少两个领域模块、Skill、CLI、Dashboard、Hook 或 workflow
- **When** Shape 准备确认实施拆分
- **Then** 至少一个现有 Child 的 `summary` 明确承担横向接入责任，或计划增加一个小型 integration Child
- **And** integration Child 只负责连接、fallback 和端到端验证，不吞并领域实现

### Scenario: Child 数量不由文档长度决定

- **Given** 父级有多个目标 Specs 和大量验收项
- **When** Shape 决定实施 Child
- **Then** Child 按可独立实现、验证和真实依赖拆分
- **And** Spec 数量、验收项数量或需求文字长度不强制与 Child 数量一致

### Scenario: 用户只确认一次父级 Shape

- **Given** Child 范围严格派生自已经澄清的父级目标
- **When** 用户确认父级 Shape
- **Then** Runtime 不要求用户为每个 Child 重复确认相同范围
- **And** 后续无真实产品决定的编排步骤可以自动推进

### Scenario: 父级失败可追加范围内修复 Child

- **Given** 既有 Child 已 integrated，父级 Verify 发现已确认范围内的失败
- **When** 协调者增加一个修复 Child
- **Then** 新 Child 只处理现有失败并声明必要依赖
- **And** Runtime 不改写既有 integrated Child 的名称、摘要、历史依赖或验证记录
- **And** 用户不需要重新确认未发生变化的产品范围

### Scenario: 新范围使父级返回 Shape

- **Given** 父级 Verify 后提出的修复需要新增用户可见范围或新的产品决定
- **When** 协调者尝试把它作为修复 Child 加入
- **Then** Runtime 不直接继续 Build
- **And** 父级返回 Shape 并等待用户确认更新后的合同

### Scenario: 已归档 v1 保持不可变

- **Given** 一个 Supervisor v1 已经归档
- **When** 新版本 Runtime 读取它
- **Then** Runtime 按 v1 兼容语义展示历史
- **And** 不把它重写为 v2，也不移动其分支、Archive 或历史状态

### Scenario: 已启动 Child 的 active v1 按旧语义完成

- **Given** active v1 已经创建、推进或归档至少一个 Child
- **When** 用户恢复父级
- **Then** Runtime 把它标记为 legacy 并继续 v1 生命周期
- **And** 不允许中途切换为 integration-first v2

### Scenario: 未启动 Child 的 active v1 只能经确认升级

- **Given** active v1 尚未启动任何 Child
- **When** 用户下一次恢复或继续该父级
- **Then** Skill 主动展示一次生命周期、integration workspace 和最终交付语义变化并取得明确确认
- **And** Runtime 在确认前不改写 `children.yaml`、分支或历史
- **And** 用户确认后升级为 v2，拒绝后继续使用 v1 且不再主动重复提示
- **And** 不为升级新增 CLI；用户之后明确请求时，只要仍满足条件仍可再次选择升级

### Scenario: 兼容读取保持至少一个 beta 周期

- **Given** 客户端或本地状态仍使用 `children.v1`、旧 Verifier response 或旧 status JSON
- **When** Supervisor v2 发布后的兼容期内读取这些数据
- **Then** Runtime 继续接受旧格式并保留其原语义
- **And** 发生字段语义变化的新 status 使用新的 schema 版本，不复用旧字段表达不同含义

### Scenario: 普通 Native 与 Classic 不进入 Supervisor v2

- **Given** Change 没有 `children.yaml`，或属于 Classic workflow
- **When** 新 Runtime 创建、恢复或推进它
- **Then** 普通 Native 与 Classic 继续使用各自现有状态机、Hook Router 和 Archive 语义
- **And** Supervisor v2 不成为跨 workflow 的隐式行为

## 非目标

- 命名验收场景、Markdown 机器职责规则或内容指纹迁移。
- 多层父子树、跨仓库 DAG、软依赖或多种依赖边。
