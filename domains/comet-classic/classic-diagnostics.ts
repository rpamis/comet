import type { ClassicEvidence } from './classic-evidence.js';
import { collectClassicEvidence } from './classic-evidence.js';
import { ensureStrictClassicRuntimeRun, validateClassicRuntimeRun } from './classic-runtime-run.js';
import { readClassicState } from './classic-store.js';
import { resolveClassicStepId } from './classic-resolver.js';
import {
  evaluateClassicRuntimeStep,
  type ClassicRuntimeEvalStatus,
} from './classic-runtime-evals.js';

export interface ClassicDiagnostic {
  name: string;
  valid: boolean;
  workflow: string;
  phase: string;
  currentStep: string | null;
  nextCommand: string | null;
  runtimeMode: 'engine-projection' | 'legacy-state' | 'invalid';
  runtimeEval: ClassicRuntimeEvalStatus | null;
  evidence: ClassicEvidence[];
  error?: string;
}

export async function inspectClassicChangeReadOnly(
  changeDir: string,
  name: string,
): Promise<ClassicDiagnostic> {
  try {
    const projection = await readClassicState(changeDir, { migrate: false });
    const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
    if (unknownKeys.length > 0) {
      throw new Error(`Invalid Classic state: unknown field(s): ${unknownKeys.join(', ')}`);
    }
    if (!projection.classic) throw new Error('Invalid Classic state: missing Classic projection');

    if (!projection.run) {
      return {
        name,
        valid: true,
        workflow: projection.classic.workflow,
        phase: projection.classic.phase,
        currentStep: null,
        nextCommand: nextCommandForPhase(projection.classic.phase),
        runtimeMode: 'legacy-state',
        runtimeEval: null,
        evidence: [],
      };
    }

    const runtime = await validateClassicRuntimeRun(changeDir, projection);
    const evidence = runtime.evidence;
    const currentStep = resolveClassicStepId(runtime.classic, evidence);
    return {
      name,
      valid: true,
      workflow: projection.classic.workflow,
      phase: projection.classic.phase,
      currentStep,
      nextCommand: nextCommandForPhase(projection.classic.phase),
      runtimeMode: 'engine-projection',
      runtimeEval: evaluateClassicRuntimeStep(currentStep, evidence),
      evidence,
    };
  } catch (error) {
    return {
      name,
      valid: false,
      workflow: 'unknown',
      phase: 'invalid',
      currentStep: null,
      nextCommand: null,
      runtimeMode: 'invalid',
      runtimeEval: null,
      evidence: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function nextCommandForPhase(phase: string): string | null {
  switch (phase) {
    case 'open':
      return '/comet-open';
    case 'design':
      return '/comet-design';
    case 'build':
      return '/comet-build';
    case 'verify':
      return '/comet-verify';
    case 'archive':
      return '/comet-archive';
    default:
      return null;
  }
}

export async function inspectClassicChange(
  changeDir: string,
  name: string,
): Promise<ClassicDiagnostic> {
  try {
    const runtime = await ensureStrictClassicRuntimeRun(changeDir);
    const evidence = await collectClassicEvidence(changeDir, {
      classic: runtime.classic,
      run: runtime.run,
      unknownKeys: [],
    });
    const currentStep = resolveClassicStepId(runtime.classic, evidence);
    return {
      name,
      valid: true,
      workflow: runtime.classic.workflow,
      phase: runtime.classic.phase,
      currentStep,
      nextCommand: nextCommandForPhase(runtime.classic.phase),
      runtimeMode: 'engine-projection',
      runtimeEval: evaluateClassicRuntimeStep(currentStep, evidence),
      evidence,
    };
  } catch (error) {
    return {
      name,
      valid: false,
      workflow: 'unknown',
      phase: 'invalid',
      currentStep: null,
      nextCommand: null,
      runtimeMode: 'invalid',
      runtimeEval: null,
      evidence: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
