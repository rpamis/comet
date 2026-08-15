# Outcome

修复 Dashboard SQLite 索引变更误提交到仓库根目录的用户可见快照，确保索引数据只保存在 Comet 的本机缓存目录。

# Scope

- 删除已提交的 `dashboard-installed-snapshot.json`。
- 将该文件名加入 Git 忽略，避免后续本地 Dashboard 产物再次进入项目 Git diff。
- 保持 `DashboardIndexStore` 的 SQLite 路径和 Dashboard 查询行为不变。

# Non-goals

- 不改变 SQLite 表结构、索引查询、刷新策略或 Dashboard UI。
- 不清理用户其他本地缓存、worktree 或 `.ruff_cache`。

# Acceptance examples

- `dashboard-installed-snapshot.json` 不再存在于仓库 HEAD，架构检查不再因该文件失败。
- SQLite 索引仍写入用户缓存目录，不在项目根目录创建索引或快照文件。
- Dashboard SQLite index 与 native collector 的相关测试继续通过。

# Constraints and invariants

- 只移除错误的根目录快照，不删除 `.comet/runtime` 或用户缓存中的数据库。
- 不改变 Dashboard 对外 API 和返回数据结构。

# Decisions

- 本修复选择删除并忽略错误的 JSON 快照；SQLite 数据库继续作为本机缓存，不进入项目仓库。

# Open questions

- 无。

# Verification expectations

- 运行 Dashboard index、native collector 相关测试。
- 运行架构检查；如本机存在其他既有顶层环境目录，需单独记录环境风险。
- 检查 SQLite 路径解析测试、TypeScript 和受影响文件格式。
