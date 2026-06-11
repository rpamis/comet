# News

## 0.3.7 — 2026-06-07

### CodeGraph 语义代码索引

`comet init` 和 `comet update` 现在支持一键安装 [CodeGraph](https://github.com/colbymchenry/codegraph)（`@colbymchenry/codegraph`），为 Agent 提供语义代码索引能力。自动检测 7 个支持平台（Claude Code、Cursor、Codex、OpenCode、Gemini、Kiro、Antigravity），安装 CLI 并初始化项目索引。`comet doctor` 可检查 CodeGraph 状态。

官方数据：成本降低约 **16%**，工具调用减少约 **58%**。

### 上下文压缩（Beta）

Design → Build 阶段交接时的 spec 投影压缩。启用后 Build 阶段输入 token 降低 **25–30%**，大型任务绝对节省可达 15,000 tokens。Beta 模式使用全文投影（`cat`），支持中英文 Spec，无需求关键词依赖。

启用：`.comet.yaml` 设置 `context_compression: beta`

详见 [CONTEXT-COMPRESSION.md](docs/CONTEXT-COMPRESSION.md)。

### 主动上下文压缩机制

Design 阶段新增 Step 1e 主动压缩门：Brainstorming 完成后、创建 Design Doc 前，Agent 主动触发平台原生上下文压缩（如 Claude Code 的 compact），释放读取 Spec 和 brainstorming 消耗的上下文，为后续 Build 阶段保留窗口。压缩后自动重新加载 handoff 文件继续执行。不支持程序化触发的平台会暂停提示用户手动压缩。

### 自动流转（Auto Transition）

`auto_transition` 控制阶段推进后是否自动调用下一个 Skill，还是暂停等待用户手动触发。默认 `true`（全自动），设为 `false` 可在阶段间暂停审查。支持三层配置优先级：环境变量 `COMET_AUTO_TRANSITION` > `.comet/config.yaml`（项目级）> `.comet.yaml`（change 级）。适用于所有工作流类型（full / hotfix / tweak）。

详见 [AUTO-TRANSITION.md](docs/AUTO-TRANSITION.md)。

### Token 优化套件

6 项独立优化，默认开启，不需要启用 beta 上下文压缩：

| 优化项 | 节省效果 |
|--------|---------|
| TDD skill 单次加载 | ~44K tokens / 10-task workflow |
| Brainstorming checkpoint | 压缩恢复点，防止决策丢失 |
| Plan 创建子代理卸载 | 主会话上下文释放 |
| Verify skill 去重 | 消除冗余 skill 内容 |
| tasks.md 增量扫描 | grep 替代全文读取 |
| Hash 按需读取 | 跳过未变更的 OpenSpec 制品 |


### 防漂移阶段守护

长上下文会话中 Agent 容易遗忘当前阶段，导致在 `open`/`design` 阶段误写源码。0.3.7 新增两层防护：

- **Rule（软提醒）**：`.claude/rules/comet-phase-guard.md` 每轮注入阶段感知、Skill 调用规范、脚本执行要求和上下文压缩恢复指令。适用于所有平台。
- **Hook（硬拦截）**：`comet-hook-guard.sh` PreToolUse hook 在 `open`/`design`/`archive` 阶段直接拦截文件写入，白名单 `openspec/*`、`docs/superpowers/*`、`.claude/*`、`.comet/*` 路径。仅 Claude Code 等支持 hook 的平台生效。

### 其他重要变更

- **TDD 模式**：`.comet.yaml` 新增 `tdd_mode`（`tdd`|`direct`），用户可选择是否在 build 阶段强制 TDD
- **子代理调度确认**：`.comet.yaml` 新增 `subagent_dispatch`，确保 `subagent-driven-development` 模式在平台真实支持后台调度后才离开 build 阶段
- **PRD 拆分预检**：`/comet-open` 在创建 OpenSpec 制品前对大型 PRD 进行分流，允许拆分为多个 Comet change
- **验证重试限制**：连续 3 次 verify-fail 后强制用户决策，防止无限重试
- **归档前确认与回退**：`/comet-archive` 在执行归档脚本前暂停等待用户确认，拒绝后可通过 `archive-reopen` 返回 verify 阶段调整，无需手动编辑 `.comet.yaml`
- **系统化调试拦截**：build/hotfix 阶段遇到崩溃或测试失败时必须加载 `systematic-debugging` skill，确保根因定位后才修复
- **验证完成检查**：`/comet-verify` 执行前必须加载 `verification-before-completion` skill，强制基于证据的完成确认
- **50% 范围阈值第三选项**：变更超过 50% 范围时新增"继续在当前 change 中完成"选项，不再强制拆分
- **平台中性确认机制**：去除 `AskUserQuestion` 硬编码，Codex 等非 Claude Code 平台使用各自的确认机制

完整变更列表见 [CHANGELOG.md](CHANGELOG.md)。
