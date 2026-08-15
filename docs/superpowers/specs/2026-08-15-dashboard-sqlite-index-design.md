# Dashboard SQLite 索引设计

## 目标

解决 Dashboard 首次加载和自动刷新反复扫描 Git worktree、Native change 和 Supervisor 子 change 导致的延迟。

Dashboard 使用 SQLite 保存本地索引，让 overview、变更列表和详情查询直接读取索引；Git、.comet 状态文件和归档目录仍然是唯一事实来源。SQLite 是可删除、可重建的缓存，不参与 Git 提交、Archive 或跨设备同步。

用户在项目目录中不需要看到索引文件，也不需要手动维护索引。

## 行业依据

- IDE 通常把索引和缓存放在用户缓存目录，而不是项目仓库中。
- 文件监听器只负责提供变化提示；索引服务负责增量更新，监听丢失时可以重新盘点。
- 查询接口读取已经生成的索引，只有索引过期或缺失时才执行较重的盘点。
- SQLite 适合本地单文件、无服务进程的结构化查询，但不应替代 Git 或 Comet 状态文件。

## 架构

```text
Git / .comet 状态文件 / 归档目录
                │
                ▼
       DashboardIndexReconciler
       （命令事件、文件提示、定时兜底）
                │
                ▼
       DashboardIndexStore（SQLite）
                │
                ▼
 overview / Native 列表 / Native 详情 / Supervisor 摘要
```

### 事实来源与索引分离

事实来源包括：

- Git worktree、分支和当前提交；
- .comet 项目配置和 change 状态；
- Native archive、children.yaml 和验证结果文件；
- Classic change 的可读状态和 artifact 指针。

SQLite 只保存 Dashboard 查询所需的摘要和来源版本，不保存完整 Markdown、源代码或验证报告正文。详情接口仍然按需从事实来源读取文件。

### SQLite 文件位置

索引放在用户级缓存目录，每个稳定仓库身份使用一个数据库：

- Windows：%LOCALAPPDATA%/Comet/dashboard/<repository-id>.sqlite
- macOS：~/Library/Caches/Comet/dashboard/<repository-id>.sqlite
- Linux：$XDG_CACHE_HOME/comet/dashboard/<repository-id>.sqlite

repository-id 使用现有稳定项目身份解析；同一仓库的多个 worktree 共用索引。无法得到稳定身份时，回退到规范化路径，并将该索引标记为不可迁移。

数据库目录由 Comet 自动创建，使用当前用户权限。项目目录不会出现 .sqlite、索引 JSON 或其他新的机器文件。

### 索引内容

索引只保存摘要，推荐包含以下逻辑数据：

- meta：索引版本、仓库身份、最近一次刷新状态和全局 generation；
- workspaces：worktree 路径、分支、当前提交、是否为当前 worktree、来源 generation；
- changes：change 名称、workspace、状态、阶段、归档名称、父 change、状态文件版本；
- supervisor_children：父子关系、依赖、子 change 状态、阶段和可读阻塞原因；
- artifacts：详情文件的类型、路径、大小和修改时间，不保存正文。

数据库表结构属于内部实现，不向 Dashboard 前端暴露。前端继续使用现有 API 形状。

## 刷新与失效

### 变更提示

刷新器可以接收三类提示：

1. Comet Native、Classic、Archive 命令完成后的主动通知；
2. .comet 状态、children 文件和归档目录的文件变化通知；
3. 定时检查，用于补偿文件监听不可用或丢事件的情况。

文件监听只表示“可能过期”，不直接决定最终状态。刷新器必须重新读取事实来源并提交新的索引快照。

### 不重新计算完整内容指纹

第一版不对所有文件重新计算内容 hash。使用已有且便宜的版本信号：

- Git HEAD；
- worktree 列表和分支变化；
- 状态文件、children.yaml 和归档目录的修改时间、大小；
- Native/Classic 状态中的 state version；
- SQLite 自身的递增 generation。

版本信号未变化时直接复用索引；变化时只刷新受影响的 workspace、change 或 Supervisor 父级。

### Supervisor 增量刷新

只有以下变化才重新计算父级子 change 摘要：

- 父级 children.yaml 变化；
- 子 change 状态或归档状态变化；
- 子 change 的依赖来源发生变化；
- 父级或子级绑定的 Git HEAD 变化。

普通 Dashboard 查询不执行全量子 change ancestry 检查。完整盘点保留给首次建立索引、索引恢复和显式诊断场景。

## 查询路径

### Overview

overview 只查询 SQLite 中的项目摘要和状态计数，不触发全量 Native index 构建。

### 变更列表

变更列表直接使用 SQLite 分页、过滤和排序。分页不再只是限制响应大小，同时也限制查询范围。

### 变更详情

详情先返回索引中的摘要，再按需读取任务、验证报告和 artifact 预览。大文件不会被 overview 或列表接口读取。

### 缓存未完成时

- 有旧索引：先返回旧索引，并在后台刷新；响应附带内部 freshness 状态，不显示数据库路径。
- 没有索引：执行一次有界的初始盘点，完成后写入 SQLite；页面只显示普通的“正在同步项目状态”。
- 索引损坏：关闭当前连接、将数据库移到用户缓存的恢复目录并自动重建；不修改项目文件。

## 并发与恢复

- 所有写入经过 DashboardIndexStore，不允许 Dashboard route 直接写 SQLite。
- 使用 SQLite WAL 和短事务，Git/文件盘点在事务外执行，完成后一次性提交新的摘要。
- 同一仓库同一时间只允许一个刷新任务；并发请求共享同一个 in-flight refresh。
- 读请求不等待无关 workspace 的刷新。
- 进程崩溃时依靠 SQLite 事务回滚；下次启动根据版本信号重新盘点过期部分。
- 数据库锁等待超时后，读取最近可用快照并排队重试，不阻塞基础 Dashboard 页面。

## 对现有代码的接入边界

新增一个领域服务 DashboardIndexStore，由 Dashboard collector 使用：

- collectDashboardOverview 查询轻量索引；
- collectNativeDashboardChangePage 查询分页索引；
- collectNativeDashboardChangeDetail 查询摘要后按需读取详情；
- DashboardIndexReconciler 负责刷新和失效，不由 HTTP server 自己实现扫描逻辑。

现有 API 路径和前端调用方式保持不变。第一次访问时可以回退到当前全量 collector 来建立数据库，建立完成后后续请求走 SQLite。

## 数据隐私与可见性

- 数据库只保存在用户本机缓存目录；
- 不保存源代码、Markdown 正文、提示词或记忆内容；
- 不加入 Git，不同步到远程仓库；
- Dashboard 不展示数据库文件、表名或维护命令；
- 用户删除缓存目录不会影响项目，下一次访问自动重建。

## 测试与可观测性

必须覆盖：

- 首次建立 SQLite 索引；
- 索引命中时 overview、列表和详情不触发全量盘点；
- 只修改一个 worktree 时只刷新该 worktree；
- Supervisor 子 change 变化只刷新对应父级；
- 并发请求只产生一个刷新任务；
- SQLite 损坏、锁等待和进程中断后的自动恢复；
- 删除数据库后能够从 Git 和 .comet 状态重建；
- 多个 worktree 共用正确的仓库索引；
- 33 个支持平台上的缓存目录解析和 SQLite 打开失败回退。

记录以下内部耗时指标：

- SQLite warm query 耗时；
- 单 workspace 增量刷新耗时；
- 全量重建耗时；
- 刷新原因和扫描条目数量；
- 索引命中率和数据库锁等待次数。

## 非目标

- 不引入 PostgreSQL、Redis 或远程 Dashboard 数据库；
- 不把 SQLite 作为 Git 或 Comet 状态的事实来源；
- 不把完整源代码、Markdown 或验证报告复制进数据库；
- 不在本设计中实现全文搜索索引；
- 不增加用户必须执行的初始化或清理命令；
- 不改变 Native、Classic、Supervisor 的状态语义。

## 分阶段实施

1. **索引接口**：抽出 DashboardIndexStore 和 DashboardIndexReconciler，保留当前全量扫描作为回退。
2. **SQLite 接入**：加入版本化 schema、WAL、单写者刷新和自动重建。
3. **Dashboard 查询迁移**：overview、列表、详情切换到索引查询；保留详情按需读取。
4. **增量刷新**：接入 Comet 命令提示、文件失效和定时兜底。
5. **性能验收**：验证冷启动、热启动、Supervisor 多子 change、多个 worktree 和数据库损坏恢复。
