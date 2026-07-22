# Comet 贡献指南

语言：[English](CONTRIBUTING.md) | [中文](CONTRIBUTING-zh.md)

感谢你帮助改进 Comet。这份指南说明如何配置项目、准备改动、维护分支、提交 PR，以及如何更新 Skill、Workflow runtime 等 Comet 特有资产。

更深层的项目规范（中文术语翻译、Changelog 撰写、Skill 双语同步、README 改动克制等）写在 `CLAUDE.md` 中，本指南只覆盖贡献流程本身，不重复那些规则。

## 开始之前

- 对于首次贡献的开发者可在issue中找到“good first issue”标签的任务。
- 修复 bug 前，先确认是否已有 issue 或近期 PR 覆盖同一问题。
- 较大的行为变更建议先开 issue 或 draft PR，避免方向还没对齐就写太多代码。
- 每个贡献保持一个清晰目的；无关改动拆成多个 PR。
- 添加测试，或说明为什么这次改动不需要测试。
- 行为、命令、工作流或用户可见文案变化时，同步更新文档与 `CHANGELOG.md`。
- PR版本只能够领先master 1个版本，如master为0.3.0，则pr的版本为0.3.1。

## 标准贡献流程

- 在想要认领的issue下留言认领，避免重复工作。
- 从最新 `master` 创建任务分支，按功能或修复点命名，例如 `fix/dev-resync-docs` 或 `docs/contributing-guide`。
- 在本地实现改动，补充测试，运行定向检查。
- 在 PR review 前运行完整验证：`pnpm build && pnpm lint && pnpm format:check && pnpm test`，纯文档改动除外。
- 向 `master` 开 PR，按照模版说明改了什么、为什么改、如何验证。
- 提交PR后会有3位AI Review，他们不一定给出的是正确的意见，你需要识别哪些是需要修改的，哪些是AI误判的，尽可能的解决和自身PR相关的内容
- 修复完AI Review意见后，只需要推送你的修改，PR会自动识别，你需要对AI的每一个评论进行回复，对于已解决的问题点击Resolve conversation。
- 完整修复后，等待项目维护者的人工审核反馈。

## 哪些是可以认领的任务

- issue标签为“good first issue”的任务。
- issue标签为“task”的任务
- issue标签为“bug”的任务
- 认领前请确认该issue没有被其他人认领，或分配给其他人，避免重复工作。

## 开发环境

```bash
git clone https://github.com/rpamis/comet
cd comet
pnpm install
pnpm build
```

- Node.js `>=22`，pnpm 版本以 `package.json` 的 `packageManager` 字段为准（当前 `pnpm@10.18.3`）。
- 如果本地依赖安装或构建行为与 CI 不一致，请在 PR 中说明。

## 常用命令

| 命令                         | 用途                                                                      |
| ---------------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`                   | TypeScript watch 模式                                                     |
| `pnpm build`                 | 全量构建（Classic、Native、Entry runtime + dashboard）                    |
| `pnpm build:classic-runtime` | 单独打包 Classic runtime（`scripts/build/build-classic-runtime.mjs`）     |
| `pnpm build:native-runtime`  | 单独打包 Native runtime（`scripts/build/build-native-runtime.mjs`）       |
| `pnpm build:entry-runtime`   | 单独打包共享入口与 Hook Router（`scripts/build/build-entry-runtime.mjs`） |
| `pnpm build:dashboard`       | 单独构建 `comet dashboard` 前端（Vite）                                   |
| `pnpm dev:dashboard`         | Dashboard 前端开发模式                                                    |
| `pnpm test`                  | 运行单元测试（Vitest）                                                    |
| `pnpm test:coverage`         | 运行测试并生成覆盖率                                                      |
| `pnpm test:script-smoke`     | 运行 Classic 启动器 smoke 套件，CI 入口                                   |
| `pnpm test:watch`            | Vitest watch 模式                                                         |
| `pnpm lint`                  | ESLint + 架构 linter                                                      |
| `pnpm lint:architecture`     | 仓库分层 linter（`scripts/lint/architecture.mjs`）                        |
| `pnpm lint:fix`              | ESLint 自动修复                                                           |
| `pnpm format`                | Prettier 格式化 `app/`、`domains/`、`platform/`                           |
| `pnpm format:check`          | Prettier 校验（CI 强制）                                                  |
| `pnpm benchmark:context`     | 上下文压缩 benchmark                                                      |
| `pnpm benchmark:execution`   | 上下文执行 benchmark                                                      |
| `pnpm benchmark:classic`     | Classic 基线回归 benchmark                                                |
| `pnpm benchmark:bundle`      | Bundle 兼容性 benchmark（含构建）                                         |

如果改动 Workflow runtime，先按归属运行对应新鲜度检查；Classic launcher 另有定向 smoke：

```bash
node scripts/build/build-classic-runtime.mjs --check
node scripts/build/build-native-runtime.mjs --check
node scripts/build/build-entry-runtime.mjs --check
npx vitest run test/domains/comet-classic/comet-scripts.test.ts
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
<type>(<scope>): <description>
```

类型：`feat`、`fix`、`refactor`、`docs`、`test`、`chore`、`perf`、`build`、`ci`

示例：

```text
feat: add eval report language switch
fix(eval): prevent chart labels from overlapping
docs: update contributor commit rules
```

## 本地 Pre-commit 钩子

仓库已配置 Git pre-commit 钩子（`.husky/pre-commit` + `lint-staged`），每次 `git commit` 会自动对 `app/`、`domains/`、`platform/` 下的暂存源文件运行 `prettier --write`，与 CI `format:check` 范围一致，不依赖编辑器，所有贡献者生效。

- 钩子在 `pnpm install` 时由 `husky` 安装。
- Windows 上若 `core.autocrlf=true`，未改动的旧文件可能因 CRLF 被 `prettier --check` 误报；钩子只处理暂存文件，旧文件下次编辑时会自动转为 LF。
- 提交前仍建议手动跑一次 `pnpm lint`、`pnpm build`、`pnpm test`，CI 会强制检查。

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

纯文档改动至少运行相关格式检查。根 `README.md` 与 `README-zh.md` 在 `.prettierignore` 中，不参与 Prettier 校验，例如：

```bash
npx prettier --check CONTRIBUTING.md CONTRIBUTING-zh.md
```

## 项目结构

源码按责任分层，每一层职责清晰：

```text
app/                 # CLI 入口与命令编排层。只组合 domain/platform 能力，不承载领域规则
├── cli/             # Commander 注册
└── commands/        # comet init / status / doctor / update / bundle / publish / skill / creator / eval / dashboard ...

domains/             # 业务领域模块
├── bundle/          # Skill bundle 编译、发布、加载
├── comet-classic/   # Classic 工作流（state / guard / handoff / archive / intent / hook-guard）
├── comet-entry/     # Native/Classic 共享入口、selection 与 Hook Router
├── comet-native/    # Native 工作流（change / state / evidence / archive / guard）
├── dashboard/       # comet dashboard 后端 + 前端（web/）
├── engine/          # 通用执行引擎（loop / state / guardrails / evals）
├── eval/            # comet eval 评测
├── factory/         # Skill 创作工厂产物打包
├── integrations/    # 第三方集成（openspec / superpowers / codegraph）
├── skill/           # Skill 安装、发现、偏好、snapshot
└── workflow-contract/ # 跨 workflow 的契约

platform/            # 平台适配层，domain 不直接散落平台差异
├── fs/              # 文件系统工具
├── install/         # 平台定义、检测、安装路径
├── paths/           # 仓库布局解析
├── process/         # 子进程、错误处理、shell quoting
└── version/         # 版本比较

scripts/             # 仓库自动化脚本（构建/发布/benchmark/lint/install）
├── benchmark/       # benchmark 套件
├── build/           # Classic、Native、Entry runtime builder
├── install/         # postinstall.js
├── lib/             # 跨脚本工具
├── lint/            # architecture.mjs、gitignore-top-level.mjs
└── release/         # prepare.js、prepublish-check.js

assets/              # 发布资产：内置 Skill 内容与 install manifest
├── skills/          # 英文 Skill
├── skills-zh/       # 中文 Skill
└── manifest.json    # install 入口

docs/                # 架构、运维、设计文档（docs/superpowers/ 由工作流写入）
```

`bin/comet.js` 是 npm `bin` 入口；`build.js` 是顶层构建脚本；`vitest.config.ts` / `eslint.config.js` / `tsconfig.json` 是工具配置。

## 架构 linter

`pnpm lint:architecture`（`scripts/lint/architecture.mjs`）会校验：

- 顶层目录白名单（`config/repository-layout.json` 的 `allowedTopLevelEntries`）。
- 活跃源码根只能是 `app` / `domains` / `platform`（`sourceRoots`）。
- 各层的子模块（`appModules` / `domainModules` / `platformModules` / `scriptModules`）。
- Classic、Native 与 Entry runtime 入口和生成物一致性。
- 内置 Skill 根目录与 install manifest 一致。
- 测试归属（见下节）。
- 禁止恢复已迁移走的旧目录（例如 `src/`、`test/ts/`）。

如果确实需要新增顶层目录、源码模块、测试根目录或例外，**必须先更新 `config/repository-layout.json`、架构 linter 规则、本指南的相关说明，再开 PR**。

## 测试目录规范

测试目录严格跟随被测对象归属：

| 测试目录                 | 覆盖范围                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `test/app/`              | `app/` 下的 CLI 与命令                                                                 |
| `test/domains/<domain>/` | 对应 `domains/<domain>/`（每个 domain 同名子目录）                                     |
| `test/platform/`         | `platform/` 适配层                                                                     |
| `test/scripts/`          | `scripts/` 自动化脚本                                                                  |
| `test/repository/`       | README、CI workflows、仓库布局、package scripts、各 workflow runtime assets 等跨层约束 |
| `test/fixtures/`         | 测试数据                                                                               |
| `test/helpers/`          | 测试工具（`comet-test-utils.ts`、`ensure-cli-built.ts`、`workflow-plan.ts`）           |

禁止新增 `test/ts/` 这种横向桶；旧文件应迁移到上面对应目录。CI smoke 入口是 `pnpm test:script-smoke`，GitHub Actions 与本地跑同一套 Classic 启动器 smoke。

## 新增平台

1. 在 `platform/install/platforms.ts` 的 `PLATFORMS` 中添加平台定义。
2. 在 `domains/integrations/superpowers.ts` 中更新 `SKILLS_AGENT_MAP`（仅当映射不同时）。
3. 添加或更新测试（`test/platform/` 与相关 domain 测试），覆盖检测、安装路径、生成说明。
4. 同步更新 `assets/manifest.json` 和 README 文档。
5. 如平台对用户可见，在 `CHANGELOG.md` 中记录。

## 新增或更新 Skill

1. 先在 `assets/skills-zh/` 编写或更新中文版本。
2. 确认措辞与行为后再同步 `assets/skills/` 下的英文版本，两版行为等价。
3. 新增 Skill 时同步加入 `assets/manifest.json`。
4. 视情况补充生成资产或安装行为的测试（`test/domains/skill/`、`test/repository/classic-runtime-assets.test.ts`）。
5. 改 Skill 样板（boilerplate）时，所有 `SKILL.md` 与 `reference/*` 中的样板要全量同步。
6. **不能直接修改 Superpowers 和 OpenSpec 的原始 Skill。**

Skill 设计建议：

- **Decision Core first**：面向 Agent 的决策说明放在顶部，包括阶段检测、分发逻辑、错误处理。
- **Reference Appendix**：字段说明、脚本位置、最佳实践放在底部。
- 中文与英文版本行为等价，表达可以自然不同；中文术语遵循 `CLAUDE.md` 的翻译规范（不要把 `gate` 译成"门"）。

## Workflow runtime 与 Hook 路由

工作流脚本是 **Node.js 启动器或生成 bundle（`.mjs`）**，只依赖 Node.js，**不依赖 Bash / Git Bash / WSL**，在 macOS、Linux、Windows 上行为一致。

- Classic 的薄 launcher 位于 `assets/skills/comet/scripts/`，真实逻辑在 `domains/comet-classic/`，由 `pnpm build:classic-runtime` 生成 `comet-runtime.mjs`。
- Native 真实逻辑位于 `domains/comet-native/`，由 `pnpm build:native-runtime` 生成 `assets/skills/comet-native/scripts/comet-native-runtime.mjs`。Native 主流程和 Guard 不得依赖外部 Skill。
- 共享入口、selection 与 Hook Router 位于 `domains/comet-entry/`，由 `pnpm build:entry-runtime` 生成 `comet-entry-runtime.mjs` 和 `comet-hook-router.mjs`。
- 每个平台只安装一份 `comet-workflow-guard` Rule；支持 Hook 的平台只安装一个 `comet-hook-router.mjs`。Router 根据 `.comet/current-change.json` 一次只调用 Native 或 Classic 的一个 Guard。两边的阶段、目录、schema 与 Guard 逻辑保持独立。
- `comet-hook-guard.mjs` 和 `comet-native-hook-guard.mjs` 是各自 runtime 的薄 Guard launcher，不直接作为平台 Hook 安装。
- 跨平台由 Node 保证：hash 用 `node:crypto`，YAML 用 `yaml` 包，子进程用 `child_process`（构建/校验命令走 `spawnSync(cmd, { shell: true })`）。不再有 `sed -i` / `sha256sum` vs `shasum` / `pipefail` 等 shell 可移植性问题。
- `comet-env.mjs` 打印自身所在目录，skill 样板通过 `node "$COMET_ENV"` 解析同级启动器路径，命令统一为 `node "$COMET_STATE" ...` 形式。
- 新增或重命名入口/生成物时，必须同步 `assets/manifest.json`、`config/repository-layout.json` 的对应 runtime 映射，以及 `test/repository/*-runtime-assets.test.ts`；Classic launcher 还需同步 `test/domains/comet-classic/comet-scripts.test.ts` 的 fixture 列表。

运行时分发：

```text
comet-runtime.mjs        <- domains/comet-classic/*
comet-native-runtime.mjs <- domains/comet-native/*
comet-entry-runtime.mjs  <- domains/comet-entry/*
comet-hook-router.mjs    <- 平台唯一 Hook 入口 -> 当前 selection 的一个 workflow Guard
```

## `.comet.yaml` 状态变更

修改 `.comet.yaml` 状态文件字段时，需要同步三处（均在 TypeScript 中）：

1. `domains/comet-classic/classic-state-command.ts`：`set` 白名单与 enum 校验（`SETTABLE_FIELDS` / `MACHINE_OWNED_FIELDS`）。
2. `domains/comet-classic/classic-validate-command.ts`：schema 校验与已知字段集合。
3. `test/domains/comet-classic/comet-scripts.test.ts`：测试中的 YAML 示例与断言。

改完 1/2 后运行 `pnpm build` 重新生成 `comet-runtime.mjs`，否则 `classic-runtime.test.ts` 的新鲜度检查会失败。

## Dashboard / Eval / Skill Creator / Skill CLI

Comet 已从单一 `/comet` 工作流 bundle 扩展为工作流 + Skill 创作平台。涉及这些命令时注意：

- **`comet dashboard`**：本地只读浏览器面板，前端代码在 `domains/dashboard/web/`，由 `pnpm build:dashboard` 单独构建。后端 `domains/dashboard/server.ts` 提供 `--json` 与 `GET /api/dashboard`。
- **`comet eval`**：仓库本地评测，profile、manifest、HTML 报告、token/cost 归因、pass@k/pass^k 等。用法见 `docs/operations/EVAL-USAGE.md`。
- **`comet creator` / `comet publish`**：Skill 创作主流程，详见 `docs/operations/SKILL-CREATION.md`。`domains/bundle/*` 是它们的后端工具。
- **`comet skill add|show|run|continue|check`**：本地 Skill 包管理，代码在 `domains/skill/`。

改这些命令的行为或输出时，要同步更新对应 `docs/operations/*` 文档与对应 `test/domains/<domain>/` 测试。

## 文档与双语规范

详细规则见 `CLAUDE.md`。简记：

- **双语顺序**：Skill / 文档先写中文版（`assets/skills-zh/` / `README-zh.md` / `CONTRIBUTING-zh.md` / `docs/operations/*-ZH.md`），用户确认后再同步英文版。Skill 内容修改必须等中英文完全同步后才写 Changelog。
- **README 改动克制**：feature 更新后不要把所有亮点堆进 README；必要的特性以 `docs/` 引用形式存在。
- **中文术语**：`gate` 不要直译为"门"（"压缩门"/"调试门"不自然），按语境译为"协议""阶段""检查""阻塞点"；修饰性 `proactive/active` 译为"主动式"。
- **Skill 触发句**：中文统一使用 `**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。`，英文统一使用 `**Immediately execute:** Use the Skill tool to load the <skill-name> skill. Skipping this step is prohibited.`。
- **Commit / GitHub 规范**：不要在 GitHub 上未经同意评论或提交 PR；提交信息不追加 `Co-Authored-By` 行。

## Changelog

`CHANGELOG.md` 用英文撰写，记录**用户可见**的行为变化。详细分类与"发布视角检查"规则见 `CLAUDE.md`，这里只列要点：

- 版本号与 `package.json` 一致，新版本条目置顶；只比 `master` 当前版本大一个版本。
- 如果当前分支已有高于 `master` 的版本条目，追加到同一版本下，不要新增流水账版本。
- 分组顺序：`Added → Changed → Fixed → Tests → Removed → Security`，每条以 `- **粗体关键词**: ` 开头。
- 描述行为变化和原因，不写实现细节。
- 写之前先用 `git log <上一个tag>..HEAD --oneline` 看实际差异；只写"用户从上一个版本升级后会注意到的变化"。
- 开发分支内部的 review follow-up、doc sync、test refactor、内部修复不要写进 Changelog。
- 改 Skill 内容的条目，必须等中英文完全同步之后再写。

模板：

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

`### Tests` 只在测试/评估能力本身是用户可运行的发布能力时使用；普通回归测试、覆盖率补充、测试文件迁移不写入。

## 安全

- 发布前扫描 API key、secret、token、private key。
- 保持 `.npmignore` 准确，避免 source-only 文件和本地配置发布到 npm。
- 保持 `.gitignore` 覆盖 secret、凭据和 IDE 特定文件。
- 使用用户提供的 change name 作为文件路径前，必须校验 path traversal。
- Skill 安装在 symlink 模式下，不得替换包含 manifest 外文件的 `skills/` 目录（参见 `CHANGELOG.md` 0.4.0-beta.2 的 issue #159）。
