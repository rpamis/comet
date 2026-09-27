import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  hashProtectedProjectFile,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import {
  type RuntimeAction,
  type RuntimeExecutor,
  type RuntimeValidator,
  type RuntimeValue,
  type WorkflowRun,
  hashRuntimeValue,
} from '../engine/runtime.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { inspectNativePortableAcceptanceDrift } from './native-portable-requirements.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativeSdkCurrentCheckSummaries } from './native-sdk-checks.js';
import {
  renderNativeVerificationReport,
  writeNativeVerificationReport,
} from './native-verification-report-v2.js';

class NativeSdkReportDriftError extends Error {}

function reportInput(run: Readonly<WorkflowRun>, action: Readonly<RuntimeAction>) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  if (
    state.phase !== 'verify' ||
    state.status !== 'await-user' ||
    state.verification_result !== 'pass' ||
    !state.verification ||
    !state.builder_handoff ||
    input.name !== state.name ||
    typeof input.artifactRootRef !== 'string' ||
    action.stepId !== 'verify.report' ||
    action.ref !== 'native-verification-report'
  ) {
    throw new Error('Native verification report is not bound to the current passed candidate');
  }
  return { state, artifactRootRef: input.artifactRootRef };
}

async function reportTarget(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  root: string,
) {
  const { state, artifactRootRef } = reportInput(run, action);
  const config = await readProjectConfig(root);
  if (!config || config.native.artifact_root !== artifactRootRef) {
    throw new Error('Native artifact root changed after Run creation');
  }
  const paths = await nativeProjectPaths(root, artifactRootRef);
  const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
  if (drift.drifted) throw new Error(drift.reason ?? 'Native acceptance changed');
  const file = path.join(paths.changesDir, state.name, 'verification.md');
  const ref = path.relative(root, file).replaceAll('\\', '/');
  await inspectProtectedProjectPath(root, ref, {
    label: 'Native SDK verification report',
    expected: 'file',
  });
  return { state, file, ref };
}

export const nativeSdkReportExecutor: RuntimeExecutor = {
  id: 'comet-native-report',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-verification-report',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) throw new Error('Native report requires a bound SDK Run');
    const { state, file, ref } = await reportTarget(run, action, context.projectRoot);
    await writeNativeVerificationReport({ file, state });
    const current = await hashProtectedProjectFile(context.projectRoot, ref, {
      label: 'Native SDK verification report',
    });
    return {
      status: 'succeeded',
      output: {
        candidateId: state.builder_handoff!.candidate_id,
        reportRef: ref,
        reportSha256: current.digest,
        stateVersion: state.state_version,
      } as unknown as RuntimeValue,
    };
  },
};

export const nativeSdkReportValidator: RuntimeValidator = {
  id: 'comet-native-report-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkReportExecutor.id ||
      outcome.status !== 'succeeded'
    ) {
      return { accepted: false, reason: 'Native report was not produced by the Runtime executor' };
    }
    try {
      const { state, ref } = await reportTarget(run, action, context.projectRoot);
      const output = outcome.output as Record<string, unknown> | null;
      const actual = await hashProtectedProjectFile(context.projectRoot, ref, {
        label: 'Native SDK verification report',
      });
      const expected = createHash('sha256')
        .update(renderNativeVerificationReport(state))
        .digest('hex');
      if (
        !output ||
        output.candidateId !== state.builder_handoff!.candidate_id ||
        output.reportRef !== ref ||
        output.reportSha256 !== actual.digest ||
        output.stateVersion !== state.state_version ||
        actual.digest !== expected
      ) {
        return { accepted: false, reason: 'Native verification report changed after generation' };
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

async function revalidatedReport(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  if (
    state.phase !== 'verify' ||
    state.status !== 'await-user' ||
    state.verification_result !== 'pass' ||
    !state.builder_handoff ||
    !state.verification ||
    input.name !== state.name ||
    typeof input.artifactRootRef !== 'string' ||
    action.stepId !== 'verify.revalidate' ||
    action.ref !== 'native-report-revalidate' ||
    !run.waits.some(
      (wait) =>
        wait.stepId === 'verify.confirm' &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'approved',
    )
  ) {
    throw new Error('Native report revalidation lacks an approved current Verifier result');
  }
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef) {
    throw new Error('Native artifact root changed after Run creation');
  }
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
  if (drift.drifted) throw new Error(drift.reason ?? 'Native acceptance changed');
  await nativeSdkCurrentCheckSummaries({ run, projectRoot });
  const file = path.join(paths.changesDir, state.name, 'verification.md');
  const ref = path.relative(projectRoot, file).replaceAll('\\', '/');
  const prior = run.outputs['verify.report']?.value as Record<string, unknown> | undefined;
  if (
    !prior ||
    prior.candidateId !== state.builder_handoff.candidate_id ||
    prior.reportRef !== ref ||
    prior.stateVersion !== state.state_version ||
    typeof prior.reportSha256 !== 'string'
  ) {
    throw new Error('Native report approval is stale for the current candidate');
  }
  const actual = await hashProtectedProjectFile(projectRoot, ref, {
    label: 'Native SDK verification report',
  });
  const expected = createHash('sha256').update(renderNativeVerificationReport(state)).digest('hex');
  if (actual.digest !== prior.reportSha256 || actual.digest !== expected) {
    throw new NativeSdkReportDriftError('Native verification report changed after user approval');
  }
  return {
    candidateId: state.builder_handoff.candidate_id,
    reportRef: ref,
    reportSha256: actual.digest,
    stateVersion: state.state_version,
  };
}

export const nativeSdkReportRevalidationExecutor: RuntimeExecutor = {
  id: 'comet-native-report-revalidate',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-report-revalidate',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) {
      throw new Error('Native report revalidation requires a bound SDK Run');
    }
    try {
      return {
        status: 'succeeded',
        output: (await revalidatedReport(
          run,
          action,
          context.projectRoot,
        )) as unknown as RuntimeValue,
      };
    } catch (error) {
      if (error instanceof NativeSdkReportDriftError) {
        return { status: 'failed', output: { reason: 'report-drift' } };
      }
      throw error;
    }
  },
};

export const nativeSdkReportRevalidationValidator: RuntimeValidator = {
  id: 'comet-native-report-revalidation-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkReportRevalidationExecutor.id ||
      !['succeeded', 'failed'].includes(outcome.status)
    ) {
      return { accepted: false, reason: 'Native report was not revalidated by the Runtime' };
    }
    try {
      const expected = await revalidatedReport(run, action, context.projectRoot);
      if (outcome.status !== 'succeeded') {
        return { accepted: false, reason: 'Native report is current but outcome says it drifted' };
      }
      return hashRuntimeValue(outcome.output) ===
        hashRuntimeValue(expected as unknown as RuntimeValue)
        ? { accepted: true }
        : { accepted: false, reason: 'Native report revalidation changed before commit' };
    } catch (error) {
      if (error instanceof NativeSdkReportDriftError && outcome.status === 'failed') {
        return hashRuntimeValue(outcome.output) === hashRuntimeValue({ reason: 'report-drift' })
          ? { accepted: true }
          : { accepted: false, reason: 'Native report drift outcome is invalid' };
      }
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
