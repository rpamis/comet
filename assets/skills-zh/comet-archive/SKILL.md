---
name: comet-archive
description: '归档并交付 Classic change。在用户调用 /comet-archive，或 Classic Runtime 进入 Archive、恢复交付时使用。'
---

# Comet 阶段 5：归档（Archive）

收到入口返回的 layout 后，按 `comet-classic/reference/classic-layout.md` 确定各逻辑根对应的目录。当前上下文已有这份协议时，无需重复加载。本文件中的 OpenSpec CLI 调用均通过适配器执行，文件路径均基于已绑定的 `<classic-*>` 根目录，无需先额外运行 root show。

## 前置条件

- 验证已通过（阶段 4 完成）
- 归档或所选交付动作尚未完成；恢复不要求 branch_status 仍为 pending
- `<classic-change-dir>/.comet.yaml` 中 `verify_result: pass`

## 步骤

### 0. 设置输出语言

归档摘要和流程完成说明，使用本轮入口返回的 configuration.language，不再单独查询语言。

### 0b. 入口状态验证（Entry Check）

按 `comet-classic/reference/scripts.md` 使用正式支持的 `comet` CLI，执行以下入口验证。从任意入口恢复任务时，先按 `comet-classic/reference/context-recovery.md` 检查恢复状态：

```bash
comet state select <change-name>
comet state check <name> archive --json
```

使用入口返回的 layout、configuration、nextAction 和 delivery 摘要继续。丢失上下文后恢复任务时，按 context-recovery.md 读取所需详情。已有授权仍然有效、交付目标也没有变化时，只继续未完成的动作，不重复询问。失败时，处理返回的具体原因。

若上述 `select` / `check` 输出 `BLOCKED`，且原因是 `bound_branch` 与当前分支不一致，立即按 `comet-classic/reference/decision-point.md` 暂停，让用户单选：切回绑定分支后重新运行入口验证，或在用户明确确认当前分支应接管该 change 后运行 `comet state rebind <change-name>` 并重新入口验证。不得自行切换分支，不得自行换绑。

### 1. 请用户确认归档与交付方式

读取入口返回的 configuration.isolation 与 delivery。没有有效授权，或交付目标发生变化时，**按 decision-point.md 暂停，请用户确认归档和交付方式**。已有授权时，先由 Runtime 核对实际 Git 状态和交付进度，再按 nextAction 继续。不能仅凭 branch_status: handled 就认定用户已授权归档、push 或创建 PR，也不能在获得授权前运行 archive-confirm 或 archive。

确认前必须向用户展示简短摘要：

- change 名称
- 验证报告路径和结论
- 当前分支、工作区，以及未提交改动分别属于哪些工作的核对结果
- 本次归档将执行的不可逆动作：按 OpenSpec delta 语义合并主 spec、标注 design doc / plan、移动 change 到 archive 目录
- 归档完成后将采用的提交处理方式：只保留在本地、推送当前绑定分支，或推送后创建 PR

用户确认问题必须以单选题形式呈现，包含以下全部选项。文本降级模式必须使用下表；使用结构化提问时，将“方式”作为短标签、“实际影响”作为说明，不得缩短为含义不明确的选项：

| 选项 | 方式                            | 实际影响                                                                                                                                                             |
| ---- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | 仅归档（不推送）                | 完成归档并创建唯一归档提交；提交只保留在当前绑定分支，不推送、不创建 PR                                                                                              |
| B    | 「确认归档并立即推送」          | 完成归档并创建唯一归档提交，然后推送当前绑定分支；不创建 PR                                                                                                          |
| C    | 「确认归档、立即推送并创建 PR」 | 完成归档并创建唯一归档提交，推送当前绑定分支，然后创建 PR                                                                                                            |
| D    | 「需要调整或重新验证」          | 不归档；运行 `comet state transition <change-name> archive-reopen` 回到 `phase: verify`，再调用 `/comet-verify`；若确认需要修复，再按验证失败决策回到 `/comet-build` |
| E    | 「暂不归档」                    | 不运行 `archive-confirm` 或归档命令，不提交、不推送；保留未归档的 change、`phase: archive` 和 `branch_status: pending`，等待稍后再次调用 `/comet-archive`            |

只有用户选择 A、B 或 C 后，才将选择保存为 JSON 并通过 Runtime 记录，再确认归档：

```bash
comet state delivery <change-name> --file <json-path>
comet state transition <change-name> archive-confirm
```

JSON 包含 action（A=local、B=push、C=pr）、targetBranch，以及可选的 remote、commit 和 prUrl。初次记录时，只填写已确认的动作和目标；尚不知道的 commit/prUrl 不得伪造，等操作实际完成后再补写。

targetBranch 是接收归档提交的绑定分支，与 PR 的 base 分支含义不同。PR base 使用已有的明确配置；存在歧义时先澄清。存在多个 remote 时，明确推送目的地，不自行猜测。例如，用户已确认推送时：

```json
{
  "action": "push",
  "targetBranch": "<confirmed-bound-branch>",
  "remote": "<confirmed-remote>"
}
```

用文件工具保存 JSON，再传给 delivery --file。归档提交确认后，在同一完整记录中追加 `"commit": "<actual-archive-commit-sha>"`；action 为 pr 且 PR 已创建时，再追加真实 prUrl。local 示例只需 action:local 和已确认 targetBranch，不要求 remote。

普通 `comet state delivery <change-name>` 只读取已保存的记录，入口摘要也不访问网络。恢复远端交付、上次调用没有返回明确结果，或准备宣告完成时，必须显式运行：

```bash
comet state delivery <change-name> --verify
```

返回结果为 `{delivery, verification}`。delivery 是已保存的用户选择和执行进度，verification 是 Runtime 对实际 Git、远端分支和 PR 的只读核对结果。仅有 delivery 记录或入口检查成功，不能证明远端交付已经完成。按核对结果处理：

- 已确认 not-yet-delivered，例如尚未首次 push，或已推送但尚未创建 PR：授权和目标仍然有效时，继续未完成的动作，再用 --verify 核对；不能仅因为 notVerified/needsVerification 就停止。
- unavailable，即网络、权限或服务故障导致无法确定实际结果，或出现目标冲突、结果不确定：保留记录并停止。先解决只读核对遇到的问题，不盲目重试 push，也不重复创建 PR。

delivery 写入或 transition 失败均停止。只有两者成功才继续 Step 2。用户选择 D 时运行 archive-reopen，旧交付授权应失效，重新验证后重新确认；选择 E 直接停止，不归档、提交、推送或设置 handled。

### 2. 执行归档

运行归档脚本：

```bash
comet archive "<change-name>"
```

脚本自动执行：

1. 入口状态验证（phase=archive, verify_result=pass, archive_confirmation=confirmed, archived=false）
2. 在归档前更新 Design Doc 的元数据（archived-with, status）
3. 在归档前更新 Plan 的元数据（archived-with）
4. 调用 OpenSpec archive 按 delta 语义合并主 spec 并移动 change 到归档目录
5. 检查主 spec 中没有残留仅用于增量规格的章节标题（delta-only section）
6. 在 OpenSpec 实际归档目录中更新 archived 状态，并处理 pending recovery 元数据，保证中断后能够恢复

如脚本返回非零退出码，报告错误并停止。
如脚本返回零退出码，归档完成。

脚本摘要中的 `X/Y steps succeeded` 以真实执行步骤计数，不会因 delta spec 同步或文档标注重复累计。

脚本会调用 OpenSpec 归档能力按 `ADDED/MODIFIED/REMOVED/RENAMED` 语义合并主 spec，并在归档后校验主 spec 中没有残留 delta-only section 标题。

如需预览而不实际执行，使用 `--dry-run` 参数。

### 3. Spec 流程完成

Spec 从需求讨论到归档的完整流程如下，到此全部完成：

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

handled 只是兼容旧流程的状态字段，不能表示用户已授权 local/push/pr，也不能证明这些动作已成功。授权与执行结果以 delivery 记录和 Runtime 对实际 Git、远端的核对为准。状态写入或 guard 失败时停止。恢复任务时，先核对归档提交是否已经存在；存在就复用，不再创建第二个归档提交。

归档后读取 `git status --short`，与归档前按 dirty-worktree 协议记录的改动归属逐项核对。只允许暂存明确属于当前 change 的路径：change 原来所在的路径、脚本输出的实际 archive 路径、归档目录中已更新为 `branch_status: handled` 的 `.comet.yaml`、被本次 delta 更新的 main specs，以及当前 Design Doc/Plan 的归档元数据。无法确定某个路径的改动归属时，停止并请用户处理。

使用显式 pathspec 暂存核对后的路径，再检查 staged diff；不得使用全仓库暂存，也不得把用户已有改动混入归档提交：

```bash
git add -- <逐项核对后的归档路径...>
git diff --cached --stat
git commit -m "chore: archive <change-name>"
```

提交失败或 staged diff 含无关路径时停止，不得继续分支处理。

### 5. 交付归档提交并完成

归档提交成功后，用 `state delivery --file` 补写实际 commit，再由 Runtime 核对归档提交与交付目标。根据核对结果，只执行已授权且未完成的动作。记录失败时停止交付，不重新提交；恢复时，先核对已有 Git 提交和分支状态，再补齐记录。交付回执由 Runtime 保存，不能为了记录 commit 而反复创建归档提交。

- A「仅归档（不推送）」：不执行任何远端操作，归档提交只保留在当前绑定分支。
- B「确认归档并立即推送」：推送当前绑定分支一次。
- C「确认归档、立即推送并创建 PR」：先推送当前绑定分支一次，再通过已配置的 GitHub 集成创建 PR；Step 1 的明确选择就是创建 PR 的授权，不得再次改成其他分支处置方式。

push 或 PR 调用后，使用 delivery --verify 核对实际远端分支和 PR。PR 创建成功后，通过 delivery --file 补写实际 prUrl，并保留此前的 action、目标和 commit。调用超时或没有返回明确结果时，先查询实际结果，不能盲目重试。失败时保留 delivery 和 current selection，只继续已授权但尚未完成的动作；不得改写、删除或切换分支。

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

按 context-recovery.md 执行，phase 为 archive。读取已保存的 delivery 记录，不能依赖当前对话回忆用户选过 A、B 还是 C。Runtime 核对归档目录、提交、远端和 PR 后，只继续尚未完成的动作；local 不执行远端操作。旧 change 只有 handled 记录、缺少授权、交付目标发生变化，或分支关系与记录不一致时，停止并请用户明确确认。不能自行推断授权，也不能自动调整分支关系。
