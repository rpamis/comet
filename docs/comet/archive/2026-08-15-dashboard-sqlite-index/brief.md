# Outcome

让 Dashboard 首次和后续访问都能快速展示 Native 工作流。SQLite 是隐藏在用户缓存目录中的可删除查询缓存；Git、`.comet` 状态文件和归档目录仍然是事实来源。

# 本 change 范围

- 使用 Node 22 内置 `node:sqlite`，按稳定仓库身份在用户缓存目录维护 SQLite 数据库。
- Native overview、Native 列表和 Native 详情先读取缓存摘要；详情正文仍按需读取事实文件。
- Native 列表的状态、关键词、排序和分页由 SQLite 索引表执行。
- 首次建立索引时只做一次 Git worktree 发现，并使用轻量 Supervisor 子 change 摘要；不在冷启动阶段执行完整子 change 语义盘点。
- 使用 WAL、短事务、单写者刷新合并；旧索引先返回并在后台刷新，缓存不可用时回退现有 collector。
- 优化 worktree 发现，避免为每个 worktree 重复调用 Git。
- 项目目录不生成索引文件，不增加用户维护操作，现有 HTTP API 和前端行为保持兼容。

# 不在本 change

- 命令完成事件、文件 watcher 和 Git 版本信号驱动的增量同步；本版提供 Reconciler 和定时兜底基础，主动通知另行接入。
- 完整 project/workspace/change/artifact 统一投影及诊断计数。
- 全文搜索、远程数据库、跨设备同步、用户可见的索引管理命令或页面。

# Acceptance examples

- A1：首次访问在用户缓存目录创建 per-repository SQLite，项目目录没有新增机器文件。
- A2：SQLite 保存 Native 查询所需的摘要，不保存源代码、Markdown 正文、提示词或完整验证报告。
- A3：SQLite 命中时 overview 不触发完整 Native index 重建。
- A4：Native 列表通过 SQLite 执行状态、关键词、排序和分页，详情按需读取事实文件。
- A5：首次 Native 索引建立使用轻量 worktree/子变更盘点，已有缓存的 overview 约百毫秒级返回。
- A6：并发请求共享一个刷新任务，SQLite 使用 WAL 和短事务。
- A7：已有旧索引时先返回旧摘要并后台刷新；无缓存或缓存损坏时自动重建或回退事实来源。
- A8：SQLite 打开、锁等待或事务失败不会修改项目事实来源，也不会阻断基础 Dashboard。
- A9：同一仓库的多个 worktree 使用同一缓存身份，change locator 不混淆。
- A10：Supervisor 父级列表保留子 change 的轻量依赖、状态和 locator 摘要；不在首次 overview 深度扫描所有子 change。
- A11：现有 overview、Native 列表、Native 详情 API 和 Dashboard 前端行为保持兼容。
- A12：索引数据库路径、表结构和维护操作不出现在用户界面或 API 响应。
- A13：DashboardIndexReconciler 合并并发刷新、支持 dirty 标记和定时兜底。
- A14：worktree 发现复用一次 Git worktree 列表，避免按 worktree 重复启动 Git 进程。
- A15：覆盖 SQLite store、Reconciler、Native collector、workspace discovery、Dashboard server 和构建检查。

# Verification expectations

- 运行 Dashboard index、Native collector、workspace、collector 和 server 相关测试。
- 运行 TypeScript、架构检查、受影响文件 Prettier、ESLint 和 Dashboard build。
- 记录冷建立、热 overview、热列表的实测耗时。
