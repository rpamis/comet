# Classic 产物布局协议

进入已选 change 的阶段时，使用本轮 `comet state check <change-name> <phase> --json` 返回的 layout；无需再单独查询布局。尚未选择 change、入口未提供 layout，或只处理根目录迁移时，才在项目根运行：

```bash
comet classic root show
```

只接受 `schema: comet.classic-layout.v1`。把 layout 的 `openSpecRoot`、`changesRoot`、`archiveRoot`、`specsRoot`、`superpowersRoot` 分别绑定为 `<classic-open-spec-root>`、`<classic-changes-root>`、`<classic-archive-root>`、`<classic-specs-root>`、`<classic-superpowers-root>`；`<classic-change-dir>` 使用入口返回的实际 changeDir，尚未创建 change 时才由 changesRoot 与 name 构成。已归档 change 不拼接 active 路径。布局是本轮事实源；冷恢复或工作区变化后由入口重新解析，不沿用旧绑定。

## 命令规则

- 本 Skill 及其他 Comet-owned Classic Skill 调用官方 OpenSpec CLI 时，必须直接使用：

  ```bash
  comet classic openspec -- <args...>
  ```

- Adapter 会从配置的 OpenSpec base 运行官方 CLI，并透传 stdout、stderr 和退出码。不得为同仓库注册或查询 OpenSpec store。
- 需要可执行下一步时使用 `comet classic openspec --agent-json -- <args...>`。读取 `data.upstream.data` 中的上游 JSON，保留 `data.upstream.cwd/stdout/stderr/exitCode` 用于诊断；执行 `data.nextAction` 的完整 argv 和 cwd。原始 nextSteps 属于上游 base，不在项目根直接执行。普通 adapter 形式保留既有透传契约。
- 只有用户在解析后的 OpenSpec base 中明确直接操作官方 CLI 时，才可直接运行 `openspec`。

## 路径规则

- 绝对路径只用于文件读写。`data.artifactRefs` 提供仓库相对引用：`change`、`tasks`、`designDoc`、`plan`、`plansRoot`、`handoffContext`。将 `change` 绑定为 `<classic-change-ref>`，`tasks` 绑定为 `<classic-task-authority-ref>`；状态中的路径字段和计划的 `comet-task-authority` 必须使用这些引用，不传绝对的 `<classic-change-dir>`。新 plan 的引用由 `plansRoot` 与文件名组成；文件操作路径由 `projectRoot` 与引用解析。自定义路径也必须以项目根为基准，禁止 `..`、跨项目链接或另一 change 的 authority。
- change、tasks、delta spec、handoff 和 archive 等文件路径必须使用上方绑定的 `<classic-*>` 逻辑根；例如 tasks 使用 `<classic-change-dir>/tasks.md`。不得把某一种物理布局包装成逻辑路径继续指导文件读写。
- Superpowers 文件使用 `<classic-superpowers-root>/...`，不要从 OpenSpec root 或当前 cwd 推导。
- `comet state`、`comet guard`、`comet handoff`、`comet archive` 会自行解析布局；不得把物理 root 写入 `.comet/current-change.json`。
- 若 root show 或任一写命令报告 legacy/docs 双根冲突、无效配置或未完成迁移，立即停止。只读使用 `comet doctor` 检查；不要扫描两个根、猜测 change 归属或双写。

## 新旧项目与迁移

- 新 Classic 项目默认使用 `docs/openspec/`。
- 缺少 `classic.artifact_layout` 的兼容读取使用根目录 `openspec/`（legacy）；新项目 init 会明确写入 docs。`comet update` 检测到已有根目录 `openspec/` 产物时会显式补为 `legacy`，不会移动产物。
- 普通 init/update 不移动旧产物。运行 `comet classic root move docs --dry-run` 只查看现状；用户确认后运行 `comet classic root move docs --apply` 直接迁移。迁移身份与锁内复检由 Runtime 内部管理。
- 迁移会原样移动完整的旧布局树，包括 active、unmanaged 和尚未完成归档的 change；change 状态本身不阻塞根目录迁移。
