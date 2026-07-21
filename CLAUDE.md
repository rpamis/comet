## 回复语言

必须采用中文回答用户

## 测试

验证范围必须与改动风险相匹配，不要在每次编辑后默认运行全量测试。

- 每轮先运行覆盖当前改动的最小相关测试。
- 纯文档或 Skill 内容修改：运行相关契约测试和受影响文件的 Prettier 检查。
- 单一 `app/`、`domains/` 或 `platform/` 模块修改：运行对应测试；涉及编译、Runtime 或生成物时再运行 build。
- 跨模块、Runtime、安装/路由、发布准备或其他高风险修改：最终交付前运行一次全量测试。
- 全量测试失败或超时时，先定位原因；只有修正了明确原因后才重跑，不盲目重复。
- CI 已覆盖全量检查时，可以在本地只运行相关验证，但交付时必须明确说明未在本地运行的检查。

```bash
npx vitest run <相关测试文件>                     # 默认：最小相关测试
npx vitest run                                   # 高风险修改或最终交付前的全量测试
```

## 提交前检查

仓库已配置 Git pre-commit 钩子（husky + lint-staged），每次 `git commit` 会自动对 `app/`、`domains/`、`platform/`、`scripts/`、`test/`、`.github/`、`config/` 下的暂存源文件运行 `prettier --write`（与 CI `format:check` 范围一致；冻结的 `test/fixtures/` 除外），编辑器无关，所有贡献者生效。

根据改动范围选择提交前检查；不要求每个提交机械地运行全部命令（CI 会执行完整检查）：

```bash
pnpm format:check   # 大范围格式检查；小范围可只检查受影响文件
pnpm lint           # 修改源码、测试、脚本或配置时
pnpm build          # 涉及编译、Runtime、生成物或发布资产时
pnpm test           # 高风险修改或最终交付前需要本地全量验证时
```

注：本地 Windows 若 `core.autocrlf=true`，未改动的旧文件可能因 CRLF 被 `prettier --check` 误报；钩子只处理暂存文件，不受影响，旧文件下次编辑时会自动转为 LF。

## Commit 规范

提交信息必须使用类型前缀，格式为 `<type>: <summary>`，scope 可选：`<type>(<scope>): <summary>`。

常用类型包括：`feat`、`fix`、`docs`、`chore`、`refactor`、`test`、`build`、`ci`、`perf`。

示例：

- `feat: add eval report language switch`
- `fix(eval): prevent chart labels from overlapping`
- `docs: update contributor commit rules`

## 项目结构规范

当前源码目录按责任分层：

- `app/`：CLI 入口、命令编排和用户交互层。只能组合 domain/platform 能力，不承载领域规则。
- `domains/`：业务领域模块。每个子目录是一个可独立维护的领域模块，例如 `domains/bundle/`、`domains/comet-classic/`、`domains/comet-native/`、`domains/comet-entry/`、`domains/dashboard/`、`domains/skill/`、`domains/workflow-contract/`。
- `platform/`：文件系统、进程、安装平台、版本、路径等平台适配能力。domain 不应直接散落平台差异逻辑。
- `scripts/`：构建、发布、benchmark、lint 等仓库自动化脚本。可调用源码模块，但不要成为运行时业务入口。
- `assets/`：发布资产和内置 Skill 内容。修改 runtime 源码后必须通过构建同步生成资产，不要把业务逻辑只写在生成物里。

测试目录必须跟随被测对象归属：

- `test/app/` 覆盖 `app/` 命令和 CLI 行为。
- `test/domains/<domain>/` 覆盖对应 `domains/<domain>/` 模块；新增 domain 时同步新增同名测试目录。
- `test/platform/` 覆盖 `platform/` 适配层。
- `test/scripts/` 覆盖 `scripts/` 自动化脚本。
- `test/repository/` 覆盖 README、CI、仓库布局等跨层约束。
- `test/fixtures/` 和 `test/helpers/` 只放测试数据与测试工具。
- 禁止新增或恢复 `test/ts/` 这种横向桶；旧文件应迁移到上面对应目录。

架构约束由 `pnpm run lint:architecture` 校验，并已接入 `pnpm lint`。它会检查顶层目录白名单、活跃源码根、app/domain/platform 子模块、脚本模块、Classic/Native/Entry runtime 入口与生成物、内置 Skill 根目录、测试归属和禁止旧目录回归。如果确实需要新增顶层目录、源码模块、测试根目录或例外，必须先更新 `config/repository-layout.json`、架构 linter 和本节说明。

## Workflow runtime 与 Hook 路由规范

脚本是 **Node.js 启动器或生成 bundle（`.mjs`）**，只依赖 Node.js，**不依赖 bash / Git Bash / WSL**。

- Classic 真实逻辑位于 `domains/comet-classic/`，由 `pnpm build:classic-runtime` 生成 `assets/skills/comet/scripts/comet-runtime.mjs`；同目录其他 Classic launcher 保持薄封装。
- Native 真实逻辑位于 `domains/comet-native/`，由 `pnpm build:native-runtime` 生成 `assets/skills/comet-native/scripts/comet-native-runtime.mjs`；Native 主流程和 Guard 不得依赖外部 Skill。
- 共享入口、selection 与 Hook Router 位于 `domains/comet-entry/`，由 `pnpm build:entry-runtime` 生成 `comet-entry-runtime.mjs` 与 `comet-hook-router.mjs`。
- 每个平台只安装一份 `comet-workflow-guard` Rule；支持 Hook 的平台只安装一个 `comet-hook-router.mjs`。Router 根据 `.comet/current-change.json` 一次只调用当前 Native 或 Classic Guard，两边的阶段、目录、schema 与 Guard 逻辑保持独立。
- `comet-hook-guard.mjs` 与 `comet-native-hook-guard.mjs` 是各自 runtime 的薄 Guard launcher，不直接作为平台 Hook 安装。
- `comet-env.mjs` 打印自身所在目录（scripts dir），供 skill 样板代码解析同级启动器路径。
- 跨平台由 Node 保证：hash 用 `node:crypto`，YAML 用 `yaml` 包，子进程用 `child_process`（构建/校验命令走 `spawnSync(cmd, { shell: true })`）。不再有 `sed -i` / `sha256sum` vs `shasum` / `pipefail` 等 shell 可移植性问题。
- 新增/重命名 runtime 入口或生成物必须同步 `assets/manifest.json`、`config/repository-layout.json` 的对应 runtime 映射与 `test/repository/*-runtime-assets.test.ts`；Classic launcher 还需同步 `test/domains/comet-classic/comet-scripts.test.ts` 的 fixture 列表。
- skill 样板（boilerplate，当前版本 `v3`）在所有 SKILL.md / reference 中重复，改动需全量同步；样板通过 `find` 定位 `comet-env.mjs`，再用 `node "$COMET_ENV"` 解析路径，命令统一为 `node "$COMET_STATE" ...` 形式。

## 脚本依赖关系

```
comet-runtime.mjs        ← domains/comet-classic/*
comet-native-runtime.mjs ← domains/comet-native/*
comet-entry-runtime.mjs  ← domains/comet-entry/*
comet-hook-router.mjs    ← 平台唯一 Hook 入口 → 当前 selection 的一个 workflow Guard
```

Classic 打包入口 `domains/comet-classic/classic-cli.ts` 导出 `main` / `runClassicCli` / `CLASSIC_COMMANDS`；Native 与 Entry 的入口由 `config/repository-layout.json` 分别声明。esbuild ESM bundle 保留所需 export，启动器直接 import 调用，单进程、无 bash、无二次 node 派生。跨 workflow 的稳定契约放在 `domains/workflow-contract/`，入口归属与路由放在 `domains/comet-entry/`；不要为了复用而合并 Native 与 Classic 的状态机或 Guard。

## .comet.yaml 状态机

每个 change 的状态文件，字段变更需要同步三处（全在 TypeScript 中）：

1. `domains/comet-classic/classic-state-command.ts` — `set` 白名单 + enum 验证（`SETTABLE_FIELDS` / `MACHINE_OWNED_FIELDS`）
2. `domains/comet-classic/classic-validate-command.ts` — schema 校验 + 已知字段
3. `test/domains/comet-classic/comet-scripts.test.ts` — 测试中的 yaml 字符串

改完 1/2 后 `pnpm build` 重新生成 `comet-runtime.mjs`，否则 `classic-runtime.test.ts` 的新鲜度检查会失败。

## 双语言 Skill

skill 优化时先写中文版本（`assets/skills-zh/`），用户确认后再修改英文版本（`assets/skills/`）。

## 中文术语翻译规范

中文文档不得把英文 “gate” 直译为“门”（如“压缩门”“调试门”“确认门”），这种译法在中文语境下不自然。应按实际含义翻译：

- `gate`（阶段性检查/阻塞点）→ 根据语境用“协议”“阶段”“检查”“阻塞点”等，如 `debug gate` → “异常调试协议”
- 修饰词性质的 `proactive/active` → “主动式”，如 `proactive context compression` → “主动式上下文压缩”，不写作“主动压缩门”
- 英文版保持原术语（如 Debug Gate），仅中文版需要遵循本规范

## Skill 触发表述规范

修改 skill 时，新增或调整依赖 skill 的触发方式必须和既有写法保持一致：

- 中文统一使用：`**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。`
- 英文统一使用：`**Immediately execute:** Use the Skill tool to load the <skill-name> skill. Skipping this step is prohibited.`
- 后续输入、上下文或执行要求写在“技能加载后 / After the skill loads”段落，不要把 `ARGUMENTS`、`fast-forward` 等另一套调用术语混入触发句。

## Changelog 规范

Changelog写英文

每次代码产生变更你都应该在完成后写Changelog，并确定是否需要升级版本号，版本号只会比master分支的版本号大一个版本，你需要确定一下当前master的版本号后做决定

如果当前已经有了一个比master大的版本Changelog，则应该追加到同一个版本的Changelog条目下

如果修改的是Skill内容，则需要等中英文完全同步之后再写Changelog

文件：`CHANGELOG.md`，新版本条目置顶。

```
## What's Changed [x.y.z] - YYYY-MM-DD

### Added / Changed / Fixed / Tests / Removed / Security

- **功能名**: 描述做了什么以及为什么
```

要点：

- 版本号与 `package.json` 的 `version` 字段一致
- 每条以 `- **粗体关键词**: ` 开头，后接具体变更内容
- 按类型分组：Added → Changed → Fixed → Tests → Removed → Security
- 描述侧重 **行为变更**（what + why），不是实现细节
- `### Tests` 条目汇总新增测试覆盖的场景，不逐条列出测试用例

写的Changelog应该是用户可视的版本，如果在一个分支上多次解决问题，但又不是master中的问题，而是开发中的问题，那这种内容不需要写入

### 常见错误：写偏问题

**核心规则：每个版本条目只描述与上一个 tag 之间的差异，不是开发过程记录。**

错误做法：

- 把开发分支上的所有迭代都写进 changelog
- 记录设计过程、文档迭代、重构历史
- 把已经在上一个 tag 中发布的内容重复写入
- 把开发中解决的内部问题（而非最终用户可见的改动）写入

正确做法：

- 先用 `git log <上一个tag>..HEAD --oneline` 确认实际改动范围
- 只写最终用户升级后能感知到的变化
- 如果一个功能经历了多轮迭代，只写最终形态，不写中间过程
- 如果一个改动在开发中解决了多个内部问题，合并为一条用户视角的描述
- 开发中的设计文档、重构、内部修复不需要出现在 changelog 中（除非它们改变了用户可见行为）

判断标准：**"一个从上个版本升级的用户，会注意到这个变化吗？"** 如果不会，不要写入。

### Changelog 发布视角检查

写 `CHANGELOG.md` 前必须先完成以下检查，不允许直接把 commit log 改写成 changelog：

1. **确定比较基线**
   - 确认 `package.json` 当前版本、`origin/master` 版本、上一个发布 tag。
   - 用 `git log <上一个tag>..HEAD --oneline` 只生成候选清单，不等于逐条写入。
   - 如果当前分支已有高于 master 的版本条目，只重写/追加到同一个版本条目，不新增流水账版本。

2. **先列候选，再筛选**
   每个候选变化都必须先判断：
   - 用户从上一个版本升级后是否会感知到？
   - 它是最终能力/行为，还是开发中间状态？
   - 它应该归类为 Added / Changed / Fixed / Removed / Security 中哪一类？
   - 是否有 issue / PR / 用户报告可追溯？

3. **禁止写入开发过程**
   不写：
   - 分支内反复修正、review follow-up、doc sync、coverage、test refactor
   - “修复刚新增功能里的问题”，除非该问题已经存在于 master / 已发布版本
   - 设计过程、重构过程、命名迁移过程
   - 预发布内部格式、未公开 CLI 别名、后端术语清理

   应合并为：
   - 一个最终用户可见能力
   - 一个从已发布版本继承来的用户可见修复
   - 一个安全/依赖风险修复

`### Tests` 只在测试/评估能力本身是用户可运行的发布能力时使用；普通回归测试、覆盖率补充、测试文件迁移不写入 changelog。

### Changelog 分类规则

- `Added`: 新命令、新平台、新 workflow、新用户可运行能力。
- `Changed`: 已有行为的用户可见语义变化，例如默认值、路由、升级判定、输出结构。
- `Fixed`: 修复已发布版本或 master 中用户会遇到的问题；新功能开发过程中发现并修掉的问题不算 Fixed。
- `Removed`: 移除用户曾经可见或可用的能力；未发布的内部别名/临时格式不要写。
- `Security`: 依赖漏洞、权限、路径穿越、敏感信息、执行安全相关修复。

## 修改Skill规范

不能够直接修改Superpowers和OpenSpec的原始Skill

## github规范

不能未经过同意直接在github上评论或者提交PR

## README改动

先写中文，再写英文，当feature更新后，更新README应该保持克制，确定是否是必要的需要列在READMD的内容，这部分要用户阅读友好，必要的亮点特性应该以文档引用的形式存在docs目录下

<comet-ambient-resume>
<!-- Managed by Comet. Edits inside this block may be replaced by comet init/update. -->
<!-- Contract: comet.resume_probe.v2 -->

## Comet Ambient Resume

在这个仓库中，开始处理需要改动或调查的任务前，如果可能存在活跃 Comet workflow，把当前用户请求传入只读探针：`comet resume-probe . --stdin --json`。

- 只信任返回的 `workflow`、`skill` 和 `entrySource`；它们只由项目配置或无配置兼容回退决定。不得扫描或切换另一套 workflow。
- 如果 probe 返回 `auto_resume`，简短说明选中的 active change，并进入 `nextCommand` 指向的永久入口。不要把状态命令当作恢复入口直接推进。
- 如果 probe 返回 `ask_user`，只问一个简短问题并等待用户回复。
- 如果 probe 返回 `out_of_scope` 或 `none`，不要进入 Comet workflow。
- 如果配置或状态无效且没有 `nextCommand`，停止并报告原因；不要猜测另一个 workflow。
- 不能只因为存在 active change 就把无关任务挂到该 change。Native 的未提交改动由 Native 入口检查，不由探针自动归因。
</comet-ambient-resume>
