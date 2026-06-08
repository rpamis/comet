# Comet 贡献指南

语言：[English](CONTRIBUTING.md) | [中文](CONTRIBUTING-zh.md)

感谢你帮助改进 Comet。这份指南偏实操：说明如何配置项目、准备改动、维护分支、提交 PR，以及如何更新 Skill、shell 脚本等 Comet 特有资产。

## 开始之前

- 修复 bug 前，先确认是否已有 issue 或近期 PR 覆盖同一问题。
- 较大的行为变更建议先开 issue 或 draft PR，避免方向还没对齐就写太多代码。
- 每个贡献保持一个清晰目的；无关改动拆成多个 PR。
- 添加测试，或说明为什么这次改动不需要测试。
- 行为、命令、工作流或用户可见文案变化时，同步更新文档。

## 开发环境

```bash
git clone https://github.com/rpamis/comet
cd comet
pnpm install
pnpm build
```

Node.js 与 pnpm 版本以 lockfile 和 CI 支持范围为准。如果本地依赖安装或构建行为与 CI 不一致，请在 PR 中说明。

## 常用命令

| 命令                 | 用途                           |
| -------------------- | ------------------------------ |
| `pnpm dev`           | TypeScript watch 模式          |
| `pnpm build`         | 编译 TypeScript                |
| `pnpm test`          | 运行单元测试                   |
| `pnpm test:coverage` | 运行测试并生成覆盖率           |
| `pnpm test:shell`    | 运行 shell 脚本测试，需要 bats |
| `pnpm lint`          | 运行 ESLint                    |
| `pnpm format`        | 运行 Prettier                  |

如果改动 shell 脚本，最常用的定向检查是：

```bash
npx vitest run test/ts/comet-scripts.test.ts
```

除纯文档改动外，开 PR 或更新 PR 前请运行完整验证：

```bash
pnpm build && pnpm lint && pnpm format:check && pnpm test
```

## 分支模型

- `master` 是唯一权威的开发与发布基线。
- 任务分支从最新 `master` 创建。
- PR 目标分支是 `master`。
- PR 使用 **Squash and merge** 合并。
- 被 squash 的 PR 源分支视为一次性分支：合并后删除，或从 `master` 重新创建/重置后再使用。

Squash merge 会在 `master` 上生成一个新提交。源分支如果仍保留原始多个提交，Git 不一定能识别两边历史包含的是等价变更。因此，不要把 `master` 继续 merge 回已经被 squash 的源分支。

## 准备一个改动

```bash
git fetch origin
git switch master
git pull --ff-only origin master
git switch -c <type>/<short-topic>
```

分支名要短且能说明改动，例如 `fix/dev-resync-docs` 或 `docs/contributing-guide`。

开发过程中：

- 提交保持便于 review 的粒度。
- 优先在实现前或实现同时补测试。
- 开发时运行定向测试。
- 最终 diff 前重新运行格式化。
- 避免大范围重写、无关格式化或无关元数据变更。

## 让 PR 跟上 `master`

如果 PR 分支落后 `master`，优先把任务分支 rebase 到最新 `master`：

```bash
git fetch origin
git switch <your-branch>
git rebase origin/master
# 解决冲突后运行相关检查
git push --force-with-lease
```

rebase 后需要改写远端分支历史，因此使用 `--force-with-lease`。它会保护你本地没有的远端更新；避免使用普通 `--force`。

如果分支混入了无关提交，从 `origin/master` 新建干净分支，只 cherry-pick 属于这个 PR 的提交：

```bash
git fetch origin
git switch -c <topic>-take-2 origin/master
git cherry-pick <commit-1> <commit-2>
# 运行检查
git push --force-with-lease origin <topic>-take-2:<original-branch>
```

这样能保持 PR 容易 review，也能避免把无关工作合进去。

## 共享 `dev` 分支

如果保留共享 `dev` 分支，只把它当作临时工作入口。来自 `dev` 的 PR 被 squash 到 `master` 后，不要再把 `master` merge 回 `dev`。确认 `dev` 没有仍需保留的未 squash 工作后，把 `dev` 重置到 `origin/master`：

```bash
git fetch origin
git switch dev
git status --short
git branch backup/dev-before-sync-YYYYMMDD
git reset --hard origin/master
git push --force-with-lease origin dev
```

如果 `dev` 里还有尚未合并到 `master` 的工作，先把这些工作移到从 `origin/master` 创建的新分支，再重置 `dev`。

## 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
<type>: <description>
```

类型：`feat`、`fix`、`refactor`、`docs`、`test`、`chore`、`perf`、`ci`

示例：

```text
docs: expand contribution workflow
fix: preserve stderr when superpowers install fails
test: cover comet state transitions
```

## PR 流程

1. 更新 `master`，并从它创建任务分支。
2. 实现聚焦的改动，并补充测试。
3. 开发过程中运行定向检查。
4. PR review 前运行 `pnpm build && pnpm lint && pnpm format:check && pnpm test`，纯文档改动除外。
5. 向 `master` 开 PR。
6. 说明改了什么、为什么改、如何验证。
7. 用后续提交响应 review 反馈。
8. PR 通过后使用 **Squash and merge**。
9. 合并后删除或重新创建源分支；不要继续把 `master` merge 回被 squash 的分支。

纯文档改动至少运行相关格式检查，例如：

```bash
npx prettier --check CONTRIBUTING.md CONTRIBUTING-zh.md README.md README-zh.md
```

## 项目结构

```text
src/
├── cli/index.ts       # Commander 注册
├── commands/          # 命令编排
│   ├── init.ts        # comet init
│   ├── status.ts      # comet status
│   ├── doctor.ts      # comet doctor
│   └── update.ts      # comet update
├── core/              # 平台无关的核心逻辑
│   ├── platforms.ts   # 平台定义
│   ├── detect.ts      # 平台检测
│   ├── skills.ts      # Skill 文件操作
│   ├── openspec.ts    # OpenSpec 安装
│   └── superpowers.ts # Superpowers 安装
└── utils/
    └── file-system.ts # 文件系统工具
```

## 新增平台

1. 在 `src/core/platforms.ts` 的 `PLATFORMS` 中添加平台定义。
2. 如果映射不同，在 `src/core/superpowers.ts` 中更新 `SKILLS_AGENT_MAP`。
3. 添加或更新测试，覆盖检测、安装路径和生成说明。
4. 如果平台对用户可见，同步更新 README 文档。

## 新增或更新 Skill

1. 先在 `assets/skills-zh/` 编写或更新中文版本。
2. 确认措辞与行为。
3. 再同步 `assets/skills/` 下的英文版本。
4. 新增 Skill 时同步加入 `assets/manifest.json`。
5. 视情况补充生成资产或安装行为的测试。

Skill 设计建议：

- **Decision Core first**：面向 Agent 的决策说明放在顶部，包括阶段检测、分发逻辑、错误处理。
- **Reference Appendix**：字段说明、脚本位置、最佳实践放在底部。
- 中文和英文版本要保持行为等价，表达可以自然不同。

## Shell 脚本

脚本位于 `assets/skills/comet/scripts/`，必须兼容 macOS、Linux 和 Windows Git Bash。

规则：

- 禁止使用 `sed -i`；GNU 与 BSD 行为不同。字段替换使用 `awk`。
- 同时兼容 GNU 系统的 `sha256sum` 与 BSD/macOS 的 `shasum -a 256`。
- 所有可选 `grep` 结果都加 `|| true`，避免 `pipefail` 误杀脚本。
- 新增脚本必须加入 `test/ts/comet-scripts.test.ts` 的 `beforeEach` 拷贝列表。
- 新增脚本必须加入 `assets/manifest.json`。

脚本依赖关系：

```text
comet-state.sh <- comet-guard.sh, comet-handoff.sh, comet-archive.sh
comet-yaml-validate.sh <- comet-guard.sh (preflight 阶段)
comet-handoff.sh <- comet-state.sh (写入 handoff_context/handoff_hash)
```

如果两个脚本需要同一个小工具函数，例如 hash 或 YAML 解析，允许在各自脚本中独立实现，不强制抽共享 shell 库。

## `.comet.yaml` 状态变更

修改 `.comet.yaml` 状态文件字段时，需要同步三处：

1. `assets/skills/comet/scripts/comet-state.sh`：`cmd_set` 白名单与 enum 校验。
2. `assets/skills/comet/scripts/comet-yaml-validate.sh`：schema 校验与 `KNOWN_KEYS`。
3. `test/ts/comet-scripts.test.ts`：测试中的 YAML 示例与断言。

## Changelog

用户可见行为变化需要更新 `CHANGELOG.md`。新版本条目置顶，版本号必须与 `package.json` 一致。

格式：

```markdown
## What's Changed [x.y.z] - YYYY-MM-DD

### Added

- **功能名**: 描述做了什么以及为什么。

### Changed

### Fixed

### Tests

### Removed

### Security
```

规范：

- 分组顺序：Added、Changed、Fixed、Tests、Removed、Security。
- 每条以 `- **粗体关键词**: ` 开头。
- 描述行为变化和原因，不写实现细节流水账。
- `### Tests` 汇总覆盖场景，不逐条列测试用例。

## 安全

- 发布前扫描 API key、secret、token、private key。
- 保持 `.npmignore` 准确，避免 source-only 文件和本地配置发布到 npm。
- 保持 `.gitignore` 覆盖 secret、凭据和 IDE 特定文件。
- 使用用户提供的 change name 作为文件路径前，必须校验 path traversal。
