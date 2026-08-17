# Dashboard、Worktree 与个人记忆性能优化设计

## 背景

Comet 自动创建的隔离 worktree 在成功合并后仍可能留在 Git 注册表中。Dashboard 会把所有注册 worktree 当成真实项目来源，导致内部验证 worktree、detached worktree 和已经失效的路径参与 Native 扫描，并把历史活动状态显示给用户。

同时，Dashboard 项目目录会为已经不存在的项目注册表条目执行 Git 身份解析；个人记忆页面首屏会读取状态、检索数据和未展示的管理数据，并在状态读取时触发记忆仓库同步检查。

## 目标

1. Comet 创建的隔离 worktree 在成功完成合并后自动清理，保留分支，失败时保留可恢复状态。
2. Dashboard 只发现有效的项目 worktree，跳过内部 runtime、非当前 detached worktree 和不存在的注册 worktree。
3. SQLite Native 索引只重建有效来源，并避免继续返回明显失效来源的缓存结果。
4. 失效项目注册表条目继续显示为不可用，但不再触发 Git 身份解析。
5. 个人记忆首屏只加载页面实际使用的数据，不在状态读取中执行远程同步。

## 非目标

- 不自动删除用户分支。
- 不自动修改或删除项目注册表文件；本次只优化读取和跳过策略。
- 不改变个人记忆的记录语义、语言规则、文件格式或检索排序。
- 不把 SQLite 变成事实来源；文件和 Git worktree 仍然是事实来源。

## 设计

### 1. Worktree 生命周期

归档流程在成功完成 merge 后，继续执行 post-merge worktree 清理。清理前确认目标 worktree 存在且变更 worktree 已提交；只调用 Git 的 `worktree remove`，不删除 change branch。清理成功返回 `cleanup.performed: true`，清理失败不会伪造成功，而是返回完成但带有可恢复原因，保留 worktree 供用户处理。

已有 push / pull-request 清理逻辑保持不变。当前进程位于变更 worktree 内时，不使用强制删除；返回明确原因，避免 Windows 文件锁或用户仍在该目录工作时破坏数据。

### 2. Dashboard workspace 来源

workspace discovery 对 Git worktree entry 做以下过滤：

- 当前请求对应的 worktree始终保留；
- 其他 worktree 必须存在且是目录；
- 其他 detached worktree 跳过；
- `.comet/runtime` 下的内部 worktree 跳过。

这样保留正常的 branch-backed change worktree，同时排除验证 sidecar 和 stale registration。过滤发生在所有 Classic/Native 发现之前，避免它们进入 SQLite 重建和文件扫描。

### 3. 项目目录与 Native SQLite

项目目录先并行判断目录可用性。可用项目继续使用 remote/common-dir 解析稳定 ID；失效项目使用路径哈希 ID，保留不可用列表但不启动 Git 子进程。

Native SQLite cache 保持缓存优先。缓存中如果包含来自内部或不可用 workspace 的候选，则不直接返回该缓存，触发一次事实来源重建；重建使用过滤后的 workspace 列表并替换 SQLite 索引。正常缓存仍在后台刷新，避免每次页面请求同步扫描。

### 4. Personal Memory 首屏

个人记忆 Dashboard 页面只读取 `status` 和当前项目的 `retrieve` 结果。`manage` 数据当前未被页面渲染，移出首屏加载。`status` 不再调用 `repository.sync()`；同步只由用户点击“同步记忆仓库”触发。

状态和 Markdown reconciliation 的既有一致性校验保持不变；本次不改变写入路径和用户操作。

## 错误处理

- worktree 清理失败不强制删除、不吞掉原因，结果保留恢复信息。
- Dashboard 单个 worktree 配置读取失败继续跳过该来源，不影响其他来源。
- SQLite 打开或刷新失败继续回退到文件事实来源。
- 失效项目仍返回 `availability: missing`，不影响当前项目选择。
- 个人记忆同步失败只在显式同步操作中展示，不阻塞首屏读取。

## 验证标准

- merge finish 的单元测试证明成功合并后清理变更 worktree，且不删除分支。
- workspace 测试证明 detached、内部 runtime 和不存在 worktree 被跳过，正常 branch worktree 保留。
- project directory 测试证明失效项目仍可见但使用非 Git fallback ID。
- Native collector 测试证明缓存来源失效时会重建并排除该来源。
- personal memory/plugin 测试证明 Dashboard page load 不调用 `manage` 和 `sync`。
- 运行受影响 domain 测试、格式检查、lint；涉及 runtime 生成物时同步构建并运行对应资产契约测试。
