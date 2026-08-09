import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { readNativeLocalExecution } from '../../../domains/comet-native/native-local-execution.js';
import {
  ensureNativeDirectories,
  nativePreferredChangeRuntimeDir,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { archiveNativePortableChange } from '../../../domains/comet-native/native-portable-archive.js';
import {
  confirmNativePortableShape,
  confirmNativePortableSkillCoordinatedPass,
  createNativePortableChange,
  dispatchNativePortableVerifier,
  executeNativePortableCheckPlan,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

const FORBIDDEN_V4_ARTIFACT =
  /(?:^|[\\/_-])(snapshot|scope|receipt|evidence|trajectory|checkpoint)(?:$|[.\\/_-])/iu;

describe('Native v4 verification-loop regression eval', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-v4-regression-'));
    await fs.mkdir(path.join(root, '.git'));
    await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
    paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    await fs.writeFile(
      path.join(root, 'check-output.mjs'),
      `import { readFileSync, writeFileSync } from 'node:fs';

const [counterFile, label, sizeText] = process.argv.slice(2);
let counters = {};
try {
  counters = JSON.parse(readFileSync(counterFile, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
counters[label] = (counters[label] ?? 0) + 1;
writeFileSync(counterFile, JSON.stringify(counters));
const size = Number(sizeText);
process.stdout.write('o'.repeat(size));
process.stderr.write('e'.repeat(size));
`,
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function expectNoLegacyVerificationArtifacts(): Promise<void> {
    const entries = (await fs.readdir(root, { recursive: true })).map(String);
    expect(entries.filter((entry) => FORBIDDEN_V4_ARTIFACT.test(entry))).toEqual([]);
  }

  async function readCounters(): Promise<Record<string, number>> {
    return JSON.parse(await fs.readFile(path.join(root, 'check-counts.json'), 'utf8')) as Record<
      string,
      number
    >;
  }

  function outputPlan(id: string, bytesPerStream: number) {
    return {
      id,
      name: `${id} output check`,
      executable: process.execPath,
      argv: ['./check-output.mjs', './check-counts.json', id, String(bytesPerStream)],
      cwdRef: '.',
      timeoutMs: 10_000,
      repeatable: true,
    };
  }

  it('requires independent full-coverage verification, loops repairs, and archives without legacy artifacts or rechecks', async () => {
    const name = 'portable-loop-eval';
    await createNativePortableChange({ paths, name, language: 'en' });
    const changeDir = nativePortableChangeDir(paths, name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Ship a command whose output remains valid at every supported diagnostic size.

# Acceptance examples
- The command succeeds when stdout and stderr are both long.
- Archive preserves the independently verified result without rerunning checks.
`,
    );
    let state = await confirmNativePortableShape({ paths, name });
    expect(state.acceptance.map(({ id }) => id)).toEqual(['A1', 'A2']);
    await expectNoLegacyVerificationArtifacts();

    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'regression-host',
          executionRef: 'builder-confident-1',
        }),
        candidateId: 'candidate-1',
        summary: 'Everything is complete and all acceptance criteria pass.',
        addressedAcceptanceIds: ['A1', 'A2'],
        checks: [{ name: 'Builder self-check', result: 'passed' }],
      },
    });

    expect(state).toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      verification: null,
      loop: { stage: 'verify-ready', iteration: 1, attempt: 0 },
    });
    await expect(archiveNativePortableChange({ paths, name })).rejects.toThrow('not archive-ready');

    const firstChecks = await executeNativePortableCheckPlan({
      paths,
      name,
      plans: [outputPlan('candidate-1-check', 0)],
    });
    await dispatchNativePortableVerifier({
      paths,
      name,
      checks: firstChecks.checks,
      verifierExecutionId: 'verifier-incomplete',
    });

    await expect(
      submitNativePortableVerifierResult({
        paths,
        name,
        checks: firstChecks.checks,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'candidate-1',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'regression-host',
            executionRef: 'verifier-incomplete',
          }),
          payload: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Observed the command succeed.' }],
              risks: [],
              summary: 'Pass claimed with incomplete coverage.',
            },
          },
        }),
      }),
    ).rejects.toThrow('missing: A2');
    state = await readNativePortableChange(paths, name);
    expect(state).toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      loop: { stage: 'verify-ready', execution_failure_count: 1 },
    });

    await dispatchNativePortableVerifier({
      paths,
      name,
      checks: firstChecks.checks,
      verifierExecutionId: 'verifier-finds-gap',
    });
    const failed = await submitNativePortableVerifierResult({
      paths,
      name,
      checks: firstChecks.checks,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: 'candidate-1',
        identity: runner.captureExecutionIdentity({
          identityProvider: 'regression-host',
          executionRef: 'verifier-finds-gap',
        }),
        payload: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 2,
            verdict: 'fail',
            acceptance: [
              { id: 'A1', result: 'passed', reason: 'Long output completed.' },
              { id: 'A2', result: 'failed', reason: 'The Archive behavior still needs repair.' },
            ],
            risks: [],
            summary: 'One acceptance criterion remains unresolved.',
          },
        },
      }),
    });
    expect(failed.state).toMatchObject({
      phase: 'build',
      verification_result: 'fail',
      verification_report: 'verification.md',
      loop: { stage: 'repairing', iteration: 2, attempt: 0 },
    });
    await expect(
      fs.readFile(path.join(nativePortableChangeDir(paths, name), 'verification.md'), 'utf8'),
    ).resolves.toContain('Result: **Failed**');

    await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'regression-host',
          executionRef: 'builder-repair-2',
        }),
        candidateId: 'candidate-2',
        summary: 'Repaired the Archive behavior reported by the independent Verifier.',
        addressedAcceptanceIds: ['A1', 'A2'],
      },
    });
    const byteSizes = new Map([
      ['stdout-stderr-4k', 4 * 1024],
      ['stdout-stderr-64k', 64 * 1024],
      ['stdout-stderr-long', 256 * 1024],
    ]);
    const finalPlans = [...byteSizes].map(([id, size]) => outputPlan(id, size));
    const finalChecks = await executeNativePortableCheckPlan({
      paths,
      name,
      plans: finalPlans,
    });
    expect(finalChecks.checks).toHaveLength(3);
    expect(finalChecks.checks.every(({ status }) => status === 'passed')).toBe(true);

    const localBeforeArchive = await readNativeLocalExecution(
      nativeLocalExecutionFile(paths, name),
    );
    expect(localBeforeArchive?.execution).toMatchObject({
      stage: 'checking',
      actor: 'runtime',
      status: 'completed',
    });
    expect(
      localBeforeArchive?.checks.map(({ id, status, executionCount }) => ({
        id,
        status,
        executionCount,
      })),
    ).toEqual([...byteSizes.keys()].map((id) => ({ id, status: 'passed', executionCount: 1 })));
    for (const check of localBeforeArchive?.checks ?? []) {
      const bytesPerStream = byteSizes.get(check.id)!;
      const log = path.join(
        path.dirname(nativeLocalExecutionFile(paths, name)),
        ...check.log.split('/'),
      );
      expect((await fs.stat(log)).size).toBe(bytesPerStream * 2);
    }
    expect(await readCounters()).toEqual({
      'candidate-1-check': 1,
      'stdout-stderr-4k': 1,
      'stdout-stderr-64k': 1,
      'stdout-stderr-long': 1,
    });
    const reusedChecks = await executeNativePortableCheckPlan({ paths, name, plans: finalPlans });
    expect(reusedChecks.checks.map(({ id, status }) => ({ id, status }))).toEqual(
      finalChecks.checks.map(({ id, status }) => ({ id, status })),
    );
    expect(await readCounters()).toEqual({
      'candidate-1-check': 1,
      'stdout-stderr-4k': 1,
      'stdout-stderr-64k': 1,
      'stdout-stderr-long': 1,
    });

    await dispatchNativePortableVerifier({
      paths,
      name,
      checks: finalChecks.checks,
      verifierExecutionId: 'verifier-complete',
    });
    const passed = await submitNativePortableVerifierResult({
      paths,
      name,
      checks: finalChecks.checks,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: 'candidate-2',
        identity: runner.captureExecutionIdentity({
          identityProvider: 'regression-host',
          executionRef: 'verifier-complete',
        }),
        payload: {
          kind: 'final-result',
          result: {
            iteration: 2,
            attempt: 1,
            verdict: 'pass',
            acceptance: [
              { id: 'A1', result: 'passed', reason: 'All three long-output checks passed.' },
              { id: 'A2', result: 'passed', reason: 'Archive no longer reruns verification.' },
            ],
            risks: [],
            summary: 'Every acceptance criterion and Runtime-owned check passed.',
          },
        },
      }),
    });
    expect(passed.state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
      loop: { stage: 'await-user', iteration: 2, attempt: 1 },
    });
    expect(
      passed.state.verification?.checks.map(({ id, duration_ms }) => ({ id, duration_ms })),
    ).toEqual(finalChecks.checks.map(({ id, duration_ms }) => ({ id, duration_ms })));
    await expectNoLegacyVerificationArtifacts();

    const confirmed = await confirmNativePortableSkillCoordinatedPass({ paths, name });
    expect(confirmed).toMatchObject({
      phase: 'archive',
      loop: { stage: 'archive-ready', iteration: 2, attempt: 1 },
    });

    const countsBeforeArchive = await readCounters();
    const archived = await archiveNativePortableChange({ paths, name });
    expect(await readCounters()).toEqual(countsBeforeArchive);
    expect((await fs.readdir(archived.archiveDir)).sort()).toEqual([
      'brief.md',
      'comet-state.yaml',
      'specs',
      'verification.md',
    ]);
    await expect(fs.stat(nativePreferredChangeRuntimeDir(paths, name))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expectNoLegacyVerificationArtifacts();
  });
});
