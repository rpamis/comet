import type {
  RuntimeCommandValidator,
  RuntimeExecutor,
  RuntimeValidator,
} from '../engine/runtime.js';
import { parseNativePortableState } from './native-portable-state.js';

export const nativeSdkReviseCommandValidator: RuntimeCommandValidator = {
  id: 'comet-native-revise-command',
  version: '1',
  validate({ run, name, input }) {
    const state = parseNativePortableState(run.state);
    if (
      name !== 'revise-requirements' ||
      !['verify', 'archive'].includes(state.phase) ||
      state.archived ||
      !['active', 'await-user', 'blocked'].includes(state.status) ||
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'expectedStateVersion,reason' ||
      input.expectedStateVersion !== state.state_version ||
      typeof input.reason !== 'string' ||
      !input.reason.trim() ||
      run.actions.some(
        (action) =>
          action.stepId === 'archive.execute' &&
          ['succeeded', 'running', 'unknown'].includes(action.status),
      )
    ) {
      return {
        accepted: false,
        reason: 'Native requirements revision is stale or cannot interrupt Archive application',
      };
    }
    return { accepted: true };
  },
};

export const nativeSdkReviseExecutor: RuntimeExecutor = {
  id: 'comet-native-revise-requirements',
  capabilities: [],
  supports(action) {
    return action.stepId === 'shape.revise' && action.ref === 'native-revise-requirements';
  },
  async execute(action, _context, run) {
    if (!run) throw new Error('Native SDK Run is required');
    const activation = (
      action.input as {
        activation?: { reason?: unknown; expectedStateVersion?: unknown };
      }
    ).activation;
    const state = parseNativePortableState(run.state);
    if (
      typeof activation?.reason !== 'string' ||
      !activation.reason.trim() ||
      activation.expectedStateVersion !== state.state_version
    ) {
      throw new Error('Native requirements revision references a stale change');
    }
    return { status: 'succeeded', output: { reason: activation.reason.trim() } };
  },
};

export const nativeSdkReviseValidator: RuntimeValidator = {
  id: 'comet-native-revise-outcome',
  version: '1',
  validate({ action, outcome }) {
    const activation = (action.input as { activation?: { reason?: unknown } }).activation;
    return {
      accepted:
        outcome.status === 'succeeded' &&
        action.stepId === 'shape.revise' &&
        typeof activation?.reason === 'string' &&
        (outcome.output as { reason?: unknown } | null)?.reason === activation.reason.trim(),
      reason: 'Native requirements revision has no matching receipt',
    };
  },
};
