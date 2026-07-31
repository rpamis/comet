# Classic Dashboard 双布局发现设计

## 目标

Classic Dashboard 不再依赖 `.comet/config.yaml` 或其
`classic.artifact_layout` 决定变更目录。它默认识别并合并项目中的
`openspec/` 与 `docs/openspec/` 两种布局。Native Dashboard 保持现有配置驱动
行为，不改变 Native 项目发现、路径或数据契约。

## 范围与非目标

本次只调整 Dashboard 的项目根发现和 Classic 数据采集。Classic 的写入命令、根目录
迁移、Guard 与 `classic.artifact_layout` 配置仍按现有契约运行；Dashboard 不以配置替代
这些命令的安全约束。

## 方案

### Dashboard 项目根

Dashboard 使用独立的只读项目根发现：从目标路径向上查找最近包含 `.git`、
`.comet/config.yaml`、`openspec/` 或 `docs/openspec/` 的目录。`.comet/config.yaml` 仅作为
Native 项目的现有边界标记，不读取 `classic.artifact_layout`；因此没有配置的既有 Classic
项目也能从项目根或任意子目录启动 Dashboard，同时保留 Native 项目的配置根发现行为。

### Classic 双布局采集

收集器固定检查以下两个候选根：

- `openspec/changes`（legacy）；
- `docs/openspec/changes`（docs）。

候选根缺失时视为空，不产生 `classicError`。存在的根分别收集活跃 change 与
`archive/` 下的归档 change，之后合并、排序并用于现有摘要、风险和前端列表。

当两个根同时存在时，Dashboard 展示二者的完整内容。每个 Classic change 的稳定 ID
包含其项目相对根路径和状态，例如 `openspec/changes/add-api` 与
`docs/openspec/changes/add-api`；同名 change 不会互相覆盖，列表中的相对路径继续说明
来源。

目录越界、符号链接或读取权限等安全检查仍使用受保护的项目路径 API。只有这类实际
读取失败才形成 `classicError`；一个根出错时应继续保留另一根的可读 change，并报告
诊断。前端在存在任何 Classic change 时把该诊断显示为非阻塞提示；仅当两个根都没有
可展示的 change 时才显示完整的 Classic 错误态。

### Native 隔离

`collectNativeDashboardProjection` 及 Native 的项目配置读取保持原样。有效的 Native-only
workflow 会跳过 Classic 采集；Classic 双布局扫描不能作为 Native 路径、workflow 或项目根的
后备来源。

## 备选方案

1. **直接扫描两个 Classic 根（采用）**：对旧项目无配置依赖，两个根都可见，语义与
   只读 Dashboard 一致。
2. 放宽 `classic.artifact_layout` 校验：仍需要配置并会在配置缺失时失败，不满足目标。
3. 固定优先某一个根：实现较少，但会隐藏另一根的变更，不满足合并展示的确认规则。

## 代码边界

- `app/commands/dashboard.ts` 或 Dashboard 专用领域模块：不读取 Classic 布局配置、但保留
  Native 配置边界的 Dashboard 项目根发现。
- `domains/dashboard/collector.ts`：Classic 候选根枚举、合并和有来源的稳定 ID；不再调用
  Classic 的配置布局断言。
- `domains/dashboard/web/src/main.jsx`：有 Classic 数据时以非阻塞提示展示单根读取诊断。
- `domains/dashboard/native-collector.ts`：不修改。
- `test/domains/dashboard/`：覆盖无配置、legacy、docs、双根同名、单根异常和 Native
  配置隔离；真实 CLI 测试覆盖从子目录启动。

## 验证

先建立无 `.comet/config.yaml` 的双根 fixture，并验证：

1. `collectDashboardSnapshot` 与构建后的 `bin/comet.js dashboard <fixture> --json` 都返回两个来源的 change；
2. 单根存在时正常、双根同名时 ID 不冲突、一个根读取失败时保留另一个根的数据并在页面显示非阻塞诊断；
3. Native 仍只通过项目配置识别其 Dashboard 数据，且 Native-only 项目从嵌套目录启动时根路径不丢失。

完成后运行受影响 Dashboard 测试、Dashboard 构建与必要的 CLI 回归。

## 发布

这是已有 Dashboard 发现行为的用户可见修复。实现完成后追加到现有 `0.4.0-beta.13` 的英文 Changelog 条目，不新增开发过程版本。
