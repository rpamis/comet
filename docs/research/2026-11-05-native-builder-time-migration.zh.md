# Builder 辅助提交时间校验迁移

## 范围与依据

版本保持 0.5.2，迁移前基线为 `0ffccd4e33a87e62f3b41fd9877d5d326b1b9b4d`。原案例 `native-builder-submitted-at-diagnostic` 来源于 [Issue #506](https://github.com/rpamis/comet/issues/506)，要求拒绝非规范 `submittedAt` 并给出字段诊断。其登记、来源和原测试正文完整保留。

用户已授权 Native 协议精简中由 Runtime 记录提交时间，既有案例 `native-builder-runtime-submission-time` 对应 `report:2026-11-02-native-protocol-simplification`。此次 Review 指出恢复严格日期校验会在 Runtime 时间兜底前拒绝原本可提交的候选，要求继续由 Runtime 记录接收时间。迁移授权依据与该讨论绑定。[PR #539 Review](https://github.com/rpamis/comet/pull/539#discussion_r4478758481)

## 替代契约

撤下 Agent 辅助时间的严格格式拒绝行为。Builder 回报省略时间、包含不可解析文本、合法 ISO 时间缺少毫秒，或包含两位毫秒时，完整候选均可提交。缺失或不可解析的时间由 Runtime 记录实际接收时间，合法旧请求保留其解析时间并规范化为 ISO 格式。提交后进入原 Verify 检查步骤，候选身份、验收项和检查结果等业务字段继续执行原校验。

四个替代场景均由 `native-sdk-application.test.ts` 的 `records a Runtime submission time without requiring Agent metadata` 执行。缺失或不可解析时，保存时间须位于 Runtime 提交前后时间窗内。合法时间须等于请求的解析时间。所有场景同时验证原验收信息及 Verify 后继步骤。Issue #506 的检查枚举、summary、接受项诊断继续保留。

## 归档与验证边界

- `native-builder-time-migration/regression-registry-before-removal.json` 保存原案例登记。
- `native-builder-time-migration/test-snapshots.json` 保存基线完整测试文件、commit 和内容摘要。
- `native-builder-time-migration/implementation-removal.patch` 保存删除严格校验及替代测试的实际差异。
- `native-builder-time-migration/case-migrations.json` 保存原案例与四个替代场景的逐项映射。

迁移按 `feature-removed` 登记，PR 不再把原格式拒绝案例列为已修复。证据摘要由现有迁移校验器核对。四个替代时间场景与三个保留的业务字段诊断共 7 项定向 Runtime 测试通过，迁移完整性单例通过。此次没有启动模型 Eval。
