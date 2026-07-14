import type { DeterministicResolver } from '../engine/resolver.js';
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
      version: '1',
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
    maxIterations: 16,
    maxRetriesPerAction: 2,
    confirmationRequiredFor: [],
  },
  evals: [],
};

export const NATIVE_RUNTIME_HASH = sha256Text('comet-native-runtime:v1');

export const nativePhaseResolver: DeterministicResolver<undefined> = {
  resolveStep({ pkg, state }) {
    return pkg.definition.orchestration.steps?.find((step) => step.id === state.currentStep);
  },
  resolveNext({ step, outcome }) {
    if (step.id === 'verify' && outcome.state?.verification_result === 'fail') return 'build';
    return step.next ?? null;
  },
};
