# Dashboard：完整展示 Native、Classic 关键产物

来源：`report:2026-11-12-dashboard-full-artifacts`。用户在 Issue #548 全屏预览调整后明确要求删除“内容过长，已截取前 256KB。”提示并完整展示产物。

## 复现和实现

比较基线为 `00956d7cb5eb18f943667bd07ceef980047b2a55`，分支 `053`。保留了此前全屏预览、18px 图标及其未提交修改，未修改 website 子模块。当前版本 0.5.3 高于 master 的 0.5.2，因此完整预览行为追加至 0.5.3 Changelog。

使用 npm 发布的 `@rpamis/comet@0.5.2` 编译模块，在隔离临时项目和独立临时 HOME 中复现：

- Native：17MiB brief 仅返回 49152 字符，`truncated: true`，末尾丢失。
- Classic：300KiB proposal 仅返回 262144 字符，`truncated: true`；3MiB proposal 被标记为不存在。

成功复现项目位于系统临时目录 `comet-full-preview-052-2YVCTi`。发布包复用当前仓库安装的依赖，未执行全套旧版本安装。修改前当前源码的两个新回归也失败：Native 返回长度 49152，Classic 的 `exists` 为 false。浏览器在完整正文附带旧 `truncated` 标记时实际追加了固定 256KB 提示。

修改如下：

- Classic 通过原受保护读取器完整读取产物；移除 256KiB 裁剪及 2MiB 读取限制。状态和 tasks 的同源读取也使用完整读取，避免大产物仍影响详情加载。
- Native 改用已有完整文本读取器，`maxBytes: null`、`includeHash: false`，保留路径、文件身份及稳定性检查。移除旧 48KiB 前缀预算和完整投影 16MiB 总字节限制。
- 两种采集器保留兼容字段 `truncated: false`。共享产物组件不再为 Markdown、YAML 或 JSON 追加固定截断文案。列表继续使用轻量投影；用户选中后才加载正文。
- 同步演示数据中的预览说明及英文翻译。不修改知识来源预览、Eval 日志或其他列表的独立截断策略。

原 Native 测试专门要求“固定 48KiB 读取”。本次用户明确撤销此预览策略，因此将同一大文件测试改为验证完整读取、UTF-8 结尾和实际读取字节数，并扩展至超过原总预算的完整投影；不删除路径安全或历史 badcase 映射。

## 验证与回归登记

- 精确回归：`reads complete Native artifact previews beyond former byte limits` 和 `reads complete Classic artifact previews beyond former byte limits`，修改前失败、修改后通过。Native 用 17MiB 正文，Classic 用 3MiB 正文，两者都检查中文和表情结尾。
- 9 个相关 Vitest 文件：145 项通过、1 项跳过。覆盖 collector、native-collector、native-adapter、web-source、native-web-source、artifact-fullscreen、demo、demo-locale、i18n。跳过项属于原有环境依赖的用例，不记为通过。
- Playwright 4 项通过：两种 workflow 的完整预览及全屏回归。完整预览使用超过 256KB 的 API 正文，并特意保留旧 `truncated: true` 标记，验证末尾标题存在、没有合成截断提示、全屏目录链接能滚动到末尾。全屏回归继续覆盖桌面和窄屏、还原、Escape、正文保留及重开。
- Playwright 服务执行当前 checkout 的 `pnpm run build:dashboard`，构建通过。
- `pnpm exec tsc --noEmit`、`pnpm lint` 通过；lint 有 9 条已有未使用变量警告，架构检查通过。
- 受影响文件 Prettier、diff 和 badcase 登记检查通过。

分别登记 `dashboard-native-complete-artifact-preview`、`dashboard-classic-complete-artifact-preview`；Vitest 登记证明后端采集，附加浏览器验收证明正文渲染与导航。浏览器采用受控 API 响应，后端文件读取由真实临时项目测试覆盖；两层证据分别记录。

未运行全量测试、模型 Eval、真实平台 Hook 或完整 npm 安装验证。此次改动属于 Dashboard 文档展示，未修改 workflow 推进或平台 Hook；Eval 未获启动授权。上述验证在提交前完成，后续提交和推送以 Git 记录为准；未创建 PR 或在 GitHub 留言。
