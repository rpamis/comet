---
name: comet-archive
description: '归档并交付 Classic change。在用户调用 /comet-archive，或 Classic Runtime 路由到 Archive、恢复交付时使用。'
---

# Comet 阶段 5：归档（Archive）

入口返回 layout 后按 `comet-classic/reference/classic-layout.md` 绑定逻辑根；协议已在当前上下文时不重复加载。本文件的 OpenSpec CLI 使用 adapter，文件路径使用绑定的 `<classic-*>` 根，不先额外运行 root show。

## 前置条件

- 验证已通过（阶段 4 完成）
- 归档或所选交付动作尚未完成；恢复不要求 branch_status 仍为 pending
- `<classic-change-dir>/.comet.yaml` 中 `verify_result: pass`

## 步骤

### 0. 输出语言约束

归档摘要和生命周期闭环说明使用本轮入口 configuration.language，不额外查询语言。

### 0b. 入口状态验证（Entry Check）

按 `comet-classic/reference/scripts.md` 使用稳定 `comet` CLI，然后执行入口验证；从任意入口恢复时先按 `comet-classic/reference/context-recovery.md` 运行恢复检查：

```bash
comet state select <change-name>
comet state check <name> archive --json
```

使用入口 layout、configuration、nextAction 和 delivery 摘要继续。冷恢复所需详情按 context-recovery.md 读取；已有有效授权且目标一致时只续做未完成动作，不重复询问。失败时处理具体原因。

若上述 `select` / `check` 输出 `BLOCKED`，且原因是 `bound_branch` 与当前分支不一致，立即按 `comet-classic/reference/decision-point.md` 暂停，让用户单选：切回绑定分支后重新运行入口验证，或在用户明确确认当前分支应接管该 change 后运行 `comet state rebind <change-name>` 并重新入口验证。不得自行切换分支，不得自行换绑。

### 1. 归档与交付前最终确认（阻塞点）

使用入口 configuration.isolation 与 delivery。没有有效授权或交付目标发生变化时，**按 decision-point.md 暂停并确认归档和交付方式**；已有授权时先让 Runtime 核对真实 Git 与交付状态，再从 nextAction 继续。不得仅从 branch_status: handled 推断归档、push 或 PR 授权，也不得在授权前运行 archive-confirm 或 archive。

确认前必须向用户展示简短摘要：

- change 名称
- 验证报告路径和结论
- 当前分支/工作区和未提交改动归因摘要
- 本次归档将执行的不可逆动作：按 OpenSpec delta 语义合并主 spec、标注 design doc / plan、移动 change 到 archive 目录
- 归档完成后将采用的提交处理方式：只保留在本地、推送当前绑定分支，或推送后创建 PR

用户确认问题必须以单选题形式呈现，包含以下全部选项。文本降级模式必须使用下表；使用结构化提问时，将“方式”作为短标签、“实际影响”作为说明，不得缩短为含义不明确的选项：

| 选项 | 方式                            | 实际影响                                                                                                                                                             |
| ---- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | 仅归档（不推送）                | 完成归档并创建唯一归档提交；提交只保留在当前绑定分支，不推送、不创建 PR                                                                                              |
| B    | 「确认归档并立即推送」          | 完成归档并创建唯一归档提交，然后推送当前绑定分支；不创建 PR                                                                                                          |
| C    | 「确认归档、立即推送并创建 PR」 | 完成归档并创建唯一归档提交，推送当前绑定分支，然后创建 PR                                                                                                            |
| D    | 「需要调整或重新验证」          | 不归档；运行 `comet state transition <change-name> archive-reopen` 回到 `phase: verify`，再调用 `/comet-verify`；若确认需要修复，再按验证失败决策回到 `/comet-build` |
| E    | 「暂不归档」                    | 不运行 `archive-confirm` 或归档命令，不提交、不推送；保留 active change、`phase: archive` 和 `branch_status: pending`，等待稍后再次调用 `/comet-archive`             |

只有用户选择 A、B 或 C 后，才将选择保存为 JSON 并通过 Runtime 记录，再确认归档：

```bash
comet state delivery <change-name> --file <json-path>
comet state transition <change-name> archive-confirm
```

JSON 字段为 action（A=local、B=push、C=pr）、targetBranch、可选 remote、commit 和 prUrl。初次记录只提供已确认动作与目标；未知的 commit/prUrl 不伪造，待真实完成后补写。targetBranch 是接收归档提交的绑定分支，不代替 PR 的 base 分支；PR base 按已有明确配置，存在歧义时先澄清。多个 remote 时明确目的地，不猜测。例如用户已确认推送：

```json
{
  "action": "push",
  "targetBranch": "<confirmed-bound-branch>",
  "remote": "<confirmed-remote>"
}
```

用文件工具保存 JSON，再传给 delivery --file。归档提交确认后，在同一完整记录中追加 `"commit": "<actual-archive-commit-sha>"`；action 为 pr 且 PR 已创建时，再追加真实 prUrl。local 示例只需 action:local 和已确认 targetBranch，不要求 remote。

普通 `comet state delivery <change-name>` 只读取记录，入口摘要也不触网。恢复远端交付、处理返回不确定或宣告完成前显式运行：

```bash
comet state delivery <change-name> --verify
```

读取结果为 `{delivery, verification}`。delivery 表示已持久化的选择和进度，verification 表示 Runtime 对真实 Git/远端/PR 的只读核对结果；仅有 delivery 或普通 entry 成功不能证明远端完成。区分核对结论：

- 已确认 not-yet-delivered（例如尚未首次 push，或已推送但尚未创建 PR）：授权和目标仍有效时，继续执行缺失动作，再用 --verify 核对；不能仅因 notVerified/needsVerification 就停止。
- unavailable（网络、权限或服务故障使真实结果无法确定）、目标冲突或不确定结果：保留记录并停止；先恢复只读核对能力，不盲目重试 push 或重复创建 PR。

delivery 写入或 transition 失败均停止。只有两者成功才继续 Step 2。用户选择 D 时运行 archive-reopen，旧交付授权应失效，重新验证后重新确认；选择 E 直接停止，不归档、提交、推送或设置 handled。

### 2. 执行归档

运行归档脚本：

```bash
comet archive "<change-name>"
```

脚本自动执行：

1. 入口状态验证（phase=archive, verify_result=pass, archive_confirmation=confirmed, archived=false）
2. Design doc 前置元数据标注（archived-with, status）
3. Plan 前置元数据标注（archived-with）
4. 调用 OpenSpec archive 按 delta 语义合并主 spec 并移动 change 到归档目录
5. 校验主 spec 未残留 delta-only section 标题
6. 在 OpenSpec 实际归档目录中更新 archived 状态，并协调 pending recovery 元数据

如脚本返回非零退出码，报告错误并停止。
如脚本返回零退出码，归档完成。

脚本摘要中的 `X/Y steps succeeded` 以真实执行步骤计数，不会因 delta spec 同步或文档标注重复累计。

脚本会调用 OpenSpec 归档能力按 `ADDED/MODIFIED/REMOVED/RENAMED` 语义合并主 spec，并在归档后校验主 spec 中没有残留 delta-only section 标题。

如需预览而不实际执行，使用 `--dry-run` 参数。

### 3. 生命周期闭环

Spec 生命周期在此完成：

```
brainstorming → delta spec → 实施 → 验证 → 主 spec 合并 → design doc 标注 → 归档
```

### 4. 精确提交归档改动

归档脚本只移动文件和合并 spec，不会自动提交。归档完成后工作区会有以下未提交改动：

- change 目录从 `<classic-change-dir>/` 移动到 `<classic-archive-root>/YYYY-MM-DD-<name>/`
- 主 spec 按 delta 语义合并的内容
- design doc / plan 的归档元数据标注

确认 delivery 中的实际授权仍有效，再写入兼容字段并运行最终 archive guard：

```bash
comet state set <change-name> branch_status handled
comet guard <change-name> archive
```

handled 仅为兼容状态，不承载 local/push/pr 的授权或成功证据；这些以 delivery 记录和 Runtime 对真实 Git/远端的核对为准。状态写入或 guard 失败时停止。恢复时先核对归档提交是否已存在，存在则复用，不再创建第二个归档提交。

归档后读取 `git status --short`，并以归档前的 dirty-worktree 归因记录为基线。只允许暂存可归因于当前 change 的路径：原 active change 路径、脚本输出的实际 archive 路径、归档目录中已更新为 `branch_status: handled` 的 `.comet.yaml`、被本次 delta 更新的 main specs，以及当前 Design Doc/Plan 的归档元数据。存在无法归因的路径时停止并请求用户处理。

使用显式 pathspec 暂存核对后的路径，再检查 staged diff；不得使用全仓库暂存，也不得把用户已有改动混入归档提交：

```bash
git add -- <逐项核对后的归档路径...>
git diff --cached --stat
git commit -m "chore: archive <change-name>"
```

提交失败或 staged diff 含无关路径时停止，不得继续分支处理。

### 5. 交付归档提交并完成

归档提交成功后，用 `state delivery --file` 补写真实 commit，并由 Runtime 核对归档提交与目标；读取结果后只执行已授权且未完成的动作。记录失败时停止交付，不重新提交；恢复时先核对已有 Git 事实再补记录。不要为记录 commit 本身反复创建归档提交，交付回执的存储由 Runtime 管理。

- A「仅归档（不推送）」：不执行任何远端操作，归档提交只保留在当前绑定分支。
- B「确认归档并立即推送」：推送当前绑定分支一次。
- C「确认归档、立即推送并创建 PR」：先推送当前绑定分支一次，再通过已配置的 GitHub 集成创建 PR；Step 1 的明确选择就是创建 PR 的授权，不得再次改成其他分支处置方式。

push 或 PR 调用后使用 delivery --verify 核对真实远端分支和 PR；成功创建 PR 后通过 delivery --file 补写真实 prUrl，保留此前 action、目标和 commit。超时或返回不确定时先查真实结果，不能盲目重试。失败时保留 delivery 和 current selection，只续做缺失的授权动作；不得改写、删除或切换分支。

local 由 Runtime 确认归档提交存在；push 还需确认远端包含该提交；pr 还需确认对应 PR 存在且目标匹配。仅填写 commit/prUrl 不等于交付成功。所选动作全部经 Runtime 核对完成后，才运行 clear-selection 并宣告完成。

归档阶段不再调用 Superpowers `finishing-a-development-branch`，也不提供本地合并、切换、删除或变基等分支拓扑操作。用户只想完成本地归档时，必须在 Step 1 选择 A；用户尚不想归档时，选择 E。

## 退出条件

- 归档脚本执行成功（退出码 0）
- 归档目录 `<classic-archive-root>/YYYY-MM-DD-<change-name>/` 存在
- 归档后的 `.comet.yaml` 中 `archived: true`
- 归档状态中的 `branch_status: handled` 已包含在唯一归档提交中
- `comet guard <change-name> archive` 通过
- 唯一归档提交已按用户在归档前确认的方式处理：选择 A 时只保留本地，选择 B 时已成功推送，选择 C 时已成功推送并创建 PR
- current selection 已在所选处理方式完成后清除

归档脚本会把 `<classic-change-dir>/` 移动到 `<classic-archive-root>/YYYY-MM-DD-<name>/`。

`comet guard <change-name> archive` 会按原 change 名解析实际归档目录；不要手工拼接日期目录名。

## 完成

Comet Classic 流程全部完成。如需开始新的 Classic 工作，调用 `/comet-classic` 或 `/comet-open`。

## 上下文压缩恢复

按 context-recovery.md 执行，phase 为 archive。读取持久化 delivery，不依赖当前对话记得 A/B/C。Runtime 核对归档目录、提交、远端和 PR 后只继续缺失动作；local 不执行远端操作。旧 change 只有 handled、授权缺失、目标变化或分支拓扑不一致时停止并明确确认，不推断授权，也不自动修复分支拓扑。
