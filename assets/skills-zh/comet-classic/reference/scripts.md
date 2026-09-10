# 稳定公开 CLI 协议

规范路径：`comet-classic/reference/scripts.md`

本文件是 Classic Skill 调用 Comet Runtime 的单一事实来源。Skill 只使用 PATH 中的公开 `comet` CLI；随包发布的 `comet/scripts/*.mjs` 属于内部安装与 Runtime 资产，不由 Skill 搜索或直接调用。

## CLI 引导

进入 workflow 时直接运行下方所需的公开 `comet` 命令。若命令返回 `command not found`、`executable not found` 或 `ENOENT`，停止并说明 Comet CLI 安装不完整；不得搜索 Skill 文件、枚举平台目录或直接调用内部 bundle。CLI 已启动但返回非零时，报告原错误，不得通过内部脚本重试。

## 公开工作流协议

日常工作流统一调用公开 CLI：

```bash
comet classic workspace prepare <change-name> --isolation <current|branch|worktree> --json
comet classic workspace resolve <change-name> --json
comet state select <change-name>
comet state current
comet state clear-selection
comet state check <change-name> <phase> --json
comet state check <change-name> <phase> --recover --json
comet state check <change-name> <phase> --recover --details --json
comet state checkpoint <change-name>
comet state checkpoint <change-name> --file <json-path>
comet state sync-plan <change-name>
comet state delivery <change-name>
comet state delivery <change-name> --verify
comet state delivery <change-name> --file <json-path>
comet check run <change-name> <build|verify> --local -- <program> [args...]
comet guard <change-name> <phase> --apply
comet handoff <change-name> design --write
comet archive <change-name>
comet resume-probe . --stdin --json
comet classic intent route --stdin
```

在 Open 阶段先运行 workspace prepare；工作区未知、发生切换或选择失效时运行 workspace resolve，进入返回的 projectRoot 后 select。普通阶段衔接沿用已有效的选择，不重复扫描 Worktree；普通源码写入只受所选 change 管辖。

入口 check --json 统一提供 layout、configuration、nextAction、任务摘要、coordination 和 delivery；已返回信息不逐字段重复查询。冷恢复先用 --recover 的紧凑包，需要全量任务/检查点/证据时才加 --details，具体见 context-recovery.md。

checkpoint 输入必须有 schemaVersion:1，及 taskIds/revision/stage/sessionId/evidence/unresolved/reviewRounds；读取返回 `{checkpoint, stale}`，由 Runtime 验证并生成 Markdown。JSON 示例见 context-recovery.md。task-complete 自动同步有 comet-task ID 映射的旧计划；sync-plan 可单独同步，planSync mapping-required 只要求补映射，不要求重做实现。

delivery 输入为 action（local|push|pr）、targetBranch、可选 remote、commit、prUrl，示例见 comet-archive。普通入口和 delivery 读取不触网；只有 `state delivery <change-name> --verify` 执行远端/PR 只读核对，返回 `{delivery, verification}`。写入成功不等于交付成功；命令不可用、拒绝或记录不一致时停止，不手改内部状态绕过。

guard 的 `--apply` 在检查通过后推进状态。需要直接表达状态事件时使用 `comet state transition`；阶段推进后使用 `comet state next` 解析是否自动调用下一 Skill。

## 自动状态更新

guard 支持 `--apply` 参数，验证通过后自动更新 `.comet.yaml` 状态字段：

```bash
comet guard <change-name> <phase> --apply
```

`--apply` 内部委托给状态机 transition。需要直接表达状态事件时使用：

```bash
comet state transition <change-name> open-complete
comet state transition <change-name> design-complete
comet state transition <change-name> build-complete
comet state transition <change-name> verify-pass
comet state transition <change-name> verify-fail
comet state transition <change-name> archive-confirm
comet state transition <change-name> archive-reopen
comet state transition <change-name> archived
comet state transition <change-name> preset-escalate
```

归档完成由 `comet archive <change-name>` 负责；OpenSpec 会先把 change 移到带日期前缀的归档目录，再由 Comet 完成状态记录。预归档确认使用 `archive-confirm` 或 `archive-reopen`；不要在归档流程之外手动执行 `archived` transition。

## 解析下一步

阶段守卫推进 phase 后，用 `next` 子命令解析是否自动调用下一个 skill：

```bash
comet state next <change-name>
```

输出 `NEXT: auto|manual|done` + `SKILL: <skill-name>`（`done` 时省略）+ `HINT`（仅 `manual` 时）。`auto_transition: false` 时输出 `manual`，只暂停下一 skill 调用，不影响已发生的 phase 推进。

## 归档脚本

一键完成归档全部步骤：

```bash
comet archive <change-name>
```
