# Classic 根目录迁移与 Dashboard 修复设计

## 目标

简化 Classic 产物从 `openspec/` 迁移到 `docs/openspec/` 的用户流程，并修复
Dashboard 无法可靠显示 Classic change 的问题。

最终用户只需要根据目的执行以下命令：

```text
comet classic root show
comet classic root move docs --dry-run
comet classic root move docs --apply
```

`--dry-run` 用于查看现状，`--apply` 用于执行迁移。用户不再接触迁移计划 ID。

## CLI 交互

### `root show`

保持现有机器可读 JSON 输出，不改变命令用途。

### `root move docs --dry-run`

命令只读取当前状态，不写文件，并根据 Classic 项目配置的
`classic.language` 输出中文或英文。缺少该字段时沿用项目配置契约，默认使用
`zh-CN`。

未迁移时，报告包含：

- 当前布局、源目录和目标目录；
- 文件、目录和字节统计；
- 冲突、阻塞项和是否可以迁移；
- 明确说明没有修改任何文件；
- 可以迁移时，明确提示下一步运行
  `comet classic root move docs --apply`。

已经使用 `docs/openspec/` 时，命令成功退出并明确说明迁移已经完成，不再把该状态
作为异常。

### `root move docs --apply`

命令直接执行真实迁移，不要求计划 ID。

安全流程保持不变：

1. 在命令内部生成当前计划指纹；
2. 创建独占迁移锁；
3. 在锁内重新执行预检；
4. 对比锁前和锁内的目录、配置与清单身份；
5. 只有身份一致且无阻塞项时才执行复制、切换和配置更新。

用户输入 `--apply` 即代表本次迁移授权，计划指纹只作为内部并发与漂移保护。

旧语法 `--apply --plan <id>` 不兼容，并按非法用法返回退出码 64。帮助文本、错误
提示和 dry-run 输出中均不再出现 plan ID。

已经使用 `docs/openspec/` 时，`--apply` 安全成功退出并明确说明无需重复迁移。

## 本地化

迁移命令从结构化项目配置读取 `classic.language`：

- `zh-CN`：所有用户可见标题、字段标签、状态、提示和错误使用中文；
- `en`：所有用户可见内容使用英文；
- 未配置：使用项目配置契约的 Classic 默认值 `zh-CN`；
- 非法值：沿用项目配置解析错误，不猜测语言。

路径、哈希、命令和 schema 标识保持原样，不做翻译。底层领域错误在 CLI 边界按已知
错误类型映射为对应语言；未知异常保留原始错误，避免掩盖诊断信息。

## Dashboard

Dashboard 后端必须从结构化项目配置解析 Classic 布局，并只读取配置选中的
`openspec/changes` 或 `docs/openspec/changes`。启动路径先解析为项目根目录，避免从
仓库子目录启动时读取错误位置。

Classic 采集失败时：

- API 保留 `classicError` 诊断；
- Classic 页面显示具体错误与建议，不再把采集失败呈现为“当前无迭代”；
- Native 数据仍可独立显示，不因 Classic 错误中断整个 Dashboard。

构建后的真实 CLI 入口必须与 TypeScript 源码行为一致。回归验证需要通过
`bin/comet.js dashboard <fixture> --json` 覆盖 legacy 和 docs 两种布局，防止只测试
源码而遗漏过期 `dist/`。

## 代码边界

- `domains/comet-classic/classic-root-command.ts`：参数契约、本地化报告和幂等状态提示。
- `domains/comet-classic/classic-root-move.ts`：内部计划授权和锁内漂移校验，不承载文案。
- `domains/dashboard/collector.ts`：配置驱动的 Classic 目录采集。
- `domains/dashboard/web/src/main.jsx`：展示 `classicError`。
- `test/domains/comet-classic/`、`test/domains/dashboard/` 和 `test/app/`：分别覆盖领域、
  Dashboard 数据与真实 CLI 入口。

Classic runtime 源码修改后重新生成 `assets/skills/comet/scripts/comet-runtime.mjs`；
涉及真实 CLI 与 Dashboard 构建物，因此最终执行完整 build。

## 验证

先建立两个红色回归入口：

1. `--apply` 不带 plan ID 成功迁移，旧 `--plan` 语法失败，中文与英文配置分别输出
   对应语言；
2. 构建后的 Dashboard CLI 对 legacy 和 docs fixture 都返回 Classic change，并在
   Classic 采集错误时由前端展示诊断。

完成后运行最小相关测试、Classic runtime 生成物检查、Dashboard 构建和完整测试。

## 发布

这是用户可见的 CLI 与 Dashboard 修复。当前 `origin/master` 为
`0.4.0-beta.11`，实现完成后版本升级为 `0.4.0-beta.12`，并在同一版本的
`CHANGELOG.md` 条目中用英文描述最终用户可见行为。
