# 仓库闲置代码与构建重复清理

日期：2026-11-15。工作分支：`054`。本任务比较基线：`a699272f9a7c2dad5e2b5bab2ca1d3c20999f5c7`。

## 完成范围

先扫描 `app/`、`domains/`、`platform/`、`plugin/` 的静态依赖，再核对脚本、测试、公开 SDK 入口和回归登记。没有根据文件体积删除模块，也没有撤下 Native、Classic、Creator 或 SDK 能力。

### 删除闲置实现

- 删除没有源码、脚本或测试调用方的 `classic-formal-source-evidence.ts`、`classic-document-language.ts`、`classic-handoff-source.ts` 和 `domains/eval/repository-benchmarks.ts`。
- 删除只被旧 handoff 摘要算法使用的 `classicTaskRequirements`，以及没有调用方的 `splitNeutralDocumentChanges`。保留当前任务解析、稳定 ID、完成操作和 Hook 文档路径判定。
- 删除旧摘要算法专用的 LF／CRLF 两个测试实例。保留任务完成幂等性、ID 和正文保持不变的断言，以及全部已登记的任务权威回归选择器。
- 删除 Dashboard 未使用的 `PhaseStepper`、产物／状态常量、个人资料判断函数、未使用的消息订阅和预览参数；清理 DSH 提示组件的无用参数。演示索引仍明确排除完整节点列表。

没有删除 `readGitBlobs`、`readGitStatusObservationAsync` 等目前主要由测试使用的辅助实现：它们仍承载登记的历史行为，不能仅凭生产调用数为零移除原断言。本任务没有迁移或退休这些案例。

### 合并 Runtime 构建实现

Classic、Native、Entry 三个原有构建命令调用 `scripts/lib/runtime-bundle-build.mjs`，集中维护 esbuild 配置、逐命令输出、新鲜度比较和写入重试。

保留各命令自包含 bundle、Native 的 Classic schema 排除插件，以及 Hook Router 按需加载 Guard 的行为。原三套构建脚本在当前源码上对新产物执行 `--check`，全部通过，说明抽取前后的生成内容逐字节一致。

扩展现有构建位置测试，检查多个输出、普通路径与 `node_modules` 内路径，以及 `--check` 遇到陈旧／缺失产物时返回失败且不修写文件。`verify:changed` 也识别共享构建实现和 schema 插件的修改。

### CI 每种操作系统构建一次

新增三平台构建矩阵。Linux 使用最低支持版本 Node 22.16.0 构建，macOS／Windows 使用 Node 24；现有 Node 22 和 Node 24 测试执行版本保持不变。

同一次 workflow 的测试 job 下载对应操作系统的完整 `dist/`，不再按分片重新编译。保留构建前的新鲜度检查、构建后的确定性检查、SDK API 检查、覆盖率、历史 badcase、Runtime、安装包、Python 和浏览器测试，以及各组失败报告。

按当前矩阵展开计算，完整构建从 24 次降至 3 次，另外省去 Eval 静态检查中的一次独立 TypeScript 编译。Dashboard 浏览器测试原有的服务端构建仍保留。这是配置执行次数的减少，不是远端实际耗时测量。

本任务手写源码、测试及 CI 配置合计净减约 440 行，不包含生成产物和本文。

## 实际验证

三组定向检查共覆盖 19 个测试文件、181 个测试；最终均通过。更改后重跑受影响的失败文件和后续调整的测试，不将重复执行计入上述数量。

| 范围               | 测试文件／结果                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 构建、配置与任务   | `classic-tasks`、`ci-workflows`、`runtime-build-location`、`verify-changed`、`package-scripts`、`runtime-schema-generation`：60 项通过                  |
| Runtime 与公开 CLI | Native／Entry／Classic runtime assets、`classic-sdk-preset-scope`、`neutral-document-path`、`cli-smoke`：46 项最终通过                                  |
| Dashboard 与 DSH   | `web-source`、`native-web-source`、`demo-locale`、`memory-callbacks`、`classic-refresh-callbacks`、`artifact-fullscreen`、`dsh-plugin-build`：75 项通过 |

其他检查：

- `pnpm build`：成功；最终完整构建本机约 24 秒，包含 TypeScript、Runtime、CLI facade 和 Dashboard。
- `pnpm build:dashboard`：成功。保留既有的大 chunk 提示，没有通过调高告警阈值掩盖它。
- `pnpm check:generated`：通过；原 Classic／Native／Entry 构建脚本的逐字节比较也通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm exec eslint app/ domains/ platform/ plugin/`：通过，零错误、零警告。
- 修改文件的 Prettier 检查、`git diff --check`：通过。
- `pnpm check:sdk-api`：八个公开入口均与已接受的 API 报告一致。
- `pnpm check:badcase-registration --base a699272f9a7c2dad5e2b5bab2ca1d3c20999f5c7`：通过。该检查不代表已执行所有登记案例。
- actionlint 1.7.7：通过。Docker 服务不可用，改用 `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 -shellcheck= -pyflakes= .github/workflows/ci.yml`；没有执行 ShellCheck／Pyflakes 子检查。
- 将当前 `dist/`、`bin/` 和包清单复制到隔离目录并连接依赖后，版本命令、Native 帮助、SDK Runtime／Compiler 导入均成功，Dashboard HTML 存在。这证明本机复制后的产物可用，不能替代 GitHub Actions 下载或 npm 安装验证。
- `pnpm verify:changed --base <本任务基线> --plan`：执行了只读计划；该计划同时包含另一项正在进行的 Native 修改，实际按本任务行为选择上述测试，没有执行整个计划中的所有领域套件。

初次 Runtime 定向检查有一个 Entry 新鲜度失败：删除后续 Classic 闲置函数后，关联的 Guard bundle 尚未重建。完整重建后，重跑 Entry 及最终构建契约，46 项全部通过；没有删除或放宽失败断言。

## 限制与工作区保护

`pnpm lint` 未整体通过：其中 ESLint 成功，但架构 linter 报告任务开始前已存在的未跟踪目录 `.codex-attachments` 不在顶层许可清单。没有删除该目录或扩大许可清单；这是当前仍存在的本地检查阻塞。

未运行仓库全量测试、全量覆盖率、真实模型／容器 Eval、真实平台 Hook、npm 安装端到端测试或远端 CI。本任务没有改变页面交互和布局，未运行浏览器 E2E；已验证前端构建及相关契约。远端三平台产物上传／下载和实际耗时仍需 CI 确认。

工作期间出现另一项 Native 工作区恢复修改，涉及 `native-build-workspace*`、Native 状态／Guard、规则和对应测试。本任务保留这些修改；生成物来自构建时的共同工作树，不能将所有 Native bundle 差异归为本次清理。未修改网站子模块内容或引用，没有提交、推送或创建 PR。

当前版本 `0.5.4`，本地 `origin/master` 和上一发布 tag `0.5.3`。保留已有版本：本次是内部源码及验证基础设施清理，公开 SDK 报告与产品行为没有变化，依照发布视角规则不将开发过程另写入产品 Changelog。

<!-- badcase-registration
{"status":"no-user-behavior-fix","reason":"本次删除无调用方的内部实现、合并构建代码并复用同次 CI 的编译产物，不声称修复新的产品行为问题；全部现有 badcase 登记和执行矩阵保留。","fixes":[]}
-->
