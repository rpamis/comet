# Classic 产物布局协议

每次进入或恢复任一 Classic 阶段，先在项目根运行：

```bash
comet classic root show
```

只接受 `schema: comet.classic-layout.v1`。把返回的 `openSpecRoot`、`changesRoot`、`archiveRoot`、`specsRoot`、`superpowersRoot` 分别绑定为 `<classic-open-spec-root>`、`<classic-changes-root>`、`<classic-archive-root>`、`<classic-specs-root>`、`<classic-superpowers-root>`，并把 `<classic-change-dir>` 定义为 `<classic-changes-root>/<name>`。这些逻辑根是本轮事实源；恢复或上下文压缩后必须重新解析。

## 命令规则

- 本 Skill 及其他 Comet-owned Classic Skill 调用官方 OpenSpec CLI 时，必须直接使用：

  ```bash
  comet classic openspec -- <args...>
  ```

- Adapter 会从配置的 OpenSpec base 运行官方 CLI，并透传 stdout、stderr 和退出码。不得为同仓库注册或查询 OpenSpec store。
- 只有用户在解析后的 OpenSpec base 中明确直接操作官方 CLI 时，才可直接运行 `openspec`。

## 路径规则

- change、tasks、delta spec、handoff 和 archive 等文件路径必须使用上方绑定的 `<classic-*>` 逻辑根；例如 tasks 使用 `<classic-change-dir>/tasks.md`。不得把某一种物理布局包装成逻辑路径继续指导文件读写。
- Superpowers 文件使用 `<classic-superpowers-root>/...`，不要从 OpenSpec root 或当前 cwd 推导。
- `comet state`、`comet guard`、`comet handoff`、`comet archive` 会自行解析布局；不得把物理 root 写入 `.comet/current-change.json`。
- 若 root show 或任一写命令报告 legacy/docs 双根冲突、无效配置或未完成迁移，立即停止。只读使用 `comet doctor` 检查；不要扫描两个根、猜测 change 归属或双写。

## 新旧项目与迁移

- 新 Classic 项目默认使用 `docs/openspec/`。
- 缺少 `classic.artifact_layout` 时默认使用 `docs/openspec/`；`comet update` 检测到已有根目录 `openspec/` 产物时会显式补为 `legacy`，不会移动产物。
- 普通 init/update 不移动旧产物。运行 `comet classic root move docs --dry-run` 只查看现状；用户确认后运行 `comet classic root move docs --apply` 直接迁移。迁移身份与锁内复检由 Runtime 内部管理。
- 迁移会原样移动完整的旧布局树，包括 active、unmanaged 和尚未完成归档的 change；change 状态本身不阻塞根目录迁移。
