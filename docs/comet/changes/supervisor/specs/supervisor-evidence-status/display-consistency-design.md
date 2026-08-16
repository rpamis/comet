# Supervisor 展示一致性设计

## 目标

让用户无需理解 Runtime、宿主身份或语义验证等内部术语，也能判断当前验证结果是否完整、是否需要确认、是否可以归档。

## 方案

- 保留 Portable State 和 status JSON 中现有机器枚举值，保证 Runtime、旧状态和 Dashboard 数据兼容。
- 只统一 verification report、Dashboard 和 CLI 帮助中的用户展示文案。
- 保证“验收通过”“等待用户确认”和“已归档”在展示上明确区分。

## 用户文案

| 内部值                              | 中文展示                           | 用户应理解的含义                                         |
| ----------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| `host-attested`                     | 已完成独立验证                     | 可信运行环境已经完成独立验证。                           |
| `skill-coordinated`                 | 已完成检查，但需要你确认验证结果   | 检查已完成，但系统无法确认验证者是否独立，需要用户确认。 |
| `semantic-verification-unavailable` | 无法完成完整验证，只完成了自动检查 | 没有可用的语义验证，只有 Runtime 自动检查结果。          |
| `user-confirmed-degraded`           | 你已确认接受不完整验证结果         | 用户已明确接受只有自动检查、缺少语义验证的结果。         |

英文展示同步表达同一语义，不改变内部枚举名称。

## 验收

- 报告和 Dashboard 对四个内部值使用同一组用户可读含义。
- `skill-coordinated` 在等待确认时明确显示“需要用户确认”。
- `semantic-verification-unavailable` 明确显示“只有自动检查”，不被误解为检查失败。
- 报告将“验收通过、等待确认”“验收通过、可归档”和“已归档”区分展示。
- 机器 JSON、Portable State、旧状态读取和生成物接口保持兼容。

## 非目标

- 不拆分或重命名 `assurance`、`identity_provider`、`coordination` 等机器字段。
- 不改变验证、归档、权限或 Runtime 状态转换逻辑。
- 不重设计 Dashboard 布局。
