# Comet Dashboard

本目录包含 `comet dashboard` 本地仪表盘：后端采集当前仓库的
`openspec/changes`、Git 与验证状态，并支持管理项目设置、插件生命周期、个人记忆和
项目知识记录；前端是位于 `web/` 的 React + Tailwind CSS 应用。

## 启动

在仓库根目录运行：

```powershell
pnpm build
node .\bin\comet.js dashboard . --port 4399 --no-open
```

然后打开：

```text
http://localhost:4399/
```

停止服务：回到运行命令的终端按 `Ctrl+C`。

## Demo 模式

如果只是预览页面效果，不读取当前仓库真实数据，在 URL 后加 `?demo`：

```text
http://localhost:4399/?demo
```

Demo 数据来自 `web/demo.js`，适合检查首屏、侧边栏、卡片和响应式布局。

## 常用选项

```powershell
node .\bin\comet.js dashboard . --port 4399
node .\bin\comet.js dashboard . --port 4399 --no-open
node .\bin\comet.js dashboard . --json
```

- `--port 4399`：指定 HTTP 端口；如果端口被占用，Dashboard 会尝试后续端口。
- `--no-open`：只启动服务，不自动打开浏览器。
- `--json`：只输出一次 Dashboard snapshot，适合脚本检查，不启动浏览器服务。

## 产物分组

Dashboard 将关键产物按来源分为三组展示：

| 分组            | 产物                                                           | 说明                                                       |
| --------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| **OpenSpec**    | proposal, design, tasks, deltaSpec                             | 变更目录内的规格文件                                       |
| **Superpowers** | designDoc, plan, verifyReport                                  | 通过 `.comet.yaml` 路径指针引用的 `docs/superpowers/` 文件 |
| **Comet**       | .comet.yaml, handoff, checkpoint, brainstorm, subagentProgress | `.comet/` 中间产物                                         |

部分产物根据变更状态显示不同标记：

- **已生成**：文件存在，可预览
- **未生成**：预期产物但尚未创建
- **无需生成**：当前模式/阶段不适用（如 subagent-progress 在 `executing-plans` 模式下）

## 开发提示

Dashboard 后端是 `domains/dashboard/*.ts`，前端是 `web/` 下的 React 应用，通过 Vite 构建：

```powershell
pnpm build:dashboard
```

修改 `domains/dashboard/web/` 后，如果通过 `bin/comet.js` 启动，需要先运行
`pnpm build`，因为 CLI 入口读取的是 `dist/` 下的构建产物；完整构建会同时编译
后端 TypeScript、Classic runtime 与 React/Tailwind 前端。
