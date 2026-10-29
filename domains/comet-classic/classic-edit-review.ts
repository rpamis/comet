import path from 'node:path';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import {
  assertEditReviewsComplete,
  isCheckInputRetained,
  areObservedEditsNonBehavioral,
  listApprovedEditOriginalsForEvidence,
  type EditReviewScope,
} from '../workflow-contract/edit-review.js';
import {
  resolveWorkspaceRuntimeRootSync,
  resolveWorkspaceRuntimeRoot,
} from '../workflow-contract/workspace-runtime.js';
import { resolveClassicLayout } from './classic-layout.js';
import { resolveClassicChangeDirectory } from './classic-paths.js';
import { classicProtectedDocumentPrefixes } from './classic-neutral-documents.js';
import type { ClassicState } from './classic-state.js';
import {
  readClassicProjectFile,
  readClassicProjectBytes,
  classicProjectTargetExists,
} from './classic-protected-path.js';
import {
  hashProtectedProjectFile,
  ensureProtectedProjectDirectory,
} from '../workflow-contract/protected-project-path.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { collectCheckSnapshot, type CheckSnapshot } from './classic-check-snapshot.js';
import type { WorkflowRun } from '../engine/runtime.js';
import { createFileRuntimeStore, hashRuntimeValue } from '../engine/runtime.js';
import type { RunState } from '../engine/types.js';
import { readClassicState } from './classic-store.js';
import { readCheckIndex } from './classic-check-index.js';
import { readCheckPolicy } from './classic-check-policy.js';
import { rememberApprovedEditOriginal } from '../workflow-contract/edit-review.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import {
  classicSdkFormalSourceEvidence,
  classicSdkPresetSourceEvidence,
} from './classic-formal-source-evidence.js';
import type { RecordedCommandCheck } from './classic-command-checks.js';
import {
  checkManifestHash,
  parseCheckManifest,
  diffCheckManifests,
} from './classic-check-manifest.js';

export async function classicEditReviewScope(
  projectRoot: string,
  change: string,
  state: ClassicState,
  write = false,
): Promise<EditReviewScope> {
  const layout = await resolveClassicLayout(projectRoot);
  // 从 Archive 的阶段序号还原 Verify 序号；下一轮 Build 或重新验收使用新的序号。
  const verifyEpoch =
    (state.checkEpoch ?? 0) -
    (state.phase === 'archive'
      ? 1 + (state.archiveConfirmation === 'confirmed' ? 1 : 0) + (state.archived ? 1 : 0)
      : 0);
  const candidateKey = createHash('sha256')
    .update(
      JSON.stringify({
        createdAt: state.createdAt,
        baseRef: state.baseRef,
        plan: state.plan,
        handoffHash: state.handoffHash,
        verifyEpoch,
        boundBranch: state.boundBranch,
      }),
    )
    .digest('hex');
  return {
    projectRoot: path.resolve(projectRoot),
    runtimeRoot: write
      ? await resolveWorkspaceRuntimeRoot(projectRoot)
      : resolveWorkspaceRuntimeRootSync(projectRoot),
    workflow: 'classic',
    change,
    candidateKey,
    formalPrefixes: [
      '.comet',
      ...classicProtectedDocumentPrefixes(projectRoot, layout),
      ...[state.designDoc, state.plan, state.verificationReport].filter((ref): ref is string =>
        Boolean(ref),
      ),
    ],
  };
}

export async function assertClassicEditReviewsComplete(
  projectRoot: string,
  change: string,
  state: ClassicState,
): Promise<void> {
  await assertEditReviewsComplete(await classicEditReviewScope(projectRoot, change, state));
}

/** 正式文档判断随原 change 保留；是否对应当前批准由批准收据的原始内容摘要核对。 */
export async function classicFormalEditReviewScope(
  projectRoot: string,
  change: string,
  state: ClassicState,
  write = false,
  base?: EditReviewScope,
  preloadedRun?: Readonly<WorkflowRun>,
): Promise<EditReviewScope> {
  const sources: string[] = [];
  if (
    state.handoffContext &&
    state.handoffHash &&
    (await classicProjectTargetExists(projectRoot, state.handoffContext, {
      label: 'Classic 正式来源登记',
      expected: 'file',
    }))
  ) {
    const document = JSON.parse(
      await readClassicProjectFile(projectRoot, state.handoffContext, {
        label: 'Classic 正式来源登记',
      }),
    ) as { context_hash?: string; files?: Array<{ path?: string }> };
    const changeRef = path.posix.dirname(
      path.posix.dirname(path.posix.dirname(state.handoffContext)),
    );
    if (document.context_hash === state.handoffHash && Array.isArray(document.files)) {
      for (const file of document.files)
        if (
          file.path &&
          (['proposal.md', 'design.md', 'tasks.md'].some(
            (name) => file.path === `${changeRef}/${name}`,
          ) ||
            (file.path.startsWith(`${changeRef}/specs/`) && file.path.endsWith('/spec.md')))
        )
          sources.push(file.path);
    }
  }
  const scope = base ?? (await classicEditReviewScope(projectRoot, change, state, write));
  const allowedFormalPaths = [
    ...new Set(
      [...sources, state.designDoc, state.plan].filter((ref): ref is string => Boolean(ref)),
    ),
  ];
  if (!allowedFormalPaths.length && state.workflow === 'full')
    return {
      ...scope,
      candidateKey: `formal:${state.createdAt}`,
      judgment: 'agent',
      approvedSources: {},
      allowedFormalPaths,
    };
  let run = preloadedRun;
  if (!run) {
    const owner = await readSdkChangeOwner(projectRoot, 'classic', change, { readOnly: true });
    if (owner) {
      run =
        (await createFileRuntimeStore<WorkflowRun>({
          rootDir: path.join(scope.runtimeRoot, 'sdk-runs', 'classic'),
        }).read(owner.runId)) ?? undefined;
      if (!run || run.runId !== owner.runId)
        throw new Error('正式材料判断缺少当前 SDK Run，不能降级使用旧批准');
    }
  }
  const approvedSources: Record<string, string> = run
    ? classicSdkFormalSourceEvidence(run, sources)
    : state.handoffHash
      ? Object.fromEntries(sources.map((ref) => [ref, state.handoffHash!]))
      : {};
  const preset = run ? classicSdkPresetSourceEvidence(run) : null;
  if (preset) {
    const originalScope = { ...scope, candidateKey: `formal:${state.createdAt}` };
    for (const original of await listApprovedEditOriginalsForEvidence(
      originalScope,
      preset.evidenceHash,
    )) {
      if (!original.file.startsWith(`${preset.ref}/`))
        throw new Error('Preset 正式来源不属于当前 change');
      approvedSources[original.file] = preset.identity;
      if (!allowedFormalPaths.includes(original.file)) allowedFormalPaths.push(original.file);
    }
  }
  if (!run && state.workflow !== 'full' && state.phase !== 'open') {
    const { directory } = await resolveClassicChangeDirectory(change, projectRoot);
    const projection = await readClassicState(directory, { migrate: false });
    if (projection.run) {
      const accepted = (await readCheckIndex(directory, projection.run.trajectoryRef)).events
        .slice()
        .reverse()
        .find(
          (entry) =>
            entry.runId === projection.run!.runId &&
            entry.type === 'state_transitioned' &&
            entry.data?.event === 'open-complete' &&
            entry.data.source === 'comet-guard',
        );
      const data = accepted?.data;
      if (
        data &&
        Number(data.formalSourceIteration) <= projection.run.iteration &&
        Number(data.formalSourceEpoch) <= (state.checkEpoch ?? 0) &&
        data.formalSources &&
        typeof data.formalSources === 'object'
      ) {
        const prefix = path.relative(projectRoot, directory).replaceAll('\\', '/') + '/';
        for (const [ref, evidence] of Object.entries(data.formalSources)) {
          if (
            !ref.startsWith(prefix) ||
            typeof evidence !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(evidence)
          )
            throw new Error('Compat Open 原文来源不属于当前 change');
          approvedSources[ref] = evidence;
          if (!allowedFormalPaths.includes(ref)) allowedFormalPaths.push(ref);
        }
      }
    }
  }
  if (!run && state.workflow === 'full' && ['verify', 'archive'].includes(state.phase)) {
    const { directory } = await resolveClassicChangeDirectory(change, projectRoot);
    const projection = await readClassicState(directory, { migrate: false });
    if (projection.run) {
      const accepted = (await readCheckIndex(directory, projection.run.trajectoryRef)).events
        .slice()
        .reverse()
        .find(
          (entry) =>
            entry.type === 'state_transitioned' &&
            entry.runId === projection.run!.runId &&
            entry.data?.event === 'build-complete' &&
            entry.data.source === 'comet-guard',
        );
      const data = accepted?.data;
      if (
        data &&
        Number(data.formalSourceIteration) <= projection.run.iteration &&
        Number(data.formalSourceEpoch) <= (state.checkEpoch ?? 0) &&
        data.formalSourceHandoff === state.handoffHash &&
        data.formalSources &&
        typeof data.formalSources === 'object'
      ) {
        for (const [ref, evidence] of Object.entries(data.formalSources))
          if (
            (ref === state.plan || ref === state.designDoc) &&
            typeof evidence === 'string' &&
            /^[a-f0-9]{64}$/u.test(evidence)
          )
            approvedSources[ref] = evidence;
      }
    }
  }
  return {
    ...scope,
    candidateKey: `formal:${state.createdAt}`,
    judgment: 'agent',
    approvedSources,
    allowedFormalPaths,
  };
}

/** 只在真实 Open 或 Build 阶段提交时保存原文；对象本身不赋予接受权限。 */
export async function rememberClassicCompatFormalSources(
  projectRoot: string,
  change: string,
  state: ClassicState,
  run: RunState,
  check?: RecordedCommandCheck,
  refs?: readonly string[],
) {
  const scope = await classicEditReviewScope(projectRoot, change, state, true);
  scope.candidateKey = `formal:${state.createdAt}`;
  const formalSources: Record<string, string> = {};
  for (const ref of [...new Set(refs ?? [state.plan, state.designDoc])]) {
    if (!ref) continue;
    if (
      !check &&
      !(await classicProjectTargetExists(projectRoot, ref, {
        label: 'Classic Open 正式来源',
        expected: 'file',
      }))
    )
      continue;
    const source = await readClassicProjectFile(projectRoot, ref, {
      label: `Classic 正式原文 ${ref}`,
      maxBytes: Number.MAX_SAFE_INTEGER,
    });
    const rawHash = createHash('sha256').update(source).digest('hex');
    const evidence = hashRuntimeValue([
      check ? 'classic-formal-build-v1' : 'classic-formal-open-v1',
      run.runId,
      run.iteration + 1,
      check?.sequence ?? null,
      ref,
      rawHash,
      state.handoffHash,
    ]);
    await rememberApprovedEditOriginal(scope, ref, source, rawHash, evidence);
    formalSources[ref] = evidence;
  }
  return {
    formalSourceIteration: run.iteration + 1,
    formalSourceEpoch: state.checkEpoch ?? 0,
    formalSourceHandoff: state.handoffHash,
    formalSources,
  };
}

/** Compat 使用真实检查 Action；更早的无 Action 记录使用原轨迹事件身份。 */
export function classicCompatCheckExecutionRef(record: RecordedCommandCheck) {
  return (
    record.action?.id ?? `classic-check:${record.runId}:${record.sequence}:${record.timestamp}`
  );
}

export async function observeClassicCompatCheckInputs(
  projectRoot: string,
  changeDir: string,
  state: ClassicState,
  check: RecordedCommandCheck,
  baseline?: { manifestRef: string; manifestHash: string },
) {
  const manifestRef = baseline?.manifestRef ?? check.manifestRef;
  const manifestHash = baseline?.manifestHash ?? check.manifestHash;
  if (!manifestRef || !manifestHash || !check.argv?.length)
    throw new Error(
      '旧检查缺少逐文件输入记录；保留原成果，通过原检查建立新记录，不能从当前文件补造旧快照',
    );
  const source = await readClassicProjectFile(projectRoot, manifestRef, {
    label: 'Classic 原检查输入清单',
    maxBytes: Number.MAX_SAFE_INTEGER,
  });
  if (checkManifestHash(source) !== manifestHash) throw new Error('Classic 原检查输入清单已变化');
  const before = parseCheckManifest(source);
  const current = await collectCheckSnapshot(
    projectRoot,
    changeDir,
    { argv: check.argv, cwd: check.cwd },
    { verificationReport: state.verificationReport },
  );
  const diff = diffCheckManifests(before, current.entries);
  const left = new Map(before.map((entry) => [entry.p, entry.h]));
  const right = new Map(current.entries.map((entry) => [entry.p, entry.h]));
  const changes = [];
  const gitChanges = [];
  for (const ref of [...diff.added, ...diff.changed, ...diff.removed]) {
    if (ref.startsWith('\0git:')) {
      gitChanges.push({
        path: ref,
        beforeHash: left.get(ref) ?? 'missing',
        afterHash: right.get(ref) ?? 'missing',
      });
      continue;
    }
    let afterHash = 'missing';
    try {
      afterHash = (
        await hashProtectedProjectFile(projectRoot, ref, { label: 'Classic 当前变化文件' })
      ).digest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!right.has(ref) && afterHash !== 'missing') continue;
    changes.push({
      path: ref,
      beforeHash: left.get(ref) ?? 'missing',
      afterHash,
      afterInputHash: right.get(ref),
    });
  }
  const root = await ensureProtectedProjectDirectory(
    await resolveWorkspaceRuntimeRoot(projectRoot),
    'classic/input-observations',
    { label: 'Classic 输入观察' },
  );
  const currentRef = path.join(root, `${checkManifestHash(current.manifest)}.manifest`);
  try {
    await atomicWriteContainedText(currentRef, current.manifest, {
      containedRoot: root,
      exclusive: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (
      checkManifestHash(await fs.readFile(currentRef, 'utf8')) !==
      checkManifestHash(current.manifest)
    )
      throw new Error('已保存的 Classic 输入观察已变化', { cause: error });
  }
  return {
    sourceActionId: classicCompatCheckExecutionRef(check),
    beforeRef: manifestRef,
    currentRef,
    changes,
    gitChanges,
    ...(state.phase === 'archive' && !state.archived
      ? {
          refreshInputTemplate: {
            expectedCheckEpoch: state.checkEpoch ?? 0,
            sourceActionId: classicCompatCheckExecutionRef(check),
            observationHash: checkManifestHash(current.manifest),
            reportSha256: state.verificationReport
              ? (
                  await hashProtectedProjectFile(projectRoot, state.verificationReport, {
                    label: 'Classic 原报告',
                  })
                ).digest
              : null,
            summary: '<当前 Agent 说明仅补原检查且保留接受结果的依据>',
          },
        }
      : {}),
  };
}

/** 观察最近一次真实检查之后的文件变化；显式 Git 依赖另行展示。 */
export async function observeClassicCheckInputs(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
  options: { actionId?: string; snapshot?: CheckSnapshot } = {},
) {
  const action = run.actions
    .slice()
    .reverse()
    .find(
      (entry) =>
        entry.ref === 'classic-check' &&
        (!options.actionId || entry.id === options.actionId) &&
        (entry.outcome?.output as { manifestRef?: unknown } | undefined)?.manifestRef,
    );
  if (!action) throw new Error('当前 Run 没有检查输入清单；沿用原检查建立记录后再判断变化');
  const output = action.outcome!.output as {
    manifestRef: string;
    manifestHash: string;
    argv: string[];
    cwd: string;
  };
  const source = await readClassicProjectFile(projectRoot, output.manifestRef, {
    label: 'Classic 原输入清单',
    maxBytes: Number.MAX_SAFE_INTEGER,
  });
  if (checkManifestHash(source) !== output.manifestHash)
    throw new Error('Classic 原输入清单已变化');
  const state = run.state as unknown as ClassicState;
  const current =
    options.snapshot ??
    (await collectCheckSnapshot(
      projectRoot,
      path.resolve(projectRoot, (run.input as { changeDir: string }).changeDir),
      { argv: output.argv, cwd: output.cwd },
      { verificationReport: state.verificationReport },
    ));
  const before = parseCheckManifest(source),
    diff = diffCheckManifests(before, current.entries);
  const left = new Map(before.map((entry) => [entry.p, entry.h])),
    right = new Map(current.entries.map((entry) => [entry.p, entry.h]));
  const changedPaths = [...diff.added, ...diff.changed, ...diff.removed];
  const gitChanges = changedPaths
    .filter((ref) => ref.startsWith('\0git:'))
    .map((ref) => ({
      path: ref,
      beforeHash: left.get(ref) ?? 'missing',
      afterHash: right.get(ref) ?? 'missing',
    }));
  const changes = [];
  for (const ref of changedPaths.filter((entry) => !entry.startsWith('\0git:'))) {
    let afterHash = 'missing';
    try {
      afterHash = (
        await hashProtectedProjectFile(projectRoot, ref, { label: 'Classic 当前原始文件' })
      ).digest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!right.has(ref) && afterHash !== 'missing') continue; // 新声明的检查输出仍在磁盘，不是删除输入文件。
    changes.push({
      path: ref,
      beforeHash: left.get(ref) ?? 'missing',
      afterHash,
      afterInputHash: right.get(ref),
    });
  }
  const root = await ensureProtectedProjectDirectory(
    await resolveWorkspaceRuntimeRoot(projectRoot),
    'classic/input-observations',
    { label: 'Classic 输入观察' },
  );
  const currentRef = path.join(root, `${checkManifestHash(current.manifest)}.manifest`);
  try {
    await atomicWriteContainedText(currentRef, current.manifest, {
      containedRoot: root,
      exclusive: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (
      checkManifestHash(await fs.readFile(currentRef, 'utf8')) !==
      checkManifestHash(current.manifest)
    )
      throw new Error('Classic 已保存的输入观察内容已变化', { cause: error });
  }
  const approval = [...run.waits]
    .reverse()
    .find(
      (wait) =>
        wait.stepId === `${state.workflow}.archive.confirm` &&
        wait.status === 'resolved' &&
        ['local', 'push', 'pr'].includes(wait.decision?.choice ?? ''),
    );
  const pending = run.actions.filter((entry) => entry.status === 'pending');
  return {
    sourceActionId: action.id,
    beforeRef: output.manifestRef,
    currentRef,
    currentManifestHash: checkManifestHash(current.manifest),
    changes,
    gitChanges,
    ...(state.phase === 'archive' &&
    approval &&
    pending.length === 1 &&
    ['archive.preflight', 'archive.execute'].some(
      (step) => pending[0].stepId === `${state.workflow}.${step}`,
    )
      ? {
          refreshInputTemplate: {
            expectedRevision: run.revision,
            archiveActionId: pending[0].id,
            approvalWaitId: approval.id,
            proposalHash: approval.proposalHash,
            reportSha256: run.evidenceWaits
              ?.slice()
              .reverse()
              .find(
                (wait) =>
                  wait.stepId === `${state.workflow}.verify.report.evidence` &&
                  wait.status === 'resolved',
              )?.receipt?.contentHash,
            sourceActionId: action.id,
            observationHash: checkManifestHash(current.manifest),
            summary: '<当前 Agent 说明仅补跑原 Verify 检查且保留原结论与批准的依据>',
          },
        }
      : {}),
  };
}

export async function observeClassicSdkAcceptedCandidateInputs(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
  snapshot?: CheckSnapshot,
) {
  const state = run.state as unknown as ClassicState;
  const receipt = [...(run.evidenceWaits ?? [])]
    .reverse()
    .find(
      (wait) =>
        wait.stepId === `${state.workflow}.verify.check.evidence` && wait.status === 'resolved',
    )?.receipt;
  const action = [...run.actions].reverse().find((entry) => {
    const output = entry.outcome?.output as
      { receiptRef?: string; contentHash?: string } | undefined;
    return (
      entry.stepId === `${state.workflow}.verify.check` &&
      entry.status === 'succeeded' &&
      entry.claim?.executorId === 'comet-classic-check' &&
      output?.receiptRef === receipt?.ref &&
      output?.contentHash === receipt?.contentHash
    );
  });
  if (!receipt || !action) throw new Error('原接受结果的检查收据缺失，不能用补检查替代原验收');
  return observeClassicCheckInputs(projectRoot, run, { actionId: action.id, snapshot });
}

export async function assertClassicSdkAcceptedCandidateInputs(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
  snapshot?: CheckSnapshot,
) {
  const state = run.state as unknown as ClassicState;
  const observation = await observeClassicSdkAcceptedCandidateInputs(projectRoot, run, snapshot);
  const change = path.posix.basename((run.input as { changeDir: string }).changeDir);
  const scopes = [
    await classicEditReviewScope(projectRoot, change, state),
    await classicFormalEditReviewScope(projectRoot, change, state, false, undefined, run),
  ];
  for (const scope of scopes) await assertEditReviewsComplete(scope);
  if (!(await areObservedEditsNonBehavioral(scopes, observation.changes)))
    throw new Error(
      '当前内容与原已接受候选不一致；由当前 Agent 只判断新增变化，不能用补检查替代原验收',
    );
}

/** 只消费明确列出原检查 Action 的 Agent 判断，不从文档类型推断检查无关。 */
export async function classicCheckInputsRetained(
  projectRoot: string,
  change: string,
  state: ClassicState,
  actionId: string,
  previous: { manifestRef?: unknown; manifestHash?: unknown },
  currentManifest: string,
  run?: Readonly<WorkflowRun>,
): Promise<boolean> {
  if (typeof previous.manifestRef !== 'string' || typeof previous.manifestHash !== 'string')
    return false;
  let source: string;
  try {
    source = await readClassicProjectFile(projectRoot, previous.manifestRef, {
      label: 'Classic 原检查输入清单',
      maxBytes: Number.MAX_SAFE_INTEGER,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (checkManifestHash(source) !== previous.manifestHash)
    throw new Error('Classic 原检查输入清单已变化');
  const before = parseCheckManifest(source),
    after = parseCheckManifest(currentManifest);
  const diff = diffCheckManifests(before, after);
  const old = new Map(before.map((entry) => [entry.p, entry.h]));
  const current = new Map(after.map((entry) => [entry.p, entry.h]));
  const changes = [...diff.added, ...diff.removed, ...diff.changed].map((ref) => ({
    path: ref,
    beforeHash: old.get(ref) ?? 'missing',
    afterHash: current.get(ref) ?? 'missing',
  }));
  // 回到 Build 后旧报告留作历史；只排除同一 Run 真正验收且字节未变的 Runtime 输出。
  if (run && state.phase === 'build') {
    const command = run.commands
      ?.slice()
      .reverse()
      .find((entry) => entry.name === 'continue-build');
    const sequence = command ? run.actionContexts[command.actionId]?.sequence : undefined;
    const report =
      sequence === undefined
        ? undefined
        : run.evidenceWaits
            ?.slice()
            .reverse()
            .find(
              (wait) =>
                wait.stepId === `${state.workflow}.verify.report.evidence` &&
                wait.sequence < sequence,
            );
    const receipt = report?.status === 'resolved' ? report.receipt : undefined;
    const output = run.actions.find((entry) => entry.id === actionId)?.outcome?.output as
      { argv?: string[]; cwd?: string } | undefined;
    const entry = receipt
      ? changes.find((entry) => entry.path === receipt.ref && entry.beforeHash === 'missing')
      : undefined;
    if (
      entry &&
      receipt &&
      output?.argv &&
      output.cwd !== undefined &&
      (await readCheckPolicy(projectRoot, { argv: output.argv, cwd: output.cwd })).files ===
        undefined
    ) {
      const bytes = await readClassicProjectBytes(projectRoot, receipt.ref, {
        label: 'Classic 原验收报告输出',
        maxBytes: Number.MAX_SAFE_INTEGER,
      });
      const raw = createHash('sha256').update(bytes).digest('hex');
      const hashes = [
        raw,
        ...['sha1', 'sha256'].map(
          (algorithm) =>
            `git:${createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex')}`,
        ),
      ];
      if (raw === receipt.contentHash && hashes.includes(entry.afterHash))
        entry.beforeHash = entry.afterHash;
    }
  }
  // Verify 声明报告后，旧 Build 输入会移除该输出；实际字节未变不构成项目内容变化。
  for (const entry of changes) {
    if (entry.afterHash !== 'missing' || entry.path !== state.verificationReport) continue;
    try {
      const bytes = await readClassicProjectBytes(projectRoot, entry.path, {
        label: 'Classic 报告输入观察',
        maxBytes: Number.MAX_SAFE_INTEGER,
      });
      const hashes = [
        createHash('sha256').update(bytes).digest('hex'),
        ...['sha1', 'sha256'].map(
          (algorithm) =>
            `git:${createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex')}`,
        ),
      ];
      if (hashes.includes(entry.beforeHash)) entry.afterHash = entry.beforeHash;
      else entry.afterHash = hashes[0];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return isCheckInputRetained(
    await classicEditReviewScope(projectRoot, change, state),
    actionId,
    changes.filter((entry) => entry.beforeHash !== entry.afterHash),
    [await classicFormalEditReviewScope(projectRoot, change, state, false, undefined, run)],
  );
}
