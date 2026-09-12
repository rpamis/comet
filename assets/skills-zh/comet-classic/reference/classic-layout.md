# Classic 产物布局协议

进入已选 change 的阶段时，使用本轮 `comet state check <change-name> <phase> --json` 返回的 layout；无需再单独查询布局。尚未选择 change、入口未提供 layout，或只处理根目录迁移时，才在项目根运行：

```bash
comet classic root show
```

只接受 `schema: comet.classic-layout.v1`。把 layout 的 `openSpecRoot`、`changesRoot`、`archiveRoot`、`specsRoot`、`superpowersRoot` 分别作为 `<classic-open-spec-root>`、`<classic-changes-root>`、`<classic-archive-root>`、`<classic-specs-root>`、`<classic-superpowers-root>` 对应的实际目录。`<classic-change-dir>` 使用入口返回的 changeDir；只有尚未创建 change 时，才用 changesRoot 与 name 拼出路径。对于已归档的 change，不要使用未归档 change 的目录规则拼接路径。本轮路径以返回的 layout 为准；恢复会话时若缺少上下文，或工作区发生变化，应重新查询，不沿用旧目录信息。

## 命令规则

- 本 Skill 及其他 Comet 自有的 Classic Skill 调用官方 OpenSpec CLI 时，必须使用以下适配命令：

  ```bash
  comet classic openspec -- <args...>
  ```

- 适配器会在配置的 OpenSpec 根目录中运行官方 CLI，并原样返回 stdout、stderr 和退出码。不得为同一仓库另行注册或查询 OpenSpec store。
- 需要取得可以直接执行的下一条命令时，使用 `comet classic openspec --agent-json -- <args...>`。读取 `data.upstream.data` 中的 OpenSpec JSON，并保留 `data.upstream.cwd/stdout/stderr/exitCode` 用于排错。执行 `data.nextAction` 时，完整使用它提供的 argv 和 cwd。原始 nextSteps 假设命令在 OpenSpec 根目录中执行，不能直接搬到项目根运行。未使用 `--agent-json` 的普通调用仍原样返回 OpenSpec 输出。
- 只有用户明确要求在解析得到的 OpenSpec 根目录中直接使用官方 CLI 时，才可直接运行 `openspec`。

## 路径规则

- 绝对路径只用于文件读写。`data.artifactRefs` 提供相对仓库根目录的路径：`change`、`tasks`、`designDoc`、`plan`、`plansRoot`、`handoffContext`。将 `change` 作为 `<classic-change-ref>`，`tasks` 作为 `<classic-task-authority-ref>`；状态中的路径字段和计划的 `comet-task-authority` 必须使用这些相对路径，不传绝对路径 `<classic-change-dir>`。新 plan 的相对路径由 `plansRoot` 与文件名组成；读写文件时，再通过 `projectRoot` 解析出完整路径。自定义路径也必须以项目根为基准，不得包含 `..`、跨项目链接，或指向另一 change 的任务清单。
- change、tasks、delta spec、handoff 和 archive 等文件路径必须使用上方确定的 `<classic-*>` 逻辑路径；例如 tasks 使用 `<classic-change-dir>/tasks.md`。不要仅把固定目录改写成逻辑路径的名称，实际读写仍使用写死的目录。
- Superpowers 文件使用 `<classic-superpowers-root>/...`，不要从 OpenSpec root 或当前 cwd 推导。
- `comet state`、`comet guard`、`comet handoff`、`comet archive` 会自行解析布局；不得把物理 root 写入 `.comet/current-change.json`。
- 若 root show 或任一写命令报告 legacy/docs 两套根目录冲突、配置无效或迁移未完成，立即停止写入，运行只读的 `comet doctor` 检查。不要自行扫描两个根目录后猜测 change 归属，也不要向两处同时写入。

## 新旧项目与迁移

- 新 Classic 项目默认使用 `docs/openspec/`。
- 为兼容旧项目，缺少 `classic.artifact_layout` 时使用项目根下的 `openspec/`（legacy）；新项目 init 会明确写入 docs。`comet update` 检测到已有 `openspec/` 产物时，会把配置补为 `legacy`，不会移动产物。
- 普通 init/update 不移动旧产物。先运行 `comet classic root move docs --dry-run` 查看现状；用户确认后，再运行 `comet classic root move docs --apply` 迁移。Runtime 负责记录迁移标识，并在持有锁时再次检查迁移条件。
- 迁移会原样移动旧布局下的完整目录，包括 active、unmanaged 和尚未完成归档的 change；这些 change 的状态不会阻止根目录迁移。
