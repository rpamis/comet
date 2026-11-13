import { reserveNativeVerifierAttempt } from './native-loop-runtime.js';
import { nativeSdkVerificationReportMetadata } from './native-sdk-report.js';
import {
  defineWorkflow,
  hashRuntimeValue,
  preserveRuntimeExecutionOrigins,
  type DefineWorkflowOptions,
  type WorkflowRun,
  type WorkflowTransitionHandler,
  type RuntimeValue,
} from '../engine/runtime.js';
import { parseNativePortableState } from './native-portable-state.js';

// 旧安装包内置 v4 的既有 SDK 定义身份；不计算文件指纹或保留旧工厂。
const LEGACY_NATIVE_V4_DEFINITION_HASH =
  '26c4e50c65dcb5e1280529642a73b650400e3109ba6fa2efded90e03ad790443';

/** 只转换旧业务调度；保留原批准、任务和结果，不观测或重放旧进程。 */
export function upgradeNativeRun(
  saved: WorkflowRun,
  workflow: DefineWorkflowOptions,
  handler?: WorkflowTransitionHandler,
): WorkflowRun {
  const definition = defineWorkflow(workflow),
    hash = hashRuntimeValue(definition);
  if (saved.workflow.hash === hash && saved.workflow.version === definition.version) return saved;
  if (saved.workflow.version === '4' && saved.workflow.hash !== LEGACY_NATIVE_V4_DEFINITION_HASH)
    throw new Error('Native 当前 Run 的 definition hash 不匹配；不能作为旧业务数据重新绑定。');
  if (
    saved.workflow.id !== 'comet-native' ||
    !['1', '2', '3', '4'].includes(saved.workflow.version)
  )
    throw new Error('Native Run 不属于可升级的内置协议');
  const state = parseNativePortableState(saved.state);
  if (state.name !== saved.runId || (saved.input as { name?: unknown })?.name !== saved.runId)
    throw new Error('Native Run 与需求名称不一致');
  const next = preserveRuntimeExecutionOrigins(saved);
  next.state = state as unknown as RuntimeValue;
  const exists = (id: string) => Object.hasOwn(definition.steps, id);
  const frontiers: Array<{ step: string; results: WorkflowRun['ready'][number]['results'] }> = [];
  const stopAliases: Record<string, string> = {
    'verify.checks-stop': 'verify.stop',
    'supervisor.child.checks-stop': 'supervisor.child.verifier-retry',
    'supervisor.child.integration-checks-stop': 'supervisor.child.verifier-retry',
  };
  for (const action of next.actions) {
    if (exists(action.stepId) || !['pending', 'running', 'unknown'].includes(action.status))
      continue;
    frontiers.push({ step: action.stepId, results: next.actionContexts[action.id].results });
    action.status = 'cancelled';
    action.reason = '旧检查调度已移交 Agent 平台；原进程结果未确认，不代表已经停止或通过。';
  }
  for (const wait of next.waits) {
    if (wait.status !== 'pending' || exists(wait.stepId)) continue;
    if (stopAliases[wait.stepId]) {
      wait.stepId = stopAliases[wait.stepId];
      continue;
    }
    throw new Error('旧 Native 待决定事项没有当前业务对应项，原提案保持不变。');
  }
  for (const wait of next.evidenceWaits ?? []) {
    if (wait.status === 'pending' && !exists(wait.stepId)) {
      frontiers.push({ step: wait.stepId, results: wait.results });
      wait.status = 'cancelled';
    }
  }
  const oldReady = next.ready;
  next.ready = oldReady.filter((t) => exists(t.to) && (t.from === null || exists(t.from)));
  for (const token of oldReady)
    if (!exists(token.to) || (token.from !== null && !exists(token.from)))
      frontiers.push({ step: token.to, results: token.results });
  if (saved.status === 'failed' && saved.reason?.startsWith('ACTION_FAILED: ')) {
    const step = saved.reason.slice('ACTION_FAILED: '.length),
      action = [...next.actions].reverse().find((a) => a.stepId === step);
    if (!exists(step) && action)
      frontiers.push({ step, results: next.actionContexts[action.id].results });
  }
  if (
    state.children_contract_ref &&
    !next.actions.some((a) => a.id === state.children_contract_ref)
  ) {
    const approved = [...next.waits]
      .reverse()
      .find(
        (w) =>
          ['shape.confirm', 'supervisor.shape.confirm'].includes(w.stepId) &&
          w.status === 'resolved' &&
          ['approved', 'single-session', 'multi-session'].includes(w.decision?.choice ?? ''),
      );
    const source = next.actions.find(
      (a) =>
        a.stepId === 'shape.prepare' &&
        a.status === 'succeeded' &&
        next.actionContexts[a.id].sequence === approved?.results['shape.prepare']?.sequence,
    );
    const contract = (source?.outcome?.output as { children?: { contract?: unknown } } | undefined)
      ?.children?.contract;
    if (!source || !contract) throw new Error('旧 Supervisor 缺少原已批准的子任务方案');
    next.state = {
      ...state,
      children_contract_hash: state.children_contract_ref,
      children_contract_ref: source.id,
      children_contract: contract,
    } as unknown as RuntimeValue;
  }
  const scheduled = new Set<string>();
  for (const frontier of frontiers) {
    if (['completed', 'cancelled'].includes(saved.status)) break;
    const rootBlocked = next.waits.some(
      (w) =>
        w.status === 'pending' &&
        ['verify.stop', 'verify.confirm', 'verify.retry'].includes(w.stepId),
    );
    if (rootBlocked && !frontier.step.startsWith('supervisor.child.')) continue;
    const approvedStep = ['shape.revalidate', 'build.checks'].includes(frontier.step)
      ? ['shape.confirm', 'supervisor.shape.confirm']
      : frontier.step === 'verify.revalidate'
        ? ['verify.confirm']
        : [];
    const approved = [...next.waits]
      .reverse()
      .find(
        (w) =>
          approvedStep.includes(w.stepId) &&
          w.status === 'resolved' &&
          frontier.results[w.stepId]?.sequence === w.sequence &&
          ['approved', 'single-session', 'multi-session'].includes(w.decision?.choice ?? ''),
      );
    let token: WorkflowRun['ready'][number] | undefined;
    if (approved) {
      let applied;
      if (frontier.step === 'build.checks') {
        applied = { state: next.state, next: ['build.builder'] };
      } else {
        if (!handler) throw new Error('旧批准需要当前业务转移器完成数据转换');
        applied = handler.apply({
          run: next,
          event: {
            kind: 'wait-resolved',
            stepId: approved.stepId,
            choice: approved.decision!.choice,
            proposalHash: approved.proposalHash,
            decisionId: approved.decision!.id,
          },
        });
      }
      if (applied.next.length !== 1) throw new Error('旧批准没有唯一的当前业务续行');
      next.state = applied.state;
      const target = applied.next[0];
      token = {
        from: approved.stepId,
        to: typeof target === 'string' ? target : target.stepId,
        results: {
          ...approved.results,
          [approved.stepId]: {
            sequence: approved.sequence,
            value: { choice: approved.decision!.choice, proposal: approved.proposal },
          },
        },
        ...(typeof target === 'string' ? {} : { activation: target.input }),
      };
    } else {
      const latest = [...next.actions]
        .reverse()
        .find(
          (a) =>
            exists(a.stepId) &&
            a.status === 'succeeded' &&
            [
              'build.builder',
              'supervisor.parent.builder',
              'supervisor.child.builder',
              'supervisor.child.integrate',
              'supervisor.child.integration-repair',
              'verify.verifier',
            ].includes(a.stepId) &&
            frontier.results[a.stepId]?.sequence === next.actionContexts[a.id].sequence,
        );
      if (!latest) throw new Error('旧 Native Run 缺少已接受的业务续行来源，原记录保持不变。');
      if (scheduled.has(latest.id)) continue;
      scheduled.add(latest.id);
      const context = next.actionContexts[latest.id];
      let to: string, activation: RuntimeValue | undefined;
      if (
        [
          'supervisor.child.builder',
          'supervisor.child.integrate',
          'supervisor.child.integration-repair',
        ].includes(latest.stepId)
      ) {
        if (!handler) throw new Error('旧 Child 需要当前业务转移器完成数据转换');
        const applied = handler.apply({
          run: next,
          event: { kind: 'action-outcome', stepId: latest.stepId, outcome: latest.outcome! },
        });
        if (applied.next.length !== 1) throw new Error('旧 Child 没有唯一的当前业务续行');
        next.state = applied.state;
        const target = applied.next[0];
        to = typeof target === 'string' ? target : target.stepId;
        activation = typeof target === 'string' ? undefined : target.input;
        if (activation && typeof activation === 'object' && !Array.isArray(activation)) {
          activation = {
            ...activation,
            contractRef: parseNativePortableState(next.state).children_contract_ref!,
          };
          delete activation.contractHash;
        }
      } else {
        const current = parseNativePortableState(next.state),
          verified = latest.stepId === 'verify.verifier' && current.verification_result === 'pass';
        to = verified ? 'verify.confirm' : 'verify.verifier';
        if (
          !verified &&
          current.phase === 'verify' &&
          current.loop.stage === 'verify-ready' &&
          current.loop.next_action !== 'await-verifier-result'
        )
          next.state = reserveNativeVerifierAttempt(current) as unknown as RuntimeValue;
      }
      token = {
        from: latest.stepId,
        to,
        results: {
          ...context.results,
          [latest.stepId]: { sequence: context.sequence, value: latest.outcome!.output },
        },
        ...(activation === undefined ? {} : { activation }),
      };
    }
    if (token.to === 'verify.confirm')
      token.activation = {
        report: nativeSdkVerificationReportMetadata(
          parseNativePortableState(next.state),
          (next.input as { artifactRootRef: string }).artifactRootRef,
        ),
      };
    next.ready.push(token);
    next.status = 'running';
    delete next.reason;
  }
  next.workflow = { id: definition.id, version: definition.version, hash };
  for (const key of Object.keys(next.definitionHashes))
    if (JSON.parse(key)[0] === definition.id) delete next.definitionHashes[key];
  next.definitionHashes[JSON.stringify([definition.id, definition.version])] = hash;
  return next;
}
