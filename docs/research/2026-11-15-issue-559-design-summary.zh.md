# Issue #559：Classic Design 讨论摘要保存路径

来源：[Issue #559](https://github.com/rpamis/comet/issues/559)。报告环境为 Comet 0.5.3、Windows 11、GitHub Copilot、中文 Skill。修复比较基线为 054 的 `a09ef4478d77d9bba9e0c29cd096df611d324260`。

## 复现与根因

在系统临时目录下载官方 `@rpamis/comet@0.5.3` npm 包，用隔离项目回放 Write 与 apply_patch 输入。发布包和 054 基线的 Classic Guard、使用 `--platform github-copilot` 的 Router 均呈现以下结果；docs 与 legacy 布局一致：

| 目标                                                        | 旧行为                         | 预期                             |
| ----------------------------------------------------------- | ------------------------------ | -------------------------------- |
| `<classic-change-dir>/brainstorm-summary.md`                | 拒绝，提示源码受限及进入 Build | 指向讨论检查点，保留 Design      |
| `<classic-change-dir>/.comet/handoff/brainstorm-summary.md` | 允许                           | 允许保存候选，恢复时读取同一文件 |
| 当前 change 的 `design.md`                                  | 允许                           | 保留原行为                       |
| `src/feature.ts`                                            | 拒绝                           | Design 阶段继续拒绝              |

共执行 64 项 bundle 对照。该记录证明确定性 Guard 行为，未重现真实 Copilot 会话或 Agent 选错路径的完整过程。

独立问题及回归映射：

- `classic-559-design-summary-path`：SDK 主 Skill 与方法参考只写摘要文件名，完整路径在 SDK 不加载的 Compat 参考中。新增中英文路径与恢复契约；原文的两项契约在修改前失败。SDK Run 测试从公开 bundle 创建隔离 full workflow，以模拟测试用户批准进入 Design，再建立待决定提案，确认摘要操作不改变原 Run、Wait 或批准。
- `classic-559-design-summary-recovery`：Guard 将根目录摘要交给通用源码拦截，NEXT 要求进入 Build。四项旧 bundle 回归在预期的正确路径断言处失败；修复后同输入通过，并确认按路径重试允许、状态不变、源码仍拒绝。

## 修复范围

中英文 SDK Skill 与方法参考明确目录创建、摘要保存和恢复位置。Guard 仅为当前 change 根目录的 `brainstorm-summary.md` 提供定向诊断，不放开该位置或整个 change 目录。原有所有权、归档、阶段和普通源码保护保持有效。Classic 与 Entry 相关 bundle 由构建脚本同步，未修改本机安装副本。

在既有 0.5.4 Changelog 的 Fixed 分组追加用户可见说明。当前 `origin/master` 为 0.5.3，分支已为 0.5.4，不再增加版本。

## 验证与限制

实际检查结果：

- 9 个相关测试文件：408 项通过，1 项非 Windows 专用用例在 Windows 按平台条件跳过。覆盖新路径契约、公开 Router bundle 的 legacy/docs 与中英文事件、SDK Design Wait 保留，以及源码、混合补丁、跨 change 与归档反例；包括相邻 Classic Guard、Router、Skill 和 Runtime 资产契约。
- `pnpm test:core-regressions --case classic-559-design-summary-path --case classic-559-design-summary-recovery`：两组登记案例、8 项精确选择断言通过。
- `pnpm build`、`pnpm check:generated`、受影响文件 Prettier 检查、`git diff --check`、基线 badcase 登记保留检查：通过。构建保留既有 Dashboard chunk 体积警告，无构建失败。
- 实际打出并解压本地 0.5.4 npm 包，对照官方 0.5.3 包：64 项 bundle 检查及 4 份包内 Skill 路径契约通过。新版误放摘要诊断给出检查点路径，不再要求 `--apply`；两版正确路径均可写，源码仍拒绝，状态不改变。该检查不等同安装或真实平台 Hook 验收。
- 原工作区 `pnpm lint`：ESLint 通过，随后架构检查失败，原因是任务开始前已有的未跟踪 `.codex-attachments/` 不在顶层白名单。未删除或移动该目录，也未更改白名单。使用当前 HEAD 的 Git archive 加本次差异及新增文件创建隔离副本，在该副本运行同一架构检查，通过。

以下验收保留为 pending，不能据此关闭用户问题：

- 真实模型遵循路径：负责人 benym。用户未请求启动 Eval，本次不运行。获明确授权后，验证 Design 探索和上下文恢复都使用规定检查点；静态契约不能代替模型证据。
- 真实 Copilot Hook：负责人 benym。当前只回放 Router 的平台事件；报告人的实际会话未验证。升级安装后确认拒绝信息显示正确目录、保存成功且未进入 Build。
- 未运行仓库全量测试：本次影响范围可由定向检查覆盖；本次不提供全量或发布验收结论。

测试中的 Open 批准是隔离场景的模拟输入，不代表真实需求批准；未自动评论或关闭 Issue，未创建 PR。
