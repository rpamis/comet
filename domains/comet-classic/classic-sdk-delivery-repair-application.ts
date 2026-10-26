import {
  hashRuntimeValue,
  preserveRuntimeExecutionOrigins,
  type RuntimeCommandValidator,
  type RuntimeExecutor,
  type RuntimeValidator,
  type WorkflowRun,
} from '../engine/runtime.js';
import type { ClassicWorkflowApplication } from './classic-sdk-application.js';
import { createClassicSdkCheckExecutor } from './classic-sdk-check.js';
import { assertClassicSdkCheckReceipt } from './classic-sdk-check-record.js';
import {
  captureClassicDeliveryRepair,
  assertClassicDeliveryRepairCurrent,
} from './classic-sdk-delivery-repair.js';
import {
  classicDeliveryRepairRecord as record,
  classicDeliveryRepairForAction,
  isClassicDeliveryRepairCheck,
} from './classic-sdk-delivery-repair-model.js';

export function withClassicDeliveryRepair<
  T extends ClassicWorkflowApplication & { commandValidators: RuntimeCommandValidator[] },
>(base: T, profile: string, sourceRun?: Readonly<WorkflowRun>) {
  const checkStep = `${profile}.delivery.check`,
    confirmStep = `${profile}.delivery.confirm`;
  const commandValidator: RuntimeCommandValidator = {
    id: 'comet-classic-delivery-repair-command',
    version: '1',
    async validate({ run, name, input, context }) {
      const request = record(input);
      if (
        !context?.projectRoot ||
        name !== 'repair-delivery' ||
        request.expectedRevision !== run.revision ||
        request.fromPhase !== 'archive' ||
        Object.keys(request).length !== 3
      )
        return { accepted: false, reason: 'Classic delivery repair requires its current revision' };
      if (sourceRun) {
        const expected =
          run.workflow.hash === sourceRun.workflow.hash
            ? (structuredClone(sourceRun) as WorkflowRun)
            : preserveRuntimeExecutionOrigins(sourceRun as WorkflowRun);
        expected.workflow.hash = run.workflow.hash;
        expected.definitionHashes[JSON.stringify([run.workflow.id, run.workflow.version])] =
          run.workflow.hash;
        if (hashRuntimeValue(expected) !== hashRuntimeValue(run))
          return {
            accepted: false,
            reason: 'Classic delivery repair no longer matches its authoritative source Run',
          };
      }
      const actual = await captureClassicDeliveryRepair(context.projectRoot, sourceRun ?? run);
      const accepted = hashRuntimeValue(actual) === hashRuntimeValue(request.deliveryRepair);
      return {
        accepted,
        allowFailed: accepted && run.status === 'failed',
        reason: 'Classic delivery repair scope changed',
      };
    },
  };
  const outcomeValidator: RuntimeValidator = {
    id: 'comet-classic-delivery-repair-check',
    version: '1',
    async validate({ run, action, outcome, context }) {
      if (
        !context?.projectRoot ||
        !isClassicDeliveryRepairCheck(run, action) ||
        action.claim?.executorId !== 'comet-classic-check'
      )
        return {
          accepted: false,
          reason: 'Classic delivery repair check has the wrong execution owner',
        };
      await assertClassicSdkCheckReceipt(context.projectRoot, run, action, {
        status: outcome.status,
        output: outcome.output,
      });
      if (outcome.status === 'succeeded') {
        const generated = record(record(outcome.output).regeneratedOutputs);
        const proof = classicDeliveryRepairForAction(action);
        if (
          hashRuntimeValue(Object.keys(generated).sort()) !==
            hashRuntimeValue(Object.keys(proof.excludedOutputs).sort()) ||
          Object.values(generated).some(
            (hash) =>
              typeof hash !== 'string' ||
              !/^(?:git:[a-f0-9]{40}(?:[a-f0-9]{24})?|[a-f0-9]{64})$/u.test(hash),
          )
        )
          return {
            accepted: false,
            reason: 'Classic delivery repair lacks Runtime-bound output generation evidence',
          };
        await assertClassicDeliveryRepairCurrent(
          context.projectRoot,
          run,
          classicDeliveryRepairForAction(action),
          'delivery',
        );
      }
      return { accepted: true };
    },
  };
  const executor: RuntimeExecutor = {
    id: 'comet-classic-check',
    capabilities: [],
    supports: (action) =>
      action.type === 'call_tool' && action.ref === 'classic-check' && action.stepId === checkStep,
    async preflight(action, context, run) {
      if (!context?.projectRoot || !run)
        throw new Error('Classic delivery repair requires its project');
      await assertClassicDeliveryRepairCurrent(
        context.projectRoot,
        run,
        classicDeliveryRepairForAction(action),
        'prepare',
      );
      await createClassicSdkCheckExecutor(context.projectRoot).preflight!(action, context, run);
    },
    async execute(action, context, run) {
      if (!context?.projectRoot || !run)
        throw new Error('Classic delivery repair requires its project');
      return createClassicSdkCheckExecutor(context.projectRoot).execute(action, context, run);
    },
  };
  return {
    ...base,
    workflow: {
      ...base.workflow,
      steps: {
        ...base.workflow.steps,
        [checkStep]: {
          type: 'call_tool' as const,
          ref: 'classic-check',
          validator: { id: outcomeValidator.id, version: outcomeValidator.version },
        },
        [confirmStep]: {
          type: 'ask_user' as const,
          proposalFrom: checkStep,
          choices: ['approved', 'later'],
        },
      },
      transitions: [
        ...(base.workflow.transitions ?? []),
        { from: checkStep, to: confirmStep },
        { from: confirmStep, to: `${profile}.archive.deliver`, on: 'approved' },
        { from: confirmStep, to: confirmStep, on: 'later' },
      ],
      commands: {
        ...base.workflow.commands,
        'repair-delivery': {
          stepId: checkStep,
          validator: { id: commandValidator.id, version: commandValidator.version },
        },
      },
    },
    commandValidators: [...base.commandValidators, commandValidator],
    validators: [...base.validators, outcomeValidator],
    executors: [...base.executors, executor],
    transitionHandler: {
      ...base.transitionHandler,
      apply(context: Parameters<typeof base.transitionHandler.apply>[0]) {
        if (context.event.kind === 'action-outcome' && context.event.stepId === checkStep)
          return {
            state: context.run.state!,
            next: context.event.outcome.status === 'succeeded' ? [confirmStep] : [],
          };
        if (context.event.kind === 'wait-resolved' && context.event.stepId === confirmStep) {
          const check = context.run.actions
            .slice()
            .reverse()
            .find((a) => a.stepId === checkStep && a.status === 'succeeded');
          return {
            state: context.run.state!,
            next:
              context.event.choice === 'approved' && check
                ? [
                    {
                      stepId: `${profile}.archive.deliver`,
                      input: { deliveryRepairCheckId: check.id },
                    },
                  ]
                : [confirmStep],
          };
        }
        return base.transitionHandler.apply(context);
      },
    },
  };
}
