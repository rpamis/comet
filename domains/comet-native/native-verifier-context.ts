import { hashRuntimeValue, type WorkflowRun, type RuntimeAction } from '../engine/runtime.js';
import { resolveWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import {
  nativeRawInputSnapshot,
  saveNativeRawInput,
  readNativeRawInput,
  nativeRawInputChanges,
} from './native-portable-checks.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativeSdkCheckRuntimeRef } from './native-sdk-check-execution.js';
import { nativeProjectPaths } from './native-paths.js';
import { nativeVerifyMode } from './native-verification-policy.js';
import {
  assertNativeSdkCandidateUnchanged,
  nativeSdkCurrentCheckSummaries,
  NativeSdkCandidateDriftError,
  NativeSdkCheckInputDriftError,
  NativeSdkCheckInputSnapshotError,
} from './native-sdk-checks.js';

export async function prepareNativeVerificationBaseline(
  projectRoot: string,
  artifactRootRef: string,
  name: string,
) {
  const paths = await nativeProjectPaths(projectRoot, artifactRootRef);
  const snapshot = await nativeRawInputSnapshot({
    projectRoot,
    managedArtifactRoot: paths.artifactRoot,
  });
  if (!snapshot.complete)
    throw new Error(
      `Native verification baseline is incomplete: ${snapshot.diagnostics.join('; ')}`,
    );
  const directory = `native/verification-baselines/${hashRuntimeValue(name)}`;
  const ref = await saveNativeRawInput(paths.workspaceRuntimeRoot, directory, snapshot);
  return { directory, ref, contentHash: snapshot.contentHash };
}

export async function readNativeVerificationBaseline(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
) {
  const baseline = (
    run.input as { verificationBaseline?: { directory: string; ref: string; contentHash: string } }
  ).verificationBaseline;
  if (
    !baseline ||
    baseline.directory !== `native/verification-baselines/${hashRuntimeValue(run.runId)}`
  )
    throw new Error('Native verification baseline belongs to another Run or is missing');
  const root = await resolveWorkspaceRuntimeRoot(projectRoot);
  const snapshot = await readNativeRawInput(root, baseline.directory, baseline.ref);
  if (!snapshot.complete || snapshot.contentHash !== baseline.contentHash)
    throw new Error('Native verification baseline is incomplete or changed');
  return snapshot;
}

const builders = new Set([
  'build.builder',
  'supervisor.parent.builder',
  'supervisor.child.builder',
  'supervisor.child.integration-repair',
]);

export async function nativeVerifierSession(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const index = run.actions.findIndex((entry) => entry.id === action.id);
  const shapeIndex = run.actions
    .slice(0, index)
    .map((entry) => entry.stepId === 'shape.revalidate' && entry.status === 'succeeded')
    .lastIndexOf(true);
  const prior = run.actions
    .slice(Math.max(0, shapeIndex + 1), index)
    .reverse()
    .find((entry) => entry.stepId === 'verify.verifier');
  const output = prior?.outcome?.output as
    { candidateId?: string; response?: { kind?: string } } | undefined;
  const candidateId = parseNativePortableState(run.state).builder_handoff?.candidate_id;
  const sessionId = prior?.claim?.sessionId;
  if (
    prior?.status !== 'succeeded' ||
    !sessionId ||
    !output ||
    (output.candidateId === candidateId && output.response?.kind !== 'request-checks') ||
    run.actions.some((entry) => builders.has(entry.stepId) && entry.claim?.sessionId === sessionId)
  ) {
    return { strategy: 'fresh' as const };
  }
  const checks = run.actions.filter(
    (entry) => ['verify.checks', 'verify.requested-checks'].includes(entry.stepId) && entry.outcome,
  );
  const refFor = (id: string | undefined) =>
    (
      [...checks]
        .reverse()
        .find((entry) => (entry.outcome!.output as { candidateId?: string }).candidateId === id)
        ?.outcome?.output as { rawInput?: { afterRef: string } } | undefined
    )?.rawInput?.afterRef;
  const previousRef = refFor(output.candidateId);
  const currentRef = refFor(candidateId);
  if (!previousRef || !currentRef) return { strategy: 'fresh' as const };
  if (previousRef !== currentRef) {
    const root = await resolveWorkspaceRuntimeRoot(projectRoot);
    const directory = `${nativeSdkCheckRuntimeRef(run)}/inputs`;
    const [previous, current] = await Promise.all([
      readNativeRawInput(root, directory, previousRef),
      readNativeRawInput(root, directory, currentRef),
    ]);
    if (!previous.complete || !current.complete)
      throw new Error('Native verification input is incomplete');
    if (previous.projectRoot !== current.projectRoot) return { strategy: 'fresh' as const };
  }
  return { strategy: 'resume' as const, sessionId, previousActionId: prior.id };
}

/** 提供真实来源和增量范围；不把 Builder 自评或累积 Action 输入交给审查者。 */
export async function nativeVerifierContext(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  if (nativeVerifyMode(run) !== 'bugfree' || action.stepId !== 'verify.verifier') return undefined;
  const state = parseNativePortableState(run.state);
  const input = run.input as {
    artifactRootRef: string;
    verificationBaseline?: { directory: string; ref: string; contentHash: string };
  };
  const root = await resolveWorkspaceRuntimeRoot(projectRoot);
  const plans = run.actions.filter(
    (entry) => ['verify.checks', 'verify.requested-checks'].includes(entry.stepId) && entry.outcome,
  );
  const current = [...plans]
    .reverse()
    .find(
      (entry) =>
        (entry.outcome!.output as { candidateId?: string }).candidateId ===
        state.builder_handoff?.candidate_id,
    );
  const currentOutput = current?.outcome?.output as { rawInput?: { afterRef: string } } | undefined;
  let implementationRoot = projectRoot;
  let changeRefs: unknown = {
    complete: false,
    reason: 'Current input or creation baseline is unavailable',
  };
  let checkInput: {
    status: 'unavailable' | 'current' | 'changed' | 'incomplete';
    checkedActionId?: string;
    checkedRef?: string;
    checkedHash?: string;
    currentHash?: string;
    changes: ReturnType<typeof nativeRawInputChanges>;
    diagnostics: string[];
    candidateStatus: 'unchanged' | 'changed' | 'unknown';
    evidenceStatus: 'current' | 'retained' | 'stale' | 'unavailable';
    reason?: string;
    recovery?: { cwd: string; commandArgs: string[] };
  } = {
    status: 'unavailable',
    changes: [],
    diagnostics: [],
    candidateStatus: 'unknown',
    evidenceStatus: 'unavailable',
  };
  if (input.verificationBaseline && currentOutput?.rawInput) {
    const baseline = await readNativeVerificationBaseline(run, projectRoot);
    const now = await readNativeRawInput(
      root,
      `${nativeSdkCheckRuntimeRef(run)}/inputs`,
      currentOutput.rawInput.afterRef,
    );
    implementationRoot = now.projectRoot;
    if (
      !baseline.complete ||
      !now.complete ||
      baseline.contentHash !== input.verificationBaseline.contentHash
    )
      throw new Error('Native verification input is incomplete');
    const paths = await nativeProjectPaths(implementationRoot, input.artifactRootRef, {
      readOnly: true,
    });
    const live = await nativeRawInputSnapshot({
      projectRoot: implementationRoot,
      managedArtifactRoot: paths.artifactRoot,
      previous: now,
    });
    checkInput = {
      status: !live.complete
        ? 'incomplete'
        : now.contentHash === live.contentHash
          ? 'current'
          : 'changed',
      checkedActionId: current!.id,
      checkedRef: currentOutput.rawInput.afterRef,
      checkedHash: now.contentHash,
      currentHash: live.contentHash,
      changes: live.complete ? nativeRawInputChanges(now, live) : [],
      diagnostics: live.diagnostics,
      candidateStatus: 'unknown',
      evidenceStatus: 'unavailable',
    };
    try {
      await assertNativeSdkCandidateUnchanged({
        run,
        projectRoot,
        requireEvidence: true,
        observedInputs: live,
      });
      checkInput.candidateStatus = 'unchanged';
      await nativeSdkCurrentCheckSummaries({ run, projectRoot, observedInputs: live });
      checkInput.evidenceStatus = checkInput.status === 'changed' ? 'retained' : 'current';
    } catch (error) {
      checkInput.reason = error instanceof Error ? error.message : String(error);
      if (error instanceof NativeSdkCandidateDriftError) {
        checkInput.candidateStatus = 'changed';
        checkInput.recovery = {
          cwd: projectRoot,
          commandArgs: [
            'comet',
            'edit-review',
            'observe',
            'native',
            state.name,
            '--session',
            '<current-agent-session>',
            '--json',
          ],
        };
      } else if (error instanceof NativeSdkCheckInputSnapshotError) {
        checkInput.status = 'incomplete';
      } else if (error instanceof NativeSdkCheckInputDriftError) {
        checkInput.evidenceStatus = 'stale';
      }
    }
    const previous = [...plans]
      .reverse()
      .find(
        (entry) =>
          entry !== current &&
          (entry.outcome!.output as { candidateId?: string }).candidateId !==
            state.builder_handoff?.candidate_id,
      );
    const previousRef = (
      previous?.outcome?.output as { rawInput?: { afterRef: string } } | undefined
    )?.rawInput?.afterRef;
    const earlier = previousRef
      ? await readNativeRawInput(root, `${nativeSdkCheckRuntimeRef(run)}/inputs`, previousRef)
      : null;
    changeRefs = {
      complete: live.complete,
      baselineRef: input.verificationBaseline.ref,
      candidateRef: currentOutput.rawInput.afterRef,
      currentInputHash: live.contentHash,
      baselineCommit: baseline.git?.head ?? null,
      fullChanges: live.complete ? nativeRawInputChanges(baseline, live) : [],
      ...(earlier
        ? {
            previousCandidateRef: previousRef,
            incrementalChanges: live.complete ? nativeRawInputChanges(earlier, live) : [],
          }
        : {}),
    };
  }
  const session = await nativeVerifierSession(run, action, projectRoot);
  const prior =
    session.strategy === 'resume'
      ? run.actions.find((entry) => entry.id === session.previousActionId)
      : undefined;
  const shape = run.outputs['shape.revalidate']?.value as
    { specChanges?: Array<{ source: string }> } | undefined;
  const changeRoot = `${input.artifactRootRef}/comet/changes/${state.name}`;
  return {
    verifyMode: 'bugfree' as const,
    candidateId: state.builder_handoff?.candidate_id,
    workspace: { projectRoot, implementationRoot },
    requirementRefs: [
      `${changeRoot}/brief.md`,
      ...(shape?.specChanges ?? []).map((entry) => `${changeRoot}/${entry.source}`),
      'AGENTS.md',
    ],
    acceptance: state.acceptance.map(({ id, source, text }) => ({ id, source, text })),
    ...(typeof (run.input as { task?: unknown }).task === 'string'
      ? {
          originalRequest: {
            source: 'run.input.task',
            text: (run.input as { task: string }).task,
            instruction:
              state.language === 'zh-CN'
                ? '先读原始请求，再对照 Spec 与实现。核对遗漏、非目标及接口变化；范围变化须有用户授权。在同一结果的 requestReview 中说明依据，冲突或疑问未解决时如实 fail 或 blocked。'
                : 'Read the original request before the Spec and implementation. Check omissions, non-goals and interface changes against user authorization. Explain the comparison in requestReview in the same result; report fail or blocked for unresolved conflicts or requirements.',
          },
        }
      : {}),
    changeRefs,
    checkInput,
    session,
    checkEvidence: plans
      .filter(
        (entry) =>
          (entry.outcome!.output as { candidateId?: string }).candidateId ===
            state.builder_handoff?.candidate_id ||
          ((entry.outcome!.output as { checks?: Array<{ status: string }> }).checks ?? []).some(
            (check) => check.status !== 'passed',
          ),
      )
      .map((entry) => ({
        actionId: entry.id,
        status: entry.status,
        candidateId: (entry.outcome!.output as { candidateId?: string }).candidateId,
        checks: (entry.outcome!.output as { checks?: unknown }).checks ?? [],
      })),
    ...(prior ? { previousReview: { actionId: prior.id, result: prior.outcome?.output } } : {}),
    instruction:
      state.language === 'zh-CN'
        ? '独立只读审查全部验收项，充分运用语义理解；阅读足以判断时直接给出结果。checkInput 列出检查后的实际变化，不能把旧快照当成当前文件。candidateStatus 为 changed 时先按 recovery 观察并判断实际影响，不能仅刷新检查接受代码改动。evidenceStatus 为 retained 表示 Runtime 已核对保留证明，无需重跑；候选仍适用而检查过期时，才使用领取响应中的 refreshChecksResultRequest，保留 receipt。不要手工重算绑定哈希或改写收据。仅为实际疑问补读或请求必要检查；遵守明确要求的检查，不新增审查 Agent。续审根据实际变化确认全部结论。输入不完整时补齐或如实 blocked，失败和未知不得记为通过。'
        : 'Independently review every criterion using semantic understanding. checkInput lists actual changes since checks; the checked snapshot is not the current filesystem. If candidateStatus is changed, follow recovery to assess the edits; refreshing checks cannot accept changed code. evidenceStatus retained means Runtime validated retention evidence, so no rerun is needed. Use refreshChecksResultRequest only when the candidate remains applicable and checks are stale; preserve receipt. Do not reconstruct binding hashes or edit receipts. Read or request checks only to resolve concrete uncertainty, while honoring required checks. Do not spawn reviewers. On continuation, assess actual changes and reconfirm every criterion. Incomplete inputs, failures and unknown executions cannot count as passed.',
  };
}
