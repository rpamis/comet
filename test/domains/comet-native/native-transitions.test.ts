import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  createNativeChange,
  nativeChangeDir,
  readNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import {
  nativeChangeRuntimeDir,
  nativeProjectPaths,
  nativeRuntimeRefFile,
} from '../../../domains/comet-native/native-paths.js';
import {
  readNativeRunState,
  readNativeTrajectory,
} from '../../../domains/comet-native/native-run-store.js';
import { inspectNativeStatus } from '../../../domains/comet-native/native-diagnostics.js';
import {
  readNativeBaselineManifest,
  writeNativeBaselineManifest,
} from '../../../domains/comet-native/native-snapshot.js';
import { readNativeImplementationScopeBundle } from '../../../domains/comet-native/native-evidence-storage.js';
import {
  advanceNativeChange,
  formatNativeReceiptBindingMismatchMessage,
} from '../../../domains/comet-native/native-transitions.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';
import { nativeVerificationFixtureReport } from '../../helpers/native-verification.js';

const brief = `# Outcome
Ship the feature.
# Scope
One capability.
# Non-goals
No migration.
# Acceptance examples
- The feature works.
# Constraints and invariants
Keep compatibility.
# Decisions
Use existing APIs.
# Open questions

# Verification expectations
Run focused tests.
`;

describe('Native guarded transitions', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let changeDir: string;
  let runtimeDir: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-transitions-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    const state = await createNativeChange({
      paths,
      name: 'advance-change',
      language: 'en',
      verificationProtocol: 'legacy-v1',
    });
    changeDir = nativeChangeDir(paths, state.name);
    runtimeDir = nativeChangeRuntimeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('uses the concrete change name in receipt binding recovery guidance', () => {
    const message = formatNativeReceiptBindingMismatchMessage({
      change: 'advance-change',
      detail: 'verification.json -> sourceRevision: expected 3, got 2',
    });

    expect(message).toContain('comet native receipt refresh advance-change --apply');
    expect(message).not.toContain('<change>');
  });

  it('does not write Run files when Shape guard fails', async () => {
    await fs.writeFile(path.join(changeDir, 'brief.md'), '# Outcome\nIncomplete.\n');
    await fs.mkdir(path.join(changeDir, 'specs', 'new-capability'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'new-capability', 'spec.md'),
      '# New capability\nTarget behavior.\n',
    );
    const result = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape done' },
    });
    expect(result.next).toBe('manual');
    expect((await readNativeChange(paths, 'advance-change')).phase).toBe('shape');
    expect((await readNativeChange(paths, 'advance-change')).spec_changes).toEqual([]);
    await expect(fs.access(path.join(runtimeDir, 'run-state.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('blocks Shape before Build when a legacy baseline is incomplete', async () => {
    const baseline = await readNativeBaselineManifest(paths, 'advance-change');
    await writeNativeBaselineManifest(paths, 'advance-change', {
      ...baseline,
      complete: false,
      omitted: [
        {
          path: 'oversized.bin',
          size: baseline.limits.maxFileBytes + 1,
          type: 'file',
          reason: 'file-size',
        },
      ],
      omittedCount: 1,
    });

    const result = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape done' },
    });
    expect(result).toMatchObject({
      next: 'manual',
      change: { phase: 'shape' },
      findings: [
        expect.objectContaining({
          code: 'baseline-snapshot-incomplete',
          requiredAction: 'resolve-native-baseline',
        }),
      ],
    });
  });

  it('advances Shape and Build with Engine state and idempotent evidence', async () => {
    const first = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape done', confirmed: true },
      runId: () => 'native-run-1',
      now: new Date('2026-07-14T01:00:00Z'),
    });
    expect(first.change).toMatchObject({
      revision: 2,
      phase: 'build',
      approval: 'confirmed',
      approved_contract_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      run_id: 'native-run-1',
    });
    expect((await readNativeRunState(runtimeDir))?.currentStep).toBe('build');

    const retry = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape done', confirmed: true },
    });
    expect(retry.change.phase).toBe('build');
    expect(retry.change.revision).toBe(2);
    const run = (await readNativeRunState(runtimeDir))!;
    expect(
      (await readNativeTrajectory(runtimeDir, run.trajectoryRef)).filter(
        (event) => event.type === 'state_transitioned',
      ),
    ).toHaveLength(1);

    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
    const build = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'implemented', artifacts: ['feature.ts'] },
    });
    expect(build.change.phase).toBe('verify');
    expect(build.change.revision).toBe(3);
  });

  it('rebuilds a missing Build Runtime without pretending verification survived', async () => {
    await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape done', confirmed: true },
      runId: () => 'initial-runtime-run',
    });
    await fs.rm(runtimeDir, { recursive: true });

    const rebuilt = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'rebuild this worktree Runtime' },
      runId: () => 'rebuilt-runtime-run',
    });

    expect(rebuilt.change).toMatchObject({
      phase: 'build',
      revision: 3,
      run_id: 'rebuilt-runtime-run',
      verification_result: 'pending',
      verification_report: null,
      implementation_scope: null,
      verification_evidence: null,
    });
    expect(await readNativeRunState(runtimeDir)).toMatchObject({
      runId: 'rebuilt-runtime-run',
      currentStep: 'build',
    });
    expect(await readNativeBaselineManifest(paths, 'advance-change')).not.toBeNull();
  });

  it('rebuilds a missing Shape Runtime before applying the requested Shape transition', async () => {
    await fs.rm(runtimeDir, { recursive: true });

    const rebuilt = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape done after cloning', confirmed: true },
      runId: () => 'rebuilt-shape-run',
    });

    expect(rebuilt.change).toMatchObject({
      phase: 'build',
      revision: 2,
      run_id: 'rebuilt-shape-run',
      verification_result: 'pending',
    });
    expect(await readNativeRunState(runtimeDir)).toMatchObject({
      runId: 'rebuilt-shape-run',
      currentStep: 'build',
    });
    expect(await readNativeBaselineManifest(paths, 'advance-change')).not.toBeNull();
  });

  it.each(['verify', 'archive'] as const)(
    'returns a missing %s Runtime to Build and clears stale verification bindings',
    async (phase) => {
      await advanceNativeChange({
        paths,
        name: 'advance-change',
        evidence: { summary: 'shape done', confirmed: true },
      });
      await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
      const verifying = await advanceNativeChange({
        paths,
        name: 'advance-change',
        evidence: { summary: 'implemented', artifacts: ['feature.ts'] },
      });
      const state =
        phase === 'archive'
          ? {
              ...verifying.change,
              phase,
              verification_result: 'pass' as const,
              verification_report: 'verification.md',
              verification_evidence: `runtime/evidence/verifications/${'a'.repeat(64)}.json`,
            }
          : verifying.change;
      await writeNativeChange(paths, state);
      await fs.writeFile(path.join(changeDir, 'evidence.md'), '# Stale evidence\n');
      await fs.rm(runtimeDir, { recursive: true });

      const rebuilt = await advanceNativeChange({
        paths,
        name: 'advance-change',
        evidence: { summary: 'continue after cloning' },
        runId: () => `rebuilt-${phase}-run`,
      });

      expect(rebuilt.change).toMatchObject({
        phase: 'build',
        revision: state.revision + 1,
        run_id: `rebuilt-${phase}-run`,
        verification_result: 'pending',
        verification_report: null,
        implementation_scope: null,
        verification_evidence: null,
      });
      await expect(fs.access(path.join(changeDir, 'evidence.md'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it.each(['sequential', 'batch'] as const)(
    'requires explicit shared-understanding confirmation in %s mode',
    async (clarificationMode) => {
      const blocked = await advanceNativeChange({
        paths,
        name: 'advance-change',
        evidence: { summary: 'shape is ready' },
        clarificationMode,
      });
      expect(blocked).toMatchObject({
        next: 'manual',
        change: { phase: 'shape', approval: null },
        findings: [
          expect.objectContaining({
            code: 'shape-confirmation-required',
            requiredAction: 'confirm-shared-understanding',
            retryCommand: 'comet native next advance-change --summary "<summary>" --confirmed',
            requiresUserDecision: true,
          }),
        ],
      });

      const confirmed = await advanceNativeChange({
        paths,
        name: 'advance-change',
        evidence: { summary: 'shared understanding confirmed', confirmed: true },
        clarificationMode,
      });
      expect(confirmed.change).toMatchObject({
        phase: 'build',
        approval: 'confirmed',
      });
    },
  );

  it('requires a legacy implicit Build state to be confirmed before Verify', async () => {
    const shaped = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shared understanding confirmed', confirmed: true },
      clarificationMode: 'batch',
    });
    await writeNativeChange(paths, { ...shaped.change, approval: 'implicit' });
    expect(await inspectNativeStatus(paths, 'advance-change')).toMatchObject({
      phase: 'build',
      nextCommand:
        'comet native next advance-change --summary "<summary>" --artifact "<project-relative-path>" --confirmed',
      continuation: {
        command:
          'comet native next advance-change --summary "<summary>" --artifact "<project-relative-path>" --confirmed',
        commandArgs: [
          'comet',
          'native',
          'next',
          'advance-change',
          '--summary',
          '<summary>',
          '--artifact',
          '<project-relative-path>',
          '--confirmed',
        ],
        requiredInputs: [
          'summary',
          'artifact-or-no-code-reason',
          'shared-understanding-confirmation',
        ],
      },
    });
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');

    const blocked = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'implemented', artifacts: ['feature.ts'] },
      clarificationMode: 'batch',
    });
    expect(blocked).toMatchObject({
      next: 'manual',
      change: { phase: 'build', approval: 'implicit' },
      findings: [
        expect.objectContaining({
          code: 'approval-confirmation-required',
          requiredAction: 'confirm-shared-understanding',
          retryCommand: 'comet native next advance-change --summary "<summary>" --confirmed',
          requiresUserDecision: true,
        }),
      ],
    });

    const confirmed = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: {
        summary: 'implemented and confirmed',
        artifacts: ['feature.ts'],
        confirmed: true,
      },
      clarificationMode: 'batch',
    });
    expect(confirmed.change).toMatchObject({
      phase: 'verify',
      approval: 'confirmed',
    });
  });

  it('blocks a changed approved contract until Build explicitly re-confirms it', async () => {
    const shaped = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape is approved', confirmed: true },
    });
    const approvedHash = shaped.change.approved_contract_hash;
    expect(approvedHash).toMatch(/^[a-f0-9]{64}$/u);

    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      brief.replace('The feature works.', 'The changed feature works.'),
    );
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');

    const blocked = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'implemented changed contract', artifacts: ['feature.ts'] },
    });
    expect(blocked).toMatchObject({
      next: 'manual',
      change: { phase: 'build', approved_contract_hash: approvedHash },
      findings: [
        expect.objectContaining({
          code: 'contract-changed-after-approval',
          requiresUserDecision: true,
          requiredAction: 're-confirm-contract',
        }),
      ],
    });

    const confirmed = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: {
        summary: 'implemented and re-confirmed changed contract',
        artifacts: ['feature.ts'],
        confirmed: true,
      },
    });
    expect(confirmed.change).toMatchObject({ phase: 'verify', approval: 'confirmed' });
    expect(confirmed.change.approved_contract_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(confirmed.change.approved_contract_hash).not.toBe(approvedHash);
    const scope = await readNativeImplementationScopeBundle(
      paths,
      confirmed.change.name,
      confirmed.change.implementation_scope!,
    );
    expect(confirmed.change.approved_contract_hash).toBe(scope.scope.contractHash);
  });

  it('records explicit confirmation from Shape and rejects it in Verify', async () => {
    const shaped = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape is ready', confirmed: true },
    });
    expect(shaped.change).toMatchObject({ phase: 'build', approval: 'confirmed' });

    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
    const build = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'implemented', artifacts: ['feature.ts'], confirmed: true },
    });
    expect(build.change).toMatchObject({ phase: 'verify', approval: 'confirmed' });

    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'advance-change',
        evidenceRefs: ['feature.ts'],
      }),
    );
    const verify = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: {
        summary: 'verification passed',
        verificationResult: 'pass',
        verificationReport: 'verification.md',
        confirmed: true,
      },
    });
    expect(verify.next).toBe('manual');
    expect(verify.findings).toContainEqual(
      expect.objectContaining({ code: 'confirmation-not-shape' }),
    );
  });

  it('returns Verify failures to Build and preserves report evidence', async () => {
    await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape is ready', confirmed: true },
    });
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
    await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'build is ready', artifacts: ['feature.ts'] },
    });
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'advance-change',
        evidenceRefs: ['feature.ts'],
        conclusion: 'Fail',
      }),
    );

    const result = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: {
        summary: 'verification failed',
        verificationResult: 'fail',
        verificationReport: 'verification.md',
      },
    });
    expect(result.change).toMatchObject({
      phase: 'build',
      verification_result: 'fail',
      verification_report: 'verification.md',
    });

    await fs.appendFile(path.join(changeDir, 'verification.md'), '\nChanged after transition.\n');
    const retry = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: {
        summary: 'verification failed',
        verificationResult: 'fail',
        verificationReport: 'verification.md',
      },
    });
    expect(retry.next).toBe('manual');
    expect(retry.change.revision).toBe(result.change.revision);
  });

  it('explicitly returns a fresh Verify change to Build without counting a failure', async () => {
    await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape is ready', confirmed: true },
    });
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
    const build = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'build is ready', artifacts: ['feature.ts'] },
    });
    expect(build.change.phase).toBe('verify');

    const returned = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: {
        summary: 'User requested an additional implementation file',
        returnToBuild: true,
      },
    });

    expect(returned).toMatchObject({
      previousPhase: 'verify',
      next: 'auto',
      change: {
        phase: 'build',
        revision: build.change.revision + 1,
        verification_result: 'pending',
        verification_report: null,
        implementation_scope: null,
        verification_evidence: null,
        partial_allowance: null,
        approved_contract_hash: build.change.approved_contract_hash,
      },
    });
    const run = await readNativeRunState(runtimeDir);
    expect(run).toMatchObject({ currentStep: 'build', status: 'running' });
    const trajectory = await readNativeTrajectory(runtimeDir, run!.trajectoryRef);
    expect(trajectory.at(-1)).toMatchObject({
      type: 'state_transitioned',
      data: { previousPhase: 'verify', nextPhase: 'build', returnToBuild: true },
    });
  });

  it('explicitly returns an Archive change to Build and invalidates its pass', async () => {
    await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape is ready', confirmed: true },
    });
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
    await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'build is ready', artifacts: ['feature.ts'] },
    });
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'advance-change',
        evidenceRefs: ['feature.ts'],
      }),
    );
    const verified = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: {
        summary: 'verification passed',
        verificationResult: 'pass',
        verificationReport: 'verification.md',
      },
    });
    expect(verified.change.phase).toBe('archive');

    const returned = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'User requested follow-up implementation', returnToBuild: true },
    });

    expect(returned.change).toMatchObject({
      phase: 'build',
      verification_result: 'pending',
      verification_report: null,
      implementation_scope: null,
      verification_evidence: null,
      partial_allowance: null,
    });
  });

  it('advances Verify pass to the Native archive command without reasoning fields', async () => {
    await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape done', confirmed: true },
    });
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
    await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'built', artifacts: ['feature.ts'] },
    });
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'advance-change',
        evidenceRefs: ['feature.ts'],
      }),
    );
    const result = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: {
        summary: 'verified',
        verificationResult: 'pass',
        verificationReport: 'verification.md',
      },
    });
    expect(result.change.phase).toBe('archive');
    expect(result.nextCommand).toBe('comet native archive advance-change --dry-run');
    const run = (await readNativeRunState(runtimeDir))!;
    const source = await fs.readFile(nativeRuntimeRefFile(runtimeDir, run.trajectoryRef), 'utf8');
    expect(source).not.toMatch(/reasoning|thoughts|chain_of_thought/iu);

    await fs.appendFile(path.join(changeDir, 'verification.md'), '\nChanged after transition.\n');
    await expect(
      advanceNativeChange({
        paths,
        name: 'advance-change',
        evidence: {
          summary: 'verified',
          verificationResult: 'pass',
          verificationReport: 'verification.md',
        },
      }),
    ).rejects.toThrow('retreat only accepts a transition summary');
  });
});
