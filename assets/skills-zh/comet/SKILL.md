---
name: comet
description: "Comet 工作流入口。当用户明确调用 /comet，或明确要求使用 Comet 但未指定 Native/Classic 时使用；解析项目配置并加载唯一入口。"
---

# Comet 入口

`/comet` 只负责选择入口，不包含任何一种工作流的执行方法。

一旦加载本 Skill，就视为已经选定 `/comet` 入口。必须立即执行下方入口解析，不得重新判断任务是否适合 Comet，也不得只解释为什么不使用它。

1. 在当前项目运行 PATH 中安装的 Comet CLI：

   ```text
   comet workflow resolve . --activate --json
   ```

   若项目还没有 `.comet/config.yaml`，该命令会将全局默认配置固化到当前项目，并在项目内创建对应产物目录；后续全局默认值变化不会改写已激活项目。若命令返回 `command not found`、`executable not found` 或 `ENOENT`，停止并说明 Comet CLI 安装不完整。不得搜索 Skill 文件、扫描平台配置目录或直接调用内部 bundle。CLI 已启动但返回非零、配置解析失败、输出不是 JSON 或字段无效时，同样停止并原样说明错误，不要回退或猜测。
2. 解析 JSON。只接受 `schema: comet.workflow-resolution.v1`，且 `skill` 必须是下列两个值之一。
3. 只按返回的 `skill` 选择下列一个入口。必须立即使用 Skill 工具加载且只加载该入口：
    - `/comet-native` → **立即执行：** 使用 Skill 工具加载 `comet-native` 技能。禁止跳过此步骤。
    - `/comet-classic` → **立即执行：** 使用 Skill 工具加载 `comet-classic` 技能。禁止跳过此步骤。

   技能加载后，把用户原始请求完整交给已加载的入口 Skill，作为该入口的用户输入。

不根据任务大小、文件数量、活跃 change 或模型判断改选另一套工作流。Native 与 Classic 的 change、状态和产物始终彼此独立。
