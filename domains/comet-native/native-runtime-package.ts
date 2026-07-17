import type { DeterministicResolver } from '../engine/resolver.js';
import type { RunState } from '../engine/types.js';
import type { SkillPackage } from '../skill/types.js';
import { sha256Text } from './native-hash.js';

export const NATIVE_RUNTIME_PACKAGE: SkillPackage = {
  root: '/comet/native-runtime',
  packageKind: 'runtime',
  definition: {
    apiVersion: 'comet/v1alpha1',
    kind: 'Skill',
    metadata: {
      name: 'comet-native-runtime',
      version: '3',
      description: 'Comet-owned state runtime for the Native workflow.',
    },
    goal: {
      statement: 'Advance a Native change only after its current guard passes.',
      inputs: [],
      outputs: [],
      success: ['The Native change and Run state agree on the next phase.'],
    },
    orchestration: {
      mode: 'deterministic',
      entry: 'shape',
      steps: [
        { id: 'shape', action: { type: 'checkpoint' }, next: 'build' },
        { id: 'build', action: { type: 'checkpoint' }, next: 'verify' },
        { id: 'verify', action: { type: 'checkpoint' }, next: 'archive' },
        { id: 'archive', action: { type: 'checkpoint' } },
      ],
    },
    skills: [],
    agents: [],
    tools: [],
  },
  guardrails: {
    allowedSkills: [],
    allowedAgents: [],
    allowedTools: [],
    // Native uses the evidence-bound repair episode budget below the engine seam. The generic
    // counter remains an action ID source, not a user-visible permanent stop for long-lived changes.
    maxIterations: Number.MAX_SAFE_INTEGER,
    maxRetriesPerAction: 2,
    confirmationRequiredFor: [],
  },
  evals: [],
};

export const NATIVE_RUNTIME_HASH = sha256Text('comet-native-runtime:v3:semantic-repair-budget');
export const NATIVE_LEGACY_RUNTIME_IDENTITIES = [
  {
    skillVersion: '2',
    skillHash: sha256Text('comet-native-runtime:v2:max-iterations-32'),
  },
  {
    skillVersion: '1',
    skillHash: sha256Text('comet-native-runtime:v1'),
  },
] as const;

/** Older active Native Runs may continue when only the compatible iteration budget changed. */
export function isCompatibleNativeRuntimeIdentity(
  run: Pick<RunState, 'skillVersion' | 'skillHash'>,
): boolean {
  return (
    (run.skillVersion === NATIVE_RUNTIME_PACKAGE.definition.metadata.version &&
      run.skillHash === NATIVE_RUNTIME_HASH) ||
    NATIVE_LEGACY_RUNTIME_IDENTITIES.some(
      (identity) =>
        identity.skillVersion === run.skillVersion && identity.skillHash === run.skillHash,
    )
  );
}

export const nativePhaseResolver: DeterministicResolver<undefined> = {
  resolveStep({ pkg, state }) {
    return pkg.definition.orchestration.steps?.find((step) => step.id === state.currentStep);
  },
  resolveNext({ step, outcome }) {
    if (step.id === 'verify' && outcome.state?.verification_result === 'fail') return 'build';
    return step.next ?? null;
  },
};
