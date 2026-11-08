import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeCommandValidator,
  type RuntimeValidator,
  type WorkflowRun,
  type RuntimeValue,
} from '../engine/runtime.js';
import type { ClassicWorkflowApplication } from './classic-sdk-application.js';
import type { ClassicState } from './classic-state.js';
import { assertClassicSdkCheckReceipt } from './classic-sdk-check-record.js';
import path from 'node:path';

export interface ClassicCheckPreparation {
  scope: 'build' | 'verify';
  sourceActionId: string;
  command: {
    argv: string[];
    cwd: string;
    timeoutMs: number;
    reusable: boolean;
    reportRef?: string;
  };
}

/** 只有 Run 中已接受命令绑定的 activation 才能改变首次检查的续行路径。 */
export function classicSdkCheckPreparationInput(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): ClassicCheckPreparation | null {
  const activation = (action.input as { activation?: unknown }).activation;
  const command = run.commands?.find(
    (entry) =>
      entry.actionId === action.id &&
      ['prepare-build-check', 'prepare-verify-check'].includes(entry.name),
  );
  if (!command) return null;
  if (command.inputHash !== hashRuntimeValue(activation as RuntimeValue))
    throw new Error('Classic prepared check input changed');
  return activation as ClassicCheckPreparation;
}

export function withClassicCheckPreparation<
  T extends ClassicWorkflowApplication & { commandValidators?: readonly RuntimeCommandValidator[] },
>(base: T, profile: string) {
  const validator: RuntimeCommandValidator = {
    id: 'comet-classic-prepare-check',
    version: '1',
    validate({ run, name, input }) {
      const request = input as unknown as ClassicCheckPreparation;
      const state = run.state as unknown as ClassicState;
      const source = run.actions.find((entry) => entry.id === request?.sourceActionId);
      const scope = request?.scope;
      return {
        accepted:
          run.status === 'running' &&
          !state.archived &&
          (scope === 'build' || scope === 'verify') &&
          state.phase === scope &&
          state.workflow === profile &&
          name === `prepare-${scope}-check` &&
          source?.status === 'pending' &&
          source.type === 'invoke_skill' &&
          source.stepId === `${profile}.${scope === 'build' ? 'build.execute' : 'verify.run'}` &&
          !run.waits.some((wait) => wait.status === 'pending') &&
          !run.evidenceWaits?.some((wait) => wait.status === 'pending') &&
          Array.isArray(request.command?.argv) &&
          request.command.argv.length > 0 &&
          request.command.argv.every((arg) => typeof arg === 'string' && !arg.includes('\0')) &&
          typeof request.command.cwd === 'string' &&
          Number.isSafeInteger(request.command.timeoutMs) &&
          request.command.timeoutMs > 0 &&
          (request.command.reportRef === undefined ||
            (scope === 'verify' &&
              typeof request.command.reportRef === 'string' &&
              request.command.reportRef.length > 0)) &&
          (scope !== 'verify' || typeof request.command.reportRef === 'string') &&
          typeof request.command.reusable === 'boolean',
        reason: '首次检查必须属于当前未领取的实施或验收任务；保留原批准和执行身份。',
      };
    },
  };
  const outcome: RuntimeValidator = {
    id: 'comet-classic-prepared-check-outcome',
    version: '1',
    async validate({ run, action, outcome, context }) {
      const request = classicSdkCheckPreparationInput(run, action);
      if (!request) return { accepted: true };
      if (!context?.projectRoot || action.claim?.executorId !== 'comet-classic-check')
        return { accepted: false, reason: '首次检查需要真实 Runtime 执行回执' };
      const output = outcome.output as Record<string, RuntimeValue> | null;
      const cwd =
        path
          .relative(context.projectRoot, path.resolve(context.projectRoot, request.command.cwd))
          .replaceAll('\\', '/') || '.';
      if (
        !output ||
        hashRuntimeValue(output.argv ?? null) !== hashRuntimeValue(request.command.argv) ||
        output.cwd !== cwd ||
        output.timeoutMs !== request.command.timeoutMs ||
        output.reusable !== request.command.reusable ||
        output.scope !== request.scope
      )
        return { accepted: false, reason: '首次检查回执与原检查计划不一致' };
      await assertClassicSdkCheckReceipt(context.projectRoot, run, action, {
        status: outcome.status,
        output: outcome.output,
      });
      return { accepted: true };
    },
  };
  const scopes = ['build', 'verify'] as const;
  const edges = scopes.flatMap((scope) =>
    ['succeeded', 'failed'].map((on) => ({
      from: `${profile}.${scope}.check`,
      to: `${profile}.${scope === 'build' ? 'build.execute' : 'verify.run'}`,
      on,
    })),
  );
  const transitions = [...(base.workflow.transitions ?? [])];
  for (const edge of edges)
    if (
      !transitions.some(
        (current) =>
          current.from === edge.from &&
          current.to === edge.to &&
          (current.on ?? 'succeeded') === edge.on,
      )
    )
      transitions.push(edge);
  return {
    ...base,
    workflow: {
      ...base.workflow,
      steps: {
        ...base.workflow.steps,
        ...Object.fromEntries(
          scopes.map((scope) => {
            const id = `${profile}.${scope}.check`;
            return [
              id,
              {
                ...base.workflow.steps[id],
                validator: { id: outcome.id, version: outcome.version },
              },
            ];
          }),
        ),
      },
      transitions,
      commands: {
        ...base.workflow.commands,
        ...Object.fromEntries(
          scopes.map((scope) => [
            `prepare-${scope}-check`,
            {
              stepId: `${profile}.${scope}.check`,
              validator: { id: validator.id, version: validator.version },
            },
          ]),
        ),
      },
    },
    commandValidators: [...(base.commandValidators ?? []), validator],
    validators: [...base.validators, outcome],
    transitionHandler: {
      ...base.transitionHandler,
      apply(context: Parameters<typeof base.transitionHandler.apply>[0]) {
        const action = context.run.actions.find(
          (entry) =>
            entry.id ===
            (context.event.kind === 'action-outcome' ? context.event.outcome.actionId : ''),
        );
        const request = action ? classicSdkCheckPreparationInput(context.run, action) : null;
        if (request) {
          const source = context.run.actions.find((entry) => entry.id === request.sourceActionId)!;
          const activation = (source.input as { activation?: RuntimeValue }).activation;
          return {
            state: context.run.state!,
            next: [
              activation === undefined
                ? source.stepId
                : { stepId: source.stepId, input: activation },
            ],
          };
        }
        return base.transitionHandler.apply(context);
      },
    },
  };
}
