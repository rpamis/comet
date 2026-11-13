# Issue #548：Dashboard 产物全屏预览

来源：[Issue #548](https://github.com/rpamis/comet/issues/548)。Native 和 Classic 的关键产物预览分别登记为 `dashboard-native-artifact-fullscreen`、`dashboard-classic-artifact-fullscreen`。

## 复现与根因

修改基线为分支 `053` 的 `00956d7cb5eb18f943667bd07ceef980047b2a55`，开始时工作区干净。当前版本 0.5.3，`origin/master` 为 0.5.2，上一个发布 tag 为 0.5.2；远端 master 与本地跟踪引用一致。版本保持 0.5.3，用户可见修复追加至同一版本的 Changelog。

在修改前构建的真实 Dashboard 中，打开 Native 需求简报和 Classic proposal，新增 Playwright 检查均失败：期望没有关闭按钮，实际存在一个；新增组件回归也因找不到全屏按钮失败。

另将 npm 发布包 `@rpamis/comet@0.5.2` 下载到系统临时目录，解包后以本地 HTTP 服务提供包内 `dist/domains/dashboard/web`，使用 Playwright Chromium 访问 `/?demo`。分别打开 Native 需求简报与 Classic proposal，确认全屏按钮数为零、右上角关闭按钮可见，点击后预览消失。两种流程均复现，不依赖用户项目或真实 HOME。

共享 `ArtifactDrawer` 仍通过 `useDashboardModalState` 保存全屏状态，也保留全屏目录和 Escape 还原逻辑，但未取出 `toggleFullscreen`，头部按钮直接调用 `onClose`，导致全屏逻辑不可达。

## 修改与行为映射

- 普通 Dashboard 原关闭按钮位置改为放大按钮，绑定已有全屏切换；全屏后显示还原图标、`退出全屏` 提示及按下状态。
- 按用户视觉反馈，图标采用 Ant Design 的 `ExpandOutlined` / `CompressOutlined` 四角直线轮廓，显示尺寸最终调整为 18px，保留 32px 按钮点击范围。
- Native 与 Classic 复用同一实现。全屏后显示已有目录，目录链接继续定位正文；还原不丢失正文。Escape 先还原，再按关闭；普通抽屉仍能点背景关闭，重新打开从普通尺寸开始。
- 官网等嵌入模式保持容器内关闭按钮，避免将嵌入预览扩展到外部页面；增加组件反例验证此分支。本任务未修改 website 子模块、Skill 或 Runtime。
- 更新原先明确要求“没有全屏按钮”的普通源码及浏览器断言，使之符合本次用户要求；原目录条件、动画、减弱动态效果、关闭路径和其他断言保留。没有删减历史 badcase 映射。

Vitest 的两个精确用例 `expands Native artifacts without dismissing the preview`、`expands Classic artifacts without dismissing the preview` 执行真实共享组件和状态 Hook，覆盖按钮触发、目录显示、点击还原和两次 Escape。测试仅替代无关的文档渲染服务和图标；完整正文渲染、CSS 尺寸、目录滚动与导航由以下浏览器验收覆盖。

## 验证

- `pnpm exec vitest run test/domains/dashboard/artifact-fullscreen.test.ts test/domains/dashboard/web-source.test.ts test/domains/dashboard/native-web-source.test.ts test/domains/dashboard/i18n.test.ts`：56 项通过。
- `pnpm exec playwright test --config test/domains/dashboard/playwright.config.ts --grep 'expands (Native|Classic) artifact previews|animates artifact previews' --workers 1`：3 项通过。服务启动时执行 `pnpm run build:dashboard`，验证当前 checkout 构建；桌面 1440×900 和窄屏 390×844 均检查全屏实际宽度、按钮可见、正文保留、目录链接、点击还原、Escape、背景关闭及重开。另保留原动画和减弱动态效果断言。
- 视觉检查 Native 和 Classic 全屏截图：标题、正文、250px 目录和右上角还原图标正常。截图位于 `coverage/playwright-results/dashboard-browser-expands--0c3f3-stores-them-without-closing/native-artifact-fullscreen.png`；Classic 截图位于同级 `dashboard-browser-expands--a5e3b-stores-them-without-closing/classic-artifact-fullscreen.png`。
- `pnpm lint`：通过，0 错误、9 条已有未使用变量警告；架构检查通过。
- 受影响文件 Prettier 与 badcase 登记检查：通过。
- `pnpm test:core-regressions --case dashboard-native-artifact-fullscreen --case dashboard-classic-artifact-fullscreen`：精确执行两项登记测试，均通过；嵌入模式反例未被该选择器选中，已在上述 56 项定向测试中执行通过。

图标调整后重新执行组件测试（3 项通过）、上述 Playwright 定向测试（3 项通过，含 Dashboard 重建）、受影响文件 Prettier 和 `main.jsx` ESLint（0 错误、6 条已有警告）。浏览器重跑暴露了测试对页尾目录项高亮的错误假设：正文滚动到底部时，末尾标题无法总是到达高亮阈值。目录断言改为检查目标标题实际进入视口并且正文发生滚动，仍验证原目录跳转行为。已检查新图标的实际浏览器截图。

同时尝试现有综合用例 `loads the demo dashboard and previews an artifact`，它在到达预览断言前因缺少“恢复状态”标题失败。该标题属于未修改的 Native 面板，不将此综合用例记为通过，也未扩大任务修改无关面板或放宽该断言。预览路径由上面的独立实际浏览器用例验证。

未运行仓库全量测试、完整 npm 安装流程、真实平台 Hook 或模型 Eval。修改仅涉及 Dashboard 预览 UI，相关构建、组件及浏览器边界已有定向证据；Eval 未获启动授权。上述验证在提交前完成，后续提交和推送以 Git 记录为准；未创建 PR 或在 GitHub 留言。
