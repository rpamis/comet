---
name: comet
description: 'Comet 工作流入口。当用户明确调用 /comet，或明确要求使用 Comet 但未指定 Native/Classic 时使用；按项目配置加载 Native 或 Classic。'
---

# Comet 入口

`/comet` 按项目配置选择 Native 或 Classic，再将用户请求交给相应的工作流 Skill 执行。

加载本 Skill 后，立即执行下方步骤。此时用户已选择使用 Comet，应继续处理请求，不再判断是否需要使用 Comet，也不能只给出不执行的理由。

1. 在当前项目运行 PATH 中安装的 Comet CLI：

   ```text
   comet workflow resolve . --activate --json
   ```

   若项目还没有 `.comet/config.yaml`，该命令会把全局默认配置保存到项目中，并创建对应的产物目录。此后修改全局默认值，不会覆盖这个项目已经保存的配置。

   若命令返回 `command not found`、`executable not found` 或 `ENOENT`，停止并说明 Comet CLI 安装不完整。不得搜索 Skill 文件、扫描平台配置目录或直接调用内部 bundle。

   CLI 已启动但返回非零退出码、配置解析失败、输出不是 JSON 或字段无效时，保留原始错误并停止，不自行选择其他入口。

2. 解析 JSON。只接受 `schema: comet.workflow-resolution.v1`，且 `skill` 必须是下列两个值之一。
3. 根据返回的 `skill`，立即使用 Skill 工具加载对应入口。两个入口只能加载一个：
   - `/comet-native` → **立即执行：** 使用 Skill 工具加载 `comet-native` 技能。禁止跳过此步骤。
   - `/comet-classic` → **立即执行：** 使用 Skill 工具加载 `comet-classic` 技能。禁止跳过此步骤。

   加载后，把用户原始请求完整交给该 Skill 执行。

入口完成工作流选择后，由对应 Skill 确定 change 所在的工作区和当前阶段，再加载任务上下文、个人记忆和项目知识；需要时使用 `comet memory context`。

对应 Skill 必须按需加载上下文：先通过 `comet task ... --json` 获取 Context Manifest（上下文清单），其中只有摘要、推荐使用的原因和稳定 ID。需要正文、来源或验证方式时，再增加 `--expand-context "<id>"`。

实际采用某条上下文且结果已经明确后，用返回的 application ID 调用 `--application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure`，记录真实使用结果。未使用的内容不能记为使用成功。

不根据任务大小、文件数量、活跃 change 或模型的自行判断更换工作流。Native 与 Classic 分别管理自己的 change、状态和产物。
