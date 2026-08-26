# Dashboard 统一弹框交互实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Dashboard 的所有内容弹框统一使用“右上角全屏/还原、遮罩和 Escape 退出”的交互，并移除独立关闭 `×`。

**Architecture:** 在 Dashboard Web 中增加一个可复用的 Ant Design Modal 内容壳层和一个共享全屏状态 Hook。项目知识详情、来源预览、设置、记忆/知识表单和待确认列表迁移到该壳层；产物预览保留自定义覆盖层，但复用同一状态转换、按钮语义和动效契约。`Modal.confirm` 继续使用 Ant Design 原生确认行为，不接入内容弹框壳层。

**Tech Stack:** React 18、Ant Design Modal/Button/Tooltip、现有 Dashboard CSS、Playwright 浏览器测试、Vite Dashboard 构建。

## Global Constraints

- 右上角移除独立关闭 `×`，原位置只保留全屏/还原按钮。
- 普通卡片点击遮罩关闭；全屏卡片点击遮罩先还原，内容和表单草稿保持不变。
- 普通卡片按 Escape 关闭；全屏卡片按 Escape 先还原。
- 不改变 `Modal.confirm` 等短暂确认提示的确认、取消和危险操作语义。
- 不改变表单字段、保存逻辑、来源读取逻辑或 Markdown/JSON/YAML 渲染逻辑。
- 全屏是 Dashboard 页面内占满可用视口，不使用浏览器原生 Fullscreen API。
- 所有全屏切换使用一致的中心扩散过渡，并支持 `prefers-reduced-motion: reduce` 降级。
- 保持现有浅色/深色主题、移动端尺寸、Ant Design 焦点和键盘行为。

---

## 文件结构和责任

- Create: `domains/dashboard/web/src/dashboard-modal.jsx` — 内容弹框壳层、标题操作区和共享全屏状态 Hook。
- Modify: `domains/dashboard/web/src/main.jsx` — 迁移现有内容弹框和产物预览，保留业务内容与数据逻辑。
- Modify: `domains/dashboard/web/src/styles.css` — 统一弹框容器、标题操作、全屏布局、中心扩散过渡和 reduced-motion 样式。
- Modify: `test/domains/dashboard/dashboard-browser.spec.ts` — 覆盖所有内容弹框的按钮、遮罩、Escape、全屏状态保持和确认弹框回归。
- Modify: `CHANGELOG.md` — 在当前 `0.4.0-rc.1` 的 `Changed` 下追加最终用户可见的统一弹框交互说明。

### Task 1: 添加统一弹框交互的失败测试

**Files:**

- Modify: `test/domains/dashboard/dashboard-browser.spec.ts: 项目知识和产物预览主流程测试`

**Interfaces:**

- Consumes: 当前 demo Dashboard 页面和已有项目知识、Native/Classic 产物预览测试 fixture。
- Produces: 可验证 `DashboardModal` 交互契约的浏览器断言，供后续组件实现使用。

- [ ] **Step 1: 为项目知识详情增加关闭入口和全屏状态断言**

在打开“Focused tests”项目知识详情后，增加以下断言：

```ts
await expect(focusedManifestDialog.locator('button[aria-label="Close"]')).toHaveCount(0);
await expect(focusedManifestDialog.getByRole('button', { name: '全屏展示' })).toBeVisible();
```

点击“全屏展示”后验证对话框仍存在、按钮变为“退出全屏”，按 Escape 后验证对话框仍存在且按钮恢复为“全屏展示”。随后点击当前弹框的 `.ant-modal-mask`，验证对话框关闭。

- [ ] **Step 2: 为来源预览增加全屏状态保持和遮罩还原断言**

打开 `docs/rule.md` 来源预览后，验证没有 `button[aria-label="Close"]`。进入全屏并修改来源预览内部滚动位置，再点击 `.ant-modal-mask`，验证弹框仍可见、按钮恢复“全屏展示”，并且来源标题仍在。再次点击遮罩后验证弹框关闭。

- [ ] **Step 3: 为设置、创建表单、待确认记忆和纠正表单增加统一入口断言**

在已有设置和项目知识创建流程中，分别打开弹框并验证：

```ts
await expect(dialog.locator('button[aria-label="Close"]')).toHaveCount(0);
await expect(dialog.getByRole('button', { name: /全屏.*设置|全屏展示/u })).toBeVisible();
```

进入全屏后填充创建表单字段，点击遮罩还原，验证字段值仍然存在。待确认记忆和纠正记忆弹框也验证右上角存在统一全屏按钮；原有确认类 `Modal.confirm` 仅继续验证标题、确认按钮和取消按钮。

- [ ] **Step 4: 为产物预览增加统一按钮和背景状态断言**

打开 Native `brief` 产物预览，验证不存在 `关闭产物预览` 的独立关闭按钮，存在“全屏展示”。进入全屏后按 Escape 验证回到普通预览，再点击普通状态的遮罩关闭。Classic `proposal` 产物预览复用同样的按钮和 Escape 断言。

- [ ] **Step 5: 运行新增断言确认当前实现失败**

运行：

```bash
pnpm exec playwright test test/domains/dashboard/dashboard-browser.spec.ts --grep "project knowledge|demo Native|Classic"
```

预期：测试因现有默认关闭按钮、表单没有全屏入口或产物预览关闭语义不匹配而失败；失败位置应对应本任务新增断言，不应出现页面加载或 fixture 路由错误。

### Task 2: 实现共享 Dashboard 内容弹框壳层

**Files:**

- Create: `domains/dashboard/web/src/dashboard-modal.jsx`
- Modify: `domains/dashboard/web/src/main.jsx: imports and Modal call sites`

**Interfaces:**

- Consumes: Ant Design `Modal`, `Button`, `Tooltip`，现有 `FullscreenOutlined` 和 `FullscreenExitOutlined` 图标。
- Produces: `useDashboardModalState(open)` 和 `DashboardModal`，供标准内容弹框及产物预览复用。

- [ ] **Step 1: 定义共享全屏状态 Hook**

在 `dashboard-modal.jsx` 导出：

```jsx
export function useDashboardModalState(open) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!open) setFullscreen(false);
  }, [open]);

  const toggleFullscreen = () => setFullscreen((value) => !value);
  const requestClose = (onClose) => {
    if (fullscreen) {
      setFullscreen(false);
      return;
    }
    onClose();
  };

  return { fullscreen, toggleFullscreen, requestClose };
}
```

`requestClose` 是遮罩和 Escape 共用的入口：全屏时只还原，普通状态才调用业务关闭回调。

- [ ] **Step 2: 定义 `DashboardModal` 标题和 Modal 适配接口**

实现如下接口：

```jsx
<DashboardModal
  open={open}
  title="标题"
  subtitle="可选副标题"
  description="可选说明"
  ariaLabel="项目知识详情"
  width={720}
  className="可选业务样式类"
  rootClassName="可选业务根样式类"
  footer={footer}
  onClose={onClose}
>
  {({ fullscreen }) => <Content fullscreen={fullscreen} />}
</DashboardModal>
```

`DashboardModal` 必须设置 `closeIcon={null}`、`keyboard`、`mask={{ closable: true }}`、`destroyOnHidden`，由 `requestClose(onClose)` 处理 `onCancel`。标题区渲染标题、副标题、说明和右上角按钮；按钮的 `aria-label` 在两个状态间切换为“全屏展示”和“退出全屏”。普通状态传入固定 `width`，全屏状态传入 `100vw`。

- [ ] **Step 3: 迁移项目知识预览和设置弹框**

在 `main.jsx` 中：

- 删除 `ProjectKnowledgePreviewModal` 和 `DashboardSettingsOverlay` 各自维护的 `fullscreen`、重置 Effect 和关闭函数；
- 用 `DashboardModal` 保留现有标题文案、`ariaLabel`、footer 和子内容渲染；
- 保留项目知识详情和来源预览的 `children({ fullscreen })` 接口，使目录、正文滚动、Markdown/JSON/YAML 渲染不变；
- 让设置 footer 的提示改为“点击背景可关闭或还原设置”，准确反映全屏状态行为；
- 保留现有 `dashboard-settings-modal` 和 `dashboard-knowledge-preview-modal` 业务样式类，额外叠加共享弹框类。

- [ ] **Step 4: 迁移内容型标准 Modal**

将以下标准 `Modal` 替换为 `DashboardModal`，不改其 `onOk`、字段状态和保存请求：

- Personal Memory 的“待确认记忆”列表弹框；
- Project Knowledge 的“新增项目知识”表单；
- Personal Memory 的“新增偏好”表单；
- Personal Memory 的“新增项目记忆”表单；
- Personal Memory 的“纠正这条记忆”表单。

原有 `okText`、`cancelText`、`okButtonProps`、`footer` 和 `onCancel` 继续传入；`DashboardModal` 只负责标题操作和全屏状态。确认类 `Modal.confirm` 不修改。

- [ ] **Step 5: 运行 Task 1 的项目知识浏览器测试验证标准弹框行为**

运行：

```bash
pnpm exec playwright test test/domains/dashboard/dashboard-browser.spec.ts --grep "project knowledge"
```

预期：项目知识详情、来源预览、设置和新增表单的关闭按钮断言、全屏切换、Escape 和遮罩状态断言通过；产物预览相关断言仍因 Task 3 尚未迁移而失败或保持原有失败位置。

### Task 3: 将产物预览适配到统一状态契约

**Files:**

- Modify: `domains/dashboard/web/src/main.jsx: ArtifactDrawer`

**Interfaces:**

- Consumes: `useDashboardModalState(open)`、现有产物渲染状态、目录状态和 `onClose`。
- Produces: 不带独立关闭按钮的产物预览，普通/全屏状态与标准内容弹框一致。

- [ ] **Step 1: 使用共享 Hook 替换产物预览的本地全屏状态**

在 `ArtifactDrawer` 中以 `Boolean(artifact)` 调用 `useDashboardModalState`，使用返回的 `fullscreen`、`toggleFullscreen` 和 `requestClose` 替换 `isFullscreen`、`setIsFullscreen` 的状态切换。打开新产物或关闭产物时由 Hook 清理全屏状态。

- [ ] **Step 2: 统一产物预览的遮罩和 Escape 行为**

将 Escape 监听从直接 `onClose()` 改为 `requestClose(onClose)`。普通状态的遮罩点击调用 `requestClose(onClose)`；全屏状态保留外层覆盖层并让可点击背景区域调用同一入口，使全屏状态回到普通预览而不是直接关闭。

- [ ] **Step 3: 移除关闭按钮并保留右上角全屏位置**

删除 `aria-label="关闭产物预览"` 的独立按钮，只保留当前标题区右侧的全屏/还原按钮。普通状态遮罩使用非按钮背景元素或可访问的遮罩区域，不再通过一个伪装成关闭按钮的控件提供退出入口。

- [ ] **Step 4: 运行产物预览浏览器测试**

运行：

```bash
pnpm exec playwright test test/domains/dashboard/dashboard-browser.spec.ts --grep "demo Native|Classic"
```

预期：Native 和 Classic 产物预览均能打开、渲染 Markdown/结构化内容、进入/退出全屏、Escape 还原、普通遮罩关闭，且控制台没有新增错误。

### Task 4: 统一弹框视觉和中心扩散动效

**Files:**

- Modify: `domains/dashboard/web/src/styles.css: content modal and artifact preview styles`

**Interfaces:**

- Consumes: `dashboard-modal-root`、`dashboard-modal`、`is-fullscreen`、`dashboard-artifact-preview-overlay` 和 `dashboard-artifact-preview-panel` 类名。
- Produces: 所有内容弹框统一的标题按钮区域、普通卡片尺寸、全屏尺寸、遮罩和动效。

- [ ] **Step 1: 增加共享标准 Modal 样式**

定义共享规则：

```css
.dashboard-modal {
  max-width: calc(100vw - 40px);
  transition:
    width 360ms cubic-bezier(0.22, 1, 0.36, 1),
    max-width 360ms cubic-bezier(0.22, 1, 0.36, 1),
    margin 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

.dashboard-modal.is-fullscreen {
  width: 100vw !important;
  max-width: none;
  height: 100dvh;
  margin: 0;
}
```

共享 `.ant-modal-container` 规则同步过渡 `height`、`max-height`、`border-radius` 和 `box-shadow`；全屏时移除边框和圆角。项目知识详情、来源预览和设置的现有 360ms 曲线统一到共享规则，避免重复定义产生漂移。

- [ ] **Step 2: 适配表单和待确认列表的普通/全屏高度**

让创建、记忆和待确认列表弹框使用与设置弹框一致的 flex column 容器，正文区域可滚动；全屏状态将 Modal 容器铺满 `100dvh`，保持 footer 可见。移动端继续使用视口宽度约束和现有表单栅格规则。

- [ ] **Step 3: 适配产物预览覆盖层的中心扩散过渡**

为 `ArtifactDrawer` 添加明确的 overlay/panel 类名，替换依赖 Tailwind 拼接的状态布局。普通状态保留右侧阅读卡片和遮罩，全屏状态使用同一 360ms 曲线同步扩展到视口；正文滚动区域、目录和表格横向滚动不改变。

- [ ] **Step 4: 增加 reduced-motion 和主题回归规则**

在 `@media (prefers-reduced-motion: reduce)` 中将共享标准 Modal 和产物预览的过渡设置为 `none`。检查浅色、深色下遮罩、边框、标题操作按钮和全屏背景仍使用现有设计变量，不引入新的固定主题颜色。

- [ ] **Step 5: 运行样式格式和 Dashboard 构建检查**

运行：

```bash
pnpm exec prettier --check domains/dashboard/web/src/dashboard-modal.jsx domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/dashboard-browser.spec.ts
pnpm build:dashboard
```

预期：Prettier 检查通过，Vite Dashboard 构建成功；允许保留现有 chunk size warning，不把 warning 当作构建失败。

### Task 5: 完成回归验证和用户可见变更记录

**Files:**

- Modify: `test/domains/dashboard/dashboard-browser.spec.ts`
- Modify: `CHANGELOG.md: 0.4.0-rc.1 Changed`

**Interfaces:**

- Consumes: Task 1-4 的统一弹框 DOM、状态和 CSS 契约。
- Produces: 完整 Dashboard 弹框回归证据和面向用户的版本变更记录。

- [ ] **Step 1: 运行 Dashboard 全部浏览器测试**

运行：

```bash
pnpm exec playwright test test/domains/dashboard/dashboard-browser.spec.ts
```

预期：所有 Dashboard 浏览器测试通过，项目知识、数据来源、产物预览、设置、表单和确认弹框均无控制台错误。

- [ ] **Step 2: 运行 Dashboard 源码契约和静态检查**

运行：

```bash
pnpm exec vitest run test/domains/dashboard/web-source.test.ts
pnpm exec eslint app/ domains/ platform/
pnpm exec prettier --check domains/dashboard/web/src/dashboard-modal.jsx domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/dashboard-browser.spec.ts
git diff --check
```

预期：相关 Vitest、ESLint、Prettier 和空白检查通过；不因仓库中已有的无关未跟踪目录扩大验证范围。

- [ ] **Step 3: 在 `0.4.0-rc.1` 的 `Changed` 下记录最终行为**

追加一条用户视角的英文 changelog：

```markdown
- **Dashboard modal controls**: Content dialogs now use one consistent fullscreen/restore control in place of a separate close button; clicking the backdrop or pressing Escape closes normal dialogs and restores fullscreen dialogs without losing their current content.
```

不新增版本条目，不记录本次实现过程、测试重构或内部组件名称。

- [ ] **Step 4: 复核工作区并汇报未覆盖项**

运行：

```bash
git status --short
git diff --stat
```

确认只包含本次弹框功能相关的源代码、测试、样式、Changelog 和计划文件；保留用户已有的其他未提交改动，不执行 reset、checkout 或清理操作。

## Self-review checklist

- Spec coverage: 目标、非目标、统一容器、状态转换、中心扩散动效、reduced-motion、确认类弹框边界和验收标准分别由 Task 1-5 覆盖。
- Placeholder scan: 计划没有未决占位项或模糊的兜底步骤；每个测试和实现步骤给出具体文件、接口、断言或命令。
- Type consistency: `useDashboardModalState(open)` 输出 `fullscreen`、`toggleFullscreen`、`requestClose`；标准 `DashboardModal` 和 `ArtifactDrawer` 通过同一 `requestClose(onClose)` 处理遮罩/Escape；测试使用这些固定的 aria 标签和类名。
- Scope: `Modal.confirm` 明确排除；渲染、数据读取、表单字段和业务保存逻辑只做迁移不改语义。
