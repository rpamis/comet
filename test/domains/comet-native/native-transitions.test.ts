import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { readTrajectory } from '../../../domains/engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../../../domains/engine/storage-layout.js';
import { readRunStateAt } from '../../../domains/engine/storage-run.js';
import { createNativeChange, nativeChangeDir, readNativeChange, writeNativeChange } from '../../../domains/comet-native/native-change.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

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

const verification = `# Acceptance evidence
Scenario passed.
# Commands and results
Tests passed.
# Skipped checks
None.
# Spec consistency
Matches.
# Known limitations and risks
None.
# Conclusion
Pass.
`;

describe('Native guarded transitions', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let changeDir: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-transitions-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    const state = await createNativeChange({ paths, name: 'advance-change', language: 'en' });
    changeDir = nativeChangeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('does not write Run files when Shape guard fails', async () => {
    await fs.writeFile(path.join(changeDir, 'brief.md'), '# Outcome\nIncomplete.\n');
    const result = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape done' },
    });
    expect(result.next).toBe('manual');
    expect((await readNativeChange(paths, 'advance-change')).phase).toBe('shape');
    await expect(fs.access(path.join(changeDir, 'runtime', 'run-state.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('advances Shape and Build with Engine state and idempotent evidence', async () => {
    const first = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape done' },
      runId: () => 'native-run-1',
      now: new Date('2026-07-14T01:00:00Z'),
    });
    expect(first.change).toMatchObject({ phase: 'build', approval: 'implicit', run_id: 'native-run-1' });
    expect((await readRunStateAt(changeDir, NATIVE_RUN_STORAGE))?.currentStep).toBe('build');

    const retry = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'shape done' },
    });
    expect(retry.change.phase).toBe('build');
    const run = (await readRunStateAt(changeDir, NATIVE_RUN_STORAGE))!;
    expect((await readTrajectory(changeDir, run.trajectoryRef)).filter((event) => event.type === 'state_transitioned')).toHaveLength(1);

    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
    const build = await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'implemented', artifacts: ['feature.ts'] },
    });
    expect(build.change.phase).toBe('verify');
  });

  it('returns Verify failures to Build and preserves report evidence', async () => {
    let state = await readNativeChange(paths, 'advance-change');
    state.phase = 'verify';
    state.run_id = 'native-run-verify';
    await writeNativeChange(paths, state);
    const { startRunWithStorage, writeRunStateAt } = await import('../../../domains/engine/storage-run.js');
    const { NATIVE_RUNTIME_PACKAGE, NATIVE_RUNTIME_HASH } = await import('../../../domains/comet-native/native-runtime-package.js');
    const run = startRunWithStorage(NATIVE_RUNTIME_PACKAGE, state.run_id, NATIVE_RUNTIME_HASH, NATIVE_RUN_STORAGE);
    run.currentStep = 'verify';
    run.iteration = 2;
    await writeRunStateAt(changeDir, run, NATIVE_RUN_STORAGE);
    await fs.writeFile(path.join(changeDir, 'verification.md'), verification.replace('Pass.', 'Fail.'));

    const result = await advanceNativeChange({
      paths,
      name: state.name,
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
  });

  it('advances Verify pass to the Native archive command without reasoning fields', async () => {
    await advanceNativeChange({ paths, name: 'advance-change', evidence: { summary: 'shape done' } });
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
    await advanceNativeChange({
      paths,
      name: 'advance-change',
      evidence: { summary: 'built', artifacts: ['feature.ts'] },
    });
    await fs.writeFile(path.join(changeDir, 'verification.md'), verification);
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
    expect(result.nextCommand).toBe('comet native archive advance-change');
    const run = (await readRunStateAt(changeDir, NATIVE_RUN_STORAGE))!;
    const source = await fs.readFile(path.join(changeDir, run.trajectoryRef), 'utf8');
    expect(source).not.toMatch(/reasoning|thoughts|chain_of_thought/iu);
  });
});
