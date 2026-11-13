# 同一工作区的顺序 claim 与未知写入归属

授权来源：report:2026-11-11-single-writer-workspaces。普通 workflow 每 workspace 单 writer，父 Agent 顺序提交；不保 workspace/application 文件锁或并发提交互斥协议。

原精确一项 one-before.json 为 0 passed / 1 failed：两个同一 workspace 的 runtime.claim 用 Promise.allSettled 同时提交，实际两个都 fulfilled，旧断言期望互斥后恰好一项成功。此是已撤下的并发提交前提，不能据此恢复锁。

本批只改 application-hook.test.ts 该声明并改成明确顺序标题：先提交第一项，检查原 token/executor；第二项必须 SCOPE_HELD，两个 child 与 parent 都不得被失败 claim 污染。将第一项 markUnknown 后完整保原 claim，第二项仍拒绝，真实 Hook 仍禁止未知写入归属下的写入。保留原 Hook 在正常 claim 时允许、unknown 时拒绝的所有业务断言，新增各 Run 完整深等，没有删 genuine scope/授权保护。其余七个声明正文不变。

整文件 file-after.json 为 8 passed / 0 failed / 0 skipped，Prettier 检查通过。未改产品、构建或生成 bundle，未跑整个 workflow-application module、安装、真实平台 Hook、模型或容器 Eval。Hook 直接 API 测试不等于平台事件验证。

完整旧文件/八个原声明在 tests.json，逐项去向在 mapping.json。当前及 frozen historical issues 覆盖合并后，末端 effective selector 无本文件关联，因此无需 CAS 或改 ID；registry.json 保存实际目录快照摘要。四份独立 artifact 的 hash 在 artifact-index.json，原文没有覆写前轮证据。
