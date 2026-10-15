# 在 Prime Agent 中安装 Comet

Prime Agent 的平台 ID 是 `prime-agent`。项目安装使用 `.prime/agent/skills/`，全局安装使用 `~/.prime/agent/skills/`，不再推导到 `.prime-agent/`。

```bash
comet init . --platform prime-agent --scope project --workflow native --yes
comet init . --platform prime-agent --scope global --workflow native --yes
```

需要 Classic 时，将 `--workflow native` 改为 `--workflow classic`；它沿用 Classic 的 OpenSpec 和 Superpowers 依赖。安装器在临时目录生成依赖，再复制到 Prime Agent 的 Skill 目录，不额外写入项目或 HOME 的 `.claude`。

未指定 `--language` 时，初始化会优先继承当前工作流配置中的语言，其次使用已有安装的语言；全新安装仍默认英文。明确指定 `--language zh` 或 `--language en` 可以选择安装文案语言。新增平台不会因为非交互模式而把已有中文配置和项目指令切换为英文。

更新和检查：

```bash
comet update . --platform prime-agent --scope project --yes
comet update . --platform prime-agent --scope global --yes
comet doctor . --scope project --json
```

项目的 `AGENTS.md` 沿用 Comet 的恢复指令。当前适配支持 Skill 安装和 Runtime 工作流，不安装 Hook 级写入拦截，也不创建 Prime Agent 不读取的 `rules/` 或 Claude Hook 配置。Prime Agent 旧 TypeScript 版本的扩展与新 Rust 版本需要分别适配，不能把复制了 Skill 当成已经具备宿主写保护。

未知平台名称会在安装写入前报错。确实需要原有自定义 Claude 兼容模板时，显式声明：

```bash
comet init . --platform my-agent --custom-platform --scope project --yes
comet update . --platform my-agent --custom-platform --scope project --yes
```

自定义模板仍只支持项目作用域；它不代表该宿主已经经过 Comet 官方适配或验证。过去安装到错误 `.prime-agent/` 目录的文件不会被自动删除，以保留用户可能放入的内容。
