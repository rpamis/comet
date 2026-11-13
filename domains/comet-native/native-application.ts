import path from 'node:path';
import { inspectGitWorktree, resolveGitRef } from '../../platform/paths/git-worktree.js';
import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeValidator,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowTransitionHandler,
} from '../engine/runtime.js';
import type {
  WorkflowApplicationFactoryContext,
  WorkflowApplicationImplementation,
} from '../workflow-application/index.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  readChangeRuntimeOwner,
  registerSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { inspectNativeHookGuard } from './native-hook-guard.js';
import { returnNativeCandidateToBuild } from './native-loop-runtime.js';
import { nativeProjectPaths } from './native-paths.js';
import { createNativePortableState, parseNativePortableState } from './native-portable-state.js';
import { defineNativeWorkflowApplication } from './native-sdk-application.js';
import { upgradeNativeRun } from './native-sdk-run-upgrade.js';
import { reserveNativeVerifierAttempt } from './native-loop-runtime.js';
import { currentNativeSdkSupervisorActions } from './native-sdk-supervisor-plan.js';
import { createNativeSdkStateStore } from './native-sdk-state-store.js';
import { nativeSdkSupervisorParentCandidateCommit } from './native-sdk-supervisor-parent.js';

export {
  prepareNativeCandidateReviewExample,
  prepareNativeCandidateReviewProject,
} from './native-candidate-review-example.js';
export { createNativePortableState as createNativeApplicationState };

export type NativeExtensionScope = 'candidate' | 'parent' | 'child' | 'integration';

/** 按声明顺序附加检查；不替换 Native 的 Builder、Verifier 或授权条件。 */
export interface NativeApplicationExtension {
  id: string;
  skillId: string;
  scopes: readonly NativeExtensionScope[];
  artifactRefs: readonly string[];
  validator: RuntimeValidator;
}

export interface NativeApplicationOptions {
  extensions: readonly NativeApplicationExtension[];
  executors?: WorkflowApplicationImplementation['executors'];
}

interface ReviewSource {
  actionId: string;
  inputHash: string;
  outcomeId: string;
  candidateId: string;
  scope: NativeExtensionScope;
  activation: Record<string, RuntimeValue>;
  resume?: ReturnType<WorkflowTransitionHandler['apply']>['next'];
}

const EXTENSION_SOURCES: Record<NativeExtensionScope, string> = {
  candidate: 'build.builder',
  parent: 'supervisor.parent.builder',
  child: 'supervisor.child.builder',
  integration: 'supervisor.child.integrate',
};

export function nativeExtensionStepId(scope: NativeExtensionScope, id: string): string {
  return `native.extension.${scope}.${id}`;
}

function activation(action: Readonly<RuntimeAction>): Record<string, RuntimeValue> {
  return (action.input as { activation?: Record<string, RuntimeValue> }).activation ?? {};
}

function reviewSource(action: Readonly<RuntimeAction>): ReviewSource {
  const source = activation(action).reviewSource as unknown as ReviewSource;
  if (!source || typeof source.actionId !== 'string') throw new Error('扩展缺少原候选 Action');
  return source;
}

function sourceFor(run: Readonly<WorkflowRun>, action: Readonly<RuntimeAction>): ReviewSource {
  const state = parseNativePortableState(run.state);
  const input = activation(action);
  const scope =
    action.stepId === EXTENSION_SOURCES.child
      ? 'child'
      : ['supervisor.child.integrate', 'supervisor.child.integration-repair'].includes(
            action.stepId,
          )
        ? 'integration'
        : state.children_contract_ref
          ? 'parent'
          : 'candidate';
  const output = action.outcome?.output as Record<string, RuntimeValue> | undefined;
  const candidateId =
    scope === 'child'
      ? output?.candidateCommit
      : scope === 'integration'
        ? output?.integrationCommit
        : state.builder_handoff?.candidate_id;
  if (!action.outcome || typeof candidateId !== 'string')
    throw new Error('扩展必须绑定已接受的业务候选');
  return {
    actionId: action.id,
    inputHash: action.inputHash,
    outcomeId: action.outcome.outcomeId,
    candidateId,
    scope,
    activation:
      scope === 'parent'
        ? { ...input, integrationCommit: nativeSdkSupervisorParentCandidateCommit(action) }
        : scope === 'integration'
          ? {
              ...input,
              ...output,
              ...(action.stepId === 'supervisor.child.integration-repair'
                ? { repairActionId: action.id }
                : { mergeActionId: action.id }),
            }
          : { ...input, ...(scope === 'child' ? { candidateCommit: candidateId } : {}) },
  };
}

function sourceAction(run: Readonly<WorkflowRun>, source: ReviewSource): RuntimeAction {
  const action = run.actions.find((a) => a.id === source.actionId);
  const legacySteps: Record<NativeExtensionScope, string> = {
    candidate: 'verify.checks',
    parent: 'verify.checks',
    child: 'supervisor.child.checks',
    integration: 'supervisor.child.integration-checks',
  };
  const legacy =
    action?.executionOrigin &&
    ['1', '2', '3'].includes(action.executionOrigin.workflow.version) &&
    action.stepId === legacySteps[source.scope];
  if (
    !action ||
    action.status !== 'succeeded' ||
    action.inputHash !== source.inputHash ||
    action.outcome?.outcomeId !== source.outcomeId ||
    (!legacy &&
      EXTENSION_SOURCES[source.scope] !== action.stepId &&
      !(
        source.scope === 'integration' && action.stepId === 'supervisor.child.integration-repair'
      )) ||
    !currentNativeSdkSupervisorActions(run).some((a) => a.id === action.id)
  )
    throw new Error('扩展引用的业务候选或原结果已失效');
  if (!legacy && sourceFor(run, action).candidateId !== source.candidateId)
    throw new Error('扩展候选已经变化');
  return action;
}

function executionRoot(context: WorkflowApplicationFactoryContext, source: ReviewSource): string {
  const ref =
    source.scope === 'child'
      ? source.activation.worktree
      : source.scope === 'candidate'
        ? context.projectRoot
        : source.activation.integrationWorktree;
  if (typeof ref !== 'string') throw new Error('扩展缺少实际候选工作区');
  return path.resolve(ref);
}

export function createNativeWorkflowApplication(
  context: WorkflowApplicationFactoryContext,
  options: NativeApplicationOptions,
): WorkflowApplicationImplementation {
  if (context.manifest.base !== 'native') throw new Error('Native 应用必须声明 base: native');
  const base = defineNativeWorkflowApplication();
  const workflow = structuredClone(base.workflow);
  const transitions = workflow.transitions ?? [];
  workflow.transitions = transitions;
  const extensions = new Map<
    string,
    { scope: NativeExtensionScope; extension: NativeApplicationExtension }
  >();
  const chains = new Map<NativeExtensionScope, string[]>();
  const validators: RuntimeValidator[] = [...base.validators];
  for (const scope of Object.keys(EXTENSION_SOURCES) as NativeExtensionScope[])
    chains.set(scope, []);
  const ids = new Set<string>();
  for (const extension of options.extensions) {
    if (
      !/^[a-z][a-z\d]*(?:-[a-z\d]+)*$/u.test(extension.id) ||
      ids.has(extension.id) ||
      !extension.scopes.length ||
      new Set(extension.scopes).size !== extension.scopes.length ||
      !extension.artifactRefs.length
    )
      throw new Error('Native 扩展身份、范围或工件无效');
    ids.add(extension.id);
    const skill = context.skills.get(extension.skillId);
    if (
      !skill ||
      !['check', 'action'].includes(skill.adapter.kind) ||
      skill.adapter.controlsApproval ||
      skill.adapter.completion === 'self-report'
    )
      throw new Error('Native 扩展需要已审查的工作 Skill 和真实验证器');
    for (const scope of extension.scopes) {
      if (!chains.has(scope)) throw new Error('Native 扩展范围无效');
      const stepId = nativeExtensionStepId(scope, extension.id);
      extensions.set(stepId, { scope, extension });
      chains.get(scope)!.push(stepId);
      const validator: RuntimeValidator = {
        id: `native-extension-${scope}-${extension.id}`,
        version: extension.validator.version,
        async validate(input) {
          try {
            const source = reviewSource(input.action);
            sourceAction(input.run, source);
            if (source.scope !== scope) throw new Error('扩展回报范围不匹配');
            const state = parseNativePortableState(input.run.state);
            const paths = await nativeProjectPaths(
              context.projectRoot,
              (input.run.input as { artifactRootRef: string }).artifactRootRef,
            );
            const output = input.outcome.output as Record<string, RuntimeValue> | null;
            const bindingHash = hashRuntimeValue(source as unknown as RuntimeValue);
            let normalized = input.outcome;
            if (output && output.bindingHash !== bindingHash) {
              const receipt = JSON.parse(
                (
                  await readProtectedProjectFile(
                    paths.workspaceRuntimeRoot,
                    `transfers/native/${state.name}.json`,
                    Number.MAX_SAFE_INTEGER,
                    { label: 'Native 转移回执' },
                  )
                ).bytes.toString('utf8'),
              ) as {
                actionBindings?: Array<{
                  actionId: string;
                  attempt: number;
                  inputHash: string;
                  sourceBindingHash: string;
                  bindingHash: string;
                }>;
              };
              if (
                !receipt.actionBindings?.some(
                  (binding) =>
                    binding.actionId === input.action.id &&
                    binding.attempt === input.action.attempt &&
                    binding.inputHash === input.action.inputHash &&
                    binding.sourceBindingHash === output.bindingHash &&
                    binding.bindingHash === bindingHash,
                )
              )
                throw new Error('扩展回报不属于转移核对的原执行');
              normalized = { ...input.outcome, output: { ...output, bindingHash } };
            }
            if (
              !output ||
              typeof output.summary !== 'string' ||
              !output.summary.trim() ||
              !['pass', 'fail', 'revise-requirements'].includes(String(output.verdict)) ||
              (normalized.output as { bindingHash?: string }).bindingHash !== bindingHash
            )
              throw new Error('扩展回报缺少原候选绑定、结论或说明');
            if (input.outcome.status === 'failed') return { accepted: output.verdict === 'fail' };
            const root = executionRoot(context, source);
            const commit =
              source.scope === 'child'
                ? source.activation.candidateCommit
                : source.scope === 'candidate'
                  ? null
                  : source.activation.integrationCommit;
            const branch =
              source.scope === 'child'
                ? source.activation.branch
                : source.activation.integrationBranch;
            if (
              commit &&
              (typeof commit !== 'string' ||
                typeof branch !== 'string' ||
                inspectGitWorktree(root).currentBranch !== branch ||
                resolveGitRef(root, branch) !== commit)
            )
              throw new Error('扩展候选提交或分支已变化');
            return await extension.validator.validate({
              ...input,
              outcome: normalized,
              context: {
                ...input.context,
                projectRoot: root,
                requestId: input.context?.requestId ?? input.outcome.outcomeId,
              },
            });
          } catch (error) {
            return {
              accepted: false,
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        },
      };
      validators.push(validator);
      workflow.steps[stepId] = {
        type: 'invoke_skill',
        ref: extension.skillId,
        outputSchema: skill.adapter.outputSchema,
        requiredCapabilities: [...skill.adapter.requiredCapabilities],
        retry: skill.adapter.sideEffect === 'external' ? 'reconcile' : 'manual',
        validator: { id: validator.id, version: validator.version },
      };
      workflow.steps[`native.extension.revise.${scope}.${extension.id}`] = {
        type: 'ask_user',
        proposalFrom: stepId,
        choices: ['revise-requirements'],
      };
    }
  }
  for (const [scope, steps] of chains) {
    if (!steps.length) continue;
    const edges = transitions.filter(({ from }) => from === EXTENSION_SOURCES[scope]);
    transitions.push({ from: EXTENSION_SOURCES[scope], to: steps[0] });
    if (scope === 'integration')
      transitions.push({ from: 'supervisor.child.integration-repair', to: steps[0] });
    for (const [index, stepId] of steps.entries()) {
      if (steps[index + 1]) transitions.push({ from: stepId, to: steps[index + 1] });
      else transitions.push(...edges.map((edge) => ({ ...edge, from: stepId })));
      transitions.push(
        { from: stepId, to: 'build.builder' },
        { from: stepId, to: 'supervisor.parent.builder' },
        { from: stepId, to: 'supervisor.child.builder' },
        { from: stepId, to: 'supervisor.child.integration-repair' },
        {
          from: stepId,
          to: `native.extension.revise.${scope}.${extensions.get(stepId)!.extension.id}`,
        },
        { from: stepId, to: 'build.builder', on: 'failed' },
        { from: stepId, to: 'supervisor.parent.builder', on: 'failed' },
        { from: stepId, to: 'supervisor.child.builder', on: 'failed' },
        { from: stepId, to: 'supervisor.child.integration-repair', on: 'failed' },
      );
    }
  }
  const transitionKeys = new Set<string>();
  workflow.transitions = transitions.filter((edge) => {
    const key = `${edge.from}/${edge.to}/${edge.on ?? 'succeeded'}`;
    if (transitionKeys.has(key)) return false;
    transitionKeys.add(key);
    return true;
  });
  const transitionHandler: WorkflowTransitionHandler = {
    ...base.transitionHandler,
    apply(input: Parameters<typeof base.transitionHandler.apply>[0]) {
      const { run, event } = input;
      if (event.kind === 'action-outcome' && extensions.has(event.stepId)) {
        const action = run.actions.find(({ id }) => id === event.outcome.actionId)!;
        const source = reviewSource(action);
        const original = sourceAction(run, source);
        const output = event.outcome.output as { verdict: string; summary: string };
        if (output.verdict === 'revise-requirements') {
          return {
            state: run.state!,
            next: [
              {
                stepId: `native.extension.revise.${source.scope}.${extensions.get(event.stepId)!.extension.id}`,
                input: {
                  reason: output.summary,
                  expectedStateVersion: parseNativePortableState(run.state).state_version,
                },
              },
            ],
          };
        }
        if (event.outcome.status !== 'succeeded' || output.verdict !== 'pass') {
          if (source.scope === 'child')
            return {
              state: run.state!,
              next: [
                {
                  stepId: 'supervisor.child.builder',
                  input: {
                    ...source.activation,
                    failedExtensionActionId: action.id,
                  },
                },
              ],
            };
          if (source.scope === 'integration')
            return {
              state: run.state!,
              next: [
                {
                  stepId: 'supervisor.child.integration-repair',
                  input: {
                    ...source.activation,
                    failedCheckActionId: original.id,
                    failedExtensionActionId: action.id,
                  },
                },
              ],
            };
          const state = returnNativeCandidateToBuild({
            state: parseNativePortableState(run.state),
            reason: output.summary,
          });
          return {
            state: state as unknown as RuntimeValue,
            next:
              source.scope === 'parent'
                ? [
                    {
                      stepId: 'supervisor.parent.builder',
                      input: {
                        ...source.activation,
                        failedExtensionActionId: action.id,
                      },
                    },
                  ]
                : ['build.builder'],
          };
        }
        const chain = chains.get(source.scope)!;
        const next = chain[chain.indexOf(event.stepId) + 1];
        if (next)
          return {
            state: run.state!,
            next: [
              {
                stepId: next,
                input: {
                  ...activation(action),
                  artifactRefs: [...extensions.get(next)!.extension.artifactRefs],
                },
              },
            ],
          };
        if (source.resume) return { state: run.state!, next: source.resume };
        // 旧扩展只读取已接受的原检查结果作为历史来源，不加载原执行定义。
        const builderStep =
          source.scope === 'child'
            ? 'supervisor.child.builder'
            : source.scope === 'integration'
              ? 'supervisor.child.integrate'
              : undefined;
        if (builderStep) {
          const originalResult = run.actionContexts[original.id].results[builderStep];
          const builder = run.actions.find(
            (a) =>
              a.stepId === builderStep &&
              a.status === 'succeeded' &&
              run.actionContexts[a.id].sequence === originalResult?.sequence,
          );
          if (!builder) throw new Error('旧扩展缺少原已接受的业务来源');
          return base.transitionHandler.apply({
            run,
            event: { kind: 'action-outcome', stepId: builder.stepId, outcome: builder.outcome! },
          });
        }
        const state = parseNativePortableState(run.state);
        return {
          state: (state.loop.stage === 'verify-ready' &&
          state.loop.next_action !== 'await-verifier-result'
            ? reserveNativeVerifierAttempt(state)
            : state) as unknown as RuntimeValue,
          next: ['verify.verifier'],
        };
      }
      if (
        event.kind === 'action-outcome' &&
        event.outcome.status === 'succeeded' &&
        [...Object.values(EXTENSION_SOURCES), 'supervisor.child.integration-repair'].includes(
          event.stepId,
        )
      ) {
        const action = run.actions.find(({ id }) => id === event.outcome.actionId)!;
        const advanced = base.transitionHandler.apply(input);
        const source = {
          ...sourceFor(
            { ...run, state: advanced.state },
            { ...action, status: 'succeeded', outcome: event.outcome },
          ),
          resume: advanced.next,
        };
        const first = chains.get(source.scope)![0];
        if (first)
          return {
            state: advanced.state,
            next: [
              {
                stepId: first,
                input: {
                  reviewSource: source as unknown as RuntimeValue,
                  artifactRefs: [...extensions.get(first)!.extension.artifactRefs],
                  workspaceRoot: executionRoot(context, source),
                },
              },
            ],
          };
        return advanced;
      }
      if (
        event.kind === 'action-outcome' &&
        event.stepId === 'supervisor.child.verifier' &&
        event.outcome.status === 'succeeded' &&
        (event.outcome.output as { verdict?: string } | null)?.verdict === 'pass' &&
        (run.actions.some(
          (action) =>
            extensions.get(action.stepId)?.scope === 'integration' &&
            ['pending', 'running', 'unknown'].includes(action.status),
        ) ||
          run.waits.some(
            (wait) =>
              wait.status === 'pending' &&
              wait.stepId.startsWith('native.extension.revise.integration.'),
          ))
      )
        return { state: run.state!, next: [] };
      return base.transitionHandler.apply(input);
    },
  };
  const implementation: WorkflowApplicationImplementation = {
    workflows: [workflow],
    transitionHandlers: [transitionHandler],
    validators,
    stateValidators: base.stateValidators,
    commandValidators: base.commandValidators,
    validateRecovery: base.validateRecovery,
    executors: [...base.executors, ...(options.executors ?? [])],
    wrapStore(store, identity, storeOptions) {
      const projected = createNativeSdkStateStore(context.projectRoot, {
        store: {
          ...store,
          async read(id) {
            const run = await store.read(id);
            return run ? upgradeNativeRun(run, workflow, transitionHandler) : null;
          },
        },
        identity,
        readOnly: storeOptions?.readOnly,
      });
      return {
        read: (id) => projected.read(id),
        async compareAndSwap(id, revision, run) {
          const previous = await projected.read(id);
          for (const action of run.actions.filter(
            (action) =>
              action.status === 'running' &&
              !previous?.actions.some(
                (old) =>
                  old.id === action.id &&
                  old.status === 'running' &&
                  old.claim?.token === action.claim?.token,
              ),
          )) {
            const result = await implementation.validateOutcome!({
              run,
              action,
              outcome: {
                actionId: action.id,
                attempt: action.attempt,
                inputHash: action.inputHash,
                claimToken: action.claim!.token,
                outcomeId: `${action.id}-preflight`,
                status: 'succeeded',
                output: null,
              },
            });
            if (!result.accepted)
              throw new Error(result.reason ?? '扩展证据已失效，不能开始后续工作');
          }
          const state = parseNativePortableState(run.state);
          if (state.name !== id || (run.input as { name: unknown }).name !== id)
            throw new Error('Native Run 和应用 change 名称不一致');
          const owner = await readChangeRuntimeOwner(context.projectRoot, 'native', id);
          if (owner && (owner.format !== 'sdk' || owner.application !== identity.id))
            throw new Error('Native change 已归属另一个应用');
          await registerSdkChangeOwner(context.projectRoot, {
            schema: COMET_CHANGE_OWNER_SCHEMA,
            workflow: 'native',
            change: id,
            format: 'sdk',
            application: identity.id,
            runId: id,
          });
          return projected.compareAndSwap(id, revision, run);
        },
      };
    },
    inspectHook(run, request) {
      return inspectNativeHookGuard(context.projectRoot, request, run.runId);
    },
    async validateOutcome(input) {
      // 后续工作继承精确的检查 Action；历史中同 stepId 的其它 Child 不能代替它。
      if (extensions.has(input.action.stepId)) return { accepted: true };
      if (input.outcome.status === 'failed') return { accepted: true };
      // Archive 写入后由原事务验证器核对结果；候选扩展在领取前已重新核对。
      if (
        ['archive.execute', 'supervisor.child.archive'].includes(input.action.stepId) &&
        input.outcome.output !== null
      )
        return { accepted: true };
      if (
        ![
          'verify.verifier',
          'supervisor.child.verifier',
          'supervisor.child.archive',
          'supervisor.parent.deliver',
          'archive.prepare',
          'archive.execute',
        ].includes(input.action.stepId)
      )
        return { accepted: true };
      const state = parseNativePortableState(input.run.state);
      const integrating = input.action.stepId === 'supervisor.child.archive';
      const checkId = integrating
        ? (activation(input.action).repairActionId ??
          activation(input.action).mergeActionId ??
          activation(input.action).checksActionId)
        : activation(input.action).checkActionId;
      const candidateId =
        (integrating
          ? activation(input.action).integrationCommit
          : activation(input.action).candidateCommit) ?? state.builder_handoff?.candidate_id;
      const current = input.run.actions.filter(
        (action) =>
          extensions.has(action.stepId) &&
          (checkId
            ? reviewSource(action).actionId === checkId
            : reviewSource(action).candidateId === candidateId),
      );
      const scope: NativeExtensionScope = integrating
        ? 'integration'
        : input.action.stepId.startsWith('supervisor.child.')
          ? 'child'
          : state.children_contract_ref
            ? 'parent'
            : 'candidate';
      for (const stepId of chains.get(scope)!) {
        const checked = current.find(
          (action) =>
            action.stepId === stepId &&
            action.status === 'succeeded' &&
            (action.outcome?.output as { verdict?: string }).verdict === 'pass',
        );
        if (!checked?.outcome) return { accepted: false, reason: '当前候选的必需扩展尚未通过' };
        const validator = validators.find(
          (entry) => entry.id === workflow.steps[stepId].validator?.id,
        )!;
        const result = await validator.validate({
          ...input,
          action: checked,
          outcome: checked.outcome,
        });
        if (!result.accepted) return result;
      }
      return { accepted: true };
    },
  };
  return implementation;
}
