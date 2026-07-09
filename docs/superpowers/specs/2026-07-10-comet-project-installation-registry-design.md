# Comet Project Installation Registry 设计

日期：2026-07-10

状态：草案，待用户 review 后进入 implementation plan

范围：为 project-scope Comet 安装增加用户级项目索引，让 `comet update` 和 `comet uninstall` 可以一键处理所有已有索引项目

关联 issue：[#178](https://github.com/rpamis/comet/issues/178)

## 背景

Comet 目前推荐用户在项目级安装。这样做的好处是每个仓库拥有自己的 Agent rules、skills、hooks、`.comet/config.yaml` 和工作目录，不会让全局配置意外影响所有项目。

问题是 project-scope 安装分散在不同项目目录里。当前 `comet update [path]` 和 `comet uninstall [path]` 只会检测：

1. 当前传入的 `projectPath` 下的 project-scope 安装。
2. 用户 home 下的 global-scope 安装。

它们不会知道用户还在哪些其他项目中安装过 Comet。因此用户有多个 project-scope 安装时，更新和卸载都必须进入每个项目重复执行命令。issue #178 希望在用户级目录下记录安装过的项目，从而支持“一键 update”和“一键 uninstall”。

这个问题不是单个检测 bug，而是缺少一层用户级安装索引。索引应降低重复操作成本，但不能成为安装状态的唯一真相。真实状态仍必须来自每个项目目录里的平台 skills/rules/hooks 文件。

## 当前行为

相关入口：

- `app/commands/init.ts`
- `app/commands/update.ts`
- `app/commands/uninstall.ts`
- `platform/install/detect.ts`
- `domains/skill/platform-install.ts`
- `domains/skill/uninstall.ts`

当前检测模型：

```text
project scope -> scan <projectPath>/<platform skills dir>/skills/
global scope  -> scan <home>/<platform skills dir>/skills/
```

`detectInstalledCometTargets(projectPath)` 只接受一个 project path。它可以找出这个项目里的 project-scope Comet，也可以找出 home 里的 global-scope Comet，但它无法枚举“其他项目”。

symlink 安装模式已经使用 `.comet/skills/` 作为共享 skills store：

```text
project scope symlink -> <project>/.comet/skills/
global scope symlink  -> ~/.comet/skills/
```

新的安装索引不能与这个 skills store 混用。索引是用户级状态，记录项目路径；skills store 是安装产物，存放 skill 文件。两者职责不同。

## 目标

1. 在用户级目录维护 project-scope Comet 安装索引。
2. `comet init --scope project` 成功后写入或刷新当前项目索引。
3. `comet update` 成功更新 project-scope 安装后刷新对应项目索引。
4. `comet uninstall` 成功卸载 project-scope 安装后从索引移除对应项目。
5. `comet update` / `comet uninstall` 在交互模式下检测到已有索引项目时，默认选择“所有已有索引项目”。
6. 非交互或 JSON 模式保持可预测：只有显式传 `--all-projects` 才跨项目操作。
7. 跨项目操作前列出项目清单和检测到的 Comet targets，让用户确认。
8. 执行前重新检测每个项目的真实安装状态，跳过并清理失效索引。
9. 保持当前单项目 update/uninstall 的默认脚本行为兼容。
10. 不在 GitHub 上自动评论、不自动提交 PR。

## 非目标

- 不做全盘扫描，不递归搜索用户磁盘上的所有 `.comet/` 或平台配置目录。
- 不尝试发现历史上已经安装但从未写入索引的项目。它们会在用户下次对该项目运行 `init` 或 `update` 后进入索引。
- 不把 registry 作为安装状态的唯一真相。执行前必须重新检测项目目录。
- 不改变 global-scope 安装的检测和卸载语义。
- 不新增后台进程、文件 watcher 或定时任务。
- 不自动删除 registry 以外的用户文件。
- 不改变 `comet status`、Classic runtime 或 workflow state。

## 推荐方案

新增用户级 project installation registry。

默认路径：

```text
~/.comet/installations.json
```

Windows 上对应：

```text
C:\Users\<user>\.comet\installations.json
```

这个路径沿用 Comet 已有的 `~/.comet` 用户级目录心智，同时不受任意单个项目影响。它只记录 project-scope 安装过的项目，global-scope 安装仍然由 home 下的平台目录直接检测。

### 为什么不用磁盘扫描

全盘扫描看似不需要维护状态，但会带来明显问题：

1. 慢。用户项目可能分布在多个磁盘、网络盘或权限受限目录。
2. 吵。扫描会碰到大量无关目录、权限错误和历史缓存。
3. 不可靠。不同平台 skills 目录结构不完全一致，单靠目录名容易误判。
4. 隐私感差。用户只是想更新 Comet，不期望 CLI 扫描整个 home 或磁盘。

registry 模型更符合 Comet 当前 CLI 习惯：安装时记录，执行时验证，状态只服务于后续用户明确触发的命令。

## Registry 数据模型

第一版使用 JSON，方便无依赖读写，也方便用户手动查看。

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-10T00:00:00.000Z",
  "projects": [
    {
      "path": "D:\\Project\\Comet",
      "canonicalPath": "D:\\Project\\Comet",
      "addedAt": "2026-07-10T00:00:00.000Z",
      "updatedAt": "2026-07-10T00:00:00.000Z",
      "lastSeenAt": "2026-07-10T00:00:00.000Z",
      "lastSource": "init",
      "lastTargets": [
        {
          "platform": "claude",
          "language": "zh"
        }
      ]
    }
  ]
}
```

字段说明：

- `schemaVersion`：当前为 `1`，以后迁移时使用。
- `path`：用户可读的绝对项目路径，来自 `path.resolve(targetPath)`。
- `canonicalPath`：尽量通过 realpath 得到的去重 key。路径不存在时退回 resolved path。Windows 上比较时大小写不敏感。
- `addedAt`：首次记录时间。
- `updatedAt`：该项目 registry entry 最近刷新时间。
- `lastSeenAt`：最近一次验证项目仍有 project-scope Comet 安装的时间。
- `lastSource`：最近一次刷新来源，取值为 `init`、`update`、`repair`。
- `lastTargets`：最近一次检测到的 project-scope Comet targets。它用于预览，不用于跳过执行前检测。

### 路径去重

同一个项目可能通过不同路径进入，例如 symlink、大小写差异或相对路径。registry 写入时：

1. 先把输入路径转成绝对路径。
2. 如果项目存在，尽量使用 `fs.realpath()` 得到 `canonicalPath`。
3. Windows 上使用小写 canonical key 去重。
4. 保留最新的 `path` 作为显示路径，但不新建重复 entry。

### 文件写入

写入必须是原子风格：

1. 确保 `~/.comet/` 存在。
2. 写入同目录临时文件。
3. rename 到 `installations.json`。

如果 registry 文件 JSON 损坏：

- 单项目 `init` / `update` 可以提示 registry 无法读取，并保守地重新创建一个只包含当前项目的新 registry。
- `--all-projects` 不能安全得到项目列表，应失败并提示用户修复或删除损坏的 registry。

这个规则避免跨项目命令在索引损坏时误判“没有项目”，也避免普通单项目更新被 registry 损坏完全卡死。

## 命令行为

### `comet init`

当 `scope === 'project'` 时，在命令完成前重新检测当前项目的 project-scope Comet targets：

```text
detectInstalledCometTargets(projectPath, { scopes: ['project'] })
```

如果存在 targets，就写入 registry。即使用户选择跳过已有 Comet 文件，只要项目确实已有 project-scope Comet 安装，也应该记录。

当 `scope === 'global'` 时，不写入 project registry。

### `comet update`

新增 CLI 选项：

```text
comet update [path] --all-projects
comet update [path] --current-project
```

`--current-project` 用于交互默认改变后仍能显式保留旧行为。两个选项互斥。

交互模式：

1. 读取 registry。
2. 如果 registry 中存在至少一个项目，则询问 update 范围。
3. 默认选项是“所有已有索引项目”。
4. 备选项是“当前项目”。
5. 用户选择所有项目后，列出项目清单和检测到的 project targets，再确认执行。

非交互 / JSON 模式：

- 不隐式跨项目。
- 只有传 `--all-projects` 才处理所有索引项目。
- 不传 `--all-projects` 时保持当前单项目行为。

跨项目执行时，每个项目都走完整 project-scope update：

1. 重新检测该项目的 project-scope Comet targets。
2. 如果项目不存在、不可读或没有 project-scope Comet targets，则跳过。
3. 对有效项目执行 skills、rules、hooks、project instructions、`.comet/config.yaml` 更新。
4. 如果该项目有 project-local `@rpamis/comet` package，则在该项目内更新 npm package。
5. 如果使用的是 global package，则 global npm 更新最多执行一次，不对每个项目重复执行。
6. 更新成功后刷新该项目 registry entry。

`--skip-npm` 对所有项目生效。

`--scope global` 与 `--all-projects` 互斥，因为 registry 只覆盖 project-scope 安装。若用户要更新 global 安装，继续使用：

```text
comet update --scope global
```

### `comet uninstall`

新增 CLI 选项：

```text
comet uninstall [path] --all-projects
comet uninstall [path] --current-project
```

交互模式和 `update` 一样，在存在 registry 项目时默认选择“所有已有索引项目”。

因为 uninstall 会删除 skills、rules、hooks、project instructions 和 `.comet/` 工作目录，跨项目 uninstall 必须额外确认。推荐交互顺序：

1. 选择范围，默认“所有已有索引项目”。
2. 检测并列出将处理的项目。
3. 列出每个项目里的 Comet targets。
4. 询问一次确认。
5. 如果用户没有传 `--force`，保留现有 target checkbox 选择能力，但在跨项目模式中按项目分组展示。

非交互 / JSON 模式：

- 不隐式跨项目。
- 只有传 `--all-projects` 才跨项目。
- `--force --all-projects` 可以跳过确认，但仍要验证每个项目真实存在 project-scope Comet 安装。

卸载成功后：

1. 重新检测该项目 project-scope Comet targets。
2. 如果没有剩余 project-scope Comet targets，则从 registry 移除该项目。
3. 如果仍有剩余 targets，则刷新 registry，保留该项目。

### `comet doctor`

第一版不改变 `doctor` 行为。

后续可以考虑增加：

```text
comet doctor --registry
```

但这不属于 issue #178 的第一版范围。

## 交互文案

英文：

```text
Update scope:
> All indexed projects
  Current project only
```

中文：

```text
更新范围：
> 所有已有索引项目
  仅当前项目
```

跨项目 update 确认：

```text
Comet will update 3 indexed projects:
  - D:\Project\Comet
    Claude Code, Codex
  - D:\Project\comet-vibe
    Claude Code
  - D:\Project\comet-website-docs
    Codex

Proceed?
```

跨项目 uninstall 确认：

```text
Comet will uninstall project-scope files from 3 indexed projects:
  - D:\Project\Comet
    Claude Code, Codex
  - D:\Project\comet-vibe
    Claude Code
  - D:\Project\comet-website-docs
    Codex

This removes Comet-managed project files from each project. Proceed?
```

失效项目提示：

```text
Skipped stale registry entry: D:\Old\Project (project no longer exists)
Skipped stale registry entry: D:\Other\Repo (no project-scope Comet install detected)
```

## JSON 输出

当前单项目 JSON 输出保持兼容。

跨项目 JSON 使用新的顶层结构：

```json
{
  "mode": "all-projects",
  "registry": {
    "path": "C:\\Users\\user\\.comet\\installations.json",
    "projectsFound": 3,
    "staleRemoved": 1
  },
  "projects": [
    {
      "projectPath": "D:\\Project\\Comet",
      "status": "updated",
      "targets": [
        {
          "scope": "project",
          "platform": "claude",
          "language": "zh"
        }
      ],
      "summary": {
        "skillsCopied": 12,
        "rulesCopied": 1,
        "hooksInstalled": 1,
        "projectInstructionsUpdated": 2
      }
    }
  ]
}
```

`uninstall --all-projects --json` 使用同样的 `mode`、`registry`、`projects` 外形，但每个项目 summary 使用 removed 计数。

项目级错误不应让其他项目默认停止，除非错误发生在 registry 读取、CLI 参数冲突或 npm global self-update 这类全局前置步骤。每个项目结果可以是：

- `updated`
- `uninstalled`
- `skipped`
- `failed`

## 模块边界

新增模块建议：

```text
platform/install/project-registry.ts
```

职责：

- 计算 registry 路径。
- 读取 registry。
- 校验 schema。
- 规范化项目路径。
- upsert 项目。
- remove 项目。
- prune stale 项。
- 原子写入。

不负责：

- 检测 Comet targets。
- 执行 update / uninstall。
- 打印 CLI 文案。

`app/commands/update.ts` 和 `app/commands/uninstall.ts` 负责 orchestration。为避免继续膨胀，可以把共享的跨项目执行 helper 放在 `app/commands/project-scope-selection.ts` 或一个相近的 app-level helper 中。这个 helper 只处理交互选择和 per-project orchestration，不承载平台规则。

检测仍然使用现有 source of truth：

```text
detectInstalledCometTargets(projectPath, { scopes: ['project'] })
```

## 数据流

### init 写入 registry

```text
comet init --scope project
  -> 安装/跳过已有 project Comet files
  -> detect project-scope Comet targets
  -> 如果 targets 非空：upsert registry entry
```

### update 所有项目

```text
comet update
  -> 读取 registry
  -> 交互默认选择 all indexed projects
  -> 对每个 project 重新检测 project-scope targets
  -> 跳过并清理 stale entries
  -> 逐项目执行 project update
  -> 刷新成功项目的 registry entry
  -> 输出聚合 summary
```

### uninstall 所有项目

```text
comet uninstall
  -> 读取 registry
  -> 交互默认选择 all indexed projects
  -> 对每个 project 重新检测 project-scope targets
  -> 展示 destructive preview
  -> 用户确认
  -> 逐项目执行 project uninstall
  -> 无剩余 project targets 的项目从 registry 移除
  -> 输出聚合 summary
```

## 错误处理

### Registry 文件不存在

视为没有索引项目。

单项目 `init` / `update` 成功后会创建。

### Registry JSON 损坏

单项目命令：

- 不阻止当前项目操作。
- 操作成功后重建 registry，仅包含当前已验证项目。
- 输出 warning。

跨项目命令：

- 失败。
- 提示 registry 损坏，用户可修复或删除 `~/.comet/installations.json` 后重试。

### 项目路径不存在

跨项目执行时跳过并从 registry 移除。

### 项目可访问但无 project-scope Comet 安装

跳过并从 registry 移除。

### 项目读取权限错误

跳过但不移除 registry entry，因为无法确认项目是否真的失效。

### 某个项目 update/uninstall 失败

记录该项目 `failed`，继续处理其他项目。最终 summary 标明失败数量。

### 参数冲突

以下组合报错：

```text
--all-projects --current-project
--all-projects --scope global
```

## 测试策略

新增 registry 单元测试：

- registry 文件不存在时返回空列表。
- upsert 创建文件并保留 `addedAt`。
- 相同路径重复写入会去重。
- Windows 风格大小写差异按同一项目处理。
- path 不存在时仍能用 resolved path 做 fallback key。
- remove 项目后文件更新。
- invalid JSON 在 all-projects 读取路径上报错。
- stale project prune 只删除确认失效的 entry。

扩展 app tests：

- `initCommand` project scope 成功后写 registry。
- `initCommand` global scope 不写 registry。
- `updateCommand` 交互模式默认选择所有已有索引项目。
- `updateCommand --all-projects --json --skip-npm` 更新多个项目并输出聚合 JSON。
- `updateCommand --scope global --all-projects` 报参数冲突。
- `uninstallCommand` 交互模式默认选择所有已有索引项目。
- `uninstallCommand --all-projects --force --json` 卸载多个项目并清理 registry。
- stale entry 被跳过并清理。
- 权限/读取错误 entry 被跳过但保留。

建议验证命令：

```bash
npx vitest run test/platform/project-registry.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/app/init-e2e.test.ts
npx vitest run
node build.js
npx prettier --check app/ domains/ platform/ test/app/update.test.ts test/app/uninstall.test.ts test/platform/project-registry.test.ts
git diff --check
```

本地 Windows 环境中如果 `pnpm` wrapper 受 no-TTY 或依赖状态影响，可以优先使用直接的 `node` / `npx vitest` 命令。

## 发布和 Changelog

实现该功能后需要更新 `CHANGELOG.md`，因为这是用户可见的新 CLI 能力。

候选分类：

```text
### Added

- **Project installation registry**: Added a user-level registry for project-scope Comet installs so update and uninstall can operate across all indexed projects from one command.
```

版本号需要在实现阶段按仓库规则重新确认：

1. 检查 `package.json` 当前版本。
2. 检查 `origin/master` 版本。
3. 如果当前分支已有高于 master 的版本条目，则追加到同一版本。
4. 不把 spec 编写过程或中间实现修正写入 changelog。

## 开放问题

第一版已确定：

- 交互默认选择“所有已有索引项目”。
- JSON / force 等非交互路径不隐式跨项目，必须显式传 `--all-projects`。
- registry 只记录 project-scope 安装。

后续 implementation plan 需要进一步拆清：

1. 是否把跨项目 update 的 per-project runner 从现有 `updateCommand` 中抽成内部 helper，以减少重复逻辑。
2. uninstall 跨项目模式中是否保留逐 target checkbox，还是只做项目级确认后移除每个项目的全部 project-scope targets。
3. registry corrupt 后单项目命令重建 registry 时，warning 文案是否需要 i18n。

## 成功标准

1. 用户在多个项目中运行过 project-scope `comet init` 后，可以在任一项目运行 `comet update`，交互默认更新所有已有索引项目。
2. 用户可以运行 `comet uninstall`，交互默认卸载所有已有索引项目，并在执行前看到清晰的 destructive preview。
3. 旧脚本不受影响：没有 `--all-projects` 的 JSON / 非交互调用仍按当前项目执行。
4. registry 中的失效项目不会导致命令失败，也不会被当成真实安装处理。
5. global-scope 安装仍通过现有 `--scope global` 路径处理。
6. 测试覆盖 registry 读写、路径去重、stale 清理、跨项目 update/uninstall 和 CLI 参数冲突。
