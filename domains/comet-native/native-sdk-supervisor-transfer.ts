import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

import {
  inspectGitWorktree,
  listGitWorktreeRoots,
  resolveGitRef,
  samePath,
} from '../../platform/paths/git-worktree.js';
import {
  createFileRuntimeStore,
  createMemoryRuntimeStore,
  createRuntime,
  createPortableRunCheckpoint,
  hashRuntimeValue,
  PORTABLE_RUN_CHECKPOINT_KEY,
  readPortableRunCheckpoint,
  type WorkflowRun,
} from '../engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  readChangeRuntimeOwner,
  registerSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import {
  atomicWriteContainedBytes,
  atomicWriteContainedText,
} from '../workflow-contract/contained-atomic-write.js';
import { ensureProtectedProjectDirectory } from '../workflow-contract/protected-project-path.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativePortableStateFile } from './native-portable-storage.js';
import { inspectNativeSdkRun } from './native-runtime-ownership.js';
import {
  createNativeSdkStateStore,
  readNativeSdkRunRecord,
  writeNativeManagedRunState,
} from './native-sdk-state-store.js';
import {
  loadWorkflowApplication,
  type ApplicationIdentity,
} from '../workflow-application/index.js';
import { defineNativeWorkflowApplication } from './native-sdk-application.js';
import {
  nativeSupervisorChildWorktree,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';

const SCHEMA = 'comet.native.supervisor-transfer.v1';
const MAX_BUFFER = 100 * 1024 * 1024;

interface TransferFile {
  path: string;
  sha256: string;
}

interface TransferWorkspace {
  kind: 'integration' | 'child';
  child: string | null;
  sourcePath: string;
  branch: string;
  head: string;
  patchSha256: string;
  tracked: TransferFile[];
  untracked: TransferFile[];
}

interface TransferManifest {
  schema: typeof SCHEMA;
  name: string;
  artifactRootRef: string;
  sourceRoot: string;
  targetBranch: string;
  targetCommit: string;
  checkpointHash: string;
  bundleSha256: string;
  changeFiles: TransferFile[];
  workspaces: TransferWorkspace[];
  runtimeFiles?: TransferFile[];
  application?: ApplicationIdentity;
}

function git(cwd: string, args: string[]): Buffer {
  return execFileSync('git', args, {
    cwd,
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeRelative(ref: string): string {
  if (
    !ref ||
    ref.includes('\\') ||
    path.posix.isAbsolute(ref) ||
    path.posix.normalize(ref) !== ref ||
    ref.split('/').some((part) => part === '.' || part === '..' || part === '.git')
  ) {
    throw new Error(`Native Supervisor transfer has an unsafe file path: ${ref}`);
  }
  return ref;
}

function workspacePath(projectRoot: string, name: string, workspace: TransferWorkspace): string {
  return workspace.kind === 'integration'
    ? nativeSupervisorIntegrationWorktree(projectRoot, name)
    : nativeSupervisorChildWorktree(projectRoot, name, workspace.child!);
}

function containsPath(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function workspacesFromRun(
  run: WorkflowRun,
  projectRoot?: string,
): {
  targetBranch: string;
  targetCommit: string;
  workspaces: TransferWorkspace[];
} {
  const state = parseNativePortableState(run.state);
  if (state.phase !== 'build' || state.archived || !state.children_contract_hash) {
    throw new Error('Native Supervisor transfer requires an active SDK Build');
  }
  if (
    run.actions.some((action) =>
      [
        'supervisor.child.verifier',
        'supervisor.child.integrate',
        'supervisor.parent.builder',
      ].includes(action.stepId),
    )
  ) {
    throw new Error(
      'Native Supervisor transfer supports Child Builder and candidate review before independent Verify/integration',
    );
  }
  const prepared = [...run.actions]
    .reverse()
    .find((action) => action.stepId === 'supervisor.prepare' && action.status === 'succeeded');
  const receipt = prepared?.outcome?.output as Record<string, unknown> | null | undefined;
  if (
    !receipt ||
    typeof receipt.integrationWorktree !== 'string' ||
    typeof receipt.integrationBranch !== 'string' ||
    receipt.integrationBranch !== `comet/supervisor/${state.name}/integration` ||
    typeof receipt.targetBranch !== 'string' ||
    typeof receipt.targetCommit !== 'string'
  ) {
    throw new Error('Native Supervisor transfer requires a prepared integration worktree');
  }
  const workspaces: TransferWorkspace[] = [
    {
      kind: 'integration',
      child: null,
      sourcePath: receipt.integrationWorktree,
      branch: receipt.integrationBranch,
      head: '',
      patchSha256: '',
      tracked: [],
      untracked: [],
    },
  ];
  for (const action of run.actions) {
    if (action.stepId !== 'supervisor.child.prepare' || action.status !== 'succeeded') continue;
    const output = action.outcome?.output as Record<string, unknown> | null | undefined;
    if (
      !output ||
      typeof output.child !== 'string' ||
      typeof output.worktree !== 'string' ||
      typeof output.branch !== 'string' ||
      output.branch !== `comet/supervisor/${state.name}/${output.child}`
    ) {
      throw new Error('Native Supervisor transfer has an invalid Child receipt');
    }
    const previous = workspaces.find(
      (workspace) =>
        workspace.branch === output.branch ||
        samePath(workspace.sourcePath, output.worktree as string),
    );
    if (previous) {
      if (
        previous.kind !== 'child' ||
        previous.child !== output.child ||
        previous.branch !== output.branch ||
        !samePath(previous.sourcePath, output.worktree)
      )
        throw new Error('Native Supervisor transfer has conflicting workspace identities');
      continue;
    }
    workspaces.push({
      kind: 'child',
      child: output.child,
      sourcePath: output.worktree,
      branch: output.branch,
      head: '',
      patchSha256: '',
      tracked: [],
      untracked: [],
    });
  }
  if (workspaces.length < 2) {
    throw new Error('Native Supervisor transfer has no prepared Child');
  }
  if (projectRoot) {
    const registered = listGitWorktreeRoots(projectRoot);
    for (const workspace of workspaces) {
      const expected = workspacePath(projectRoot, state.name, workspace);
      if (
        !samePath(workspace.sourcePath, expected) ||
        !registered.some((root) => samePath(root, expected)) ||
        inspectGitWorktree(expected).currentBranch !== workspace.branch
      ) {
        throw new Error(`Native Supervisor transfer worktree is unavailable: ${expected}`);
      }
      workspace.head = resolveGitRef(expected, workspace.branch) ?? '';
      if (!workspace.head)
        throw new Error(`Native Supervisor transfer branch is missing: ${workspace.branch}`);
    }
    if (resolveGitRef(projectRoot, receipt.targetBranch) !== receipt.targetCommit) {
      throw new Error('Native Supervisor target branch changed before transfer');
    }
  }
  return {
    targetBranch: receipt.targetBranch,
    targetCommit: receipt.targetCommit,
    workspaces,
  };
}

async function copyTree(source: string, target: string, prefix = ''): Promise<TransferFile[]> {
  const files: TransferFile[] = [];
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const ref = safeRelative(prefix ? `${prefix}/${entry.name}` : entry.name);
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Native Supervisor transfer cannot copy a symlink: ${ref}`);
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      files.push(...(await copyTree(from, to, ref)));
    } else if (entry.isFile()) {
      const bytes = await fs.readFile(from);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, bytes, { flag: 'wx' });
      files.push({ path: ref, sha256: sha256(bytes) });
    } else {
      throw new Error(`Native Supervisor transfer cannot copy a special file: ${ref}`);
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function verifyTree(root: string, files: TransferFile[]): Promise<void> {
  const found: TransferFile[] = [];
  async function walk(directory: string, prefix = ''): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const ref = safeRelative(prefix ? `${prefix}/${entry.name}` : entry.name);
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file, ref);
      else if (entry.isFile()) found.push({ path: ref, sha256: sha256(await fs.readFile(file)) });
      else throw new Error(`Native Supervisor transfer contains a symlink or special file: ${ref}`);
    }
  }
  await walk(root);
  found.sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(found) !== JSON.stringify(files)) {
    throw new Error('Native Supervisor transfer files differ from their manifest');
  }
}

function rebindRun(run: WorkflowRun, mappings: Map<string, string>): WorkflowRun {
  function replace(value: unknown): unknown {
    if (typeof value === 'string') return mappings.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    }
    return value;
  }
  const rebound = replace(run) as WorkflowRun;
  const bindings = new Map<string, string>();
  for (const action of rebound.actions) {
    rebindEvidence(action.input);
    const source = (
      action.input as { activation?: { reviewSource?: { actionId: string; inputHash: string } } }
    ).activation?.reviewSource;
    if (source) {
      const original = (
        run.actions.find((candidate) => candidate.id === action.id)!.input as {
          activation: { reviewSource: import('../engine/runtime.js').RuntimeValue };
        }
      ).activation.reviewSource;
      const checked = rebound.actions.find((candidate) => candidate.id === source.actionId);
      if (!checked) throw new Error('Native 扩展转移缺少原候选检查');
      source.inputHash = checked.inputHash;
      bindings.set(hashRuntimeValue(original), hashRuntimeValue(source));
    }
    action.inputHash = hashRuntimeValue(action.input);
    if (action.outcome) rebindEvidence(action.outcome.output);
  }
  function rebindEvidence(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    if (typeof object.bindingHash === 'string' && bindings.has(object.bindingHash))
      object.bindingHash = bindings.get(object.bindingHash)!;
    const source = object.reviewSource as { actionId?: string; inputHash?: string } | undefined;
    if (source?.actionId)
      source.inputHash = rebound.actions.find((action) => action.id === source.actionId)!.inputHash;
    for (const item of Object.values(object)) rebindEvidence(item);
  }
  rebindEvidence(rebound);
  for (const action of rebound.actions) {
    action.inputHash = hashRuntimeValue(action.input);
    if (action.outcome) {
      action.outcome.inputHash = action.inputHash;
      const receipt = action.receipts.find((item) => item.outcomeId === action.outcome!.outcomeId);
      if (!receipt) throw new Error('Native Supervisor transfer has a missing Action receipt');
      receipt.hash = hashRuntimeValue(action.outcome);
    }
  }
  for (const wait of rebound.waits) {
    wait.proposalHash = hashRuntimeValue(wait.proposal);
    if (wait.decision) wait.decision.proposalHash = wait.proposalHash;
  }
  return createPortableRunCheckpoint(rebound).run;
}

export async function exportNativeSupervisorTransfer(options: {
  projectRoot: string;
  name: string;
  outputDir: string;
  confirmedStopped: boolean;
}): Promise<{ packageDir: string; checkpointHash: string }> {
  if (!options.confirmedStopped) {
    throw new Error('Stop the original Supervisor agents before exporting their worktrees');
  }
  const projectRoot = path.resolve(options.projectRoot);
  const outputDir = path.resolve(options.outputDir);
  const { run, artifactRootRef } = await inspectNativeSdkRun(projectRoot, options.name);
  const { targetBranch, targetCommit, workspaces } = workspacesFromRun(run, projectRoot);
  const paths = await nativeProjectPaths(projectRoot, artifactRootRef);
  const sourceDirs = [
    path.join(paths.changesDir, options.name),
    ...workspaces.map((workspace) => workspace.sourcePath),
  ];
  const outputParent = await fs
    .realpath(path.dirname(outputDir))
    .catch(() => path.dirname(outputDir));
  const physicalOutput = path.join(outputParent, path.basename(outputDir));
  if (sourceDirs.some((source) => containsPath(source, physicalOutput)))
    throw new Error('Native Supervisor transfer package cannot be inside a source workspace');
  try {
    await fs.access(outputDir);
    throw new Error(`Native Supervisor transfer output already exists: ${outputDir}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const stateFile = nativePortableStateFile(paths, options.name);
  const stateSource = await fs.readFile(stateFile, 'utf8');
  const document = parseDocument(stateSource, { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error('Native Supervisor state file is invalid');
  const saved = (document.toJS() as Record<string, unknown>)[PORTABLE_RUN_CHECKPOINT_KEY] as {
    hash?: unknown;
  };
  const applicationIdentity = (document.toJS() as { application_checkpoint?: ApplicationIdentity })
    .application_checkpoint;
  const owner = await readChangeRuntimeOwner(projectRoot, 'native', options.name);
  if (
    owner?.format === 'sdk' &&
    owner.application !== 'native' &&
    applicationIdentity?.id !== owner.application
  )
    throw new Error('Native 转移缺少原固定应用的 checkpoint');
  if (typeof saved?.hash !== 'string' || !readPortableRunCheckpoint(saved, run.runId)) {
    throw new Error('Native Supervisor transfer requires a current portable Run checkpoint');
  }
  const parent = path.dirname(outputDir);
  await fs.mkdir(parent, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(parent, '.comet-supervisor-transfer-'));
  try {
    const changeFiles = await copyTree(
      path.join(paths.changesDir, options.name),
      path.join(temporary, 'change'),
    );
    const runtimeFiles: TransferFile[] = [];
    const runtimeSource = path.join(
      projectRoot,
      '.comet/runtime/native/sdk-checks',
      hashRuntimeValue(run.runId),
    );
    if (
      await fs.stat(runtimeSource).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      })
    )
      runtimeFiles.push(...(await copyTree(runtimeSource, path.join(temporary, 'runtime'))));
    for (const [index, workspace] of workspaces.entries()) {
      const workspaceDir = path.join(temporary, 'workspaces', String(index));
      await fs.mkdir(path.join(workspaceDir, 'tracked'), { recursive: true });
      await fs.mkdir(path.join(workspaceDir, 'untracked'), { recursive: true });
      const patch = git(workspace.sourcePath, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--']);
      workspace.patchSha256 = sha256(patch);
      await fs.writeFile(path.join(workspaceDir, 'changes.patch'), patch, { flag: 'wx' });
      const tracked = git(workspace.sourcePath, [
        'diff',
        '--name-only',
        '--diff-filter=ACMRT',
        '-z',
        'HEAD',
        '--',
      ])
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
      // Git checkout 的换行转换不能改变未知审查已读取的工件字节。
      for (const action of run.actions) {
        const activation = (
          action.input as { activation?: { workspaceRoot?: string; artifactRefs?: string[] } }
        ).activation;
        if (
          !action.stepId.startsWith('native.extension.') ||
          !activation?.workspaceRoot ||
          !samePath(activation.workspaceRoot, workspace.sourcePath)
        )
          continue;
        for (const ref of activation.artifactRefs ?? []) {
          safeRelative(ref);
          if (!tracked.includes(ref)) tracked.push(ref);
        }
      }
      for (const ref of tracked) {
        safeRelative(ref);
        const source = path.join(workspace.sourcePath, ref);
        if (!(await fs.lstat(source)).isFile()) {
          throw new Error(`Native Supervisor transfer cannot copy a tracked symlink: ${ref}`);
        }
        const bytes = await fs.readFile(source);
        const destination = path.join(workspaceDir, 'tracked', ref);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, bytes, { flag: 'wx' });
        workspace.tracked.push({ path: ref, sha256: sha256(bytes) });
      }
      workspace.tracked.sort((left, right) => left.path.localeCompare(right.path));
      const untracked = git(workspace.sourcePath, [
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
      ])
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
      for (const ref of untracked) {
        safeRelative(ref);
        const source = path.join(workspace.sourcePath, ref);
        if (!(await fs.lstat(source)).isFile()) {
          throw new Error(`Native Supervisor transfer cannot copy an untracked symlink: ${ref}`);
        }
        const bytes = await fs.readFile(source);
        const destination = path.join(workspaceDir, 'untracked', ref);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, bytes, { flag: 'wx' });
        workspace.untracked.push({ path: ref, sha256: sha256(bytes) });
      }
      workspace.untracked.sort((left, right) => left.path.localeCompare(right.path));
    }
    const bundlePath = path.join(temporary, 'branches.bundle');
    git(projectRoot, [
      'bundle',
      'create',
      bundlePath,
      ...workspaces.map((workspace) => `refs/heads/${workspace.branch}`),
    ]);
    const manifest: TransferManifest = {
      schema: SCHEMA,
      name: options.name,
      artifactRootRef,
      sourceRoot: projectRoot,
      targetBranch,
      targetCommit,
      checkpointHash: saved.hash,
      bundleSha256: sha256(await fs.readFile(bundlePath)),
      changeFiles,
      workspaces,
      runtimeFiles,
      ...(applicationIdentity ? { application: applicationIdentity } : {}),
    };
    await fs.writeFile(
      path.join(temporary, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { flag: 'wx' },
    );
    if ((await inspectNativeSdkRun(projectRoot, options.name)).run.revision !== run.revision) {
      throw new Error('Native Supervisor Run changed during transfer export');
    }
    await fs.rename(temporary, outputDir);
    return { packageDir: outputDir, checkpointHash: manifest.checkpointHash };
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function importNativeSupervisorTransfer(options: {
  projectRoot: string;
  inputDir: string;
}): Promise<{ change: string; worktrees: string[] }> {
  const projectRoot = path.resolve(options.projectRoot);
  const inputDir = path.resolve(options.inputDir);
  const manifest = JSON.parse(
    await fs.readFile(path.join(inputDir, 'manifest.json'), 'utf8'),
  ) as TransferManifest;
  if (
    manifest.schema !== SCHEMA ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(manifest.name) ||
    !Array.isArray(manifest.changeFiles) ||
    !Array.isArray(manifest.workspaces) ||
    manifest.workspaces.length < 2 ||
    typeof manifest.sourceRoot !== 'string' ||
    typeof manifest.artifactRootRef !== 'string' ||
    typeof manifest.targetBranch !== 'string' ||
    typeof manifest.targetCommit !== 'string' ||
    typeof manifest.checkpointHash !== 'string' ||
    typeof manifest.bundleSha256 !== 'string'
  ) {
    throw new Error('Native Supervisor transfer manifest is invalid');
  }
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== manifest.artifactRootRef) {
    throw new Error('Native Supervisor transfer project configuration does not match');
  }
  if (resolveGitRef(projectRoot, manifest.targetBranch) !== manifest.targetCommit) {
    throw new Error('Native Supervisor transfer target branch has a different commit');
  }
  if (
    (await readChangeRuntimeOwner(projectRoot, 'native', manifest.name)) ||
    (await readNativeSdkRunRecord(projectRoot, manifest.name))
  ) {
    throw new Error('Native Supervisor transfer target already owns this change');
  }
  await verifyTree(path.join(inputDir, 'change'), manifest.changeFiles);
  const stateFile = path.join(inputDir, 'change', 'comet-state.yaml');
  const document = parseDocument(await fs.readFile(stateFile, 'utf8'), { uniqueKeys: true });
  if (document.errors.length > 0)
    throw new Error('Native Supervisor transfer state file is invalid');
  const checkpoint = (document.toJS() as Record<string, unknown>)[PORTABLE_RUN_CHECKPOINT_KEY] as {
    hash?: unknown;
  };
  if (checkpoint?.hash !== manifest.checkpointHash) {
    throw new Error('Native Supervisor transfer checkpoint differs from its manifest');
  }
  const saved = readPortableRunCheckpoint(checkpoint, manifest.name);
  if (!saved) throw new Error('Native Supervisor transfer checkpoint is missing');
  const identity = (document.toJS() as { application_checkpoint?: ApplicationIdentity })
    .application_checkpoint;
  if (hashRuntimeValue(manifest.application ?? null) !== hashRuntimeValue(identity ?? null))
    throw new Error('Native 转移固定应用与 manifest 不一致');
  if (
    identity &&
    (identity.base !== 'native' || !samePath(identity.projectRoot, manifest.sourceRoot))
  )
    throw new Error('Native 转移的固定应用归属不一致');
  const application = identity
    ? await loadWorkflowApplication({
        file: path.join(identity.packageRoot, 'application.json'),
        projectRoot,
        expectedIdentity: { ...identity, projectRoot: await fs.realpath(projectRoot) },
      })
    : null;
  if (application && application.identity.id !== identity!.id)
    throw new Error('Native 转移需要原固定应用包');
  const modelStore = createMemoryRuntimeStore<WorkflowRun>();
  await modelStore.compareAndSwap(saved.runId, null, saved);
  const base = defineNativeWorkflowApplication();
  await createRuntime({
    ...application?.implementation,
    store: modelStore,
    workflows: application?.implementation.workflows ?? [base.workflow],
    transitionHandlers: application?.implementation.transitionHandlers ?? [base.transitionHandler],
    validators: application?.implementation.validators ?? base.validators,
    commandValidators: application?.implementation.commandValidators ?? base.commandValidators,
    stateValidators: application?.implementation.stateValidators ?? base.stateValidators,
  }).inspect(saved.runId);
  if (manifest.runtimeFiles !== undefined) {
    if (!Array.isArray(manifest.runtimeFiles)) throw new Error('Native 转移检查工件无效');
    if (manifest.runtimeFiles.length)
      await verifyTree(path.join(inputDir, 'runtime'), manifest.runtimeFiles);
    for (const file of manifest.runtimeFiles) {
      const destination = path.join(
        projectRoot,
        '.comet/runtime/native/sdk-checks',
        hashRuntimeValue(saved.runId),
        safeRelative(file.path),
      );
      const existing = await fs.readFile(destination).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (existing && sha256(existing) !== file.sha256)
        throw new Error('Native 转移不能覆盖不同的检查工件');
    }
  }
  const state = parseNativePortableState(saved.state);
  if (state.name !== manifest.name)
    throw new Error('Native Supervisor transfer change name differs');
  const source = workspacesFromRun(saved);
  if (
    source.targetBranch !== manifest.targetBranch ||
    source.targetCommit !== manifest.targetCommit ||
    source.workspaces.length !== manifest.workspaces.length
  ) {
    throw new Error('Native Supervisor transfer workspaces differ from the checkpoint');
  }
  const bundlePath = path.join(inputDir, 'branches.bundle');
  if (sha256(await fs.readFile(bundlePath)) !== manifest.bundleSha256) {
    throw new Error('Native Supervisor transfer Git bundle differs from its manifest');
  }
  git(projectRoot, ['bundle', 'verify', bundlePath]);
  const bundleHeads = new Map(
    git(projectRoot, ['bundle', 'list-heads', bundlePath])
      .toString('utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const match = /^([a-f0-9]{40,64}) (refs\/heads\/.+)$/u.exec(line.trim());
        if (!match) throw new Error('Native Supervisor transfer Git bundle has an invalid ref');
        return [match[2], match[1]] as const;
      }),
  );
  if (
    bundleHeads.size !== manifest.workspaces.length ||
    manifest.workspaces.some(
      (workspace) => bundleHeads.get(`refs/heads/${workspace.branch}`) !== workspace.head,
    )
  ) {
    throw new Error('Native Supervisor transfer Git bundle heads differ from its manifest');
  }
  const mappings = new Map<string, string>([[manifest.sourceRoot, projectRoot]]);
  for (const [index, workspace] of manifest.workspaces.entries()) {
    const original = source.workspaces[index];
    if (
      !original ||
      original.kind !== workspace.kind ||
      original.child !== workspace.child ||
      original.sourcePath !== workspace.sourcePath ||
      original.branch !== workspace.branch ||
      typeof workspace.head !== 'string' ||
      typeof workspace.patchSha256 !== 'string' ||
      !Array.isArray(workspace.tracked) ||
      !Array.isArray(workspace.untracked)
    ) {
      throw new Error('Native Supervisor transfer workspace manifest is invalid');
    }
    const patch = await fs.readFile(
      path.join(inputDir, 'workspaces', String(index), 'changes.patch'),
    );
    if (sha256(patch) !== workspace.patchSha256) {
      throw new Error('Native Supervisor transfer patch differs from its manifest');
    }
    await verifyTree(
      path.join(inputDir, 'workspaces', String(index), 'tracked'),
      workspace.tracked,
    );
    await verifyTree(
      path.join(inputDir, 'workspaces', String(index), 'untracked'),
      workspace.untracked,
    );
    const target = workspacePath(projectRoot, manifest.name, workspace);
    mappings.set(workspace.sourcePath, target);
    if ((await fs.stat(target).catch(() => null)) !== null) {
      if (
        !listGitWorktreeRoots(projectRoot).some((root) => samePath(root, target)) ||
        inspectGitWorktree(target).currentBranch !== workspace.branch ||
        resolveGitRef(target, workspace.branch) !== workspace.head
      ) {
        throw new Error(`Native Supervisor transfer worktree path already exists: ${target}`);
      }
      const currentPatch = git(target, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--']);
      if (currentPatch.length > 0 && sha256(currentPatch) !== workspace.patchSha256) {
        throw new Error(`Native Supervisor transfer worktree has different changes: ${target}`);
      }
    }
    const existingRef = resolveGitRef(projectRoot, workspace.branch);
    if (existingRef && existingRef !== workspace.head) {
      throw new Error(`Native Supervisor transfer branch changed: ${workspace.branch}`);
    }
  }
  const rebound = rebindRun(saved, mappings);
  const paths = await nativeProjectPaths(projectRoot, manifest.artifactRootRef);
  const changeDir = path.join(paths.changesDir, manifest.name);
  for (const file of manifest.changeFiles) {
    safeRelative(file.path);
    const target = path.join(changeDir, file.path);
    const current = await fs.readFile(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (current && sha256(current) !== file.sha256) {
      const ref = path.relative(projectRoot, target).replaceAll('\\', '/');
      let cleanTracked = false;
      try {
        git(projectRoot, ['ls-files', '--error-unmatch', '--', ref]);
        cleanTracked = git(projectRoot, ['status', '--porcelain=v1', '--', ref]).length === 0;
      } catch {
        // An ignored or untracked file is never safe to replace automatically.
      }
      if (!cleanTracked) {
        throw new Error(`Native Supervisor transfer would replace an existing file: ${target}`);
      }
    }
  }
  for (const workspace of manifest.workspaces) {
    if (!resolveGitRef(projectRoot, workspace.branch)) {
      git(projectRoot, [
        'fetch',
        '--no-tags',
        bundlePath,
        `refs/heads/${workspace.branch}:refs/heads/${workspace.branch}`,
      ]);
    }
    if (resolveGitRef(projectRoot, workspace.branch) !== workspace.head) {
      throw new Error(
        `Native Supervisor transfer branch could not be restored: ${workspace.branch}`,
      );
    }
  }
  const worktrees: string[] = [];
  for (const [index, workspace] of manifest.workspaces.entries()) {
    const target = workspacePath(projectRoot, manifest.name, workspace);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (!listGitWorktreeRoots(projectRoot).some((root) => samePath(root, target))) {
      git(projectRoot, ['worktree', 'add', target, workspace.branch]);
    }
    if (
      inspectGitWorktree(target).currentBranch !== workspace.branch ||
      resolveGitRef(target, workspace.branch) !== workspace.head
    ) {
      throw new Error(`Native Supervisor transfer worktree changed: ${target}`);
    }
    await ensureProtectedProjectDirectory(target, '.comet', {
      label: 'Native Supervisor worktree configuration directory',
    });
    const configFile = path.join(target, '.comet', 'config.yaml');
    const projectConfig = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'));
    const configStat = await fs.lstat(configFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (configStat && (!configStat.isFile() || configStat.isSymbolicLink())) {
      throw new Error(
        `Native Supervisor transfer worktree configuration is not a file: ${configFile}`,
      );
    }
    const existingConfig = await fs.readFile(configFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (
      existingConfig &&
      !existingConfig.equals(projectConfig) &&
      JSON.stringify(await readProjectConfig(target)) !== JSON.stringify(config)
    ) {
      throw new Error(`Native Supervisor transfer worktree configuration changed: ${configFile}`);
    }
    if (!existingConfig)
      await atomicWriteContainedBytes(configFile, projectConfig, {
        containedRoot: target,
        exclusive: true,
        requireAtomicPublication: true,
      });
    const workspaceDir = path.join(inputDir, 'workspaces', String(index));
    const patchFile = path.join(workspaceDir, 'changes.patch');
    const currentPatch = git(target, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--']);
    if ((await fs.stat(patchFile)).size > 0 && currentPatch.length === 0) {
      git(target, ['apply', '--check', patchFile]);
      git(target, ['apply', patchFile]);
    }
    for (const file of workspace.tracked) {
      const destination = path.join(target, safeRelative(file.path));
      await atomicWriteContainedBytes(
        destination,
        await fs.readFile(path.join(workspaceDir, 'tracked', file.path)),
        { containedRoot: target },
      );
    }
    for (const file of workspace.untracked) {
      const destination = path.join(target, safeRelative(file.path));
      const existingStat = await fs.lstat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (existingStat && (!existingStat.isFile() || existingStat.isSymbolicLink())) {
        throw new Error(`Native Supervisor transfer untracked path is not a file: ${destination}`);
      }
      const existing = await fs.readFile(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (existing && sha256(existing) !== file.sha256) {
        throw new Error(`Native Supervisor transfer untracked file already exists: ${destination}`);
      }
      await atomicWriteContainedBytes(
        destination,
        await fs.readFile(path.join(workspaceDir, 'untracked', file.path)),
        { containedRoot: target },
      );
    }
    worktrees.push(target);
  }
  for (const file of manifest.changeFiles) {
    const destination = path.join(changeDir, file.path);
    await atomicWriteContainedBytes(
      destination,
      await fs.readFile(path.join(inputDir, 'change', file.path)),
      { containedRoot: projectRoot },
    );
  }
  for (const file of manifest.runtimeFiles ?? []) {
    const destination = path.join(
      projectRoot,
      '.comet/runtime/native/sdk-checks',
      hashRuntimeValue(saved.runId),
      safeRelative(file.path),
    );
    await atomicWriteContainedBytes(
      destination,
      await fs.readFile(path.join(inputDir, 'runtime', file.path)),
      { containedRoot: projectRoot },
    );
  }
  if (application) {
    await writeNativeManagedRunState(
      nativePortableStateFile(paths, manifest.name),
      parseNativePortableState(rebound.state),
      projectRoot,
      rebound,
      undefined,
      application.identity,
    );
    if (!(await application.store.read(manifest.name)))
      throw new Error('Native 定制应用转移未恢复原 Run');
  } else {
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(projectRoot, '.comet/runtime/sdk-runs/native'),
    });
    if (!(await store.compareAndSwap(manifest.name, null, rebound)))
      throw new Error('Native Supervisor transfer Run was created by another process');
    await createNativeSdkStateStore(projectRoot).read(manifest.name);
  }
  const receiptRef = `.comet/runtime/transfers/native/${manifest.name}.json`;
  await ensureProtectedProjectDirectory(projectRoot, '.comet/runtime/transfers/native', {
    label: 'Native Supervisor transfer receipt directory',
  });
  await atomicWriteContainedText(
    path.join(projectRoot, ...receiptRef.split('/')),
    `${JSON.stringify({
      schema: SCHEMA,
      change: manifest.name,
      sourceCheckpointHash: manifest.checkpointHash,
      importedCheckpointHash: createPortableRunCheckpoint(rebound).hash,
      actionBindings: rebound.actions
        .filter((action) => action.stepId.startsWith('native.extension.'))
        .map((action) => ({
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          sourceInputHash: saved.actions.find((original) => original.id === action.id)!.inputHash,
          sourceBindingHash: hashRuntimeValue(
            (
              saved.actions.find((original) => original.id === action.id)!.input as {
                activation: { reviewSource: import('../engine/runtime.js').RuntimeValue };
              }
            ).activation.reviewSource,
          ),
          bindingHash: hashRuntimeValue(
            (
              action.input as {
                activation: { reviewSource: import('../engine/runtime.js').RuntimeValue };
              }
            ).activation.reviewSource,
          ),
        })),
    })}\n`,
    { containedRoot: projectRoot, exclusive: true, requireAtomicPublication: true },
  );
  await registerSdkChangeOwner(projectRoot, {
    schema: COMET_CHANGE_OWNER_SCHEMA,
    workflow: 'native',
    change: manifest.name,
    format: 'sdk',
    application: application?.identity.id ?? 'native',
    runId: manifest.name,
  });
  return { change: manifest.name, worktrees };
}
