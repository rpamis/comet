# 在 MiniMax Code 中使用 Comet

平台 ID 为 `minimax-code`，对应 MiniMax Code 的 `mcode` CLI。Comet 安装工作流 Skill，不安装 MiniMax Code 本身，也不配置模型供应商或 API Key。

## 安装与维护

项目安装将 Skill 写入 `<项目>/.minimax/skills/`，并在项目 `AGENTS.md` 中维护 Comet 恢复说明，保留文件里的其他内容。

```bash
comet init . --platform minimax-code --scope project --workflow native --language zh --yes
comet doctor . --scope project
comet update . --platform minimax-code --scope project --skip-self-update --yes
```

需要 Classic 时，将 `--workflow native` 换成 `--workflow classic` 或 `--workflow both`。Classic 按现有安装流程处理 OpenSpec 和 Superpowers；OpenSpec 生成的 Skill 在临时目录中准备后复制到 `.minimax/skills/`，不会额外创建项目的 `.claude/`。

全局安装使用 `--scope global`，写入 `~/.minimax/skills/`。本次适配针对 MiniMax Code 的默认用户数据目录；如果通过 `MINIMAX_DATA_DIR`、`MAVIS_DATA_DIR` 或独立 profile 改用了其他目录，请使用项目安装，不要把默认全局目录的复制成功视为当前配置已加载。

卸载命令如下。它移除所选作用域内的 Comet 安装，不限于 MiniMax Code；自己的 Skill 和 MiniMax 配置会保留。

```bash
comet uninstall . --scope project --force
```

## 支持边界

- 支持项目级、全局 Skill 的检测、初始化、更新、诊断和卸载。
- 项目说明使用 MiniMax Code 读取的 `AGENTS.md`，不额外创建 `CLAUDE.md`。
- 不安装 `.minimax/rules/` 或 Hook 配置。MiniMax 的 Plugin Hook 不能仅凭其他平台的配置格式推断兼容，当前适配不提供平台写入拦截。
- Skill 发现和指令加载验证不代表真实模型已完成整个 Native 或 Classic 工作流。

适配时使用官方 `@minimax-ai/code@0.7.1` 发布包，在临时 HOME 和临时项目中启动 `mcode exec`，通过本地模拟模型端点检查实际请求。项目安装和默认全局安装均能在 Skill 列表中看到 Comet，并通过平台的 `skill` 工具读取 `comet-native/SKILL.md` 正文；项目安装的请求还包含 `AGENTS.md` 中的 Comet 恢复说明。该检查不使用真实模型，也不验证 Hook 或完整工作流。

## 接口依据

- [MiniMax Code 官方仓库](https://github.com/MiniMax-AI/minimax-code)：Skill 根目录见 `packages/local-runtime/src/skills/roots.ts`，项目说明见 `packages/local-runtime/src/project/instructions.ts`。
- [Skills CLI 平台定义](https://github.com/vercel-labs/skills/blob/main/src/agents.ts)：使用 `minimax-code` target。
- [需求 #518](https://github.com/rpamis/comet/issues/518)。
