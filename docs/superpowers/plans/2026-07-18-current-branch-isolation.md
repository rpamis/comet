# current 隔离模式：实现计划

- 关联 spec：`docs/superpowers/specs/2026-07-18-current-branch-isolation-design.md`（本计划的每个 Task 都标注对应的 spec 章节，改动前请先读该章节的场景走查）
- 关联 issue：#190
- 基线：master `5e97d19`，本计划所有行号均已对照该基线核实

**范围说明**：spec 里的"问题 2"（hotfix/tweak worktree 限制）和"问题 4"（ESLint 转义符）核实后确认在 master 上不存在，不需要任何改动，本计划不包含对应 Task。"问题 3" 的设计已从"新增 `branch_action` 字段"改为"archive Step 5 按 isolation 分流、不新增字段"，范围比最初设想的小。"缺口 C"（hotfix/tweak 的 isolation 选择）已从"保留默认值、防止措辞冲突"改为"彻底移除默认值，改为主动询问三选一"（spec §5.7），对应 Task 4、Task 7b、Task 9。

## Global Constraints

- **Runtime rebuild is mandatory**：任何改动 `domains/comet-classic/*.ts` 的 Task，必须在改完后跑 `pnpm build` 重新生成 `assets/skills/comet/scripts/comet-runtime.mjs`，否则 `comet-scripts.test.ts`/`classic-runtime.test.ts` 的新鲜度检查会失败。仅改 SKILL.md 或 `app/commands/status.ts` 的 Task 不需要这一步。
- **`.comet.yaml` 字段三处同步**：新字段必须同时进 `classic-state.ts`（interface + wire key + 序列化/反序列化）、`classic-state-command.ts`（`sparseClassicState`，及 `MACHINE_OWNED_FIELDS`/`FIELD_ENUMS` 视字段性质而定）、`test/domains/comet-classic/comet-scripts.test.ts`（yaml 字符串）。`classic-validate-command.ts` 的 `KNOWN_KEYS` 自动派生自 `CLASSIC_WIRE_KEYS`（`classic-validate-command.ts:45-50`），新增自由字符串字段不需要改它；只有需要枚举校验时才要同步 `ENUMS`（`classic-validate-command.ts:24-44`）。
- **不 bump `classic_migration`**：`bound_branch` 不进 `REQUIRED_CLASSIC_KEYS`（`classic-state.ts:101-112`），`CLASSIC_MIGRATION_VERSION` 保持 `1`；`migrationVersion()` 是严格相等校验，bump 会让所有在跑的 change 在下次读取时报错。
- **detached HEAD 禁止建立绑定**：首次绑定与 `rebind` 都必须拒绝 detached HEAD；已绑定的 change 检测到 detached HEAD 必须判 `drift`（BLOCKED），不能跳过。
- **双语顺序**：SKILL.md/规则文档改动，中文定稿并经用户确认后，必须在同一轮提交前完成英文同步，不允许中英不同步的中间状态进入 review（spec §5.7）。
- **Changelog**：英文书写，只写用户可见行为，版本从 `package.json` 当前的 `0.4.0-beta.5` 升到 `0.4.0-beta.6`；同一开发周期内产生的多个用户可见变更追加到同一个版本条目下，不要拆成多个版本号。
- **Commit 规范**：`<type>: <summary>`（feat/fix/docs/chore/refactor/test/build/ci/perf）。
- **测试命令**：`npx vitest run test/domains/comet-classic/comet-scripts.test.ts` 覆盖 Classic 脚本契约；`npx vitest run` 全量；`pnpm format:check && pnpm lint && pnpm build` 是提交前三件套。

---

## Task 1：`bound_branch` 字段（数据模型）

对应 spec §5.3、§5.6。

**Files**：
- Modify: `domains/comet-classic/classic-state.ts`
- Modify: `domains/comet-classic/classic-state-command.ts`（`sparseClassicState`）
- Test: `test/domains/comet-classic/classic-state.test.ts`（round-trip）
- Test: `test/domains/comet-classic/comet-scripts.test.ts`（validate 接受新字段）

**Interfaces 产出**：`ClassicState.boundBranch: string | null`（wire key `bound_branch`），后续所有 Task 都依赖这个字段存在且可读写。

- [x] Step 1：在 `test/domains/comet-classic/classic-state.test.ts` 的 round-trip fixture 里，紧跟 `isolation` 之后加一行 `boundBranch: null,`。跑 `npx vitest run test/domains/comet-classic/classic-state.test.ts -t "round-trips"` 确认 FAIL（缺字段）。
- [x] Step 2：`classic-state.ts:35` 之后（`isolation` 字段声明后）加：
  ```ts
  boundBranch: string | null;
  ```
- [x] Step 3：`CLASSIC_WIRE_KEYS`（`classic-state.ts:72` `'isolation',` 之后）加 `'bound_branch',`。
- [x] Step 4：`classicStateFromDocument`（`classic-state.ts:213` `isolation:` 之后）加：
  ```ts
  boundBranch: nullableString(doc, 'bound_branch'),
  ```
- [x] Step 5：`classicStateToDocument`（`classic-state.ts:302` `isolation: state.isolation,` 之后）加：
  ```ts
  bound_branch: state.boundBranch,
  ```
- [x] Step 6：`classic-state-command.ts:259` `sparseClassicState` 里，对应 `isolation` 的取值逻辑之后加 `boundBranch` 的同款取值（用该函数里已有的可空字符串 helper，风格与 `isolation`/`branch_status` 一致）。
- [x] Step 7：重跑 Step 1 的测试确认 PASS。`pnpm build`。
- [x] Step 8：在 `comet-scripts.test.ts` 里新增一个 CLI 测试：`.comet.yaml` 含 `bound_branch: feature-A` 时 `comet-yaml-validate.mjs` 校验通过，stderr 不含 `unknown field 'bound_branch'`。跑通过。
- [x] Step 9：提交：`git add domains/comet-classic/classic-state.ts domains/comet-classic/classic-state-command.ts test/domains/comet-classic/classic-state.test.ts test/domains/comet-classic/comet-scripts.test.ts assets/skills/comet/scripts/comet-runtime.mjs && git commit -m "feat: add bound_branch field to classic state model"`

---

## Task 2：共享分支绑定判定模块

对应 spec §5.3、§5.4、§5.6。

**Files**：
- Create: `domains/comet-classic/classic-branch-binding.ts`
- Test: `test/domains/comet-classic/classic-branch-binding.test.ts`

**Interfaces 产出**：`liveGitBranch`、`evaluateBranchBinding`、`healBoundBranch`、`driftBlockedMessage`、`driftStaleReason`、`unboundDetachedMessage`——Task 3/4/5/6/7 全部消费这一个模块，不允许各自重复实现判定逻辑（这是 spec §5.2 目标"三处漂移检测口径一致"的落地方式）。

- [x] Step 1：写 `test/domains/comet-classic/classic-branch-binding.test.ts`，覆盖 `evaluateBranchBinding` 的五种输入组合：
  ```ts
  import { describe, expect, it } from 'vitest';
  import {
    evaluateBranchBinding,
    driftBlockedMessage,
    driftStaleReason,
  } from '../../../domains/comet-classic/classic-branch-binding.js';

  describe('evaluateBranchBinding', () => {
    it('is not applicable when isolation is not current', () => {
      expect(
        evaluateBranchBinding({ isolation: 'branch', boundBranch: null, currentBranch: 'feature-A' }),
      ).toEqual({ status: 'not-applicable' });
    });
    it('passes when the bound branch matches the current branch', () => {
      expect(
        evaluateBranchBinding({ isolation: 'current', boundBranch: 'feature-A', currentBranch: 'feature-A' }),
      ).toEqual({ status: 'ok' });
    });
    it('reports drift when the current branch differs', () => {
      expect(
        evaluateBranchBinding({ isolation: 'current', boundBranch: 'feature-A', currentBranch: 'feature-B' }),
      ).toEqual({ status: 'drift', boundBranch: 'feature-A', currentBranch: 'feature-B' });
    });
    it('reports drift (never a skip) when bound but HEAD is detached', () => {
      expect(
        evaluateBranchBinding({ isolation: 'current', boundBranch: 'feature-A', currentBranch: null }),
      ).toEqual({ status: 'drift', boundBranch: 'feature-A', currentBranch: null });
    });
    it('requests a lazy heal when unbound on a real branch', () => {
      expect(
        evaluateBranchBinding({ isolation: 'current', boundBranch: null, currentBranch: 'feature-A' }),
      ).toEqual({ status: 'needs-heal', branch: 'feature-A' });
    });
    it('refuses to lazy-bind when unbound and detached', () => {
      expect(
        evaluateBranchBinding({ isolation: 'current', boundBranch: null, currentBranch: null }),
      ).toEqual({ status: 'unbound-detached' });
    });
  });

  describe('drift messages', () => {
    it('renders the blocked message with a detached-HEAD label', () => {
      expect(driftBlockedMessage('my-change', 'feature-A', null)).toContain(
        "bound to branch 'feature-A', but current branch is 'detached HEAD'",
      );
      expect(driftBlockedMessage('my-change', 'feature-A', null)).toContain('comet state rebind my-change');
    });
    it('renders the stale reason with the current branch name', () => {
      expect(driftStaleReason('my-change', 'feature-A', 'feature-B')).toBe(
        "change 'my-change' is bound to branch 'feature-A', but current branch is 'feature-B'",
      );
    });
  });
  ```
  跑测试确认 FAIL（模块不存在）。
- [x] Step 2：实现 `domains/comet-classic/classic-branch-binding.ts`：
  ```ts
  import { execFileSync } from 'child_process';
  import { randomUUID } from 'crypto';
  import { promises as fs } from 'fs';
  import path from 'path';
  import { parseDocument } from 'yaml';

  export function liveGitBranch(cwd: string): string | null {
    try {
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return branch && branch !== 'HEAD' ? branch : null;
    } catch {
      return null;
    }
  }

  export type BranchBindingVerdict =
    | { status: 'not-applicable' }
    | { status: 'ok' }
    | { status: 'needs-heal'; branch: string }
    | { status: 'unbound-detached' }
    | { status: 'drift'; boundBranch: string; currentBranch: string | null };

  export function evaluateBranchBinding(input: {
    isolation: string | null;
    boundBranch: string | null;
    currentBranch: string | null;
  }): BranchBindingVerdict {
    if (input.isolation !== 'current') return { status: 'not-applicable' };
    if (input.boundBranch === null) {
      return input.currentBranch === null
        ? { status: 'unbound-detached' }
        : { status: 'needs-heal', branch: input.currentBranch };
    }
    if (input.currentBranch === input.boundBranch) return { status: 'ok' };
    return { status: 'drift', boundBranch: input.boundBranch, currentBranch: input.currentBranch };
  }

  export async function healBoundBranch(changeDir: string, branch: string): Promise<void> {
    const file = path.join(changeDir, '.comet.yaml');
    const document = parseDocument(await fs.readFile(file, 'utf8'), { uniqueKeys: false });
    document.set('bound_branch', branch);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, document.toString(), 'utf8');
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  function branchLabel(currentBranch: string | null): string {
    return currentBranch ?? 'detached HEAD';
  }

  export function driftBlockedMessage(change: string, boundBranch: string, currentBranch: string | null): string {
    return (
      `change '${change}' is bound to branch '${boundBranch}', but current branch is '${branchLabel(currentBranch)}'.\n` +
      `Next: ask the user to confirm — switch back to '${boundBranch}', or run \`comet state rebind ${change}\` after explicit confirmation.`
    );
  }

  export function driftStaleReason(change: string, boundBranch: string, currentBranch: string | null): string {
    return `change '${change}' is bound to branch '${boundBranch}', but current branch is '${branchLabel(currentBranch)}'`;
  }

  export function unboundDetachedMessage(change: string): string {
    return `change '${change}' uses isolation=current but has no bound branch and HEAD is detached; checkout a branch first before continuing.`;
  }
  ```
- [x] Step 3：重跑测试确认 PASS。`pnpm build`（模块暂无消费方，但确认 esbuild 能正确打包新文件）。
- [x] Step 4：提交：`git commit -m "feat: add shared branch-binding verdict module"`

---

## Task 3：sidecar 瘦身，`resolveCurrentChange` 改走 `bound_branch`

对应 spec §5.1、§5.4。

**Files**：
- Modify: `domains/comet-classic/classic-current-change.ts`（当前 155 行，全文见下方 diff 描述）
- Modify: `domains/comet-classic/classic-state-command.ts`（`selectChange` 第 1234 行、`currentChange` 第 1248 行的输出）
- Test: `test/domains/comet-classic/classic-current-change.test.ts`
- Test: `test/domains/comet-classic/comet-scripts.test.ts`（hook-guard 漂移测试）

**现状确认**（master 实际代码，`classic-current-change.ts` 全文 155 行）：`CurrentChangeSelection` 含 `branch: string | null`；`currentBranch()`（8-34 行）是私有的活跃分支读取函数；`selectCurrentChange()`（97-118 行）**每次调用都无条件写入 `branch: currentBranch(projectRoot)`**；`resolveCurrentChange()`（120-151 行）第 144 行的比较是 `if (selection.branch !== null && branch !== selection.branch)`——`selection.branch` 为 `null` 时整个条件短路跳过，这正是 spec §5.1 描述的 bug 的确切代码位置。

- [x] Step 1：更新 `test/domains/comet-classic/classic-current-change.test.ts`：
  - 把"atomically selects..."测试改为断言 `selectCurrentChange` 返回 `{ version: 1, change: 'change-a' }`（不含 `branch`）。
  - 把"marks a selection stale after the branch changes"测试改为：change 是 `isolation: current` 且 `.comet.yaml` 里 `bound_branch: main`，`selectCurrentChange` 后切到 `other` 分支，`resolveCurrentChange` 必须返回 `{ status: 'stale', reason: "change 'change-a' is bound to branch 'main', but current branch is 'other'" }`。
  - 新增一个测试：`isolation: branch`（非 current）的 change，切换分支后 `resolveCurrentChange` 仍然 `{ status: 'selected' }`（证明只有 `current` 模式受漂移检测约束，`branch`/`worktree` 模式行为不变）。
  跑测试确认 FAIL。
- [x] Step 2：改写 `classic-current-change.ts`：
  - imports 里去掉 `execFileSync`（不再需要私有 `currentBranch`），加入：
    ```ts
    import {
      driftStaleReason,
      evaluateBranchBinding,
      healBoundBranch,
      liveGitBranch,
      unboundDetachedMessage,
    } from './classic-branch-binding.js';
    import { readClassicState } from './classic-store.js';
    ```
  - `CurrentChangeSelection` 去掉 `branch` 字段。
  - 删除私有函数 `currentBranch()`。
  - `parseSelection` 去掉对 `record.branch` 的解析和校验。
  - `selectCurrentChange` 不再写 `branch`，只写 `{ version: 1, change: changeName }`。
  - `resolveCurrentChange` 末尾（原第 143-150 行）替换为：
    ```ts
    const projection = await readClassicState(changeDirectory(projectRoot, selection.change), { migrate: false });
    const branch = liveGitBranch(projectRoot);
    const verdict = evaluateBranchBinding({
      isolation: projection.classic?.isolation ?? null,
      boundBranch: projection.classic?.boundBranch ?? null,
      currentBranch: branch,
    });
    if (verdict.status === 'drift') {
      return { status: 'stale', reason: driftStaleReason(selection.change, verdict.boundBranch, verdict.currentBranch) };
    }
    if (verdict.status === 'unbound-detached') {
      return { status: 'stale', reason: unboundDetachedMessage(selection.change) };
    }
    if (verdict.status === 'needs-heal') {
      await healBoundBranch(changeDirectory(projectRoot, selection.change), verdict.branch);
    }
    return { status: 'selected', selection };
    ```
    （`changeDirectory` 是文件里已有的私有 helper，第 36-38 行，直接复用。）
- [x] Step 3：`classic-state-command.ts` 的 `selectChange`（第 1234 行附近）和 `currentChange`（第 1248 行附近）——检查两处是否读取了 `selection.branch`；若有，改为从 `resolveCurrentChange` 返回的 Classic state 或单独一次 `readField(name, 'bound_branch')` 读取，不再依赖 sidecar 里的分支字段。
- [x] Step 4：重跑 Step 1 测试确认 PASS。`pnpm build`。
- [x] Step 5：在 `comet-scripts.test.ts` 新增 hook-guard 回归测试：`isolation: current` 且已绑定 `feature-A` 的 change，`select` 后切到 `feature-B`，尝试写一个仓库源文件，`runHookGuard` 必须返回非 0，stderr 包含 `current change selection is stale or invalid` 和 `bound to branch 'feature-A', but current branch is 'feature-B'`。跑通过。
- [x] Step 6：提交：`git commit -m "feat: bind current-isolation drift detection to bound_branch"`

---

## Task 4：`set isolation current` 首次绑定

对应 spec §5.4、§5.5（缺口 B 的因果，本 Task 的惰性补绑在 Task 5 才真正落地，这里只做显式 `set` 触发的首次绑定）。

**Files**：
- Modify: `domains/comet-classic/classic-state-command.ts`（`MACHINE_OWNED_FIELDS` 第 42-48 行、`setField` 第 423-490 行）
- Test: `test/domains/comet-classic/comet-scripts.test.ts`

- [x] Step 1：写失败的 CLI 测试（新增 `describe('isolation=current branch binding', ...)`），覆盖：
  - 首次 `set <name> isolation current` 在真实 git 分支上写入 `bound_branch` = 当前分支。
  - 已绑定后重复 `set isolation current`（哪怕当前分支已经变了）不覆盖已有 `bound_branch`。
  - `set <name> isolation branch` 把 `bound_branch` 清空为 `null`。
  - detached HEAD 下 `set isolation current` 报错退出非 0，stderr 含 `HEAD is detached`，且不写入 `bound_branch`。
  - 直接 `set <name> bound_branch x` 报错，stderr 含 `machine-owned`。
  跑测试确认 FAIL。
- [x] Step 2：`MACHINE_OWNED_FIELDS`（`classic-state-command.ts:42-48`）加入 `'bound_branch'`。
- [x] Step 3：文件顶部 import 区加：`import { liveGitBranch } from './classic-branch-binding.js';`
- [x] Step 4：`setField` 里 `document.set(field, parsedValue(field, value));`（第 446 行）之后插入：
  ```ts
  if (field === 'isolation') {
    if (value === 'current') {
      const record = document.toJS() as Record<string, unknown>;
      const existing = record.bound_branch;
      const alreadyBound = typeof existing === 'string' && existing !== '';
      if (!alreadyBound) {
        const branch = liveGitBranch(process.cwd());
        if (branch === null) {
          fail('ERROR: cannot bind isolation=current while HEAD is detached; checkout a branch first');
        }
        document.set('bound_branch', branch);
      }
    } else {
      document.set('bound_branch', null);
    }
  }
  ```
- [x] Step 5：重跑 Step 1 测试确认 PASS。`pnpm build`，再跑一遍确认（`fail()` 抛出的 `CommandFailure` 依赖构建产物）。
- [x] Step 6：提交：`git commit -m "feat: capture bound_branch on set isolation current"`

---

## Task 5：`state check` 漂移检测与惰性补绑（含缺口 B 场景）

对应 spec §5.4、§5.5。

**Files**：
- Modify: `domains/comet-classic/classic-state-command.ts`（`check` 函数，第 790-850 行）
- Test: `test/domains/comet-classic/comet-scripts.test.ts`

- [x] Step 1：写失败的 CLI 测试，覆盖：
  - `current` 模式绑定 `feature-A`，切到 `feature-B` 后 `state check <name> verify` 返回非 0，stdout 含 `BLOCKED` 与 `bound to branch 'feature-A', but current branch is 'feature-B'`。
  - sidecar（`.comet/`）被删除后重新 `select`，漂移检测依然生效（证明检测依据 `.comet.yaml` 而非 sidecar）。
  - detached HEAD 下检查已绑定的 change，返回非 0，stdout 含 `detached HEAD`。
  - **缺口 B 场景**：`isolation: current` 但 `bound_branch` 缺失（模拟 hotfix/tweak `init` 直写的情况，不经过 `set`），在真实分支上 `state check` 必须自动补绑并返回 0，随后 `get <name> bound_branch` 能读到该分支名。
  跑测试确认 FAIL。
- [x] Step 2：文件顶部 import 扩展为：
  ```ts
  import {
    driftBlockedMessage,
    evaluateBranchBinding,
    healBoundBranch,
    liveGitBranch,
    unboundDetachedMessage,
  } from './classic-branch-binding.js';
  ```
- [x] Step 3：`check` 函数里，`output.stdout.push('');`（第 844 行）之前插入：
  ```ts
  const isolation = await readField(name, 'isolation');
  if (isolation === 'current') {
    const boundBranchRaw = await readField(name, 'bound_branch');
    const verdict = evaluateBranchBinding({
      isolation,
      boundBranch: boundBranchRaw && boundBranchRaw !== 'null' ? boundBranchRaw : null,
      currentBranch: liveGitBranch(process.cwd()),
    });
    if (verdict.status === 'drift') {
      reject(driftBlockedMessage(name, verdict.boundBranch, verdict.currentBranch));
    } else if (verdict.status === 'unbound-detached') {
      reject(unboundDetachedMessage(name));
    } else if (verdict.status === 'needs-heal') {
      await healBoundBranch(directory, verdict.branch);
      pass(`bound_branch lazily set to ${verdict.branch} (isolation=current)`);
    } else {
      pass('bound_branch matches current branch (isolation=current)');
    }
  }
  ```
  （`reject`/`pass`/`directory` 都是 `check` 函数已有的局部变量/闭包，第 793、797-801 行已定义，直接复用；`reject` 已经会把 `blocked` 置 `true`，不需要额外处理。）
- [x] Step 4：重跑 Step 1 测试确认 PASS。`pnpm build`。
- [x] Step 5：提交：`git commit -m "feat: enforce bound_branch drift in state check"`

---

## Task 6：`state rebind` 子命令

对应 spec §5.4。

**Files**：
- Modify: `domains/comet-classic/classic-state-events.ts`（`event` 类型加宽）
- Modify: `domains/comet-classic/classic-state-command.ts`（新增 `rebind` 函数 + 分发）
- Test: `test/domains/comet-classic/comet-scripts.test.ts`

- [x] Step 1：`classic-state-events.ts:10` 的 `event: ClassicTransitionEvent;` 改为 `event: ClassicTransitionEvent | 'rebind';`
- [x] Step 2：写失败的 CLI 测试，覆盖：
  - 已绑定 `feature-A`、切到 `feature-B` 后 `rebind <name>` 成功，`get <name> bound_branch` 变为 `feature-B`，随后 `state check <name> verify` 通过；`.comet/state-events.jsonl` 最后一条记录 `event: 'rebind'`、`effects` 含 `{ field: 'boundBranch', from: 'feature-A', to: 'feature-B' }`。
  - 未绑定（`bound_branch: null`）时 `rebind` 报错，stderr 含 `not yet bound`。
  - detached HEAD 下 `rebind` 报错，stderr 含 `HEAD is detached`。
  跑测试确认 FAIL。
- [x] Step 3：在 `classic-state-command.ts` 里 `selectChange` 函数附近新增：
  ```ts
  async function rebind(output: CommandOutput, name: string): Promise<void> {
    validateChangeName(name);
    const { directory } = await stateFile(name);
    const boundBranch = await readField(name, 'bound_branch');
    if (!boundBranch || boundBranch === 'null') {
      fail(`ERROR: '${name}' is not yet bound; use 'comet state set ${name} isolation current' to establish the first binding`);
    }
    const branch = liveGitBranch(process.cwd());
    if (branch === null) {
      fail('ERROR: cannot rebind while HEAD is detached; checkout a branch first');
    }
    const before = await readClassicState(directory);
    if (!before.classic) fail('ERROR: Classic state projection is missing');
    await healBoundBranch(directory, branch);
    const after: ClassicState = { ...before.classic, boundBranch: branch };
    await appendClassicStateEvent(directory, {
      change: name,
      event: 'rebind',
      source: 'comet-state',
      from: before.classic,
      to: after,
      effects: [{ field: 'boundBranch', from: boundBranch, to: branch }],
    });
    output.stderr.push(green(`[REBIND] bound_branch: ${boundBranch} → ${branch}`));
  }
  ```
  并在 `classicStateCommand` 的分发链（第 1302 行 `select` 分支旁）加：
  ```ts
  } else if (subcommand === 'rebind') {
    requiredExact(rest, 1, 'Usage: comet-state.mjs rebind <change-name>');
    await rebind(output, rest[0]);
  } else if (subcommand === 'select') {
  ```
- [x] Step 4：重跑 Step 2 测试确认 PASS。`pnpm build`。
- [x] Step 5：提交：`git commit -m "feat: add state rebind subcommand with audit trail"`

---

## Task 7：phase guard 漂移校验

对应 spec §5.6。

**Files**：
- Modify: `domains/comet-classic/classic-guard.ts`
- Test: `test/domains/comet-classic/comet-scripts.test.ts`

**现状确认**：`classic-guard.ts` 里 `readField`（128 行）、`check` helper（273 行）、`runChecks`（300 行）已存在，可直接复用；`isolationSelected`（488-497 行）是既有的、与本次改动无关的字段选择检查（不要混淆）。

- [x] Step 1：写失败的 CLI 测试：`isolation: current` 绑定 `feature-A`、`archived: true`、`verify_result: pass`，切到 `feature-B` 后 `comet-guard <name> archive` 返回非 0，stderr 含 `BLOCKED` 与 `bound to branch 'feature-A', but current branch is 'feature-B'`。
- [x] Step 2：import 区加：
  ```ts
  import {
    driftBlockedMessage,
    evaluateBranchBinding,
    healBoundBranch,
    liveGitBranch,
    unboundDetachedMessage,
  } from './classic-branch-binding.js';
  ```
  新增检查函数（放在 `isolationSelected` 附近）：
  ```ts
  async function boundBranchMatches(changeDir: string, change: string): Promise<CheckResult> {
    const isolation = await readField(changeDir, 'isolation');
    const boundBranch = await readField(changeDir, 'bound_branch');
    const verdict = evaluateBranchBinding({
      isolation,
      boundBranch: boundBranch && boundBranch !== 'null' ? boundBranch : null,
      currentBranch: liveGitBranch(process.cwd()),
    });
    if (verdict.status === 'drift') return fail(driftBlockedMessage(change, verdict.boundBranch, verdict.currentBranch));
    if (verdict.status === 'unbound-detached') return fail(unboundDetachedMessage(change));
    if (verdict.status === 'needs-heal') {
      await healBoundBranch(changeDir, verdict.branch);
      return pass(`bound_branch lazily set to ${verdict.branch} (isolation=current)`);
    }
    return pass();
  }
  ```
- [x] Step 3：把 `check('bound branch matches isolation=current', () => boundBranchMatches(changeDir, change)),` 注册为 `guardBuildChecks`、`guardVerifyChecks`、`guardArchiveChecks` 三个 `runChecks(output, [...])` 数组的**第一项**（找 guard.ts 里这三个函数，定位方式：`grep -n "guardBuildChecks\|guardVerifyChecks\|guardArchiveChecks" classic-guard.ts`）。若 `guardArchiveChecks` 当前签名不含 `change` 参数，扩展签名并同步更新调用点。
- [x] Step 4：`pnpm build`，重跑 Step 1 测试确认 PASS。
- [x] Step 5：跑现有 guard 相关测试全集，确认无回归：`npx vitest run test/domains/comet-classic/comet-scripts.test.ts test/domains/comet-classic/classic-guard.test.ts`。特别注意：任何"`isolation=current` 下 build/verify/archive 完整流程通过"的既有测试，若原先在无 git 仓库环境下运行，会因为 `liveGitBranch` 返回 `null` 而变成 `unbound-detached` 判定并 FAIL——按 spec §5.5 的原则修 fixture（补 `gitInit` + 匹配的 `bound_branch`），**不得放宽新检查来迁就旧测试**。
- [x] Step 6：提交：`git commit -m "feat: mirror bound_branch drift check in phase guard"`

---

## Task 7b：`preset-escalate` 同步清空 `bound_branch`

对应 spec §5.6"追加发现"、§5.8 Step 7b。这是追问"hotfix/tweak 写入 isolation 的时机"时发现的第二个写入点——`preset-escalate` 走 `classic-transitions.ts` 而不是 `classic-state-command.ts` 的 `setField`，Task 4 加的清空副作用覆盖不到它。

**Files**：
- Modify: `domains/comet-classic/classic-transitions.ts`
- Test: `test/domains/comet-classic/comet-scripts.test.ts`（或 `classic-transitions.test.ts`，视现有测试组织方式而定）

**现状确认**：`applyClassicTransition()` 的 `preset-escalate` 分支（第 147-164 行）用文件内部私有的纯函数 `setField(classic, effects, field, value)`（第 96-105 行，操作内存中的 `ClassicState` 对象，和 `classic-state-command.ts` 里那个操作 YAML `Document` 的同名异物函数完全不是一回事）依次清空 `workflow`/`classicProfile`/`phase`/`designDoc`/`buildPause`/`buildMode`/`subagentDispatch`/`tddMode`/`reviewMode`/`isolation`/`verifyMode`/`directOverride`，第 162 行 `setField(classic, effects, 'isolation', null);` 之后紧接着第 163 行才是 `verifyMode`。

- [x] Step 1：写失败测试：`isolation: current` 且已绑定 `bound_branch: feature-A` 的 hotfix change，`phase: build`，执行 `comet state transition <name> preset-escalate` 后 `get <name> bound_branch` 必须为 `null`（当前行为：仍是 `feature-A`，因为没人清它）。跑测试确认 FAIL。
- [x] Step 2：`classic-transitions.ts:162` 之后加一行：
  ```ts
  setField(classic, effects, 'boundBranch', null);
  ```
- [x] Step 3：重跑 Step 1 测试确认 PASS。`pnpm build`。
- [x] Step 4：提交：`git commit -m "fix: clear bound_branch when preset-escalate clears isolation"`

---

## Task 8：全量回归

- [x] `npx vitest run` 全通过。
- [x] `pnpm lint && pnpm build` 通过。
- [x] 若 Step 5-7b 暴露的既有 fixture 需要调整，一并提交：`git commit -m "test: reconcile existing fixtures with bound_branch drift checks"`（若无改动跳过）。

---

## Task 9：hotfix/tweak 的 isolation 改为主动询问

对应 spec §5.5、§5.7（设计变更：用户明确要求把 hotfix/tweak 的 isolation 默认值改为主动询问，不再保留"默认 current"）。

**Files**：
- Modify: `domains/comet-classic/classic-state-command.ts`（`init()` 第 511 行）
- Modify: `assets/skills-zh/comet-hotfix/SKILL.md`、`assets/skills-zh/comet-tweak/SKILL.md`
- Test: `test/domains/comet-classic/comet-scripts.test.ts`

- [x] Step 1：写失败测试：`comet state init <name> hotfix` 与 `comet state init <name> tweak` 之后，`get <name> isolation` 必须返回 `null`（不再是 `current`）。跑测试确认 FAIL。
- [x] Step 2：`classic-state-command.ts:511` 把 `isolation: preset ? 'current' : null,` 改为 `isolation: null,`（对所有 workflow 统一，不再按 `preset` 区分）。
- [x] Step 3：重跑 Step 1 测试确认 PASS。`pnpm build`。
- [x] Step 4：**回归排查**：`grep -rn "isolation.*current" test/domains/comet-classic/comet-scripts.test.ts` 找出所有依赖"hotfix/tweak `init` 后 `isolation` 直接是 `current`"的既有 fixture/断言，逐一改为在 `init` 之后显式补一次 `comet state set <name> isolation current`（或按测试场景选 `branch`/`worktree`）再继续，不得为了让旧测试通过而把 `init` 的默认值改回去。跑 `npx vitest run test/domains/comet-classic/comet-scripts.test.ts` 确认全部恢复 PASS。
- [x] Step 5：编辑中文 `comet-hotfix/SKILL.md`（原第 45 行）：删除"hotfix 默认 `isolation: current`..."整句，替换为工作区隔离决策点：
  ```markdown
  ### 工作区隔离（用户决策点）

  展示决策前先做能力预检：确认 `using-git-worktrees` 是否可用、当前仓库能否安全创建分支。只展示当前真实可执行的选项。

  这是用户决策点。**必须按 `comet/reference/decision-point.md` 的协议暂停**，让用户从以下选项中选择：

  | 选项 | 方式 | 说明 |
  |------|------|------|
  | A | 当前分支直接工作 | 不新建分支/worktree，直接在当前所在分支上完成本次 hotfix |
  | B | 创建分支 | 命名规范同 `/comet-build`：`hotfix/YYYYMMDD/<change-name>` |
  | C | 创建 Worktree | 完全独立的工作区，适合当前分支有未提交工作、不想打断的场景 |

  不得自动选择，也不得沿用其他 change 的历史选择。

  用户选择后：

  - **A**：`comet state set <name> isolation current`
  - **B**：确认分支名后执行 `git checkout -b <branch-name>`，再运行 `comet state set <name> isolation branch`
  - **C**：**立即执行：** 使用 Skill 工具加载 Superpowers `using-git-worktrees` 技能创建隔离工作区；禁止用普通 shell 命令绕过。创建后运行 `comet state set <name> isolation worktree`

  选择 B 或 C 后，必须在新工作区重新运行 `comet state select <change-name>`，再开始创建精简版产物。
  ```
  请用户审阅中文措辞。
- [x] Step 6：对 `comet-tweak/SKILL.md`（原第 53 行）做同样的替换，把命名规范换成 `tweak/YYYYMMDD/<change-name>`，其余文案与 hotfix 版一致。请用户审阅中文措辞。
- [x] Step 7：`grep -rn "压缩门\|调试门\|确认门" assets/skills-zh/comet-hotfix/SKILL.md assets/skills-zh/comet-tweak/SKILL.md` 确认零命中。
- [x] Step 8：提交（中文部分）：`git commit -m "feat: ask hotfix/tweak to choose isolation explicitly instead of defaulting to current"`

---

## Task 10：五份 SKILL.md 的漂移 decision-point

对应 spec §5.8 Step 10。这一步和 Task 9 是两件不同的事：Task 9 是"流程入口选一次工作区隔离"，本 Task 是"选完之后如果中途分支漂移，检测到 `BLOCKED` 时怎么处理"——五份文件都需要，包括 hotfix/tweak（选完 `current` 之后同样可能中途被切走分支）。

**Files**：`assets/skills-zh/comet-build/SKILL.md`、`comet-verify/SKILL.md`、`comet-archive/SKILL.md`、`comet-hotfix/SKILL.md`、`comet-tweak/SKILL.md`。

- [x] Step 1：在五份 SKILL.md 的入口命令块（`comet state select` / `comet state check <name> <phase>`）之后，插入一段：检测到 `BLOCKED`（分支绑定漂移）时，按 `comet/reference/decision-point.md` 协议暂停，等待用户选择"切回绑定分支"或（明确确认后）执行 `comet state rebind <change-name>`；不得自行切换分支或换绑。
- [x] Step 2：**人工验收**：逐字通读 hotfix/tweak 两份 SKILL.md 里 Task 9 新加的"工作区隔离决策点"和本 Task 新加的"漂移 decision-point"，确认两段话读起来是"入口选一次"和"中途出问题再暂停"两件不同的事，不会被读成同一个决策点。
- [x] Step 3：`grep -rn "压缩门\|调试门\|确认门" assets/skills-zh/comet-build/SKILL.md assets/skills-zh/comet-verify/SKILL.md assets/skills-zh/comet-archive/SKILL.md assets/skills-zh/comet-hotfix/SKILL.md assets/skills-zh/comet-tweak/SKILL.md` 确认零命中。
- [x] Step 4：请用户审阅中文措辞。
- [x] Step 5：中文确认后，**同一轮**同步 Task 9 + 本 Task 涉及的全部五份英文版 SKILL.md，以及 `assets/skills/comet/reference/comet-yaml-fields.md` + 中文版补充 `bound_branch` 字段说明。不得带着中英不同步的状态提交。
- [x] Step 6：提交：`git commit -m "docs: add current-isolation drift decision point to build/verify/archive/hotfix/tweak skills"`

---

## Task 11：`comet status` 暴露 isolation / 绑定分支（缺口 A）

对应 spec §6。依赖 Task 1（`ClassicState.boundBranch` 必须已存在）。

**Files**：
- Modify: `app/commands/status.ts`
- Test: `test/app/` 下对应 status 测试文件

- [x] Step 1：新增/扩展测试：`isolation: current` 且已绑定的 change，`comet status`（文本输出）包含 `isolation: current (bound: feature-A)`；`isolation` 为 `null` 或 `branch`/`worktree` 时不打印该行（不引入噪音，`branch`/`worktree` 也不显示绑定分支）；`comet status --json` 输出的每条 change 记录包含 `"boundBranch"` 字段且与 `.comet.yaml` 一致。跑测试确认 FAIL。
- [x] Step 2：`app/commands/status.ts` 的 `ChangeStatus` 接口（第 11-40 行）在 `isolation: string | null;` 之后加：
  ```ts
  boundBranch: string | null;
  ```
- [x] Step 3：`getActiveChanges()` 内四条构造 `ChangeStatus` 记录的分支（unknown-keys 分支约第 94-115 行、valid 分支约第 121-153 行、invalid 分支约第 156-177 行、catch 分支约第 179-200 行）都在 `isolation: ...` 那一行之后加 `boundBranch: projection.classic?.boundBranch ?? null,`（catch 分支没有 `projection` 可用，保持 `boundBranch: null,` 即可，与该分支 `isolation: null,` 的写法一致）。
- [x] Step 4：`displayStatus()` 里，`console.log(\`     workflow: ${c.workflow} | build_mode: ${c.buildMode}\`);`（第 252 行）之后加：
  ```ts
  if (c.isolation) {
    const branchSuffix = c.isolation === 'current' && c.boundBranch ? ` (bound: ${c.boundBranch})` : '';
    console.log(`     isolation: ${c.isolation}${branchSuffix}`);
  }
  ```
- [x] Step 5：重跑 Step 1 测试确认 PASS；`npx vitest run` 确认无回归（本 Task 不涉及 `domains/comet-classic`，不需要 `pnpm build`）。
- [x] Step 6：提交：`git commit -m "feat: surface isolation and bound branch in comet status"`

---

## Task 12：archive Step 5 按 isolation 分流（问题 3，修正后设计）

对应 spec §7。建议在 Task 10 落地之后再做，避免同一批 SKILL.md 冲突。

**Files**：
- Modify: `assets/skills-zh/comet-archive/SKILL.md`（第 105-123 行附近的 Step 5）
- Modify: `assets/skills/comet-archive/SKILL.md`（英文同步）

- [x] Step 1：编辑中文 `comet-archive/SKILL.md` Step 5：在加载 Superpowers `finishing-a-development-branch` 之前，插入 `isolation` 判断：
  - `isolation !== 'current'`：完全保留现有三选一流程（本地合并到主分支 / 推送并创建 PR / 保持分支），不改一个字。
  - `isolation === 'current'`：跳过 `finishing-a-development-branch`，改为两选一 decision-point："1. 推送当前分支" / "2. 暂不推送，保留本地"。选 1 时执行 `git push`（若无上游分支，`git push -u origin <当前分支>`）；选 2 不执行任何 git 操作。
  两条路径收尾都保持不变：执行完选择后运行 `comet state set <change-name> branch_status handled` → `comet guard <change-name> archive` → `comet state clear-selection`。
- [x] Step 2：**人工验收**（同 Task 10 的性质，不是自动化测试）：确认新增的两选一文案措辞，与 Task 10 加入的"检测到 BLOCKED 时暂停"decision-point 文案、以及 Task 9 hotfix/tweak 的入口工作区隔离决策点，三者互相之间不冲突——这是三个不同触发条件的独立决策点（流程入口选一次隔离方式 / 漂移检测时触发 / 归档收尾时触发），不要在同一份文件里写出让人误解成同一件事的表述。
- [x] Step 3：若仓库现有对 SKILL.md 正文做断言式测试（例如 `test/domains/skill/skills.test.ts` 只做结构/存在性校验而非语义断言），本 Task 不强行新增脆弱的文本匹配测试；如需要回归保障，可在该测试文件里补一条"comet-archive SKILL.md 包含 isolation 关键字"的存在性检查即可，不用 assert 具体措辞。
- [x] Step 4：中文确认后，同一轮同步英文版 `assets/skills/comet-archive/SKILL.md`。
- [x] Step 5：`npx vitest run && pnpm lint`（本 Task 只改 SKILL.md，不涉及 `domains/comet-classic/*.ts`，不需要 `pnpm build`）。
- [x] Step 6：提交：`git commit -m "docs: branch current isolation archive flow away from finishing-a-development-branch"`

---

## Task 13：Changelog 与版本号

- [x] `package.json` 的 `"version"` 从 `0.4.0-beta.5` 改为 `0.4.0-beta.6`。
- [x] `CHANGELOG.md` 顶部新增（若已有同版本条目则追加到同一条目下，不新开版本号）：
  ```markdown
  ## What's Changed [0.4.0-beta.6] - 2026-07-18

  ### Added

  - **`comet state rebind`**: New command to explicitly re-bind an `isolation: current` change to the current branch after user confirmation, recording an audit event; refuses to run while HEAD is detached or before an initial binding exists.

  ### Changed

  - **Current-isolation drift detection**: `isolation: current` now persists its bound branch in the committed change state instead of a local sidecar, so switching branches mid-change is reliably detected at every build/verify/archive entry check and by the write guard, and is no longer silently reset by re-selecting the current change. Establishing `isolation: current` on a detached HEAD is now rejected.
  - **`comet status`**: now surfaces the selected isolation mode and, for `current` isolation, the bound branch, in both text and `--json` output.
  - **Archive branch handling for `current` isolation**: no longer offers the feature-branch-oriented merge/PR/keep choices; instead asks whether to push the current branch or keep it local.
  - **hotfix/tweak workspace isolation**: no longer defaults silently to the current branch; both presets now pause to ask the user to choose between working directly on the current branch, creating a new branch, or creating a worktree.
  ```
- [x] `node -p "require('./package.json').version"` 输出 `0.4.0-beta.6`，与 changelog 标题一致。
- [x] `npx vitest run && pnpm lint && pnpm build` 全部通过。
- [x] 提交：`git commit -m "chore: release 0.4.0-beta.6 with current-isolation branch binding"`

---

## 执行顺序回顾

Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 7b → 8（问题 1 + 缺口 B + 两个 isolation 写入点的联动清空，Task 1-8 环环相扣，必须按序）→ 9（hotfix/tweak 主动询问，缺口 C 新设计）→ 10（五份 SKILL.md 的漂移 decision-point）→ 11（缺口 A，依赖 Task 1）→ 12（问题 3）→ 13（发布）。Task 11 也可以在 Task 8 之后立即插入（只依赖 Task 1 的字段，不依赖 Task 9/10），如果想让 `comet status` 更早可用可以提前做；Task 12 建议放在 Task 10 之后以避开同批 SKILL.md 冲突。
