# Dashboard SQLite 索引 MVP

## 行为

Dashboard 为每个稳定仓库身份维护一个用户级 SQLite 缓存。数据库位于 Windows 的 `%LOCALAPPDATA%/Comet/dashboard/`、macOS 的 `~/Library/Caches/Comet/dashboard/` 或 Linux 的 `$XDG_CACHE_HOME/comet/dashboard/`，不进入项目、不加入 Git、不参与 Archive，也不跨设备同步。稳定身份不可用时使用规范化路径回退。

Git worktree、`.comet` 状态文件、children 文件、归档目录和验证报告是事实来源。SQLite 只保存 Native 查询摘要和 Supervisor 子 change 的轻量关系，不保存源代码、Markdown 正文、提示词、记忆正文或完整报告；数据库可以随时删除。

Native overview、列表和详情沿用现有 HTTP API。overview 和列表先从缓存读取，列表通过 SQLite 表执行状态、关键词、排序和分页；详情先定位缓存摘要，再按需读取 YAML、任务和 artifact 预览。旧缓存可以先返回并在后台刷新，没有可用缓存时执行轻量首次盘点；SQLite 不可用时回退现有 collector。

## 刷新模型

`DashboardIndexStore` 是 SQLite 的唯一读写入口，使用 Node 22 内置 `node:sqlite`、WAL 和短事务。`DashboardIndexReconciler` 负责按仓库键合并并发刷新、冷却重复刷新和 dirty 标记；本版的 dirty 标记由访问时定时兜底触发，主动命令/文件事件接线留给后续 change。

首次建立索引只复用一次 Git worktree 列表，并对 Supervisor 使用轻量子 change 摘要，避免 overview 深度扫描所有子 change。缓存损坏、版本不兼容、锁等待或事务失败不能修改事实来源；下一次访问重新盘点或使用现有全量 collector。

## 兼容与非目标

不新增用户初始化、迁移、清理或修复操作，不改变 Native、Classic、Supervisor 的状态语义，不实现全文搜索、远程数据库、完整 project/workspace/artifact 统一投影、命令完成事件、文件 watcher 和 Git 版本信号增量同步。后续 change 可以在本 store/reconciler 上补齐主动通知和更细粒度投影。
