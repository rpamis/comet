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
comet check rerun <change-name> <build|verify>
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

## 检查证据与输入声明

check 证据按"输入面"判定复用：默认输入是工作区文件内容。commit、暂存、勾选 tasks.md 任务和环境变量变化默认不再作废证据；构建或测试确实读取这些信息时，才通过 `.comet/check-policy.json` 显式声明绑定。

使用 `--local` 记录的同一条 full 命令（argv、cwd、输入和环境都一致）可在 Build 与 Verify 之间复用；Runtime 会为当前阶段绑定已有证据，并返回 `reused=true`，无需为了阶段名称不同再执行一次。显式失败、手工声明、过期或目录不匹配的记录会先报告原因和恢复命令，不会被自动探测出的构建命令覆盖。

Runtime 记录的命令失败或在建立输入快照、启动期间中断后，使用 `comet check rerun <change-name> <build|verify>`。Runtime 在执行前保存 argv、cwd、超时和复用级别，因此中断后也能按原样重试，不会改跑自动探测出的其他构建命令，也不会把参数重新拼成 shell 字符串。只对手工声明且没有 Runtime argv 的旧记录，guard 才会继续显示需要重新执行的 `comet check run` 模板。

guard 报告证据不可复用时，会输出失效原因和变化文件清单（`Why:`、`Changed inputs:`、`Relevance scope:`），按清单判断需要重跑的命令即可，不要凭猜测全量重跑。

`--incremental` 记录阶段内证据：guard 预览接受它用于快速确认，`--apply` 推进阶段前仍要求用完整命令重新执行一次。增量命令由调用方选择（如只跑相关测试），冷恢复后增量证据一律要求重跑。

```bash
comet check run <change-name> build --local -- <program> [args...]
comet check run <change-name> verify --local --incremental -- <program> [args...]
```

`.comet/check-policy.json` 按命令声明输入面。v2 格式每条命令独立生效，只绑定匹配 `argv` 和 `cwd` 的那条命令；修改或新增其他条目不影响本命令的既有证据。`files` 接受字面路径和 `*`、`?`、`**` 通配符，新增的匹配文件自动纳入，不需要改声明。构建会改写输入目录时，用 `outputs` 声明产物路径；这些路径不参与本命令的输入快照，避免命令因自身输出被误判为不稳定：

```json
{
  "version": 2,
  "commands": [
    { "argv": ["pnpm", "build"], "cwd": ".", "files": ["src/**", "package.json", "tsconfig.json"], "outputs": ["dist/**"], "git": "all" },
    { "argv": ["vitest", "run"], "cwd": ".", "files": ["src/**", "test/**"] }
  ]
}
```

省略的字段保持默认：`git` 默认 `none`（不绑定 HEAD 和 index），`env` 默认不绑定任何变量（可执行文件路径与文件身份、Node 版本始终绑定，切换 Node 版本仍会作废证据），`taskCheckboxes` 默认 `ignore`（勾选任务不作废证据，任务文本变化仍会作废）。构建产物包含 commit SHA 时声明 `git: "all"`；结果依赖某个环境变量时在 `env` 中列出它的名字；勾选状态本身影响检查结果时声明 `taskCheckboxes: "include"`。旧的 v1 单命令格式继续有效，按原语义解析。

条目的 `cwd` 同时声明该命令证据所属的目录。守卫默认只复用与自身调用目录一致的证据；v2 条目匹配的命令，其证据可以来自条目声明的 `cwd`。构建或验证入口在子目录时，按实际执行形式声明（例如 `{ "argv": ["npm", "run", "build"], "cwd": "ui/frontend" }`），再用 `--cwd ui/frontend` 记录，从项目根调用守卫即可复用；未声明的命令仍要求证据来自守卫的调用目录。

## 解析下一步

阶段守卫更新 phase 后，按 auto-transition.md 优先使用成功 JSON 中的 `agent.continuation`。下一阶段可以直接使用这里返回的状态信息，不重复 next、select 或 check。只有恢复会话时缺少上下文、发生外部变化，或旧结果缺少这些信息时，才运行：

```bash
comet state next <change-name>
```

输出包含 `NEXT: auto|manual|done|delivery`、`SKILL: <skill-name>`（`done` 时省略），以及 `HINT`（仅 `manual` 时）。`auto_transition: false` 时输出 `manual`，表示不自动调用下一 Skill，不影响已经更新的 phase；`delivery` 表示 change 已归档，按 delivery 摘要完成收尾，不再推进阶段。

## 归档脚本

一键完成归档全部步骤：

```bash
comet archive <change-name>
```

## 任务上下文与产物语言

所有 OpenSpec 和 Superpowers 产物都必须使用 Comet 配置的产物语言，配置值为规范化语言 ID：`en` 或 `zh-CN`。已有 change 优先使用本次有效入口返回的 `configuration.language`；仅入口未提供该字段时，才通过 `comet state get <name> language` 读取 `<classic-change-dir>/.comet.yaml` 中的 `language`。`.comet.yaml` 尚不存在时，依次读取项目 `.comet/config.yaml` 和全局 `~/.comet/config.yaml` 的 `classic.language`；两处都没有配置时，才使用当前用户请求的语言。调用外部 OpenSpec/Superpowers Skill 时，必须把最终确定的语言明确写入提示词或 ARGUMENTS。

绑定 Classic 工作区并读取 `.comet.yaml` 当前 `phase` 后，Agent 自动运行 `comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<本次任务稳定标识>" --json`。只将返回的 `text` 加入上下文。Context Manifest（`manifest` / `<context_manifest>`）是上下文清单，只包含摘要、选用原因和稳定 ID。需要正文、来源或验证方式时，运行同一命令并增加 `--expand-context "<id>"`。路径、操作或阶段发生变化时，沿用同一 `--session`，传入新的 `--path`、`--operation`、`--phase`，重新选择适用内容。

若 `<active_policies>` 中包含 `<verification command="...">`，将这些命令加入当前 Verify 的检查并记录实际结果。只有命令成功执行过，对应策略才能设为强制执行。

用户明确要求长期记住偏好或项目约定时，调用 `comet memory remember ... --scope global|project`。用户没有明确要求、但协作方式稳定且可跨任务复用时，才调用 `comet memory observe --text "<偏好内容>" --workflow <classic|native> --change <change-id> --candidate-key <change-id>-<行为短名>`（三个选项均为必需；`--candidate-key` 用 change ID 加行为短名生成稳定标识）。两者都不得保存任务摘要、进展、命令输出或测试结果。

项目记忆与个人记忆独立保存。任务结束前，把本次验证过且未来任务仍可复用的项目经验写入项目记忆：`comet knowledge remember <project-root> --title "<简明标题>" --text "<现象、做法、验证结果>" --type <fact|decision|pattern|procedure|constraint|failure-resolution> --json`。同一标题默认更新已有条目；没有可复用经验时跳过。项目记忆索引会随任务上下文注入，需要正文时追加 `--expand-context "project-memory:<slug>"`；任务摘要、一次性命令输出和未验证的猜测不得写入项目记忆。

每次任务结束前完成一次学习检查：有明确后续复用条件的用户纠正、偏好或协作习惯先调用 `comet memory observe`，再在完成命令中传 `--learning-check submitted`；确认没有合格观察时传 `--learning-check no-observation`，没有执行检查时传 `--learning-check not-run`。首次观察只形成 `trial` 候选，来自不同 change 的第二次独立成功观察才可能晋级。观察 JSON 的 `learning.result` 和 `status.learning.lastCheck` 是诊断依据。

实际使用某条内容并已得知结果后，使用返回的 `applications[].applicationId`（Hook 文本中的 `application_id`）运行 `comet task <project-root> --task "<用户原始请求>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`，如实记录使用结果；不得把未使用的条目标为使用成功。任务结束时仍需运行带 `--complete --workflow <workflow> --change <change-id> --learning-check submitted|no-observation|not-run` 的 `comet task`，记录检查点。

没有 Hook 时，由 Skill 调用相同接口。`comet memory context` 只保留为兼容入口；插件未返回结果或调用失败，不会阻止工作流继续。
