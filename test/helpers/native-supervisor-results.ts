import {
  markNativeSupervisorChildVerified as markVerified,
  applyNativeSupervisorVerifierResult as applyResult,
} from '../../domains/comet-native/native-supervisor.js';

/** Successful protocol fixtures for tests focused on integration and delivery. */
export function markNativeSupervisorChildVerified(
  ...[state, options]: Parameters<typeof markVerified>
) {
  return markVerified(state, {
    ...options,
    evidence: {
      ...options.evidence,
      acceptance:
        options.evidence.acceptance ??
        state.children
          .find(({ name }) => name === options.name)!
          .acceptanceScope!.map(({ id }) => ({
            id,
            result: 'passed',
            reason: 'Independent fixture verification passed.',
          })),
    },
  });
}

export function applyNativeSupervisorVerifierResult(
  ...[state, options]: Parameters<typeof applyResult>
) {
  const result =
    options.verdict === 'pass' ? 'passed' : options.verdict === 'fail' ? 'failed' : 'blocked';
  return applyResult(state, {
    ...options,
    evidence: {
      ...options.evidence,
      acceptance:
        options.evidence.acceptance ??
        state.children
          .find(({ name }) => name === options.child)!
          .acceptanceScope!.map(({ id }) => ({ id, result, reason: options.evidence.summary })),
    },
  });
}
