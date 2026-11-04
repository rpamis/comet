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
      complete: true,
      baselineRef: input.verificationBaseline.ref,
      candidateRef: currentOutput.rawInput.afterRef,
      baselineCommit: baseline.git?.head ?? null,
      fullChanges: nativeRawInputChanges(baseline, now),
      ...(earlier
        ? {
            previousCandidateRef: previousRef,
            incrementalChanges: nativeRawInputChanges(earlier, now),
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
    changeRefs,
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
        ? '独立只读审查全部验收项，充分运用语义理解；阅读足以判断时直接回报。仅为实际疑问补读或请求必要检查；遵守明确要求的检查，不新增审查 Agent。续审根据实际变化确认全部结论。输入不完整时补齐或如实 blocked，失败和未知不得记为通过。'
        : 'Independently review every criterion using semantic understanding. Read or request checks only to resolve concrete uncertainty, while honoring required checks. Do not spawn reviewers. On continuation, assess actual changes and reconfirm every criterion. Incomplete inputs, failures and unknown executions cannot count as passed.',
  };
}
