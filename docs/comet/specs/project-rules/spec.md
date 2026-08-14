# 项目规则领域规格

## 公开边界

`domains/project-rules` 提供项目规则文件读取、扫描、候选管理、上下文选择和验证入口发现。它不依赖某一个 Comet workflow，也不修改 Native、Classic、Hotfix 或 Tweak 的状态。`app/commands/project-rules.ts` 只把这些能力暴露为 `comet rules` CLI。

## 用户可读规则来源

- `.comet/rules/*.md` 是可选的普通 Markdown 文件；一个文件可以写多条规则。
- 规则段落可以用标题分组，并可在段落中写 `适用范围：<glob>`；没有范围时按标题、正文、任务和目标路径匹配。
- 扫描还可以识别仓库已有的 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md` 等指令来源，但不把它们复制到 `.comet/rules`。
- 写入规则时只能追加或替换明确的目标文件，保留其他文本；初始化和扫描不能生成空规则文件。

## Runtime 状态

Runtime 状态位于 `.comet/runtime/project-rules/`，包括最近扫描、来源索引、观察去重键和候选状态。它不是用户维护界面，也不替代 Markdown、Agent 指令或原生检查配置。

## 盘点、候选与操作

- `init` 和 `scan` 都执行有边界的只读盘点，并更新 Runtime 状态；两者幂等且不创建 Comet change。
- `status` 返回初始化、上次盘点、来源、验证入口和待处理/稍后候选摘要；摘要只包含用户可读文本和处理状态，候选详情按需读取。
- 显式添加的规则立即写入用户指定的普通 Markdown 文件；自动候选只有用户选择加入后才能生成仓库改动。
- 观察必须带项目身份、workflow 家族、change ID、成功结果和候选键。Native 使用 `native`，Classic 使用 `full`、`hotfix` 或 `tweak`；宿主传入 `classic` 时归一化为 `full`，不能形成第二个证据族。同一 change 只计一次；至少两个不同且成功的 change 提供一致证据后才生成非阻塞候选。
- 候选可以 `adopt`、`ignore`、`snooze` 或恢复为待处理。未采用候选不进入上下文，不阻塞编译、测试、构建或 CI，也不静默修改规则来源。

## 上下文选择

选择器先按来源、项目、路径和任务做确定性过滤，再按匹配程度排序；调用者可以缩小但不能放大固定的最大段数和字节数。调用者获得规则文本、来源路径和适用范围，不获得完整候选列表或 Runtime 机器字段。

## 原生验证入口

服务从 `package.json` scripts、有效的 Maven/Gradle 构建文件、Makefile、Python 项目配置和可用 wrapper 中发现验证入口，返回实际命令和来源；空文件或仅注释的构建文件不会被宣称为入口。它不安装依赖、不运行命令、不改变 warning/error 语义；Agent 或宿主负责在授权范围内执行并根据原生诊断修复。

## CLI

```text
comet rules init [path] [--json]
comet rules scan [path] [--json]
comet rules status [path] [--json]
```

三个命令调用同一领域服务；普通输出简短可读，`--json` 只返回用户需要的状态和摘要，不返回内部 ID、评分、证据时间戳或状态机字段。

## 非目标

本 child 不实现个人记忆、插件 Runtime、Hook/宿主 Rule 投递、Skill 上下文接线和 Dashboard。父级最终 Verify 负责确认这些消费者使用同一规则源且项目规则与 change 无关。
