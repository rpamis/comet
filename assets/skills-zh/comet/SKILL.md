---
name: comet
description: "当用户调用 /comet 或需要恢复 active Comet change 时，按项目配置路由到永久的 Comet Native 或 Comet Classic 入口。"
---

# Comet 入口

`/comet` 只负责选择入口，不包含任何一种工作流的执行方法。

1. 先在当前项目尝试 PATH 中安装的 Comet CLI：

   ```text
   comet workflow resolve . --json
   ```

2. **只有**宿主明确报告 `command not found`、`executable not found` 或 `ENOENT`，能够证明 `comet` 不在 PATH 时，才从当前 `SKILL.md` 所在目录定位 `<comet-skill-root>`，运行自带入口 runtime：

   ```text
   node <comet-skill-root>/scripts/comet-entry-runtime.mjs . --json
   ```

   CLI 已启动但返回非零、配置解析失败、输出不是 JSON 或字段无效，都不得使用 bundled runtime 重试；停止并原样说明错误，不要回退或猜测。
3. 解析 JSON。只接受 `schema: comet.workflow-resolution.v1`，且 `skill` 必须是下列两个值之一。
4. 只按返回的 `skill` 调用一个入口，并把用户原始请求完整交给它：
   - `comet-native` → `/comet-native`
   - `comet-classic` → `/comet-classic`

不根据任务大小、文件数量、活跃 change 或模型判断改选另一套工作流。Native 与 Classic 的 change、状态和产物始终彼此独立。
