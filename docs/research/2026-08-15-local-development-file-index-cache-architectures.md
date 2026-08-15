# 本地开发工具的文件索引与缓存架构调研

日期：2026-08-15

## 结论摘要

行业共识不是“文件索引应该使用 SQLite”，而是把本地文件与 Git 保持为事实源，再用可丢弃、可重建的投影加速读取。成熟实现通常同时具备四个机制：持久或内存投影、变化通知、按变化范围增量更新，以及通知失效后的全量校验。SQLite 只是投影的一种存储后端，并不是这套模型成立的前提。

本次检索到的官方材料中：Git 使用自定义 `.git/index`、untracked cache 和 fsmonitor 扩展；clangd 使用每文件一个 `*.idx` 的磁盘分片；IntelliJ Platform 公开的是持久 VFS 快照与二进制序列化索引；Watchman 维护常驻进程内的文件树索引，并用 clock 做增量查询。VS Code 确实有 SQLite 通用状态数据库，但其默认工作区搜索使用 ripgrep，不能把 `state.vscdb` 推断成文件内容索引。

对 Comet Dashboard，当前优先级应是先消除同一进程和相邻请求的重复扫描，建立明确的 `DashboardIndexStore`、`generation` 和 freshness 契约；之后再加入版本化持久投影、文件监听和全量 reconcile。只有在数据量、复杂查询或多进程读写证明 JSON 投影不够时，才需要把 store 的实现替换为 SQLite。

## 调研口径

- “SQLite”只在官方文档或源码明确出现时记为已确认；应用设置数据库不等于文件索引数据库。
- “本地持久化投影”指重启后仍可复用、且能够从事实源重建的数据；只在内存中的 Map 不计入。
- “增量索引”指按文件或变更集合更新已有投影；一次查询内部的流式读取不计入。
- “stale-while-revalidate（SWR）”只作为行为类比。下述工具的官方资料没有普遍采用这个术语，因此会明确区分“已证实行为”和“架构推断”。

## 行业实现对照

| 工具                            | SQLite                                | 本地持久化投影                                              | 文件监听                                  | 增量更新                           | SWR 或相近行为                     |
| ------------------------------- | ------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- | ---------------------------------- | ---------------------------------- |
| VS Code                         | 通用状态层使用；文件搜索层未证实      | 文件搜索未证实                                              | 是                                        | watcher 事件增量；搜索本身按需遍历 | 文件搜索未证实                     |
| IntelliJ Platform               | 核心 VFS/文件索引未见官方 SQLite 合同 | 是，VFS 快照和文件索引                                      | 是                                        | 是                                 | 是，snapshot-first + async refresh |
| clangd                          | 否，官方设计为 `*.idx` 分片           | 是                                                          | 引用的设计文档未确认 OS watcher           | 是，按文件重建/复用                | 是，动态层覆盖后台持久层           |
| Git                             | 否，使用自定义 index 格式             | 是                                                          | 可选 fsmonitor daemon                     | 是                                 | 否，`status` 通常在返回前校验      |
| Watchman                        | 未见官方证据                          | 文件树索引主要在常驻进程；statefile 只恢复 watches/triggers | 是                                        | 是，clock/`since`                  | 可显式查询可能落后的当前视图       |
| Sourcegraph Cody Local Indexing | 未见官方证据                          | 是                                                          | 官方称检测 workspace 变化，未公开底层机制 | 是                                 | 未证实                             |
| GitHub Desktop                  | repository state cache 是内存 Map     | 仓库状态缓存否                                              | 未找到仓库级 watcher 的官方源码证据       | 通过后台刷新替换 Map               | 最多是实现类比，不是公开合同       |

### 1. VS Code：监听与搜索、SQLite 状态库是三套边界

VS Code 官方的 [Search Issues](https://github.com/microsoft/vscode/wiki/Search-Issues) 说明，默认工作区搜索和 Quick Open 由 ripgrep 驱动；打开文件由编辑器搜索，其他文件由 ripgrep 搜索。ripgrep 的官方 [README](https://github.com/BurntSushi/ripgrep) 与 [Guide](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md) 描述的是递归遍历与并行搜索，而不是先查询持久文件索引。

VS Code 的 [File Watcher Internals](https://github.com/microsoft/vscode/wiki/File-Watcher-Internals) 则展示了另一条独立路径：递归和非递归 watcher 使用不同实现；相同监听请求会去重，重叠路径可以复用；已删除路径也有恢复或轮询策略。这说明监听层适合做事件合并和失效提示，但不能据此推断搜索结果来自持久索引。

VS Code 源码确有 [`SQLiteStorageDatabase`](https://github.com/microsoft/vscode/blob/main/src/vs/base/parts/storage/node/storage.ts)，并暴露 WAL、busy timeout 和键值 `ItemTable`。该类型实现的是通用 `IStorageDatabase`，不是搜索索引。因此最稳妥的结论是“VS Code 使用 SQLite 持久化应用/工作区状态”，而不是“VS Code 用 SQLite 索引工作区文件”。

### 2. IntelliJ Platform：持久快照优先，异步刷新纠偏

IntelliJ Platform 的 [Virtual File System](https://plugins.jetbrains.com/docs/intellij/virtual-file-system.html) 文档明确说明：VFS 维护已访问磁盘内容的持久快照，所有 VFS 读取先经过快照；快照异步与磁盘对齐，所以 UI 有时会短暂显示已经从磁盘删除的文件。Windows、macOS 和 Linux 上有 native file watcher；有 watcher 时 refresh 只检查已报告变化的路径，没有 watcher 时则遍历刷新范围内的全部文件。

其 [File-Based Indexes](https://plugins.jetbrains.com/docs/intellij/file-based-indexes.html) 使用 Map/Reduce 语义，并通过 `KeyDescriptor` 和 `DataExternalizer` 保存二进制序列化的 key/value；index version 变化会自动重建。官方还提醒 indexer 必须只依赖输入内容，否则外部依赖变化会留下 stale data。[Indexing and PSI Stubs](https://plugins.jetbrains.com/docs/intellij/indexing-and-psi-stubs.html) 进一步说明 Gists 可以按文件惰性计算并缓存到磁盘。

这套行为很接近 SWR：先从持久快照读，后台刷新后再发 VFS 事件。但 JetBrains 没有在这里使用 `stale-while-revalidate` 术语，所以更准确的名称是“snapshot-first + asynchronous refresh”。官方公开合同也不能支持“IntelliJ 的核心文件索引使用 SQLite”这一结论。

### 3. clangd：持久后台索引上叠加最新编辑层

clangd 的 [Indexing design](https://clangd.llvm.org/design/indexing) 把索引分层：`FileIndex` 保存正在编辑文件的动态信息，确保活跃文件的定义和引用不会陈旧；`BackgroundIndex` 在后台覆盖整个项目，并在索引前读取缓存的 `*.idx`，索引后再写回 `.cache/clangd/index/`，从而避免启动时重复处理没有变化的文件。

这是本次样本里最清楚的“旧的完整投影 + 新的局部覆盖层”：背景索引可以尚未完成，打开文件仍由动态层提供较新的结果。它证明持久化和增量化不需要 SQLite，也提示 Comet 可以先更新当前 worktree/当前 change，再在后台补齐其他 worktree 与归档。

### 4. Git：自定义持久 index，watcher 只缩小验证范围

[`git status`](https://git-scm.com/docs/git-status) 以 `.git/index` 为持久投影，并可利用 untracked cache 和 split index 降低大工作区扫描成本。Git 的 [`gitformat-index`](https://git-scm.com/docs/gitformat-index) 记录了 untracked cache 与 fsmonitor 等 index extension，而不是 SQLite 表。

内置 [`git fsmonitor--daemon`](https://git-scm.com/docs/git-fsmonitor--daemon) 使用平台文件系统通知维护“最近变化的文件和目录”列表；`git status` 可以向 daemon 询问变化，避免扫描整个磁盘。文档同时列出网络文件系统和 Linux inotify 数量等限制。这里的关键不是完全相信 watcher，而是让 watcher 缩小需要重新 stat/读取的候选集合；最终语义仍由 Git index 与工作区校验共同决定。

因此 Git 更适合作为“增量 revalidate”参考，而不是 SWR 参考：普通 `status` 不应为了更快而无标识地返回上一次结果。

### 5. Watchman：clock 驱动增量，fresh instance 触发重建语义

Watchman 的 [File Queries](https://facebook.github.io/watchman/docs/file-query) 说明服务维护被监控文件树的多个索引，`since` generator 只返回某个 clockspec 之后变化的文件。如果 clock 来自另一个 Watchman 进程或不再有效，响应会进入 `is_fresh_instance` 语义，客户端应把结果视为重新建立基线，而不是继续套用旧增量。

[`query`](https://facebook.github.io/watchman/docs/cmd/query) 默认通过 cookie 等待文件系统视图同步；只有显式设置 `sync_timeout: 0`，才允许在可能落后真实文件系统的当前 tree view 上查询。官方 [Troubleshooting](https://facebook.github.io/watchman/docs/troubleshooting) 还说明事件溢出会导致 recrawl。换言之，watcher 不是权威日志，可靠协议必须包含 clock、fresh-instance 和 full reconcile。

Watchman 的 [statefile](https://facebook.github.io/watchman/docs/cli-options) 用于恢复 watches/triggers；重启后旧 clock 仍会失效。这说明其可持久化配置不等于把 live 文件树索引完整持久化，也没有 SQLite 证据。

### 6. Sourcegraph Cody 与 GitHub Desktop：两个有用的边界样本

Sourcegraph 官方 [Cody Local Indexing](https://sourcegraph.com/docs/cody/core-concepts/local-indexing) 说明本地 keyword index 会在 workspace 打开后后台建立、检测文件变化后按需重建，并跨 VS Code 重启保存在扩展的 `globalStorage` 目录。这是“持久本地投影 + 后台增量更新”的直接产品案例；但文档没有说明 SQLite 或查询期间是否返回旧代际，因此不能补写为 SWR。

GitHub Desktop 的 [`RepositoryStateCache`](https://github.com/desktop/desktop/blob/development/app/src/lib/stores/repository-state-cache.ts) 是进程内 `Map<string, IRepositoryState>`：调用方能先读现有 repository state，刷新完成后替换 Map。它适合说明请求合并和内存投影的价值，但不是重启可复用的文件索引，也没有足够一手证据证明仓库级文件 watcher 或 SQLite index。

## 与 Comet Dashboard 当前实现的对照

当前 Dashboard 已经做了分页和按需详情读取，这是正确方向；但 overview 和分页请求仍会重复构建目录投影：

- `domains/dashboard/server.ts` 明确把 `/api/dashboard` 定义为每次请求 freshly collect；项目 overview、change page、detail 也各自调用 collector。
- `domains/dashboard/native-collector.ts` 的 `collectNativeDashboardChangePage()`、`collectNativeDashboardOverview()`、`collectNativeDashboardProjection()` 和 detail 路径都会调用 `buildNativeDashboardIndex()`。该函数重新发现 Native sources、选择 active/archive candidates，并重新读取 Supervisor children contract。
- `domains/dashboard/web/src/main.jsx` 使用 `cache: 'no-store'`，并每 30 秒自动刷新。浏览器缓存不会帮忙，多个 API 请求也没有共享一次后端扫描的 generation。
- `domains/dashboard/project-directory.ts` 读取持久 project registry，但它只解决“有哪些项目”，并不是 Dashboard change/worktree 的读模型。

所以当前主要瓶颈是重复发现、重复读取和重复聚合，而不是缺少关系型数据库。直接接入 SQLite、但仍在每次 API 请求前全量扫描，不会解决根因。

## 对 Comet Dashboard 的建议

### P0：先建立读模型边界，不引入数据库

1. 抽出 `DashboardIndexStore`，让 overview、列表和详情都通过同一个 project generation 读取。store 的第一版可以是进程内不可变快照。
2. 对同一项目的并发刷新做 single-flight 合并；刷新期间继续返回上一代快照，并带上 `freshness: fresh | refreshing | stale | degraded`、`generation` 和 `generatedAt`。
3. 把详情中的正式 Markdown、大型 verify 报告和 artifact preview 保持为按需读取。索引只保存列表/汇总所需的小型字段与定位信息。
4. 给一次全量构建和每个子步骤增加耗时/读取文件数指标。先用数据确认耗时来自 worktree discovery、Git status、Classic YAML、Native state 还是 Supervisor children。

这一步已经能消除一次页面刷新内 overview、page 和 detail 的重复扫描，并建立后续后端可替换的接口。

### P1：加入版本化持久投影与增量 reconcile

持久投影建议放在 `.comet/runtime/dashboard/`，保持它是可删除、可重建的机器状态。第一版可以使用原子替换的版本化 JSON；建议至少包含：

- schema version、Comet version、project/worktree stable identity；
- generation、最后成功全量 reconcile 时间和刷新状态；
- 每个来源的 token，例如规范化路径、`mtime/size`、Git HEAD/index 标识、Native state version；
- change/worktree 的摘要行，以及父 Supervisor 到 child 的反向依赖；
- ignore/config hash，确保扫描规则变化会使旧投影失效。

Watcher 事件只负责把路径标记为 dirty，并经过 debounce/coalescing 后局部更新：child 变化只重算对应 child、父 Supervisor 和相关计数；worktree 列表变化才重做 discovery；归档目录变化只更新受影响分区。以下情况必须退回全量 reconcile：watcher overflow、进程重启后没有可信 token、schema/config 变化、根路径身份变化、投影损坏或局部更新违反不变量。

持久写入应采用单写者和代际提交：先构建下一代，验证完整性后再原子发布；读者在此期间继续读取上一代。不要原地写一半的 JSON，也不要让 Dashboard cache 成为 Native/Classic Runtime 的事实源。

### P2：满足明确门槛后再切换 SQLite

在 `DashboardIndexStore` 后面保留后端替换能力。只有出现下列证据时才值得使用 SQLite：

- 项目/change 数量达到 JSON 全量反序列化和原子替换的实际瓶颈；
- 多个 Dashboard/CLI 进程需要并发读取，且单写者 JSON 协调成本明显；
- 产品需要跨项目、多字段过滤、排序、聚合或历史趋势查询；
- 增量更新单行/少量行显著优于重写整个投影。

即使采用 SQLite，也应把它定义为可重建 cache：一个 writer、短事务、schema migration/version、损坏后隔离并重建、busy/锁失败时回退直接扫描。第一阶段不要保存文件正文、构建全文搜索或复制整个 `.comet` Runtime；这会扩大隐私、磁盘、迁移和一致性成本，却不是当前 Dashboard 列表变慢的必要解法。

## 推荐的目标语义

```text
Git / Native / Classic files (事实源)
                 |
      command hint + watcher + periodic audit
                 |
       dirty set / token / full-reconcile fallback
                 |
       DashboardIndexStore (可重建投影)
                 |
   immutable generation + freshness metadata
                 |
       overview / page / detail APIs
```

推荐默认行为是：页面首次打开立即显示最后一次成功 generation；后台开始 bounded revalidation；刷新成功后原子切换；刷新失败则保留旧数据并明确显示 stale/degraded。对于用户刚执行的写命令，可以由命令直接提交精确的 dirty hint，避免等待 watcher；对于 Verify、Archive 等需要强一致结论的操作，仍直接读取事实源，不能依赖 Dashboard 投影。

## 最终判断

Comet 现在应该做的是“共享一次扫描结果、版本化投影、增量失效协议和可靠全扫兜底”，而不是“先选 SQLite”。这既符合 IntelliJ、clangd、Git 与 Watchman 的共同结构，也能最小化 Comet 跨平台运行、缓存损坏和 schema 迁移风险。SQLite 可以是未来 `DashboardIndexStore` 的成熟后端，但不应成为当前设计的起点或任何 workflow 状态的权威来源。
