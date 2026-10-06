import path from 'node:path';
import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeValidator,
  type RuntimeCommandValidator,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowTransitionEvent,
} from '../engine/runtime.js';
import type {
  WorkflowApplicationFactoryContext,
  WorkflowApplicationImplementation,
} from '../workflow-application/index.js';
import {
  hashProtectedProjectFile,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  readChangeRuntimeOwner,
  registerSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { defineClassicWorkflowApplication } from './classic-sdk-application.js';
import { validateClassicSdkDesignContext } from './classic-handoff.js';
import { applyClassicTransition } from './classic-transitions.js';
import { classicSdkRunMatchesProfile } from './classic-sdk-profile.js';
import { createClassicSdkStateStore } from './classic-sdk-state-store.js';
import {
  createClassicSdkCheckExecutor,
  assertClassicSdkCheckCommandBinding,
} from './classic-sdk-check.js';
import { createClassicSdkArchivePreflightExecutor } from './classic-sdk-archive-preflight.js';
import { createClassicSdkArchiveExecutor } from './classic-sdk-archive.js';
import { type ClassicProfile, type ClassicState } from './classic-state.js';

export { parseClassicStateDocument } from './classic-state.js';

export interface ClassicApplicationReplacement {
  stepId: string;
  skillId: string;
}

/** 只在原领域证据通过之后追加工作，不移动工件、批准或验收步骤。 */
export interface ClassicApplicationExtension {
  id: string;
  afterStep: string;
  skillId: string;
  artifactRefs: readonly string[];
  validator: RuntimeValidator;
}

export interface ClassicApplicationOptions {
  profile: ClassicProfile;
  replacements?: readonly ClassicApplicationReplacement[];
  extensions?: readonly ClassicApplicationExtension[];
  /** 同一检查点内可调整顺序；跨领域检查点移动会被拒绝。 */
  order?: readonly string[];
  executors?: WorkflowApplicationImplementation['executors'];
}

interface ExtensionSource {
  event: WorkflowTransitionEvent;
  sequence: number;
  checkEpoch: number;
}

export function classicExtensionStepId(id: string): string {
  return `classic.extension.${id}`;
}

function activation(action: Readonly<RuntimeAction>): { source: ExtensionSource } {
  return (action.input as unknown as { activation: { source: ExtensionSource } }).activation;
}

function sourceCurrent(run: Readonly<WorkflowRun>, source: ExtensionSource): boolean {
  const event = source.event;
  if (event.kind === 'action-outcome')
    return run.actions.some(
      (action) =>
        action.id === event.outcome.actionId &&
        action.status === 'succeeded' &&
        hashRuntimeValue({
          ...action.outcome,
          claimToken: 'source-reference',
        } as unknown as RuntimeValue) ===
          hashRuntimeValue(event.outcome as unknown as RuntimeValue),
    );
  if (event.kind === 'evidence-recorded')
    return Boolean(
      run.evidenceWaits?.some(
        (wait) =>
          wait.stepId === event.stepId &&
          wait.sequence === source.sequence &&
          wait.status === 'resolved' &&
          wait.receipt?.submissionId === event.submissionId &&
          wait.receipt.contentHash === event.contentHash &&
          wait.receipt.ref === event.ref,
      ),
    );
  return false;
}

/** 组合 Classic 的执行绑定和新增检查，所有推进仍委托原 Classic 领域。 */
export function createClassicApplication(
  context: WorkflowApplicationFactoryContext,
  options: ClassicApplicationOptions,
): WorkflowApplicationImplementation {
  if (context.manifest.base !== `classic-${options.profile}`)
    throw new Error('Classic 组合应用与所选 profile 不一致');
  const base = defineClassicWorkflowApplication(options.profile);
  const workflow = structuredClone(base.workflow);
  const commandValidator: RuntimeCommandValidator = {
    id: 'comet-classic-composition-command',
    version: '1',
    validate({ run, input }) {
      const state = run.state as unknown as ClassicState;
      const reason = (input as { reason?: unknown } | null)?.reason;
      return {
        accepted:
          !state.archived &&
          !['completed', 'cancelled'].includes(run.status) &&
          typeof reason === 'string' &&
          reason.trim().length > 0,
        reason: '请说明修复或需求修订原因；已归档的 Classic 不能重新推进',
      };
    },
  };
  workflow.commands = {
    ...(workflow.commands ?? {}),
    'repair-composition': {
      stepId: 'classic.composition.repair',
      validator: { id: commandValidator.id, version: commandValidator.version },
    },
    'revise-requirements': {
      stepId: 'classic.composition.revise',
      validator: { id: commandValidator.id, version: commandValidator.version },
    },
  };
  for (const name of ['repair', 'revise'])
    workflow.steps[`classic.composition.${name}`] = {
      type: 'call_tool',
      ref: `classic-composition-${name}`,
    };
  const workApproval = context.manifest.bindings.some(
    (binding) => binding.authorizationFrom === 'classic.composition.confirm',
  );
  const workProposal = {
    application: context.manifest.id,
    profile: options.profile,
    work: context.manifest.bindings
      .filter((binding) => binding.usage === 'action')
      .map((binding) => ({
        stepId: binding.stepId,
        skillId: binding.skillId,
        scope: [...context.skills.get(binding.skillId)!.adapter.scope],
      })),
  };
  if (workApproval) {
    workflow.steps['classic.composition.prepare'] = {
      type: 'call_tool',
      ref: 'classic-composition-prepare',
      validator: { id: 'comet-classic-composition-proposal', version: '1' },
    };
    workflow.steps['classic.composition.confirm'] = {
      type: 'ask_user',
      choices: ['approved', 'rejected'],
      proposalFrom: ['classic.composition.prepare'],
    };
    workflow.entry = 'classic.composition.prepare';
    workflow.transitions = [
      ...(workflow.transitions ?? []),
      { from: 'classic.composition.prepare', to: 'classic.composition.confirm' },
      { from: 'classic.composition.confirm', to: `${options.profile}.open`, on: 'approved' },
      { from: 'classic.composition.confirm', to: 'classic.composition.confirm', on: 'rejected' },
    ];
  }
  const extensions = new Map<string, ClassicApplicationExtension>();
  const chains = new Map<string, string[]>();
  const checkpoints = new Set([
    `${options.profile}.open.evidence`,
    'full.open.revalidate',
    'full.design.evidence',
    'full.build.plan.evidence',
    `${options.profile}.build.check.evidence`,
    `${options.profile}.verify.check.evidence`,
    ...(options.profile === 'full'
      ? []
      : ['full.build.check.evidence', 'full.verify.check.evidence']),
  ]);
  const seen = new Set<string>();
  for (const replacement of options.replacements ?? []) {
    const step = workflow.steps[replacement.stepId];
    if (seen.has(replacement.stepId) || step?.type !== 'invoke_skill')
      throw new Error(
        `Classic 只能替换唯一的执行 Skill：${replacement.stepId}；领域检查和批准不可替换`,
      );
    seen.add(replacement.stepId);
    step.ref = replacement.skillId;
  }
  for (const extension of options.extensions ?? []) {
    if (
      !/^[a-z][a-z\d]*(?:-[a-z\d]+)*$/u.test(extension.id) ||
      extensions.has(classicExtensionStepId(extension.id)) ||
      !checkpoints.has(extension.afterStep) ||
      !workflow.steps[extension.afterStep] ||
      !extension.artifactRefs.length ||
      new Set(extension.artifactRefs).size !== extension.artifactRefs.length ||
      extension.artifactRefs.some(
        (ref) => !ref || path.isAbsolute(ref) || ref.split(/[\\/]/u).includes('..'),
      )
    )
      throw new Error(
        `Classic 新增步骤的身份、工件或检查点无效：${extension.id}；不能移动必要工件或批准`,
      );
    const stepId = classicExtensionStepId(extension.id);
    extensions.set(stepId, extension);
    const targets = [extension.afterStep];
    if (
      options.profile !== 'full' &&
      [
        `${options.profile}.build.check.evidence`,
        `${options.profile}.verify.check.evidence`,
      ].includes(extension.afterStep)
    )
      targets.push(extension.afterStep.replace(`${options.profile}.`, 'full.'));
    for (const checkpoint of targets) {
      const chain = chains.get(checkpoint) ?? [];
      chain.push(stepId);
      chains.set(checkpoint, chain);
    }
  }
  if (options.order) {
    const ids = (options.extensions ?? []).map((extension) => extension.id);
    if (
      options.order.length !== ids.length ||
      new Set(options.order).size !== ids.length ||
      options.order.some((id) => !ids.includes(id))
    )
      throw new Error('Classic 顺序必须完整列出新增步骤；不能重排领域步骤');
    const original = (options.extensions ?? []).map((extension) => extension.afterStep);
    const ordered = options.order.map(
      (id) => (options.extensions ?? []).find((entry) => entry.id === id)!.afterStep,
    );
    if (hashRuntimeValue(original) !== hashRuntimeValue(ordered))
      throw new Error('Classic 新增步骤只能在同一领域检查点内调整顺序');
    for (const [checkpoint, chain] of chains)
      chains.set(
        checkpoint,
        [...chain].sort(
          (a, b) =>
            options.order!.indexOf(extensions.get(a)!.id) -
            options.order!.indexOf(extensions.get(b)!.id),
        ),
      );
  }
  const validators = [...base.validators];
  if (workApproval)
    validators.push({
      id: 'comet-classic-composition-proposal',
      version: '1',
      validate: ({ action, outcome }) => ({
        accepted:
          action.claim?.executorId === 'comet-classic-composition-prepare' &&
          hashRuntimeValue(outcome.output) === hashRuntimeValue(workProposal),
      }),
    });
  for (const [stepId, extension] of extensions) {
    const validator: RuntimeValidator = {
      id: `comet-${stepId}-result`,
      version: '1',
      async validate(input) {
        if (input.outcome.status === 'failed') return { accepted: true };
        const source = activation(input.action)?.source;
        const output = input.outcome.output as {
          verdict?: string;
          sourceHash?: string;
          artifactHashes?: Record<string, string>;
        } | null;
        if (
          !source ||
          !output ||
          !['pass', 'repair', 'revise-requirements'].includes(output.verdict ?? '') ||
          output.sourceHash !== hashRuntimeValue(source as unknown as RuntimeValue)
        )
          return {
            accepted: false,
            reason: 'Classic 新增结果未绑定当前来源；请修复或重跑原领域工作',
          };
        if (output.verdict !== 'pass') return { accepted: true };
        if (!sourceCurrent(input.run, source))
          return { accepted: false, reason: 'Classic 检查来源已失效；请修复或重跑原领域工作' };
        if (
          source.checkEpoch === ((input.run.state as unknown as ClassicState).checkEpoch ?? 0) &&
          source.event.kind === 'evidence-recorded'
        ) {
          const step = base.workflow.steps[source.event.stepId];
          const original = base.evidenceValidators.find(
            (validator) => validator.id === step.validator?.id,
          );
          if (original) {
            const checked = await original.validate({
              run: input.run,
              kind: source.event.evidenceKind,
              ref: source.event.ref,
              contentHash: source.event.contentHash,
              context: { requestId: 'classic-extension-source', projectRoot: context.projectRoot },
            });
            if (!checked.accepted) return checked;
          }
        }
        if (
          source.event.kind === 'action-outcome' &&
          source.checkEpoch === ((input.run.state as unknown as ClassicState).checkEpoch ?? 0)
        ) {
          const step = base.workflow.steps[source.event.stepId];
          const validator = base.validators.find((entry) => entry.id === step.validator?.id);
          const original = input.run.actions.find(
            (entry) =>
              entry.id === (source.event as { outcome: { actionId: string } }).outcome.actionId,
          );
          if (validator && original?.outcome) {
            const checked = await validator.validate({
              run: input.run,
              action: original,
              outcome: original.outcome,
              context: { requestId: 'classic-extension-source', projectRoot: context.projectRoot },
            });
            if (!checked.accepted) return checked;
          }
        }
        for (const ref of extension.artifactRefs) {
          try {
            const current = await hashProtectedProjectFile(context.projectRoot, ref, {
              label: 'Classic 新增检查工件',
            });
            if (output.artifactHashes?.[ref] !== current.digest)
              return { accepted: false, reason: `Classic 检查工件已变化：${ref}；请重新检查` };
          } catch (error) {
            return {
              accepted: false,
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        }
        return extension.validator.validate(input);
      },
    };
    validators.push(validator);
    workflow.steps[stepId] = {
      type: 'invoke_skill',
      ref: extension.skillId,
      validator: { id: validator.id, version: validator.version },
      retry: 'reconcile',
    };
  }
  // 替换只改变执行绑定：固定适配契约与原 validator、outputSchema 均保留。
  for (const [stepId, step] of Object.entries(workflow.steps)) {
    if (step.type !== 'invoke_skill') continue;
    const bindings = context.manifest.bindings.filter(
      (binding) =>
        binding.workflowId === workflow.id &&
        binding.stepId === stepId &&
        binding.usage === 'action',
    );
    const skill = bindings.length === 1 ? context.skills.get(bindings[0].skillId) : undefined;
    if (
      !skill ||
      skill.id !== step.ref ||
      skill.adapter.kind !== 'action' ||
      skill.adapter.controlsApproval ||
      skill.adapter.interaction !== 'none'
    )
      throw new Error(`Classic Skill 绑定不满足原工作契约：${stepId}；批准由原流程处理`);
    if (
      step.outputSchema !== undefined &&
      hashRuntimeValue(step.outputSchema) !== hashRuntimeValue(skill.adapter.outputSchema)
    )
      throw new Error(`Classic Skill 输出不符合原工作契约：${stepId}`);
    step.outputSchema ??= skill.adapter.outputSchema;
    step.requiredCapabilities = [
      ...new Set([...(step.requiredCapabilities ?? []), ...skill.adapter.requiredCapabilities]),
    ];
    if (skill.adapter.sideEffect === 'external') step.retry = 'reconcile';
  }
  const repairTarget = (checkpoint: string) =>
    checkpoint.includes('.verify.') || checkpoint.includes('.build.check.')
      ? `${checkpoint.split('.')[0]}.build.${checkpoint.startsWith('full.') ? 'plan' : 'execute'}`
      : checkpoint.includes('.build.plan.')
        ? 'full.build.plan'
        : checkpoint.includes('.design.')
          ? 'full.design.handoff'
          : `${options.profile}.open`;
  const transitions = [...(workflow.transitions ?? [])];
  if (options.profile !== 'full')
    transitions.push({ from: `${options.profile}.open.evidence`, to: 'full.design.handoff' });
  for (const from of ['classic.composition.repair', 'classic.composition.revise'])
    for (const to of [
      workApproval ? 'classic.composition.prepare' : `${options.profile}.open`,
      `${options.profile}.open`,
      `${options.profile}.build.${options.profile === 'full' ? 'plan' : 'execute'}`,
      'full.build.plan',
    ])
      transitions.push({ from, to });
  for (const [checkpoint, chain] of chains) {
    transitions.push({ from: checkpoint, to: chain[0] });
    const edges = transitions.filter((edge) => edge.from === checkpoint && edge.to !== chain[0]);
    chain.forEach((stepId, index) => {
      if (chain[index + 1]) transitions.push({ from: stepId, to: chain[index + 1] });
      else transitions.push(...edges.map((edge) => ({ ...edge, from: stepId })));
      for (const on of [undefined, 'failed'])
        for (const to of [
          repairTarget(checkpoint),
          workApproval ? 'classic.composition.prepare' : `${options.profile}.open`,
        ])
          transitions.push({ from: stepId, to, ...(on ? { on } : {}) });
    });
  }
  workflow.transitions = transitions.filter(
    (edge, index, all) =>
      all.findIndex(
        (other) =>
          hashRuntimeValue(other as unknown as RuntimeValue) ===
          hashRuntimeValue(edge as unknown as RuntimeValue),
      ) === index,
  );
  const resumeDomain = (run: Readonly<WorkflowRun>, event: WorkflowTransitionEvent) => {
    const state = run.state as unknown as ClassicState;
    if (
      options.profile !== 'full' &&
      state.workflow === 'full' &&
      event.kind === 'evidence-recorded' &&
      event.stepId === `${options.profile}.open.evidence`
    )
      return {
        state: applyClassicTransition(state, 'open-complete').classic as unknown as RuntimeValue,
        next: ['full.design.handoff'],
      };
    return base.transitionHandler.apply({ run, event });
  };
  const transitionHandler = {
    ...base.transitionHandler,
    apply(input: Parameters<typeof base.transitionHandler.apply>[0]) {
      const { run, event } = input;
      if (
        event.kind === 'action-outcome' &&
        ['classic.composition.repair', 'classic.composition.revise'].includes(event.stepId)
      ) {
        const state = run.state as unknown as ClassicState;
        const revise = event.stepId === 'classic.composition.revise';
        const target = revise
          ? workApproval
            ? 'classic.composition.prepare'
            : `${options.profile}.open`
          : ['build', 'verify', 'archive'].includes(state.phase)
            ? `${state.workflow}.build.${state.workflow === 'full' ? 'plan' : 'execute'}`
            : `${options.profile}.open`;
        return {
          state: {
            ...state,
            phase: revise ? 'open' : target.split('.')[1],
            checkEpoch: (state.checkEpoch ?? 0) + 1,
            verifyResult: 'pending',
            verifiedAt: null,
            archiveConfirmation: null,
            ...(revise
              ? {
                  designDoc: null,
                  plan: null,
                  handoffContext: null,
                  handoffHash: null,
                  verificationReport: null,
                }
              : {}),
          } as unknown as RuntimeValue,
          next: [target],
        };
      }
      if (event.kind === 'action-outcome' && event.stepId === 'classic.composition.prepare')
        return { state: run.state!, next: ['classic.composition.confirm'] };
      if (event.kind === 'wait-resolved' && event.stepId === 'classic.composition.confirm')
        return {
          state: run.state!,
          next: [
            event.choice === 'approved' ? `${options.profile}.open` : 'classic.composition.confirm',
          ],
        };
      if (event.kind === 'action-outcome' && extensions.has(event.stepId)) {
        const action = run.actions.find((entry) => entry.id === event.outcome.actionId)!;
        const source = activation(action).source;
        const verdict = (event.outcome.output as { verdict?: string } | null)?.verdict;
        if (event.outcome.status !== 'succeeded' || verdict !== 'pass') {
          const state = run.state as unknown as ClassicState;
          const revise = verdict === 'revise-requirements';
          const target = revise
            ? workApproval
              ? 'classic.composition.prepare'
              : `${options.profile}.open`
            : repairTarget(source.event.stepId);
          return {
            state: {
              ...state,
              phase: revise ? 'open' : target.split('.')[1],
              checkEpoch: (state.checkEpoch ?? 0) + 1,
              verifyResult: 'pending',
              verifiedAt: null,
              archiveConfirmation: null,
              ...(revise
                ? {
                    designDoc: null,
                    plan: null,
                    handoffContext: null,
                    handoffHash: null,
                    verificationReport: null,
                  }
                : {}),
            } as unknown as RuntimeValue,
            next: [target],
          };
        }
        const chain = chains.get(source.event.stepId)!;
        const next = chain[chain.indexOf(event.stepId) + 1];
        if (next)
          return {
            state: run.state!,
            next: [{ stepId: next, input: { source: source as unknown as RuntimeValue } }],
          };
        return resumeDomain(run, source.event);
      }
      const first = chains.get(event.stepId)?.[0];
      if (
        first &&
        (event.kind === 'evidence-recorded' ||
          (event.kind === 'action-outcome' && event.outcome.status === 'succeeded'))
      ) {
        const sequence =
          event.kind === 'action-outcome'
            ? run.actionContexts[event.outcome.actionId].sequence
            : run.evidenceWaits!.find((wait) => wait.receipt?.submissionId === event.submissionId)!
                .sequence;
        const source: ExtensionSource = {
          event:
            event.kind === 'action-outcome'
              ? { ...event, outcome: { ...event.outcome, claimToken: 'source-reference' } }
              : event,
          sequence,
          checkEpoch: (run.state as unknown as ClassicState).checkEpoch ?? 0,
        };
        return {
          state: run.state!,
          next: [{ stepId: first, input: { source: source as unknown as RuntimeValue } }],
        };
      }
      return resumeDomain(run, event);
    },
  };
  const implementation: WorkflowApplicationImplementation = {
    workflows: [workflow],
    transitionHandlers: [transitionHandler],
    validators,
    evidenceValidators: base.evidenceValidators,
    commandValidators: [commandValidator],
    executors: [
      ...base.executors,
      createClassicSdkCheckExecutor(context.projectRoot),
      createClassicSdkArchivePreflightExecutor(context.projectRoot),
      createClassicSdkArchiveExecutor(context.projectRoot),
      {
        id: 'comet-classic-composition-recovery',
        capabilities: [],
        supports: (action) =>
          ['classic-composition-repair', 'classic-composition-revise'].includes(action.ref ?? ''),
        async execute() {
          return { status: 'succeeded', output: { recovered: true } };
        },
      },
      ...(workApproval
        ? [
            {
              id: 'comet-classic-composition-prepare',
              capabilities: [],
              supports: (action: Readonly<RuntimeAction>) =>
                action.ref === 'classic-composition-prepare',
              async execute() {
                return { status: 'succeeded' as const, output: workProposal };
              },
            },
          ]
        : []),
      ...(options.executors ?? []),
    ],
    async validateOutcome(input) {
      if (input.outcome.status === 'failed') return { accepted: true };
      if (input.action.ref === 'classic-check' && input.outcome.output !== null) {
        try {
          await assertClassicSdkCheckCommandBinding(
            input.run,
            input.action,
            context.projectRoot,
            input.outcome.output as Record<string, unknown>,
          );
        } catch (error) {
          return {
            accepted: false,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }
      if (
        ['classic.composition.repair', 'classic.composition.revise'].includes(input.action.stepId)
      )
        return { accepted: true };
      if (
        extensions.has(input.action.stepId) &&
        ['repair', 'revise-requirements'].includes(
          String((input.outcome.output as { verdict?: unknown } | null)?.verdict),
        )
      )
        return { accepted: true };
      const state = input.run.state as unknown as ClassicState;
      if (
        state.workflow === 'full' &&
        ['build', 'verify', 'archive'].includes(state.phase) &&
        !state.archived &&
        !(input.action.stepId.endsWith('.archive.execute') && input.outcome.output !== null)
      ) {
        try {
          const change = input.run.input as { change: string; changeDir: string };
          if (
            !state.handoffContext ||
            !state.handoffHash ||
            !(await validateClassicSdkDesignContext({
              projectRoot: context.projectRoot,
              changeDir: path.join(context.projectRoot, change.changeDir),
              change: change.change,
              contextCompression: state.contextCompression,
              handoffContext: state.handoffContext,
              handoffHash: state.handoffHash,
            }))
          )
            return {
              accepted: false,
              reason: 'Classic 设计来源已变化；请使用 revise-requirements 重新确认需求',
            };
        } catch (error) {
          return {
            accepted: false,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }
      const results = input.run.actionContexts[input.action.id]?.results ?? {};
      for (const [stepId, result] of Object.entries(results)) {
        if (!extensions.has(stepId)) continue;
        const superseded = Object.entries(results).some(([id, entry]) => {
          if (entry.sequence < result.sequence) return false;
          if (extensions.has(id)) {
            const work = input.run.actions.find(
              (action) =>
                action.stepId === id &&
                input.run.actionContexts[action.id]?.sequence === entry.sequence,
            );
            return (
              work?.status === 'failed' ||
              (entry.value as { verdict?: string } | null)?.verdict === 'repair' ||
              (entry.value as { verdict?: string } | null)?.verdict === 'revise-requirements'
            );
          }
          if (entry.sequence === result.sequence) return false;
          const checkpoint = extensions.get(stepId)!.afterStep;
          return (
            id.endsWith('.open') ||
            ((checkpoint.includes('.build.check.') || checkpoint.includes('.verify.check.')) &&
              (id.endsWith('.build.plan') || id.endsWith('.build.execute')))
          );
        });
        if (superseded) continue;
        const checked = input.run.actions.find(
          (action) =>
            action.stepId === stepId &&
            input.run.actionContexts[action.id]?.sequence === result.sequence,
        );
        if (
          !checked?.outcome ||
          (checked.outcome.output as { verdict?: string })?.verdict !== 'pass'
        )
          return { accepted: false, reason: 'Classic 必需新增检查尚未通过' };
        const validator = validators.find(
          (entry) => entry.id === workflow.steps[stepId].validator!.id,
        )!;
        const checkedResult = await validator.validate({
          ...input,
          action: checked,
          outcome: checked.outcome,
        });
        if (!checkedResult.accepted) return checkedResult;
      }
      return { accepted: true };
    },
    wrapStore(store, identity) {
      const projected = createClassicSdkStateStore(context.projectRoot, { store, identity });
      return {
        read: (id) => projected.read(id),
        async compareAndSwap(id, revision, run) {
          if (!classicSdkRunMatchesProfile(run, (run.state as unknown as ClassicState).workflow))
            throw new Error('Classic Run 的 profile 缺少原升级批准');
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
            const checked = await implementation.validateOutcome!({
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
            if (!checked.accepted) throw new Error(checked.reason ?? 'Classic 新增检查失效');
          }
          const owner = await readChangeRuntimeOwner(context.projectRoot, 'classic', id);
          if (owner && (owner.format !== 'sdk' || owner.application !== identity.id))
            throw new Error('Classic change 已归属另一个应用');
          await registerSdkChangeOwner(context.projectRoot, {
            schema: COMET_CHANGE_OWNER_SCHEMA,
            workflow: 'classic',
            change: id,
            format: 'sdk',
            application: identity.id,
            runId: id,
          });
          return projected.compareAndSwap(id, revision, run);
        },
      };
    },
    async inspectHook(run, request) {
      if (request.intent === 'context' || request.intent === 'non-write')
        return { allowed: true, reason: 'Classic 应用上下文可读取' };
      const claimed = run.actions.filter(
        (action) =>
          action.status === 'running' &&
          (!request.sessionId || action.claim?.sessionId === request.sessionId),
      );
      const scopes = claimed.flatMap((action) =>
        context.manifest.bindings
          .filter(
            (binding) =>
              binding.workflowId === run.workflow.id &&
              binding.stepId === action.stepId &&
              binding.usage === 'action',
          )
          .flatMap((binding) => {
            const skill = context.skills.get(binding.skillId)!;
            return skill.adapter.sideEffect === 'write' ? skill.adapter.scope : [];
          }),
      );
      for (const target of request.targets) {
        const ref = path
          .relative(context.projectRoot, path.resolve(context.projectRoot, target))
          .replaceAll('\\', '/');
        if (
          ref.startsWith('.comet/') ||
          ref.split('/').includes('.comet') ||
          ref.endsWith('/.comet.yaml')
        )
          return { allowed: false, reason: 'Classic Run、检查记录和状态投影由 Runtime 管理' };
        try {
          await inspectProtectedProjectPath(context.projectRoot, ref, {
            label: 'Classic 应用 Hook 目标',
            expected: 'file',
          });
        } catch (error) {
          return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
        }
      }
      const allowed =
        request.intent === 'write' &&
        request.targets.length > 0 &&
        request.targets.every((target) =>
          scopes.some((scope) => {
            const relative = path.relative(
              path.resolve(context.projectRoot, scope),
              path.resolve(context.projectRoot, target),
            );
            return (
              !path.isAbsolute(relative) &&
              relative !== '..' &&
              !relative.startsWith('..' + path.sep)
            );
          }),
        );
      return {
        allowed,
        reason: allowed
          ? '写入属于已领取的 Classic Skill 范围'
          : '先领取当前 Classic Action，再在其授权范围内写入',
      };
    },
  };
  implementation.validateRecovery = implementation.validateOutcome;
  return implementation;
}
