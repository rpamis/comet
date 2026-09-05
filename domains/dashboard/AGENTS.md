# Dashboard

<!-- comet-development-rule:dashboard -->

- Dashboard 优先使用现有 Ant Design React 组件、token 和紧凑布局语言，保持与已有页面一致。
- UI 改动先核对当前组件、状态来源和桌面/窄屏布局，再做最小范围修改。
- 数据和状态转换留在 Dashboard domain 的明确边界，不把 Runtime 业务规则复制进前端。
- 修改后运行相关 Dashboard 测试和 `pnpm build:dashboard`；交互、响应式或浏览器行为变化再运行 Playwright E2E。
- 浏览器验证以真实渲染结果为准，不只根据 JSX/CSS 源码推断视觉和交互已经正确。
