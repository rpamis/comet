# 稳定公开 CLI 协议

规范路径：`comet-classic/reference/scripts.md`

Classic Skill 调用 Comet Runtime 的方式以本文件为准。Skill 只使用 PATH 中的公开 `comet` CLI；随包发布的 `comet/scripts/*.mjs` 是安装过程和 Runtime 使用的内部文件，Skill 不应搜索或直接调用它们。

## CLI 引导

进入工作流时，直接运行下方需要的公开 `comet` 命令。若返回 `command not found`、`executable not found` 或 `ENOENT`，停止并说明 Comet CLI 安装不完整；不得通过搜索 Skill 文件、遍历平台目录或调用内部 bundle 绕过该问题。CLI 已启动但返回非零退出码时，报告原错误，不得改用内部脚本重试。

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

在 Open 阶段先运行 workspace prepare。工作区未知、发生切换或之前的选择已失效时，运行 workspace resolve，进入返回的 projectRoot 后再执行 select。正常进入下一阶段时，沿用仍有效的选择，不重复扫描 Worktree；源码写入应属于当前选定的 change。

入口 check --json 会返回 layout、configuration、nextAction、任务摘要、coordination 和 delivery；已经返回的字段不再单独查询。恢复会话时若缺少上下文，先用 --recover 取得恢复摘要；需要全部任务、检查点或证据时才加 --details，具体见 context-recovery.md。

checkpoint 输入必须包含 schemaVersion:1，以及 taskIds/revision/stage/sessionId/evidence/unresolved/reviewRounds；读取时返回 `{checkpoint, stale}`。Runtime 检查数据后生成 Markdown，JSON 示例见 context-recovery.md。task-complete 会自动同步旧计划中已经建立 comet-task ID 对应关系的任务。需要单独同步时使用 sync-plan；返回 planSync mapping-required 时，只需补齐对应关系，不应重新实施任务。

delivery 输入包含 action（local|push|pr）、targetBranch，以及可选的 remote、commit、prUrl，示例见 comet-archive。普通入口和 delivery 读取不会访问网络；只有 `state delivery <change-name> --verify` 会只读核对远端和 PR 状态，并返回 `{delivery, verification}`。记录写入成功不等于交付成功。命令不可用、操作被拒绝或记录不一致时停止，不能手改内部状态来绕过检查。

guard 的 `--apply` 在检查通过后更新状态。需要直接触发状态机事件时，使用 `comet state transition`。阶段更新后，按 auto-transition.md 读取成功结果中的 `agent.continuation` 并继续；返回的状态信息缺失或失效时，才查询 next。

## 自动状态更新

guard 支持 `--apply` 参数，验证通过后自动更新 `.comet.yaml` 状态字段：

```bash
comet guard <change-name> <phase> --apply
```

`--apply` 内部调用状态机的 transition。需要直接触发状态机事件时使用：

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

归档由 `comet archive <change-name>` 完成。OpenSpec 先把 change 移到带日期前缀的归档目录，再由 Comet 记录状态。归档前的确认状态通过 `archive-confirm` 或 `archive-reopen` 更新；不要在归档流程之外手动执行 `archived` transition。

## 解析下一步

阶段守卫更新 phase 后，按 auto-transition.md 优先使用成功 JSON 中的 `agent.continuation`。下一阶段可以直接使用这里返回的状态信息，不重复 next、select 或 check。只有恢复会话时缺少上下文、发生外部变化，或旧结果缺少这些信息时，才运行：

```bash
comet state next <change-name>
```

输出包含 `NEXT: auto|manual|done`、`SKILL: <skill-name>`（`done` 时省略），以及 `HINT`（仅 `manual` 时）。`auto_transition: false` 时输出 `manual`，表示不自动调用下一 Skill，不影响已经更新的 phase。

## 归档脚本

一键完成归档全部步骤：

```bash
comet archive <change-name>
```

## 任务上下文与产物语言

所有 OpenSpec 和 Superpowers 产物都必须使用 Comet 配置的产物语言，配置值为规范化语言 ID：`en` 或 `zh-CN`。已有 change 优先使用本次有效入口返回的 `configuration.language`；仅入口未提供该字段时，才通过 `comet state get <name> language` 读取 `<classic-change-dir>/.comet.yaml` 中的 `language`。`.comet.yaml` 尚不存在时，依次读取项目 `.comet/config.yaml` 和全局 `~/.comet/config.yaml` 的 `classic.language`；两处都没有配置时，才使用当前用户请求的语言。调用外部 OpenSpec/Superpowers Skill 时，必须把最终确定的语言明确写入提示词或 ARGUMENTS。

绑定 Classic 工作区并读取 `.comet.yaml` 当前 `phase` 后，Agent 自动运行 `comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<本次任务稳定标识>" --json`。只将返回的 `text` 加入上下文。Context Manifest（`manifest` / `<context_manifest>`）是上下文清单，只包含摘要、选用原因和稳定 ID。需要正文、来源或验证方式时，运行同一命令并增加 `--expand-context "<id>"`。路径、操作或阶段发生变化时，沿用同一 `--session`，传入新的 `--path`、`--operation`、`--phase`，重新选择适用内容。

若 `<active_policies>` 中包含 `<verification command="...">`，将这些命令加入当前 Verify 的检查并记录实际结果。只有命令成功执行过，对应策略才能设为强制执行。

用户明确要求长期记住偏好或项目约定时，调用 `comet memory remember ... --scope global|project`。用户没有明确要求、但协作方式稳定且可跨任务复用时，才调用 `comet memory observe`。两者都不得保存任务摘要、进展、命令输出或测试结果。

实际使用某条内容并已得知结果后，使用返回的 `applications[].applicationId`（Hook 文本中的 `application_id`）运行 `comet task <project-root> --task "<用户原始请求>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`，如实记录使用结果；不得把未使用的条目标为使用成功。任务结束时仍需运行带 `--complete --workflow <workflow> --change <change-id>` 的 `comet task`，记录检查点。

没有 Hook 时，由 Skill 调用相同接口。`comet memory context` 只保留为兼容入口；插件未返回结果或调用失败，不会阻止工作流继续。
