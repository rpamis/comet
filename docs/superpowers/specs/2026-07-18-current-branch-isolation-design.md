# current 隔离模式：完整设计与实现步骤（合并 PR #203 全部 review 反馈）

- 状态：设计中，待用户审阅
- 关联 issue：#190（<https://github.com/rpamis/comet/issues/190>）
- 关联 PR：#203（已关闭，未合并；作者决定基于最新 master 重新设计）
- Review 来源：
  - benym 首轮 review（问题 1-4）：<https://github.com/rpamis/comet/pull/203#issuecomment-4958454402>
  - 作者对首轮 review 的回复：<https://github.com/rpamis/comet/pull/203#issuecomment-4999292256>
  - benym 二轮 review（合并事故 + 缺口 A/C）：<https://github.com/rpamis/comet/pull/203#issuecomment-5010352976>
  - CodeRabbit 自动化 review 三轮（2026-07-13 13:18 / 2026-07-17 05:34 / 2026-07-17 06:08）
- 本文档取代此前四份草稿（已删除）：`2026-07-16-current-isolation-branch-binding-design.md`、`2026-07-16-pr203-review-outstanding-issues.md`、`2026-07-16-pr203-outstanding-issues-2-3-4-design.md`、`2026-07-16-current-isolation-branch-binding.md`（旧 plan）、`2026-07-16-pr203-outstanding-issues-2-3-4.md`（旧 plan）。方案设计与实现步骤合并到本文档一处维护。

## 0. 为什么要重写

PR #203 实现了 issue #190（新增 `isolation: current` 模式），经过 benym 两轮人工 review 与 CodeRabbit 三轮自动化 review 后，作者在 2026-07-18 关闭该 PR：

> "那我先把这个pr关了吧, 我用主分支最新的代码重新设计。代码和skill中的细节问题我会根据近几次review的反馈的结果再好好打磨下"

关闭前的最后一次 review（benym，2026-07-18）除了指出合并操作本身的事故（`wechat.png`、`website` 子模块指针被误回退，属于 git 操作问题，不在本文档范围内），还发现了三处此前四份草稿从未提及的缺口。

**本文档写作过程中的一次重要修正**：初稿曾照搬旧草稿对"问题 2/3/4"的描述，未逐条对照当前 master 代码重新核实。在准备写实现步骤时逐项核查代码后发现：**问题 2、问题 4 在 master 上根本不存在**（都是 PR #203 分支自己引入又自己改错的东西，从未合入 master）；**问题 3 的问题现象描述也是错的**（master 现在的 archive 流程已经是"先产生归档 commit、再做分支处理决策"，不存在"commit 遗留在没人管的本地"的缺口）。以下 §3/§4/§7 是核实后的结论，不是最初的假设。

PR #203 从未合并到 master，因此下文所有"现状"描述均以当前 master（`5e97d19`）为准，且均已逐项对照 master 实际代码核实（不是转述旧草稿）。

## 1. 问题清单总览

| 编号 | 内容 | 来源 | 核实结论 | 影响面 |
|---|---|---|---|---|
| 1 | `current` 模式分支绑定被标准入口流程静默覆盖 | benym 首轮 | **属实**，master 确认存在 | `domains/comet-classic/*` 核心逻辑 |
| 2 | hotfix/tweak 被误限制为不能选 `worktree` | benym 首轮 | **不存在于 master**，仅存在于 PR #203 分支 | 无需改动 |
| 3 | archive 阶段分支处理对 `isolation: current` 文不对题 | benym 首轮（描述已修正） | **原描述不准确**；master 的真实缺口是分支处理步骤未按 isolation 区分 | `comet-archive/SKILL.md` |
| 4 | 测试文件 ESLint `no-useless-escape` | benym 首轮 | **不存在于 master**，`eslint` 实测 0 errors | 无需改动 |
| A | `comet status` 未按 issue #190 要求展示 isolation / 绑定分支 | benym 二轮 | **属实**，master 确认存在 | `app/commands/status.ts` |
| B | hotfix/tweak 的 `isolation: current` 由 `init` 直写，不经过问题 1 的首次绑定副作用；追问 isolation 写入时机时又发现 `preset-escalate` 清空 `isolation` 也不经过同一副作用 | 代码核查发现 | **属实**；设计已变更为根治（§5.5、§5.7），不再只靠兜底 | `classic-state-command.ts` init()、`classic-transitions.ts` |
| C | hotfix/tweak 默认 `isolation: current` 与新增决策点表述可能冲突 | benym 二轮 → 用户决定改变方向 | **已升级为正式设计**：不再回避矛盾，改为主动询问三选一，彻底移除默认值 | `classic-state-command.ts` init()、hotfix/tweak SKILL.md 中英文 |

## 2. 实现顺序建议

问题 2、4 核实后不需要任何代码改动，从实现顺序中移除。缺口 A 依赖问题 1 的 `boundBranch` 字段。问题 3（修正后）与问题 1 无数据依赖，但共享 `comet-archive/SKILL.md` 的编辑范围，建议问题 1 的 SKILL.md 改动落地后再改问题 3，避免同一份文件的合并冲突。缺口 B、C 现在有独立代码改动（`init()` 默认值、`preset-escalate` 清空逻辑、hotfix/tweak 决策点），已并入问题 1 的 Task 序列（§5.8 Step 7b/9），不再是"仅测试覆盖"的轻量项。

推荐顺序：**问题 1（含缺口 B、C）→ 缺口 A → 问题 3**。问题 1 是后续一切的地基；缺口 A 紧随其后，因为它是问题 1 新增字段的直接消费方；问题 3 放最后，因为它需要在问题 1 的 SKILL.md 改动稳定后再动 `comet-archive/SKILL.md`。

---

## 3. 问题 2：hotfix/tweak 的 `worktree` 限制——核实结论：master 不存在，无需改动

旧草稿描述 `domains/comet-classic/classic-state.ts` 有一张 `ISOLATION_MODES` 表，`{ value: 'worktree', allowedInPreset: false }` 把 hotfix/tweak 收窄成 `branch | current`。**这段代码在当前 master 上不存在**：

```bash
$ grep -rn "PRESET_ALLOWED_ISOLATIONS\|allowedInPreset\|ISOLATION_MODES\b" domains/comet-classic/*.ts
# 零命中
```

实际校验逻辑分布在两处，均已允许 hotfix/tweak 三选一：

```ts
// classic-guard.ts:488-497 isolationSelected()
if (isolation === 'branch' || isolation === 'worktree') return pass();
if (isolation === 'current' && (workflow === 'hotfix' || workflow === 'tweak')) return pass();
// ... allowedValues = workflow === 'full' ? '<branch|worktree>' : '<current|branch|worktree>'

// classic-state-command.ts:545-546 requireBuildDecisions()
const allowedIsolation =
  workflow === 'full' ? ['branch', 'worktree'] : ['current', 'branch', 'worktree'];
```

**结论**：这是 PR #203 分支自己引入又自己在 review 中改错的一处回归，从未合入 master。基于 master 重新设计不需要"撤销"任何限制，无需任何代码改动。保留本节仅为了让读到 benym 首轮 review 的人知道这条已经核实过、不是被遗漏。

---

## 4. 问题 4：ESLint `no-useless-escape`——核实结论：master 不存在，无需改动

旧草稿描述 `test/domains/comet-classic/comet-scripts.test.ts` 里有 `'node -e \"process.exit(0)\"'` 这种多余转义。核实：

```bash
$ grep -n 'node -e' test/domains/comet-classic/comet-scripts.test.ts
# 17 处命中，全部已是 'node -e "process.exit(0)"'，没有一处带 \"

$ npx eslint test/domains/comet-classic/comet-scripts.test.ts
✖ 2 problems (0 errors, 2 warnings)
```

**结论**：同样是 PR #203 分支自身引入的问题，从未合入 master。无需任何代码改动。保留本节同样只是为了可追溯。

---

## 5. 问题 1：`current` 隔离模式分支绑定持久化（含缺口 B）

### 5.1 场景重现（问题所在）

`isolation: current` 允许 change 直接在用户当前所在的分支上开发。为检测"开发过程中分支被意外切换"，运行时需要记录"这个 change 当初绑定的是哪个分支"，并在每次进入 build/verify/archive 阶段时和实时分支比较，不一致就必须拦下来。

当前实现把这份绑定信息存在仓库本地、不受版本控制的 sidecar 文件 `.comet/current-change.json` 里，而 `selectCurrentChange()`（`classic-current-change.ts`）**每次调用都无条件用当前分支重写这个文件**。`comet-build`/`comet-verify`/`comet-archive` 的入口第一步统一都会先跑 `comet state select <change-name>`，于是漂移检测在结构上不可能触发：

1. 在分支 `A` 上选择 change，`isolation: current`，sidecar 记录 `branch: A`。
2. build 完成后意外切到 `B`。
3. 进入 `/comet-verify`，入口先跑 `comet state select`，把 sidecar 的 `branch` 覆盖成 `B`。
4. 后续比较两边都是 `B`，永远一致，检测失效——工作流在错误分支上继续跑，用户毫不知情。

这与 issue #190 明确要求的"当前分支意外变化时必须警告并要求确认"不一致。此外，绑定信息只存在本地 sidecar 里：一旦被清理（`git clean -fdx`、CI 换 worker、`.comet/` 被删）或在另一个 checkout 里恢复现场，绑定关系直接丢失，下一次 `select` 会把当前分支当成"首次绑定"重新写入，用户不知情地换绑。

### 5.2 目标 / 非目标

**目标**：
- 分支绑定关系不会被标准入口流程（`state select`）静默覆盖。
- 绑定关系持久化在跟随仓库提交的正式状态文件（`.comet.yaml`）里，不依赖本地 sidecar 存活。
- `state check`、hook guard、phase guard 三处漂移检测口径一致（同一个判定函数）。
- detached HEAD 场景被明确处理，不能绕过检测。
- 换绑必须是显式操作，留下审计记录。
- 对已经在 in-flight 的 `isolation: current` change（本次修复上线前创建的）平滑兼容，不因缺字段直接报错。

**非目标**：
- 不改变 `branch`/`worktree` 隔离模式的任何行为。

**设计决策变更（2026-07-18 追加）**：最初设计把"hotfix/tweak 默认 `isolation: current`，无需用户选择"列为不可触碰的非目标（详见 §5.7 的历史记录）。用户在 review 本文档时明确要求改为**主动询问**——hotfix/tweak 不再静默预填 `isolation: current`，改为在流程入口显式暂停，让用户从 `current`/`branch`/`worktree` 三选一。这条决策变更同时取代了原来的防呆约束，§5.7 已按新设计重写。

### 5.3 设计概览

核心思路：**把"绑定的是哪个分支"这条信息从 sidecar 挪进 `.comet.yaml`，变成新字段 `bound_branch`；sidecar 从此只负责"当前在操作哪个 change"，不再存分支数据，因此也没有可覆盖的东西。**

| 文件 | 修复前 | 修复后 |
|---|---|---|
| `.comet/current-change.json`（sidecar，不受版本控制） | 存 `change` + `branch`，每次 `select` 都重写 | 只存 `change`，`select` 不再碰分支 |
| `openspec/changes/<name>/.comet.yaml`（正式状态，跟随仓库提交） | 无分支信息 | 新增 `bound_branch: string \| null`，写入后只能通过显式 `rebind` 命令修改 |

`domains/comet-classic/classic-state.ts` 新增：

```ts
export interface ClassicState {
  ...
  boundBranch: string | null;   // wire key: bound_branch
}
```

- 属于**机器拥有字段**（加入 `MACHINE_OWNED_FIELDS`），`comet state set <name> bound_branch xxx` 不允许直接写。
- **不加入** `REQUIRED_CLASSIC_KEYS`，不 bump `CLASSIC_MIGRATION_VERSION`（当前为 `1`）——`classic_migration` 校验是严格相等，升版本号会让所有 in-flight change 在下次 `readClassicState` 时校验失败，是要避免的破坏性行为。可选字段能完全绕开这个问题，也是存量 change 自动兼容的关键。
- 只在 `isolation === 'current'` 时有意义；`isolation` 为 `branch`/`worktree` 时恒为 `null`。

`.comet/current-change.json` 瘦身：

```ts
export interface CurrentChangeSelection {
  version: 1;
  change: string;
  // branch 字段删除
}
```

`selectCurrentChange()` 不再写分支——不是让 `select` 变聪明去判断该不该覆盖，而是让它压根没有分支数据可写，从结构上消除"select 顺带覆盖绑定"的可能。

### 5.4 核心流程（走一遍完整场景）

**首次绑定**：

```bash
git branch --show-current        # feature-A
comet state set my-change isolation current
```

`set` 命令处理 `isolation` 字段时新增副作用：新值是 `current` 且当前 `bound_branch` 为 `null` 时，读取当前 git 分支一并写入：

```yaml
isolation: current
bound_branch: feature-A
```

**关键约束**：只有 `bound_branch` 当前为 `null` 时才会写入。重复执行 `set isolation current`（脚本重跑、幂等调用）不会用当前分支重新覆盖已有值——否则等于把"静默覆盖"这个 bug 从 `select` 搬到了 `set`，没有真正解决问题。

**detached HEAD 场景下禁止建立绑定**：若执行 `set isolation current` 时当前分支解析为 `null`（detached HEAD），命令直接报错拒绝：`ERROR: cannot bind isolation=current while HEAD is detached; checkout a branch first`。不能建立"绑定到 null"的状态，否则漂移检测会因为找不到比较基准而失效。

若 `isolation` 从 `current` 改成 `branch`/`worktree`，`bound_branch` 同步清空为 `null`；下次再切回 `current` 视为全新首次绑定。

**分支漂移（核心场景）**：

```bash
git checkout feature-B           # 手滑切错分支
comet state select my-change     # 只更新 sidecar 的 change 指针，不影响 bound_branch
comet state check my-change verify
```

比较 `.comet.yaml` 里的 `bound_branch: feature-A` vs 实时分支 `feature-B`，不一致 → `[FAIL]`，整体 `BLOCKED`：

```
BLOCKED: change 'my-change' is bound to branch 'feature-A', but current branch is 'feature-B'.
Next: ask the user to confirm — switch back to 'feature-A', or run `comet state rebind my-change` after explicit confirmation.
```

**sidecar 丢失后的恢复**：`bound_branch` 存在 `.comet.yaml` 里，不受 sidecar 存亡影响，漂移检测照常生效。

**detached HEAD**：只要 `bound_branch` 非空，实时分支解析为 `null`（detached）就必须视为不一致，直接 FAIL，没有跳过检测的分支。

**显式换绑（rebind）**：

```bash
comet state rebind my-change
```

要求 `bound_branch` 当前非空，要求实时分支非 detached HEAD，读取实时分支写入新 `bound_branch`，并调用 `appendClassicStateEvent()` 记一条 `event: 'rebind', from, to` 的审计事件。命令本身不做交互确认——交互确认的职责在 SKILL.md 层的 decision-point 协议，CLI 只负责在用户已确认之后执行写入并留痕。

### 5.5 缺口 B：hotfix/tweak 的首次绑定改为走正常路径（原"惰性补绑兜底"设计已被主动询问取代）

**历史背景**：最初核查 `classic-state-command.ts` 的 `init` 函数发现 `isolation: preset ? 'current' : null`——hotfix/tweak 走 preset 分支时，`.comet.yaml` 在**创建时刻**就直接写了 `isolation: 'current'`，完全绕过 `setField`，问题 1（§5.4）"首次绑定 `bound_branch`"这个副作用（挂在 `setField` 处理 `isolation` 字段的分支上）永远不会触发。当时的结论是："功能上不会漏判——`state check`/guard 的惰性补绑（`needs-heal`）天然兜住这个场景"，把这个当作可以接受的既有设计保留。

**设计变更**：用户决定把 hotfix/tweak 的 isolation 选择从"静默默认"改成"主动询问"（详见 §5.7）。这条变更直接消除了本节最初描述的因果链条本身——**`init` 不再预填 `isolation: current`，改为写 `isolation: null`**，hotfix/tweak 与 full workflow 使用完全相同的初始值。真正的绑定动作挪到流程入口的决策点，由用户显式选择后调用 `comet state set <name> isolation current`，这时会**正常触发 `setField` 的首次绑定副作用**，不再需要依赖惰性补绑作为主路径。

走一遍新设计下的场景：

```bash
git branch --show-current        # feature-hotfix
comet state init my-fix hotfix   # 现在写入 isolation: null（不再预填 current）
comet state select my-fix
comet state check my-fix open    # isolation 为 null，isolationSelected 的既有校验本就会挡在离开 build 之前，这里的 open 检查不涉及 isolation，先放行
```

进入 hotfix 流程后，SKILL.md 的决策点（§5.7）暂停，用户选择"当前分支直接工作"：

```bash
comet state set my-fix isolation current   # 触发 setField 的首次绑定，写入 bound_branch: feature-hotfix
```

`bound_branch` 在这一步被正常写入，不再依赖 `state check` 的惰性补绑去猜测"用户是不是想要 current"。

**惰性补绑没有被移除，但角色改成纯粹的兼容兜底**：升级前创建、`.comet.yaml` 里已经是 `isolation: current` 但缺 `bound_branch` 字段的存量 hotfix/tweak change（本次改动上线前，走的还是旧版 `init` 直写逻辑），第一次经过 `state check`/guard 时仍然会走 `needs-heal` 惰性补绑——这条路径不删除，只是不再是设计里描述的"主要机制"，纯粹是给存量数据兜底（和 §5.9 兼容性策略里"缺 `bound_branch` 字段的存量 change"是同一件事，不是两套逻辑）。

detached HEAD 场景：决策点在 `set isolation current` 时会走 §5.4 已经设计好的拒绝逻辑（`liveGitBranch` 返回 `null` 直接报错），比原设计"要等到第一次 `state check` 才发现"更早、更直接——这是本次设计变更顺带解决的一个体验改进，不需要额外实现。

### 5.6 涉及的具体文件改动

| 文件 | 改动内容 |
|---|---|
| `domains/comet-classic/classic-state.ts` | 新增 `boundBranch` 字段、`bound_branch` wire key 及序列化/反序列化 |
| `domains/comet-classic/classic-branch-binding.ts`（新建） | 共享判定模块：`liveGitBranch` / `evaluateBranchBinding` / `healBoundBranch` / `driftBlockedMessage` / `driftStaleReason` / `unboundDetachedMessage`，`state check`、guard、`resolveCurrentChange` 三处统一消费 |
| `domains/comet-classic/classic-current-change.ts` | `CurrentChangeSelection` 去掉 `branch`；`selectCurrentChange()` 不再读写分支；`resolveCurrentChange()` 改为读 `.comet.yaml` 的 `bound_branch` 做比较 |
| `domains/comet-classic/classic-state-command.ts` | `MACHINE_OWNED_FIELDS` 加入 `bound_branch`；`set isolation current` 首次绑定副作用；新增 `rebind` 子命令；`check()` 新增漂移检查；`currentChange()` 输出补充 isolation/branch；`init()` 第 511 行 `isolation: preset ? 'current' : null` 改为对 hotfix/tweak 也写 `null`（§5.5/§5.7） |
| `domains/comet-classic/classic-transitions.ts` | `preset-escalate` 分支（第 147-164 行）在清空 `isolation` 的同时同步清空 `boundBranch`，避免升级到 full workflow 后残留孤儿 `bound_branch`（详见本节下方"追加发现"） |
| `domains/comet-classic/classic-guard.ts` | 新增 `boundBranchMatches()`，复用共享判定模块，在 build/verify/archive 三个关卡各自独立比较 |
| `domains/comet-classic/classic-state-events.ts` | 审计事件 `event` 类型加入 `'rebind'` |
| `domains/comet-classic/classic-validate-command.ts` | 无需显式改动——已知字段集合派生自 `CLASSIC_WIRE_KEYS`，`bound_branch` 自动被接受为可选字段 |
| `assets/skills-zh/comet-build\|verify\|archive/SKILL.md` + 对应英文版 | 检测到 `BLOCKED`（分支漂移）时的 decision-point 处理步骤；`rebind` 命令使用条件 |
| `assets/skills-zh/comet-hotfix\|tweak/SKILL.md` + 对应英文版 | 移除"默认 `isolation: current`"表述，替换为主动询问的工作区隔离决策点（§5.7 全新设计）；同时也要有检测到 `BLOCKED` 时的 decision-point 处理步骤（和 build/verify/archive 一致） |

**追加发现（用户追问"hotfix/tweak 写入 isolation 的时机"时定位）**：`isolation` 字段除了 `init()` 直写，还有第二个写入点——`preset-escalate` transition（hotfix/tweak 升级为 full workflow 时触发）。它不经过 `classic-state-command.ts` 的 `setField()`，而是走 `classic-transitions.ts` 的 `applyClassicTransition()`（该文件内部另有一个同名但完全独立的纯函数 `setField`，只操作内存中的 `ClassicState` 对象），在第 162 行 `setField(classic, effects, 'isolation', null);` 清空 `isolation`。这条路径不会触发 Task 4（§5.4）里"`isolation` 离开 `current` 时清空 `bound_branch`"的副作用，因为那段逻辑写在另一个文件的另一个函数里。修复方式：在 `classic-transitions.ts:162` 之后加一行 `setField(classic, effects, 'boundBranch', null);`，保持"`isolation` 离开 `current` 时 `bound_branch` 必须同步清空"这条不变量在两条独立的写入路径上都成立。

### 5.7 缺口 C（已升级为正式设计）：hotfix/tweak 的工作区隔离改为主动询问

**历史记录**：benym 二轮 review 原话是"Tweak Skill 自相矛盾：写默认 isolation: current，后面又要求用户显式选择 branch/worktree/current"。本文档最初的应对是把"不修改 hotfix/tweak 既有默认表述"定为防呆非目标（避免重蹈 PR #203 覆辙）。用户在审阅本文档时明确要求改变方向：**不再回避这个矛盾，而是直接解决它**——把 hotfix/tweak 的 isolation 选择从"静默默认"改成和 full workflow 一致的"主动询问"。

**为什么这是合理的方向，而不是走回 PR #203 的老路**：PR #203 当时的问题不是"不该问"，而是"半改"——加了一段要求显式选择的 decision-point 文案，却没有同步删掉"默认 current，无需选择"那句老话术，两句话留在同一份文件里互相矛盾。本次是**完整替换**：直接删掉"默认"表述，替换成结构完整的决策点，不存在两句话并存的中间状态，从根源上避免同一类矛盾。

**现状核查**（为设计提供依据）：
- `classic-state-command.ts:511`（`init()`）：`isolation: preset ? 'current' : null`——hotfix/tweak 创建时直接预填 `current`。
- `isolationSelected()`（`classic-guard.ts:488-497`）与 `requireBuildDecisions()`（`classic-state-command.ts:545-546`）**早已要求** `isolation` 必须是 `current|branch|worktree` 三者之一才能离开 build 阶段，对 hotfix/tweak 同样生效——这条强制机制本来就存在，只是因为 `init` 预填了 `current` 而从未真正生效过。
- full workflow 的等价决策点（`comet-build/SKILL.md` 第 78-222 行）已经有一套成熟模式：能力预检（`using-git-worktrees` 是否可用、仓库能否安全创建分支）→ 展示可执行选项 → 用户选择 → 按分支命名规范（`hotfix/YYYYMMDD/<change-name>`、`tweak/YYYYMMDD/<change-name>` 已经预留了 hotfix/tweak 前缀，第 193-194 行）创建分支或加载 `using-git-worktrees` 技能创建 worktree → 在新工作区重新 `comet state select`。

**设计**：
1. `init()` 改为对所有 workflow（含 hotfix/tweak）统一写 `isolation: null`，不再区分 preset。
2. hotfix/tweak 的 SKILL.md 在入口（`comet state init` → `comet state select` → `comet state check <name> open` 之后，创建 proposal.md/design.md/tasks.md 之前）插入一个决策点，比 full workflow 的 Step 2 简单——hotfix/tweak 没有 `build_mode`/`tdd_mode`/`review_mode` 需要联合决策（这三项仍是固定预设值），**只需要决定 `isolation` 一项**，多一个 full workflow 没有的选项——`current`：

   | 选项 | 方式 | 说明 |
   |------|------|------|
   | A | 当前分支直接工作 | 不新建分支/worktree，直接在当前所在分支上完成本次 change；适合当前分支本来就是目标分支的快速修复场景 |
   | B | 创建分支 | 复用 `/comet-build` 已有的分支命名规范（`hotfix/YYYYMMDD/<name>` / `tweak/YYYYMMDD/<name>`） |
   | C | 创建 Worktree | 复用 `/comet-build` 已有的 `using-git-worktrees` 技能加载步骤 |

   这是用户决策点，按 `comet/reference/decision-point.md` 协议暂停；能力预检判定不可执行的选项要先移除；剩多个合法选项时不得自动选择。

3. 用户选择后：
   - **A**：`comet state set <name> isolation current`（触发 §5.4 的首次绑定，同时也触发 detached HEAD 拒绝——比旧设计"要等到第一次 `state check` 才发现"更早）。
   - **B**：确认分支名 → `git checkout -b <branch-name>` → `comet state set <name> isolation branch`。
   - **C**：加载 `using-git-worktrees` 技能创建隔离工作区 → `comet state set <name> isolation worktree`。
   - B/C 选择后必须在新工作区重新 `comet state select <change-name>`，再开始创建精简版产物——完全复用 `/comet-build` 第 210-216 行已经验证过的"新工作区重新绑定"逻辑，不发明新机制。

具体场景走查：change `my-fix`，workflow `hotfix`。`comet state init my-fix hotfix` 后 `isolation: null`。决策点暂停，展示能力预检结果（假设 `using-git-worktrees` 可用、当前仓库可以安全建分支）和三个选项。用户选 A（当前分支直接工作，此时用户在 `feature-payments` 上），执行 `comet state set my-fix isolation current`，`bound_branch` 自动写为 `feature-payments`（§5.4 首次绑定）。若用户后来手滑切到 `feature-billing` 又忘了，`comet-verify`/`comet-archive` 入口的漂移检测会照常拦下来（§5.4）——这正是 issue #190 想要的效果：不是不让默认落在当前分支，而是让"落在当前分支"这件事经过用户明确确认，而不是流程自己悄悄替用户决定。

- §5.6 涉及的所有 SKILL.md/规则文档改动，中文定稿并经用户确认后，必须在同一轮提交 review/合并之前完成英文同步，不允许带着中英不同步的中间状态进入 review（沿用原有的双语纪律，本次没有变化）。

### 5.8 实现步骤

- [ ] **Step 1：数据模型** — `classic-state.ts` 新增 `boundBranch` 字段、`bound_branch` wire key、序列化/反序列化；`classic-state-command.ts` 的 `sparseClassicState` 同步。先写 `test/domains/comet-classic/classic-state.test.ts` 的 round-trip 断言并确认 FAIL，再实现，再确认 PASS。`pnpm build`。追加 CLI 测试：`.comet.yaml` 校验接受 `bound_branch` 为已知可选字段。
- [ ] **Step 2：共享判定模块** — 新建 `classic-branch-binding.ts`（`liveGitBranch` / `evaluateBranchBinding` / `healBoundBranch` / `driftBlockedMessage` / `driftStaleReason` / `unboundDetachedMessage`）。先写 `test/domains/comet-classic/classic-branch-binding.test.ts` 覆盖纯函数 `evaluateBranchBinding` 的五种判定（`not-applicable` / `ok` / `drift` / `needs-heal` / `unbound-detached`，含 detached HEAD 必须判 `drift` 而非跳过）和两个消息函数，确认 FAIL 后实现，确认 PASS。`pnpm build`。
- [ ] **Step 3：sidecar 瘦身与漂移路由** — `classic-current-change.ts`：`CurrentChangeSelection` 去掉 `branch`；`selectCurrentChange()` 不再读写分支；`resolveCurrentChange()` 改为消费 Step 2 的共享判定。同步改 `classic-state-command.ts` 的 `selectChange`/`currentChange` 输出。先改测试（`classic-current-change.test.ts` 的 select/drift 用例），确认 FAIL，再实现。新增 hook-guard CLI 测试：`current` 模式下分支漂移必须阻断一次仓库源码写入。`pnpm build`。
- [ ] **Step 4：`set isolation current` 首次绑定** — `MACHINE_OWNED_FIELDS` 加入 `bound_branch`；`setField` 里 `isolation` 分支新增首次绑定/清空副作用（含 detached HEAD 拒绝、重复调用不覆盖）。先写 CLI 测试覆盖：首次绑定写入当前分支、重复调用不覆盖、切离 `current` 时清空、detached HEAD 拒绝、直接 `set bound_branch` 被拒绝，确认 FAIL 后实现。`pnpm build`。
- [ ] **Step 5：`state check` 漂移与惰性补绑** — `check()` 新增：`isolation === 'current'` 时用共享判定比较，`drift`/`unbound-detached` 时 `BLOCKED`，`needs-heal` 时惰性补绑并 PASS。先写 CLI 测试覆盖漂移 BLOCKED、sidecar 删除后仍能检出漂移、detached HEAD 下 BLOCKED、遗留未绑定 change 惰性补绑成功（对应 §5.5 缺口 B 的场景），确认 FAIL 后实现。`pnpm build`。
- [ ] **Step 6：`rebind` 子命令** — `classic-state-events.ts` 的 `event` 类型加入 `'rebind'`；新增 `rebind` 函数与子命令分发。先写 CLI 测试覆盖：成功换绑并写审计事件、未绑定时拒绝、detached HEAD 时拒绝，确认 FAIL 后实现。`pnpm build`。
- [ ] **Step 7：phase guard 漂移校验** — `classic-guard.ts` 新增 `boundBranchMatches()`，注册为 `guardBuildChecks`/`guardVerifyChecks`/`guardArchiveChecks` 的首个检查项。先写 guard CLI 测试（archive 阶段漂移必须 BLOCKED），确认 FAIL 后实现。注意回归：已有的"`isolation=current` 下 build 完整流程通过"测试在纯 git-free 环境下会因 `unbound-detached` 变红，需要按场景补 `gitInit` + 匹配的 `bound_branch`，不得放宽新检查来迁就旧测试。`pnpm build`。
- [ ] **Step 7b：`preset-escalate` 同步清空 `bound_branch`** — `classic-transitions.ts` 第 162 行 `setField(classic, effects, 'isolation', null);` 之后加 `setField(classic, effects, 'boundBranch', null);`（见 §5.6"追加发现"）。先写失败测试：`isolation: current` 且已绑定的 hotfix change，执行 `comet state transition <name> preset-escalate` 后 `get <name> bound_branch` 必须为 `null`，确认 FAIL 后实现，确认 PASS。`pnpm build`。
- [ ] **Step 8：全量回归** — `npx vitest run`、`pnpm lint`、`pnpm build` 全部通过；修复过程中暴露的既有 fixture 按 Step 7 的原则调整，不弱化新检查。
- [ ] **Step 9：hotfix/tweak 主动询问 isolation（§5.7 新设计）** —
  1. `classic-state-command.ts:511` 的 `init()` 把 `isolation: preset ? 'current' : null` 改为对所有 workflow 统一写 `isolation: null`。先写失败测试：`comet state init <name> hotfix`/`tweak` 后 `get <name> isolation` 返回 `null`（不再是 `current`），确认 FAIL 后实现，确认 PASS。`pnpm build`。
  2. 这一步会让现有依赖"hotfix/tweak `init` 后 `isolation` 直接是 `current`"的既有测试全部变红——逐一检查这些测试，改为先补一次 `comet state set <name> isolation current`（或 `branch`/`worktree`，按测试语境选）再继续，不得为了让旧测试通过而把 `init` 的默认值改回去。
  3. 中文 `comet-hotfix/SKILL.md`、`comet-tweak/SKILL.md`：删除"默认 `isolation: current`"那句话，替换为 §5.7 设计的工作区隔离决策点（三选一表格 + 能力预检 + 分支命名规范复用 + `using-git-worktrees` 技能加载 + 新工作区重新 `select`）。请用户审阅中文措辞。
- [ ] **Step 10：五份 SKILL.md 的漂移 decision-point（中文先行）** — 在 `comet-build`/`comet-verify`/`comet-archive`/`comet-hotfix`/`comet-tweak` **五份**中文 SKILL.md 的入口命令块后，插入"检测到 `BLOCKED`（分支漂移）后暂停、等待用户选择切回或 `rebind`"的 decision-point 段落。hotfix/tweak 也需要这段——即使入口多了 Step 9.3 的工作区隔离选择，`isolation: current` 绑定之后同样可能在流程中途发生分支漂移（例如 hotfix 进行到一半用户手滑切了分支），需要同样的 `BLOCKED` 处理。这条和 Step 9.3 的 hotfix/tweak 入口决策点是两个不同触发条件（一个在漂移检测时触发、一个在流程入口选择工作区隔离时触发一次），措辞上要能看出是两件事，不要写得像同一个决策点。确认后请用户审阅。
- [ ] **Step 11：SKILL.md 英文同步** — 用户确认 Step 9.3、Step 10 的中文措辞后，在同一轮改动内完成 `comet-build`/`comet-verify`/`comet-archive`/`comet-hotfix`/`comet-tweak` 五份英文版同步，不得带着中英不同步的状态提交。同步更新 `assets/skills/comet/reference/comet-yaml-fields.md` 及中文版，补充 `bound_branch` 字段说明。
- [ ] **Step 12：Changelog 与版本号** — 按 CLAUDE.md 规范，`package.json` 版本从 `0.4.0-beta.5` 升到 `0.4.0-beta.6`，`CHANGELOG.md` 顶部新增条目，只写用户可见行为（`comet state rebind` 新命令、current 模式漂移检测持久化、hotfix/tweak 的工作区隔离改为主动询问），不写 SKILL.md 措辞调整等开发过程内容。

### 5.9 兼容性 / 迁移策略

`bound_branch` 不加入 `REQUIRED_CLASSIC_KEYS`，不提升 `CLASSIC_MIGRATION_VERSION`。升级前已存在的 `isolation: current` change（缺少 `bound_branch` 字段——包括本次改动上线前用旧版 `init` 直写逻辑创建的存量 hotfix/tweak change，见 §5.5）读到时缺省为 `null`；漂移检查在 `bound_branch === null` 时视为"尚未绑定"，走一次惰性首次绑定，存量 change 能在下一次经过 `state check`/guard 时自动补齐字段。本次改动上线后新创建的 hotfix/tweak change 不会再依赖这条兜底路径（§5.7 的决策点会显式调用 `set isolation current` 走正常首次绑定），惰性补绑只保留给上线前的存量数据。

---

## 6. 缺口 A：`comet status` 未暴露 isolation / 绑定分支

### 6.1 问题所在

issue #190 原文明确要求："`comet status` should surface the selected isolation mode and current branch name"。这一条在 PR #203 和旧草稿里都从未被实现或提及。

核查 `app/commands/status.ts` 现状：`ChangeStatus` 接口（第 11-40 行）已有 `isolation: string | null` 字段，`comet status --json` 能看到；但**没有** `boundBranch` 字段；`displayStatus()`（文本输出，第 227-280 行）打印 `workflow`、`build_mode`、`runtime_mode` 等字段，**唯独没有打印 `isolation`**——JSON 里已有的字段，人读的默认输出反而看不到。

具体场景：用户在 `isolation: current` 的 change 上跑 `comet status`，期望看到绑定分支信息，实际输出只有 `workflow: full | build_mode: executing-plans`、`runtime_mode: ...` 等，看不到任何 isolation 相关内容；加 `--json` 能看到 `"isolation": "current"`，但看不到绑定的是哪个分支。

### 6.2 设计

`ChangeStatus` 新增 `boundBranch: string | null`（仅 `isolation === 'current'` 时非空）。`getActiveChanges()` 的四条分支（valid / invalid / unknown-keys / error）都填充 `boundBranch: projection.classic?.boundBranch ?? null`，与 `isolation` 字段同源同步。`displayStatus()` 紧跟在 `workflow: ... | build_mode: ...` 之后新增一行：

```ts
if (c.isolation) {
  const branchSuffix = c.isolation === 'current' && c.boundBranch ? ` (bound: ${c.boundBranch})` : '';
  console.log(`     isolation: ${c.isolation}${branchSuffix}`);
}
```

修复后同样的场景，输出变为 `isolation: current (bound: feature-A)`；`--json` 与文本输出保持同一数据源，不再出现"JSON 有、文本没有"的不一致。

**依赖**：`boundBranch` 字段来自问题 1（§5.3）新增的 `ClassicState.boundBranch`，本节必须在问题 1 落地之后实现。

### 6.3 实现步骤

- [ ] Step 1：`test/app/` 下补充 `comet status` 的测试断言——`isolation: current` 且已绑定时文本输出包含 `isolation: current (bound: ...)`；`isolation` 为 `null` 时不打印该行；`--json` 输出包含 `boundBranch` 字段且与 `.comet.yaml` 一致。确认 FAIL。
- [ ] Step 2：`app/commands/status.ts` 的 `ChangeStatus` 新增 `boundBranch`，四条 `getActiveChanges()` 分支填充；`displayStatus()` 新增 isolation 输出行。
- [ ] Step 3：跑 Step 1 测试确认 PASS；跑 `npx vitest run` 确认无回归（此步不涉及 `domains/comet-classic`，无需 `pnpm build`）。
- [ ] Step 4：提交，commit message 形如 `feat: surface isolation and bound branch in comet status`。

---

## 7. 问题 3：archive 分支处理步骤要按 isolation 区分（原描述已修正）

### 7.1 旧描述错在哪，真实缺口是什么

旧草稿假设的 bug（"verify 阶段已 push，archive 又产生一个没人管的新 commit"）不成立。核实 master 现状：

`comet-verify/SKILL.md` 第 176 行明确禁止 verify 阶段碰分支：

> "不要在 verify 阶段处理、合并或丢弃分支，也不要写入 `branch_status: handled`；...分支收尾统一由 `/comet-archive` 在归档提交后执行。"

`comet-archive/SKILL.md` 第 86-123 行的真实流程：Step 4 产生归档 commit → Step 5**紧接着**加载 Superpowers `finishing-a-development-branch`，暂停让用户选（本地合并到主分支 / 推送并创建 PR / 保持分支）→ 只有用户选择的动作执行完，才写 `comet state set <name> branch_status handled`。归档 commit 必然被包含在用户选择的动作里（因为决策发生在 commit 之后），流程到这一步就是终态（"完成"小节明确写"Comet 流程全部完成"），**不存在后续还会再产生一个 commit 的情况**。旧草稿"两次决策夹一个孤儿 commit"的场景在 master 上无法复现。

真实缺口是另一个问题：`grep -n "isolation\|current" comet-archive/SKILL.md comet-verify/SKILL.md` **零命中**——这两份 SKILL.md 完全没有针对 `isolation` 做任何区分。hotfix/tweak 默认 `isolation: current`（§5.7 已确认这是既有设计），意味着这些 change 走到 archive Step 5 时，会被套用 `finishing-a-development-branch` 那三个面向"独立 feature 分支"的选项——但 `isolation: current` 的定义就是"直接在当前分支上工作，没有另建分支"，"本地合并到主分支"这个选项对它是文不对题的（合并到哪？当前分支本身可能就是目标分支）。

### 7.2 设计：archive Step 5 按 isolation 分流，不新增字段

核心结论：**不需要新增 `branch_action` 字段**。旧设计新增字段是为了解决"push 状态记录不下来"的问题，但既然真实流程里分支处理决策和执行是同一步、原地完成、后面没有任何步骤依赖这个记录（archive 是终态），持久化"选了哪个动作"就是没有消费方的多余状态——加了只是徒增一个字段，不解决任何实际问题。

具体设计：`comet-archive/SKILL.md` Step 5 读取 `isolation` 做分流：

- **`isolation !== 'current'`（`branch`/`worktree`，含遗留未设置的 change）**：完全不变，继续走现有的 `finishing-a-development-branch` 三选一流程。这条路径本来就没有 bug。
- **`isolation === 'current'`**：跳过 `finishing-a-development-branch`（选项语义不适配），改为一个贴合"直接在当前分支工作"场景的两选一 decision-point：
  1. 推送当前分支（`git push`，若已有上游分支直接 push，若没有则 `git push -u origin <当前分支名>`）
  2. 暂不推送，保留本地（不执行任何 git 操作）

  执行完选择的动作后，同样写 `comet state set <name> branch_status handled`——复用已有字段，不新增。archive guard（`branchStatusHandled` 检查）不需要改动，它只关心 `branch_status === 'handled'`，不关心走的是哪条分支。

具体场景走查：change `my-fix` 是 hotfix，`isolation: current`，绑定在 `feature-A`（问题 1 的 `bound_branch`）。归档 Step 4 提交后，Step 5 检测到 `isolation: current`，不再询问"本地合并到主分支"（`feature-A` 本身可能就是用户打算长期工作的分支，没有另一个"主分支"要合并进去），而是问"要不要现在 push `feature-A`"。用户选 1，执行 `git push`，随后 `branch_status: handled`。全程只有一次决策，不产生"合并到不存在的目标"这种无意义选项。

**目标**：`isolation: current` 的 change 在 archive 分支处理步骤上得到与其语义匹配的决策选项；`branch`/`worktree` 模式行为完全不变，零回归风险。
**非目标**：不改变 `finishing-a-development-branch`（Superpowers 技能，不可修改）本身的行为；不引入新字段、不新增 phase gate；不重新讨论 verify 阶段是否该处理分支（master 现状已经是"不处理"，且是正确的，维持不变）。

### 7.3 实现步骤

- [ ] Step 1：在 `test/domains/skill/skills.test.ts`（或对应 SKILL.md 内容校验测试，视仓库现有 skill 文本测试的组织方式而定）新增断言：`comet-archive/SKILL.md` 中文版包含 `isolation === 'current'` 分流后的两选一措辞，且不再无差别套用 `finishing-a-development-branch` 三选一。若仓库当前没有对 SKILL.md 正文做断言式测试（只做结构/存在性校验），此步改为人工验收清单项，不强行新增脆弱的文本匹配测试。
- [ ] Step 2：编辑 `assets/skills-zh/comet-archive/SKILL.md` 第 105-123 行附近的 Step 5：在加载 `finishing-a-development-branch` 之前插入 `isolation` 判断——`current` 时改为两选一 decision-point（推送当前分支 / 暂不推送），其余分支保持原有的 `finishing-a-development-branch` 三选一不变；两条路径收尾都执行 `comet state set <name> branch_status handled` → `comet guard <name> archive` → `comet state clear-selection`。请用户审阅中文措辞，重点检查是否与 §5.7 hotfix/tweak 入口的工作区隔离决策点混淆——这里的两选一针对的是"archive 收尾时要不要 push"，§5.7 是"流程一开始选 current/branch/worktree 哪一种"，两个是不同触发时机的独立决策点，措辞上要能看出是两件事。
- [ ] Step 3：中文措辞确认后，同一轮同步英文版 `assets/skills/comet-archive/SKILL.md`，不留中英不同步的中间状态提交（§5.7 的流程约束同样适用于本节）。
- [ ] Step 4：全量回归 `npx vitest run && pnpm lint`（本节不涉及 `domains/comet-classic/*.ts` 代码改动，只改 SKILL.md，无需 `pnpm build`）。
- [ ] Step 5：Changelog——若与问题 1 在同一发布周期内完成，追加到同一个 `0.4.0-beta.6` 条目下；只写用户可见行为，例如："current 模式归档时不再套用面向独立分支的三选一，改为贴合当前分支场景的推送/暂不推送二选一"。

---

## 8. 数据模型变更汇总

| 字段 | 定义位置 | wire key | 机器拥有 | 加入 REQUIRED_CLASSIC_KEYS | 说明 |
|---|---|---|---|---|---|
| `boundBranch` | `classic-state.ts` | `bound_branch` | 是 | 否 | 问题 1，§5.3 |
| `ChangeStatus.boundBranch` | `app/commands/status.ts` | 不适用（非 `.comet.yaml` 字段，衍生自 `boundBranch`） | 不适用 | 不适用 | 缺口 A，§6.2 |

问题 3 核实后不新增字段（§7.2）。唯一新增的 `.comet.yaml` 字段是 `bound_branch`，不加入 `REQUIRED_CLASSIC_KEYS`，不 bump `CLASSIC_MIGRATION_VERSION`（现为 `1`），存量 in-flight change 不受影响，不需要 migration。

## 9. 未决问题

1. `state rebind` 是否需要限制调用来源（例如只允许特定 `phase` 执行）？倾向不加限制，交互确认已在 SKILL.md 层的 decision-point 协议完成，留待实现阶段视测试情况再定。
2. §5.5 缺口 B 提到的 detached HEAD 场景，是否要在 `init` 阶段为 preset workflow 补一次前置检查？倾向不做（YAGNI：多一处检查点，换来的只是把同一个错误提示提前一步弹出），留待实现中如有更多信号再评估。
3. §7.2 `isolation: current` 的推送选项，"暂不推送"之后是否需要在下一次 `/comet` 相关命令入口提醒用户"还有未推送的分支"？倾向不做——这已经超出 issue #190 和本次 review 反馈的范围，属于独立的用户体验改进，留待后续单独提出。
