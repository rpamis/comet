# Comet Native Workflow Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一套可独立安装和运行的 Comet Native Phase 1：它使用可配置的 `<artifact-root>/comet/` 管理 change、完整目标 spec、状态、验证、归档和恢复，面向强模型提供轻量执行协议，并且不依赖或触碰 Classic、OpenSpec、Superpowers 或其他外部 Skill。

**Architecture:** `domains/comet-native/` 独占 Native 配置、路径、状态、守卫、事务和诊断；`domains/engine/` 只抽出可注入的 Run 存储布局，默认值保持 Classic 的 `.comet/` 行为；`domains/workflow-contract/` 增加独立 `comet-native` 内建协议；`app/` 只注册 `comet native` facade；生成的 Native runtime 与双语 `comet-native` Skill 随 `assets/` 分发。Native 与 Classic 没有迁移、升级、共享 change 或自动路由。

**Tech Stack:** TypeScript 5.9、Node.js 20 `fs/promises`、Commander 14、`yaml` 2.9、Vitest 4、esbuild、现有 Python eval harness。

## Global Constraints

- 本计划只实现设计文档的 Phase 1；不修改 `/comet` 默认路由，不新增 Native/Classic 自动选择，不新增 Native→Classic 或 Classic→Native 转换。
- 不修改 `assets/skills/comet/`、`assets/skills-zh/comet/`、任何 OpenSpec Skill 或任何 Superpowers Skill。
- `domains/comet-native/` 不得 import `domains/comet-classic/`，不得调用 OpenSpec CLI，也不得通过 Engine action 调用外部 Skill。
- Native 所有持久产物使用 `<artifact-root>/comet/`；项目根只额外允许 `comet.config.yaml`。Native 不创建 `.comet/`。
- 所有可变 YAML/JSON 与单个 spec 文件使用同目录临时文件后 rename；archive 与 root move 使用锁、staged tree、append-only journal 和显式恢复，不宣称多文件事务具有单次文件系统原子性。
- 每个任务先写失败测试并观察预期失败，再写最小实现、运行聚焦测试、提交。普通回归测试不写入 Changelog。
- Native Skill 先完成中文版本并暂停等待用户确认；确认后才同步英文、加入发布 manifest、写用户文档和 Changelog。
- 当前 `origin/master`、tag、`package.json` 都是 `0.4.0-beta.4`。发布任务使用唯一下一版本 `0.4.0-beta.5`；执行到发布任务时先重新核对 master，若基线变化则停止并重算版本，不能叠加第二个预发布版本。

---

## Task 1: Make Engine Run storage layout injectable without changing Classic

**Files:**

- Create: `domains/engine/storage-layout.ts`
- Modify: `domains/engine/loop.ts`
- Modify: `domains/engine/state.ts`
- Test: `test/domains/engine/engine-storage-layout.test.ts`
- Test: `test/domains/engine/engine-loop.test.ts`
- Test: `test/domains/engine/engine-state.test.ts`

- [ ] **Step 1: Add failing tests for Classic defaults and a visible Native layout**

Add tests that assert both of these layouts exactly:

```ts
expect(CLASSIC_RUN_STORAGE).toEqual({
  stateRef: '.comet/run-state.json',
  pendingRef: '.comet/pending-action.json',
  trajectoryRef: '.comet/trajectory.jsonl',
  contextRef: '.comet/context.md',
  artifactsRef: '.comet/artifacts.json',
  checkpointRef: '.comet/checkpoint.json',
  snapshotsRef: '.comet/skill-snapshots',
});

expect(NATIVE_RUN_STORAGE).toEqual({
  stateRef: 'runtime/run-state.json',
  pendingRef: 'runtime/pending-action.json',
  trajectoryRef: 'runtime/trajectory.jsonl',
  contextRef: 'runtime/context.md',
  artifactsRef: 'runtime/artifacts.json',
  checkpointRef: 'runtime/checkpoints/latest.json',
  snapshotsRef: 'runtime/skill-snapshots',
});
```

Also assert that existing `startRun(pkg, id, hash)` still emits Classic refs, while new `startRunWithStorage(pkg, id, hash, NATIVE_RUN_STORAGE)` emits only `runtime/` refs and that `writeRunStateAt(changeDir, state, NATIVE_RUN_STORAGE)` creates `runtime/run-state.json` without creating `.comet/`.

- [ ] **Step 2: Run the focused tests and observe the missing API failure**

Run:

```bash
npx vitest run test/domains/engine/engine-storage-layout.test.ts test/domains/engine/engine-loop.test.ts test/domains/engine/engine-state.test.ts
```

Expected: imports of `storage-layout.ts`, `startRunWithStorage`, and the `*RunStateAt` functions fail before implementation.

- [ ] **Step 3: Add the storage contract and preserve Classic defaults**

Implement this public contract in `domains/engine/storage-layout.ts`:

```ts
export interface RunStorageLayout {
  stateRef: string;
  pendingRef: string;
  trajectoryRef: string;
  contextRef: string;
  artifactsRef: string;
  checkpointRef: string;
  snapshotsRef: string;
}

export const CLASSIC_RUN_STORAGE: Readonly<RunStorageLayout> = Object.freeze({
  stateRef: '.comet/run-state.json',
  pendingRef: '.comet/pending-action.json',
  trajectoryRef: '.comet/trajectory.jsonl',
  contextRef: '.comet/context.md',
  artifactsRef: '.comet/artifacts.json',
  checkpointRef: '.comet/checkpoint.json',
  snapshotsRef: '.comet/skill-snapshots',
});

export const NATIVE_RUN_STORAGE: Readonly<RunStorageLayout> = Object.freeze({
  stateRef: 'runtime/run-state.json',
  pendingRef: 'runtime/pending-action.json',
  trajectoryRef: 'runtime/trajectory.jsonl',
  contextRef: 'runtime/context.md',
  artifactsRef: 'runtime/artifacts.json',
  checkpointRef: 'runtime/checkpoints/latest.json',
  snapshotsRef: 'runtime/skill-snapshots',
});
```

Validate every ref with the existing relative-path rules. Change these signatures while keeping the shown defaults:

```ts
export function startRunWithStorage(
  pkg: SkillPackage,
  runId: string,
  skillHash: string,
  storage: Readonly<RunStorageLayout>,
): RunState;

export async function readRunStateAt(
  changeDir: string,
  storage: Readonly<RunStorageLayout>,
): Promise<RunState | null>;

export async function writeRunStateAt(
  changeDir: string,
  state: RunState,
  storage: Readonly<RunStorageLayout>,
): Promise<void>;

export async function removeRunStateAt(
  changeDir: string,
  storage: Readonly<RunStorageLayout>,
): Promise<void>;
```

Keep the existing `startRun`, `readRunState`, `writeRunState`, and `removeRunState` signatures and function bodies unchanged. Add the explicit-layout variants beside them, and have only Native import those variants. This preserves Classic tree-shaking and keeps the generated Classic runtime byte-stable while giving Native a visible `runtime/` adapter. Manual Run, standalone Run, and Skill snapshot code remain untouched because Native transitions use the Engine loop/store directly rather than executing or snapshotting another Skill.

- [ ] **Step 4: Verify both layouts and all current Engine behavior**

Run:

```bash
npx vitest run test/domains/engine test/domains/comet-classic
node scripts/build/build-classic-runtime.mjs --check
```

Expected: all tests pass; no Classic snapshot or state path changes.

- [ ] **Step 5: Commit**

```bash
git add domains/engine test/domains/engine
git commit -m "refactor(engine): support explicit run storage layouts"
```

## Task 2: Add Native project discovery, safe artifact roots, and atomic config writes

**Files:**

- Create: `domains/comet-native/native-types.ts`
- Create: `domains/comet-native/native-atomic-file.ts`
- Create: `domains/comet-native/native-paths.ts`
- Create: `domains/comet-native/native-config.ts`
- Create: `domains/comet-native/index.ts`
- Modify: `config/repository-layout.json`
- Modify: `test/repository/repository-layout.test.ts`
- Test: `test/domains/comet-native/native-config.test.ts`
- Test: `test/domains/comet-native/native-paths.test.ts`

- [ ] **Step 1: Register the new domain and add failing path/config tests**

Add `comet-native` to `domainModules`. Test:

- nearest ancestor `comet.config.yaml` wins;
- without config, the nearest ancestor containing `.git` is the project root and `artifact_root` defaults to `.`;
- `docs` resolves to `<project>/docs/comet` and is persisted as `docs` with `/` separators;
- `.`, `docs/specs`, and an in-project symlink are accepted;
- absolute paths, drive-prefixed paths, `~`, empty segments that normalize outside, and any `..` segment are rejected;
- a symlink that resolves outside the project is rejected;
- malformed YAML, duplicate keys, unknown schema, missing `native.artifact_root`, and `pending_root_move` with an invalid shape fail closed;
- an existing configured root and a different explicit `--root` produce a conflict instead of scanning.

- [ ] **Step 2: Run tests and confirm the domain is absent**

```bash
npx vitest run test/domains/comet-native/native-config.test.ts test/domains/comet-native/native-paths.test.ts test/repository/repository-layout.test.ts
```

Expected: new imports fail and the repository layout test reports the missing domain.

- [ ] **Step 3: Implement exact config and path types**

Use these types:

```ts
export interface NativePendingRootMove {
  id: string;
  fromArtifactRoot: string;
  toArtifactRoot: string;
  stage: 'copying' | 'ready' | 'switched';
}

export interface CometProjectConfig {
  schema: 'comet.project.v1';
  default_workflow: 'native' | 'classic';
  native: {
    artifact_root: string;
    pending_root_move?: NativePendingRootMove;
  };
}

export interface NativeProjectPaths {
  projectRoot: string;
  configFile: string;
  artifactRoot: string;
  nativeRoot: string;
  specsDir: string;
  changesDir: string;
  archiveDir: string;
  runtimeDir: string;
  locksDir: string;
  transactionsDir: string;
}
```

Export these APIs:

```ts
export async function discoverNativeProject(startPath: string): Promise<string>;
export async function resolveArtifactRoot(projectRoot: string, value: string): Promise<string>;
export async function readProjectConfig(projectRoot: string): Promise<CometProjectConfig | null>;
export async function writeProjectConfig(projectRoot: string, config: CometProjectConfig): Promise<void>;
export async function resolveNativeProject(options: {
  startPath: string;
  explicitArtifactRoot?: string;
  allowMissingConfig?: boolean;
}): Promise<{ config: CometProjectConfig; paths: NativeProjectPaths; configured: boolean }>;
```

`native-atomic-file.ts` must expose `atomicWriteText(file, content)` and `atomicWriteJson(file, value)`, using a UUID temp file in the destination directory, `fsync` on the file before rename, and best-effort directory `fsync` on platforms that support it. YAML parsing uses `parseDocument(source, { uniqueKeys: true })`; writing uses `stringify` with stable field order.

- [ ] **Step 4: Verify path safety and architecture registration**

```bash
npx vitest run test/domains/comet-native/native-config.test.ts test/domains/comet-native/native-paths.test.ts test/repository/repository-layout.test.ts
node scripts/lint/architecture.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add domains/comet-native config/repository-layout.json test/domains/comet-native test/repository/repository-layout.test.ts
git commit -m "feat(native): add safe artifact root configuration"
```

## Task 3: Implement Native change, brief, target-spec, verification, and selection stores

**Files:**

- Create: `domains/comet-native/native-change.ts`
- Create: `domains/comet-native/native-artifacts.ts`
- Create: `domains/comet-native/native-selection.ts`
- Create: `domains/comet-native/native-hash.ts`
- Modify: `domains/comet-native/native-types.ts`
- Modify: `domains/comet-native/index.ts`
- Test: `test/domains/comet-native/native-change.test.ts`
- Test: `test/domains/comet-native/native-artifacts.test.ts`
- Test: `test/domains/comet-native/native-selection.test.ts`

- [ ] **Step 1: Write failing tests for the complete Native state schema**

Use this exact domain model:

```ts
export type NativePhase = 'shape' | 'build' | 'verify' | 'archive';
export type NativeApproval = null | 'implicit' | 'confirmed';
export type NativeVerificationResult = 'pending' | 'pass' | 'fail';
export type NativeSpecOperation = 'create' | 'replace' | 'remove';

export interface NativeSpecChange {
  capability: string;
  operation: NativeSpecOperation;
  source?: string;
  base_hash: string | null;
}

export interface NativeChangeState {
  schema: 'comet.native.v1';
  name: string;
  language: 'en' | 'zh-CN';
  phase: NativePhase;
  brief: 'brief.md';
  approval: NativeApproval;
  confirmation_required: boolean;
  spec_changes: NativeSpecChange[];
  verification_result: NativeVerificationResult;
  verification_report: string | null;
  archived: boolean;
  created_at: string;
  run_id: string | null;
}
```

Tests must cover valid round trips, duplicate YAML keys, every unknown state key, invalid enum/date/name/capability/hash, duplicate capability operations, source traversal, and the operation matrix:

| operation | canonical spec | source | base hash |
| --- | --- | --- | --- |
| create | absent | required | `null` |
| replace | present | required | required and 64 lowercase hex |
| remove | present | forbidden | required and 64 lowercase hex |

- [ ] **Step 2: Add failing artifact-structure and selection tests**

`createNativeChange` must create `change.yaml`, an eight-heading empty `brief.md`, `specs/`, and `runtime/checkpoints/`, but it must not claim Shape is complete. Test that:

- brief validation requires non-empty Outcome, Scope, Non-goals, and Acceptance examples;
- a line beginning `- [blocking]` under Open questions blocks Shape, while ordinary notes do not;
- verification requires all six sections from the design;
- spec sources and verification reports resolve inside the change even through symlinks;
- `listNativeChanges` sorts active names and never scans `openspec/`;
- selection is stored at `<native-root>/runtime/current-change.json`, validates the selected active change, and has no relation to Classic `.comet/current-change.json`.

- [ ] **Step 3: Run tests and observe schema/validator failures**

```bash
npx vitest run test/domains/comet-native/native-change.test.ts test/domains/comet-native/native-artifacts.test.ts test/domains/comet-native/native-selection.test.ts
```

Expected: all new APIs are missing.

- [ ] **Step 4: Implement the store and validation seams**

Export:

```ts
export function assertNativeName(value: string): void;
export function assertCapabilityId(value: string): void;
export async function createNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
  language: 'en' | 'zh-CN';
  now?: Date;
}): Promise<NativeChangeState>;
export async function readNativeChange(paths: NativeProjectPaths, name: string): Promise<NativeChangeState>;
export async function writeNativeChange(paths: NativeProjectPaths, state: NativeChangeState): Promise<void>;
export async function listNativeChanges(paths: NativeProjectPaths): Promise<NativeChangeState[]>;
export async function validateNativeBrief(changeDir: string, briefRef: string): Promise<NativeArtifactValidation>;
export async function validateNativeVerification(changeDir: string, reportRef: string): Promise<NativeArtifactValidation>;
export async function validateNativeSpecChanges(paths: NativeProjectPaths, state: NativeChangeState): Promise<NativeArtifactValidation>;
export async function selectNativeChange(paths: NativeProjectPaths, name: string): Promise<void>;
export async function resolveSelectedNativeChange(paths: NativeProjectPaths): Promise<string | null>;
export async function sha256File(file: string): Promise<string>;
```

`NativeArtifactValidation` is `{ valid: boolean; findings: Array<{ code: string; message: string; path?: string }> }`. Validators collect all structural findings; state/path corruption throws before validation. YAML writes use the atomic writer from Task 2.

- [ ] **Step 5: Verify the stores**

```bash
npx vitest run test/domains/comet-native
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add domains/comet-native test/domains/comet-native
git commit -m "feat(native): add change and artifact stores"
```

## Task 4: Add the self-contained Native workflow contract, guards, and Engine-backed transitions

**Files:**

- Create: `domains/comet-native/native-runtime-package.ts`
- Create: `domains/comet-native/native-guards.ts`
- Create: `domains/comet-native/native-transitions.ts`
- Create: `domains/comet-native/native-trajectory.ts`
- Modify: `domains/comet-native/native-types.ts`
- Modify: `domains/comet-native/index.ts`
- Modify: `domains/workflow-contract/types.ts`
- Modify: `domains/workflow-contract/builtins.ts`
- Modify: `domains/workflow-contract/normalize.ts`
- Modify: `domains/workflow-contract/validation.ts`
- Modify: `domains/workflow-contract/index.ts`
- Test: `test/domains/comet-native/native-transitions.test.ts`
- Test: `test/domains/comet-native/native-guards.test.ts`
- Test: `test/domains/workflow-contract/workflow-contract.test.ts`

- [ ] **Step 1: Add failing workflow-contract tests**

Add `WorkflowKind = 'comet-five-phase-overlay' | 'comet-native' | 'workflow-kernel'`. Add optional `pathBase: 'project' | 'native-root'` to artifact/state path specs, defaulting existing definitions to `project` during normalization.

Test `builtinCometNativeWorkflow({ name, goal })` normalizes to exactly `shape`, `build`, `verify`, `archive`; state is `native-change` at `changes/*/change.yaml` with `pathBase: 'native-root'`; output schema IDs are exactly:

```text
comet.native.brief.v1
comet.native.spec-change.v1
comet.native.implementation.v1
comet.native.verify.v1
comet.native.archive.v1
```

Every node implementation is the built-in `comet-native` Skill itself, and every `requiredSkillCalls` and `augmentations` array is empty. Assert `requiredSkills` is exactly `['comet-native']`, proving there is no external dependency.

- [ ] **Step 2: Add failing transition and guard tests**

Use this transition input/output:

```ts
export interface NativeAdvanceEvidence {
  summary: string;
  artifacts?: string[];
  noCodeReason?: string;
  verificationResult?: 'pass' | 'fail';
  verificationReport?: string;
}

export interface NativeAdvanceResult {
  change: NativeChangeState;
  previousPhase: NativePhase;
  next: 'auto' | 'manual' | 'done';
  nextCommand: string | null;
  findings: NativeArtifactValidation['findings'];
}
```

Cover:

- Shape remains unchanged when brief/spec structure fails or a blocking question exists;
- `confirmation_required: true` requires `approval: confirmed`; otherwise `implicit` is accepted;
- Shape success creates `runtime/run-state.json`, sets `run_id`, and advances both change phase and Engine current step to Build;
- Build requires a non-empty summary and either at least one safe artifact ref or a non-empty no-code reason;
- Verify requires the six-section report and an explicit result;
- Verify fail records evidence and returns to Build;
- Verify pass advances to Archive and returns `comet native archive <name>`;
- a guard failure never changes YAML, Run state, checkpoint, or trajectory;
- retrying an already-recorded equivalent transition is idempotent;
- no trajectory event contains hidden chain-of-thought fields such as `reasoning`, `thoughts`, or `chain_of_thought`.

- [ ] **Step 3: Run tests and observe failures**

```bash
npx vitest run test/domains/workflow-contract/workflow-contract.test.ts test/domains/comet-native/native-guards.test.ts test/domains/comet-native/native-transitions.test.ts
```

- [ ] **Step 4: Implement the built-in runtime package and resolver**

`NATIVE_RUNTIME_PACKAGE` is an in-memory `packageKind: 'runtime'` Skill package with no skills, agents, or tools. Its four deterministic steps use `checkpoint` actions. The Native resolver returns Build after a Verify outcome whose `state.verification_result` is `fail`; otherwise it follows the static next step.

Use Engine `startRunWithStorage(pkg, runId, skillHash, NATIVE_RUN_STORAGE)`, `decideWithResolver`, `recordOutcomeWithResolver`, `readRunStateAt(changeDir, NATIVE_RUN_STORAGE)`, `writeRunStateAt(changeDir, state, NATIVE_RUN_STORAGE)`, `appendTrajectory`, and `writeCheckpoint`. Do not call manual Skill execution and do not snapshot an external package.

Export:

```ts
export async function inspectNativeGuard(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  evidence: NativeAdvanceEvidence;
}): Promise<NativeArtifactValidation>;

export async function advanceNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
  evidence: NativeAdvanceEvidence;
  now?: Date;
  runId?: () => string;
}): Promise<NativeAdvanceResult>;
```

Persist only summaries, artifact refs, command outcomes, hashes, phase transitions, and timestamps. State and Run-state writes must be recoverable from the trajectory: append a `state_transitioned` event containing previous/next phase and an idempotency key, then write a checkpoint containing the resulting state version.

- [ ] **Step 5: Verify Native transitions and existing workflow contracts**

```bash
npx vitest run test/domains/workflow-contract test/domains/comet-native test/domains/engine
```

- [ ] **Step 6: Commit**

```bash
git add domains/comet-native domains/workflow-contract test/domains/comet-native test/domains/workflow-contract
git commit -m "feat(native): add guarded workflow transitions"
```

## Task 5: Implement journaled archive, spec conflict detection, and crash recovery

**Files:**

- Create: `domains/comet-native/native-lock.ts`
- Create: `domains/comet-native/native-transaction.ts`
- Create: `domains/comet-native/native-archive.ts`
- Modify: `domains/comet-native/native-types.ts`
- Modify: `domains/comet-native/index.ts`
- Test: `test/domains/comet-native/native-lock.test.ts`
- Test: `test/domains/comet-native/native-archive.test.ts`
- Test: `test/domains/comet-native/native-archive-recovery.test.ts`

- [ ] **Step 1: Add failing lock and archive tests**

Test lock acquisition with `fs.open(lockFile, 'wx')`, owner metadata `{ id, pid, hostname, createdAt, operation }`, contention failure, owner-only release, and stale-lock diagnosis. Do not silently break a live or unknown lock.

Test archive create/replace/remove, empty `spec_changes`, active-to-date-prefixed archive move, immutable existing archive target, and this conflict result:

```ts
expect(error).toMatchObject({
  code: 'native-spec-conflict',
  capability: 'authentication',
  expectedHash,
  actualHash,
  canonicalPath: path.join(nativeRoot, 'specs', 'authentication', 'spec.md'),
});
```

- [ ] **Step 2: Add deterministic crash-injection tests**

Inject a test-only hook after each journaled operation and simulate interruption after:

1. staged specs are complete;
2. one canonical spec was replaced;
3. canonical specs are complete but active change still exists;
4. active change moved but journal is not committed.

For each point, `recoverArchiveTransaction` must converge to one consistent committed archive or a complete rollback. It must never expose a mixed canonical tree without a pending journal.

- [ ] **Step 3: Run tests and observe missing transaction APIs**

```bash
npx vitest run test/domains/comet-native/native-lock.test.ts test/domains/comet-native/native-archive.test.ts test/domains/comet-native/native-archive-recovery.test.ts
```

- [ ] **Step 4: Implement an append-only transaction journal**

Use:

```ts
export type NativeTransactionKind = 'archive' | 'root-move';
export type NativeTransactionStatus = 'prepared' | 'applying' | 'committed' | 'rolling-back' | 'rolled-back';

export interface NativeTransactionOperation {
  id: string;
  type: 'write' | 'remove' | 'move';
  source?: string;
  target: string;
  staged?: string;
  backup?: string;
}

export interface NativeTransactionJournal {
  schema: 'comet.native.transaction.v1';
  id: string;
  kind: NativeTransactionKind;
  status: NativeTransactionStatus;
  projectRoot: string;
  nativeRoot: string;
  change?: string;
  createdAt: string;
  operations: NativeTransactionOperation[];
}

export interface NativeTransactionEvent {
  sequence: number;
  timestamp: string;
  type: 'prepared' | 'operation-started' | 'operation-completed' | 'commit' | 'rollback-started' | 'rollback-completed';
  operationId?: string;
}
```

Store `transaction.json`, `events.jsonl`, `staged/`, and `backups/` under `<native-root>/runtime/transactions/<id>/`. Every target/source/staged/backup ref is Native-root-relative and is checked before every operation. A completed operation is derived from the event log, not from an in-place boolean rewrite.

Archive algorithm:

1. require phase Archive and Verify pass;
2. acquire `runtime/locks/archive.lock`;
3. validate all base hashes under the lock;
4. build and hash the staged final canonical specs tree;
5. write the prepared journal;
6. apply per-file operations with same-directory temp + rename and journal each completion;
7. write `archived: true` to the active change, append final trajectory/checkpoint, move it to `archive/YYYY-MM-DD-<name>`, and atomically clear Native selection if it pointed to this change;
8. commit the journal and release the lock.

Export:

```ts
export async function archiveNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
  now?: Date;
  hooks?: NativeTransactionHooks;
}): Promise<{ archiveDir: string; transactionId: string }>;

export async function recoverArchiveTransaction(options: {
  paths: NativeProjectPaths;
  transactionId: string;
  strategy: 'continue' | 'rollback';
}): Promise<NativeTransactionJournal>;
```

- [ ] **Step 5: Verify conflict and recovery behavior**

```bash
npx vitest run test/domains/comet-native/native-lock.test.ts test/domains/comet-native/native-archive.test.ts test/domains/comet-native/native-archive-recovery.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add domains/comet-native test/domains/comet-native
git commit -m "feat(native): add recoverable spec archiving"
```

## Task 6: Implement transactional Native root moves and pending-config recovery

**Files:**

- Create: `domains/comet-native/native-root-move.ts`
- Modify: `domains/comet-native/native-config.ts`
- Modify: `domains/comet-native/native-transaction.ts`
- Modify: `domains/comet-native/index.ts`
- Test: `test/domains/comet-native/native-root-move.test.ts`
- Test: `test/domains/comet-native/native-root-recovery.test.ts`

- [ ] **Step 1: Add failing move and interruption tests**

Cover root `.`→`docs`, `docs`→`.`, nested in-project roots, occupied destination refusal, symlink escape refusal, concurrent archive/root-move lock refusal, and file-by-file hash equivalence after a successful move.

Inject interruption during `copying`, `ready`, and `switched`. While `pending_root_move` exists, all mutating Native commands except `doctor --repair` must fail closed. Read-only doctor may inspect both roots but normal root discovery must not choose one by guessing.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
npx vitest run test/domains/comet-native/native-root-move.test.ts test/domains/comet-native/native-root-recovery.test.ts
```

- [ ] **Step 3: Implement the root-move protocol**

Export:

```ts
export async function moveNativeRoot(options: {
  projectRoot: string;
  toArtifactRoot: string;
  now?: Date;
  hooks?: NativeTransactionHooks;
}): Promise<{ fromNativeRoot: string; toNativeRoot: string; transactionId: string }>;

export async function recoverNativeRootMove(options: {
  projectRoot: string;
  strategy: 'continue' | 'rollback';
}): Promise<{ activeNativeRoot: string; config: CometProjectConfig }>;
```

Protocol:

1. validate source and target and acquire the source global `root-move.lock`;
2. atomically write `pending_root_move.stage: copying` in project-root config;
3. reject symlinks anywhere in the persisted Native tree, then copy the complete source tree to `<target-artifact-root>/.comet-native-move-<id>` while excluding only the currently-held ephemeral lock file;
4. compare sorted relative file list, size, and SHA-256; duplicate the journal into the staged tree;
5. atomically set pending stage `ready`;
6. rename staging to `<target-artifact-root>/comet` and atomically set config root plus stage `switched`;
7. remove the old Native root only after the new root and journal verify; removal also retires the source lock owned by this transaction;
8. mark the destination journal committed and only then clear pending config, reopening normal Native commands on the destination root.

Recovery uses config stage and journals as authoritative state. `continue` completes the forward move; `rollback` removes an uncommitted staging/destination and restores the original config. If hashes disagree with both journals, stop and report manual recovery paths without deleting either tree.

- [ ] **Step 4: Verify recovery convergence**

```bash
npx vitest run test/domains/comet-native/native-root-move.test.ts test/domains/comet-native/native-root-recovery.test.ts test/domains/comet-native/native-config.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add domains/comet-native test/domains/comet-native
git commit -m "feat(native): add recoverable artifact root moves"
```

## Task 7: Add Native-only status, next-action diagnostics, and doctor repair

**Files:**

- Create: `domains/comet-native/native-diagnostics.ts`
- Create: `domains/comet-native/native-doctor.ts`
- Modify: `domains/comet-native/index.ts`
- Test: `test/domains/comet-native/native-diagnostics.test.ts`
- Test: `test/domains/comet-native/native-doctor.test.ts`

- [ ] **Step 1: Add failing read-only diagnostic tests**

Define:

```ts
export interface NativeStatusProjection {
  name: string;
  phase: NativePhase | 'invalid';
  approval: NativeApproval;
  verificationResult: NativeVerificationResult;
  specChanges: number;
  selected: boolean;
  nextCommand: string | null;
  archiveReady: boolean;
  error?: string;
}

export interface NativeDoctorFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
  repair?: 'continue' | 'rollback';
}
```

Test empty roots, multiple active changes, explicit selection, invalid YAML, missing brief/spec/report, stale selection, live/stale locks, incomplete archive transaction, pending root move, and canonical base-hash conflicts. Assert no read-only function opens or scans `openspec/`.

- [ ] **Step 2: Add failing doctor repair tests**

`doctorNativeProject({ repair: false })` must never mutate. `repair: true` may only:

- clear a selection pointing to a missing active Native change;
- continue/rollback a journal whose recovery is deterministic;
- remove a stale lock after proving its owner process is absent and no unfinished journal needs it.

Malformed user-authored YAML/spec/brief/report must remain untouched and produce actionable findings.

- [ ] **Step 3: Run tests and confirm failures**

```bash
npx vitest run test/domains/comet-native/native-diagnostics.test.ts test/domains/comet-native/native-doctor.test.ts
```

- [ ] **Step 4: Implement diagnostic APIs**

```ts
export async function listNativeStatus(paths: NativeProjectPaths): Promise<NativeStatusProjection[]>;
export async function inspectNativeStatus(paths: NativeProjectPaths, name: string): Promise<NativeStatusProjection>;
export async function doctorNativeProject(options: {
  paths: NativeProjectPaths;
  name?: string;
  repair?: boolean;
  recoveryStrategy?: 'continue' | 'rollback';
}): Promise<{ healthy: boolean; findings: NativeDoctorFinding[] }>;
```

Return the next command only from the Native transition table. Never return a Classic Skill or command.

- [ ] **Step 5: Verify Native diagnostics**

```bash
npx vitest run test/domains/comet-native
```

- [ ] **Step 6: Commit**

```bash
git add domains/comet-native test/domains/comet-native
git commit -m "feat(native): add status and recovery diagnostics"
```

## Task 8: Expose the complete `comet native` CLI without mixing root status

**Files:**

- Create: `domains/comet-native/native-cli.ts`
- Create: `domains/comet-native/native-cli-entry.ts`
- Create: `app/commands/native.ts`
- Modify: `app/cli/index.ts`
- Test: `test/domains/comet-native/native-cli.test.ts`
- Test: `test/app/native-command.test.ts`
- Modify: `test/app/cli-help.test.ts`
- Modify: `test/app/cli-smoke.test.ts`

- [ ] **Step 1: Add failing CLI dispatcher tests**

Use one Native facade source, parallel to `app/commands/classic.ts`, but register only a root `native [args...]` command. It must forward argv order, stdout, stderr, and exit code. Root `comet status` and `comet doctor` remain Classic/current behavior in Phase 1.

Test these public commands in text and `--json` modes:

```text
comet native init [--root <artifact-root>] [--language en|zh-CN]
comet native root show
comet native root move <artifact-root>
comet native new <change-name> [--language en|zh-CN]
comet native list
comet native show <change-name>
comet native status [<change-name>]
comet native select <change-name>
comet native next <change-name> --summary <text> [--artifact <path>] [--no-code-reason <text>] [--result pass|fail] [--report <path>]
comet native archive <change-name>
comet native doctor [<change-name>] [--repair] [--strategy continue|rollback]
```

Every command also accepts hidden `--project-root <path>` for a generated runtime launcher; ordinary discovery starts at `process.cwd()`.

- [ ] **Step 2: Run CLI tests and observe missing command failures**

```bash
npx vitest run test/domains/comet-native/native-cli.test.ts test/app/native-command.test.ts test/app/cli-help.test.ts test/app/cli-smoke.test.ts
```

- [ ] **Step 3: Implement deterministic parsing and results**

Match the Classic result seam:

```ts
export interface NativeCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export async function runNativeCli(argv: readonly string[]): Promise<NativeCommandResult>;
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number>;
```

Use exit 64 for usage errors, 65 for invalid data/config, 73 for lock/transaction conflicts, and 70 for unexpected internal failures. `--json` always emits one object containing `command`, `exitCode`, `data`, and structured `error` when present.

`init` creates config plus `specs/changes/archive/runtime/{locks,transactions}`. `new` creates default config/root if absent. Existing config blocks a conflicting `--root`. `archive` refuses before phase Archive/Verify pass. `doctor --repair` requires explicit strategy when both continue and rollback are safe.

- [ ] **Step 4: Verify end-to-end CLI behavior in a temp project**

```bash
npx vitest run test/domains/comet-native/native-cli.test.ts test/app/native-command.test.ts test/app/cli-help.test.ts test/app/cli-smoke.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add app domains/comet-native test/app test/domains/comet-native
git commit -m "feat(cli): expose native change commands"
```

## Task 9: Bundle and ship an independent Native runtime

**Files:**

- Create: `scripts/build/build-native-runtime.mjs`
- Modify: `config/repository-layout.json`
- Modify: `platform/paths/repository-layout.ts`
- Modify: `build.js`
- Modify: `package.json`
- Create generated: `assets/skills/comet-native/scripts/comet-native-runtime.mjs`
- Test: `test/repository/native-runtime-assets.test.ts`
- Modify: `test/repository/repository-layout.test.ts`
- Modify: `test/repository/package-scripts.test.ts`

- [ ] **Step 1: Add failing build/freshness tests**

Add `nativeRuntime.entries.runtime = domains/comet-native/native-cli-entry.ts` and `nativeRuntime.outputs.runtime = assets/skills/comet-native/scripts/comet-native-runtime.mjs` to the typed repository layout. Test that:

- the output exists and starts with a Node shebang;
- `node scripts/build/build-native-runtime.mjs --check` detects stale output;
- the bundle contains the Native command names and no import/reference to `domains/comet-classic`, OpenSpec execution, or external Skill IDs;
- `build.js` runs both Classic and Native runtime builds;
- `package.json` exposes `build:native-runtime`.

- [ ] **Step 2: Run tests and observe missing build configuration**

```bash
npx vitest run test/repository/native-runtime-assets.test.ts test/repository/repository-layout.test.ts test/repository/package-scripts.test.ts
```

- [ ] **Step 3: Implement the esbuild pipeline**

Mirror the Classic builder's Node 20 ESM, bundled packages, UTF-8, no sourcemap, and deterministic output settings. The Native build has one entry and one output; it does not generate Classic launchers and never edits existing Classic assets.

Update `build.js` ordering to build Classic runtime, build Native runtime, compile TypeScript, then build dashboard. Generate the runtime once.

- [ ] **Step 4: Verify freshness and the whole build**

```bash
node scripts/build/build-native-runtime.mjs
node scripts/build/build-native-runtime.mjs --check
pnpm build
npx vitest run test/repository/native-runtime-assets.test.ts test/repository/classic-runtime-assets.test.ts
```

- [ ] **Step 5: Commit source and generated runtime together**

```bash
git add scripts/build/build-native-runtime.mjs config/repository-layout.json platform/paths/repository-layout.ts build.js package.json assets/skills/comet-native/scripts/comet-native-runtime.mjs test/repository
git commit -m "build(native): bundle the native workflow runtime"
```

## Task 10: Author and test the Chinese Native Skill, then pause for approval

**Files:**

- Create: `assets/skills-zh/comet-native/SKILL.md`
- Create: `assets/skills-zh/comet-native/reference/artifacts.md`
- Create: `assets/skills-zh/comet-native/reference/commands.md`
- Create: `assets/skills-zh/comet-native/reference/recovery.md`
- Test: `test/domains/comet-native/native-skill.test.ts`

- [ ] **Step 1: Add failing Skill contract tests**

Assert the Chinese Skill:

- has frontmatter name `comet-native`;
- instructs the agent to inspect config/change/canonical specs/repo/tests before asking;
- says one highest-value decision at a time, gives a recommendation and impact;
- requires brief and complete target spec updates before implementation when behavior changes;
- delegates implementation method, planning depth, tests, and review intensity to the model;
- ends each phase with `comet native next` or the bundled runtime equivalent;
- contains no invocation of OpenSpec, Superpowers, `grill-me`, `grilling`, `brainstorming`, TDD Skill, review Skill, subagent Skill, or Classic command;
- contains no external `requiredSkillCalls` semantics;
- references only its three Comet-owned reference files and bundled runtime.

- [ ] **Step 2: Run the test and observe missing Skill files**

```bash
npx vitest run test/domains/comet-native/native-skill.test.ts
```

- [ ] **Step 3: Write the compact Chinese decision core**

The main Skill must encode this protocol directly, not wrap another Skill:

```text
先理解，再行动。

先运行 Native status/show，读取 comet.config.yaml、change.yaml、brief、拟议完整 spec、
canonical spec、仓库实现、规则和测试。能从环境得到的事实不要询问用户。

维护决策前沿。若仍有会显著改变范围、行为、兼容性、风险或不可逆性的未知决策，
一次只问最重要的一个，同时给出推荐答案、理由和选择影响。未得到必要决定前停在 Shape。

明确 Outcome、Scope、Non-goals、Acceptance、Constraints 和阻塞项后更新 brief；
长期行为变化时同步更新 change 中的完整目标 spec 和 base hash。

实现方式由模型自主决定。选择满足 brief 与拟议 spec 的最简单可靠方案；
按风险决定是否落盘 plan、测试粒度和审查强度。发现漂移先更新 Native 产物，
只有需要用户决策时才暂停。

阶段结束时提交可验证摘要和产物引用，运行 comet native next <change-name>。
不直接改 phase，不跳过守卫，不调用外部 Skill，不读取或写入 Classic/OpenSpec change。
```

`commands.md` gives runtime discovery and every CLI form from Task 8. `artifacts.md` gives exact YAML/Markdown structures. `recovery.md` gives context recovery order and doctor/transaction handling. Keep the main Skill short; move format/error detail into references.

- [ ] **Step 4: Verify Chinese content and commit it without English/manifest changes**

```bash
npx vitest run test/domains/comet-native/native-skill.test.ts
git diff --name-only origin/master -- assets/skills/comet assets/skills-zh/comet
```

Expected: tests pass; the second command prints nothing.

```bash
git add assets/skills-zh/comet-native test/domains/comet-native/native-skill.test.ts
git commit -m "feat(native): add Chinese native workflow skill"
```

- [ ] **Step 5: Pause and request explicit user approval of the Chinese Skill**

Do not create `assets/skills/comet-native/SKILL.md`, do not add the new Skill to `assets/manifest.json`, and do not write Changelog until the user confirms the Chinese wording.

## Task 11: Sync the approved English Skill and publish assets

**Files:**

- Create: `assets/skills/comet-native/SKILL.md`
- Create: `assets/skills/comet-native/reference/artifacts.md`
- Create: `assets/skills/comet-native/reference/commands.md`
- Create: `assets/skills/comet-native/reference/recovery.md`
- Modify: `assets/manifest.json`
- Modify: `test/domains/comet-native/native-skill.test.ts`
- Modify: `test/repository/native-runtime-assets.test.ts`
- Modify: `test/app/init.test.ts`
- Modify: `test/app/update.test.ts`

- [ ] **Step 1: Add failing bilingual parity and install-manifest tests**

Assert both languages have the same relative file set, headings, command examples, prohibited-dependency assertions, and `comet-native` frontmatter identity. Assert manifest contains:

```text
comet-native/SKILL.md
comet-native/reference/artifacts.md
comet-native/reference/commands.md
comet-native/reference/recovery.md
comet-native/scripts/comet-native-runtime.mjs
```

Do not add Native to `internalSkills`; it is a user-facing self-contained Skill.

- [ ] **Step 2: Run tests and observe missing English/manifest entries**

```bash
npx vitest run test/domains/comet-native/native-skill.test.ts test/repository/native-runtime-assets.test.ts
```

- [ ] **Step 3: Translate the approved Chinese content without changing behavior**

Keep the same decision protocol and reference split. English may use `gate`; Chinese continues using natural terms such as “检查”“阶段”“阻塞点”. Update the manifest version only in the release task, not here.

- [ ] **Step 4: Verify installation parity**

```bash
npx vitest run test/domains/comet-native/native-skill.test.ts test/repository/native-runtime-assets.test.ts test/app/init.test.ts test/app/update.test.ts test/app/uninstall.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add assets/skills/comet-native assets/manifest.json test/domains/comet-native/native-skill.test.ts test/repository/native-runtime-assets.test.ts test/app/init.test.ts test/app/update.test.ts
git commit -m "feat(native): ship the bilingual native workflow skill"
```

## Task 12: Add the Native eval treatment and Phase 1 behavior matrix

**Files:**

- Create: `eval/local/treatments/comet/comet_native_phase1.yaml`
- Create: `eval/local/tasks/comet-native-workflow/task.toml`
- Create: `eval/local/tasks/comet-native-workflow/instruction.md`
- Create: `eval/local/tasks/comet-native-workflow/environment/Dockerfile`
- Create: `eval/local/tasks/comet-native-workflow/environment/wordcount.py`
- Create: `eval/local/tasks/comet-native-workflow/environment/test_wordcount.py`
- Create: `eval/local/tasks/comet-native-workflow/validation/test_native_workflow.py`
- Modify: `eval/local/tasks/index.yaml`
- Modify: `eval/local/tests/scaffold/test_treatments.py`
- Create: `test/domains/comet-native/native-phase1-matrix.test.ts`
- Modify: `eval/local/README.md`

- [ ] **Step 1: Add failing treatment isolation tests**

Define `COMET_NATIVE_PHASE1` with exactly one Skill source, `comet-native`, loaded from the current repo asset path. Assert its skill name set is exactly `{ 'comet-native' }`; no dependency snapshot directory, OpenSpec Skill, Superpowers Skill, or Classic Skill is injected.

- [ ] **Step 2: Add a deterministic Phase 1 matrix test**

In `native-phase1-matrix.test.ts`, drive public domain/CLI APIs through:

- default root and `docs/comet` root;
- two active changes changing the same capability, first archive success and second base-hash conflict;
- Verify fail→Build repair→Verify pass;
- interrupted archive continue and rollback;
- interrupted root move continue and rollback;
- malformed config/state fail-closed behavior;
- a scan assertion proving Native never reads a fixture `openspec/` tree.

- [ ] **Step 3: Add the agent eval task**

The instruction asks the agent to use `/comet-native` to add sentence counting, initialize `artifact_root: docs`, manage a Native change, verify it, and archive it. Validation requires:

- the feature and its tests pass;
- `comet.config.yaml` points to `docs`;
- `docs/comet/archive/<date>-<name>/` contains `change.yaml`, complete `brief.md`, complete target spec, `verification.md`, and `runtime/trajectory.jsonl`;
- `docs/comet/specs/<capability>/spec.md` exists;
- active change is gone;
- no `openspec/`, Native `.comet/`, or external Skill artifact exists;
- trajectory contains Shape, Build, Verify, Archive evidence without hidden reasoning fields.

- [ ] **Step 4: Run deterministic eval-harness and Native matrix tests**

```bash
npx vitest run test/domains/comet-native/native-phase1-matrix.test.ts
uv run pytest local/tests/scaffold/test_treatments.py local/tests/scaffold/test_tasks.py -q
uv run pytest local/tests/tasks/test_tasks.py --task=comet-native-workflow --treatment=COMET_NATIVE_PHASE1 --collect-only -q
```

Run the live Docker/model eval when credentials and Docker are available:

```bash
uv run pytest local/tests/tasks/test_tasks.py --task=comet-native-workflow --treatment=COMET_NATIVE_PHASE1 -v
```

If unavailable, record the concrete environment blocker in the implementation handoff; deterministic matrix and collection must still pass.

- [ ] **Step 5: Commit**

```bash
git add eval/local test/domains/comet-native/native-phase1-matrix.test.ts
git commit -m "test(native): add self-contained workflow evaluation"
```

## Task 13: Add restrained user documentation, release notes, and the single next version

**Files:**

- Create: `website/zh/concepts/native-workflow.mdx`
- Create: `website/zh/cli/native.mdx`
- Modify: `website/docs.json`
- Create: `website/en/concepts/native-workflow.mdx`
- Create: `website/en/cli/native.mdx`
- Modify: `README-zh.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `assets/manifest.json`
- Modify: `test/app/cli-help.test.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write Chinese user docs first**

Document:

- Native is for strong models and uses detailed requirements with lightweight execution;
- Classic remains a separate guided OpenSpec + Superpowers workflow;
- no conversion or automatic routing exists in Phase 1;
- default `comet/` and custom `docs/comet/` examples;
- full `comet native` command reference;
- complete target spec semantics, conflicts, doctor, and root-move recovery;
- the self-contained dependency boundary.

Add only one concise README highlight and link to the detailed Native doc. Do not rewrite the product overview or imply `/comet` defaults to Native.

- [ ] **Step 2: Review Chinese wording, then synchronize English**

Ensure Chinese does not translate `gate` as “门”. English and Chinese must have matching claims, headings, commands, path examples, and Phase 1 limitations.

- [ ] **Step 3: Recheck release baseline and bump exactly once**

Run:

```bash
git show origin/master:package.json
git tag --sort=-v:refname
```

Expected baseline remains `0.4.0-beta.4`. Then run:

```bash
npm version 0.4.0-beta.5 --no-git-tag-version --ignore-scripts
```

Set `assets/manifest.json` to `0.4.0-beta.5` and update the exact CLI version assertions. Do not edit historical website text that intentionally names beta.4.

- [ ] **Step 4: Write one user-visible English Changelog entry**

Prepend:

```markdown
## What's Changed [0.4.0-beta.5] - 2026-07-14

### Added

- **Comet Native workflow**: Adds a self-contained workflow for strong coding models with configurable `comet/` artifact roots, Native change/spec/archive management, guarded automatic progression, verification evidence, conflict-safe spec archiving, and recoverable root moves—without requiring OpenSpec, Superpowers, or other external Skills.
```

Do not add internal refactors, test coverage, review follow-ups, or intermediate Skill synchronization as separate entries.

- [ ] **Step 5: Verify docs/version parity**

```bash
npx vitest run test/repository/readme.test.ts test/app/cli-help.test.ts test/repository/native-runtime-assets.test.ts
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add website README-zh.md README.md package.json package-lock.json assets/manifest.json test/app/cli-help.test.ts CHANGELOG.md
git commit -m "docs: publish the native workflow guide"
```

## Task 14: Enforce boundaries and run final release verification

**Files:**

- Modify: `scripts/lint/architecture.mjs`
- Create: `test/repository/native-boundaries.test.ts`
- Modify generated asset only if freshness check requires it: `assets/skills/comet-native/scripts/comet-native-runtime.mjs`

- [ ] **Step 1: Add failing repository-boundary tests**

Statically inspect Native TypeScript and shipped Native Skill/runtime sources. Fail if:

- `domains/comet-native` imports `domains/comet-classic`;
- Native runtime spawns `openspec` or reads/writes `openspec/changes`;
- Native Skill declares or invokes an external Skill;
- Native code constructs `.comet/` under a Native root;
- Classic domain source, Markdown Skill logic, references, launchers, or generated runtime changed relative to `origin/master`. The Engine adapter must tree-shake out of the Classic bundle, so even `assets/skills/comet/scripts/comet-runtime.mjs` remains byte-stable.

Add the import rule to architecture lint so future changes cannot regress the boundary.

- [ ] **Step 2: Run boundary tests and fix only real violations**

```bash
npx vitest run test/repository/native-boundaries.test.ts
pnpm run lint:architecture
```

- [ ] **Step 3: Run generated-runtime freshness and focused suites**

```bash
node scripts/build/build-classic-runtime.mjs --check
node scripts/build/build-native-runtime.mjs --check
npx vitest run test/domains/engine test/domains/workflow-contract test/domains/comet-native test/app/native-command.test.ts test/repository/native-runtime-assets.test.ts test/repository/native-boundaries.test.ts
```

- [ ] **Step 4: Run required repository checks**

```bash
pnpm format:check
pnpm lint
pnpm build
pnpm test
npx vitest run test/domains/comet-classic/comet-scripts.test.ts
git diff --check origin/master
```

If the known shared-`dist` parallel race appears, rerun the full suite serialized and report both results; do not hide the first failure.

- [ ] **Step 5: Verify the publish payload and release scope**

```bash
npm pack --dry-run --json
git log 0.4.0-beta.4..HEAD --oneline
git status --short --branch
```

Confirm the package includes both Native language assets and runtime, excludes temp transaction fixtures, and has no uncommitted generated drift.

- [ ] **Step 6: Commit any final mechanical boundary changes**

```bash
git add scripts/lint/architecture.mjs test/repository/native-boundaries.test.ts assets/skills/comet-native/scripts/comet-native-runtime.mjs
git commit -m "test(native): enforce workflow isolation boundaries"
```

Do not push, open a PR, or comment on GitHub without a separate explicit user request.
