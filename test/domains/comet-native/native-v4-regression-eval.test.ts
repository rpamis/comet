import '../../helpers/isolated-agent-home.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

import {
  ensureNativeDirectories,
  nativePreferredChangeRuntimeDir,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { archiveNativePortableChange } from '../../../domains/comet-native/native-portable-archive.js';
import {
  confirmNativePortableSkillCoordinatedPass,
  createNativePortableChange,
  dispatchNativePortableVerifier,
  nativePortableChangeDir,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

const FORBIDDEN_V4_ARTIFACT =
  /(?:^|[\\/_-])(snapshot|scope|receipt|evidence|trajectory|checkpoint)(?:$|[.\\/_-])/iu;

function passedReview(reviewerExecutionRef: string) {
  return {
    status: 'passed' as const,
    summary: 'Independent read-only review passed.',
    reviewerExecutionRef,
  };
}

describe('Native v4 deterministic verification-loop regression', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-v4-regression-'));
    for (const args of [
      ['init'],
      ['config', 'user.name', 'SIMULATED Fixture'],
      ['config', 'user.email', 'fixture@example.invalid'],
      ['config', 'commit.gpgsign', 'false'],
      ['commit', '--allow-empty', '-m', 'SIMULATED fixture baseline'],
    ])
      execFileSync('git', args, { cwd: root, stdio: 'ignore' });
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
    return JSON.parse(
      await fs.readFile(path.join(paths.workspaceRuntimeRoot, 'check-counts.json'), 'utf8'),
    ) as Record<string, number>;
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
        acceptanceReview: fixtureAcceptanceReview(['A1', 'A2']),
        checks: [{ name: 'Builder self-check', result: 'passed' }],
        review: passedReview('reviewer-confident-1'),
      },
    });

    expect(state).toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      verification: null,
      loop: { stage: 'verify-ready', iteration: 1, attempt: 0 },
    });
    await expect(archiveNativePortableChange({ paths, name })).rejects.toThrow('not archive-ready');

    await dispatchNativePortableVerifier({
      paths,
      name,
      verifierExecutionId: 'verifier-incomplete',
    });

    await expect(
      submitNativePortableVerifierResult({
        paths,
        name,
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
              acceptance: [
                {
                  id: 'A1',
                  result: 'passed',
                  reason: 'Observed the command succeed.',
                },
              ],
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
      loop: {
        stage: 'verify-ready',
        next_action: 'await-verifier-result',
        execution_failure_count: 0,
      },
    });

    const failed = await submitNativePortableVerifierResult({
      paths,
      name,
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
            verdict: 'fail',
            acceptance: [
              { id: 'A1', result: 'passed', reason: 'Long output completed.' },
              {
                id: 'A2',
                result: 'failed',
                reason: 'The Archive behavior still needs repair.',
              },
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

    const byteSizes = new Map([
      ['stdout-stderr-4k', 4 * 1024],
      ['stdout-stderr-64k', 64 * 1024],
      ['stdout-stderr-long', 256 * 1024],
    ]);
    const agentReports = [];
    await fs.mkdir(path.join(paths.workspaceRuntimeRoot, 'agent-check-logs'), {
      recursive: true,
    });
    for (const [label, size] of byteSizes) {
      const ran = spawnSync(
        process.execPath,
        [
          path.join(root, 'check-output.mjs'),
          path.join(paths.workspaceRuntimeRoot, 'check-counts.json'),
          label,
          String(size),
        ],
        { cwd: root, maxBuffer: 2 * 1024 * 1024 },
      );
      expect(ran.status).toBe(0);
      expect(ran.stdout.length).toBe(size);
      expect(ran.stderr.length).toBe(size);
      const log = path.join(paths.workspaceRuntimeRoot, 'agent-check-logs', label + '.log');
      await fs.writeFile(log, Buffer.concat([ran.stdout, ran.stderr]));
      expect((await fs.stat(log)).size).toBe(size * 2);
      agentReports.push({
        name: label,
        result: 'passed' as const,
        note: 'SIMULATED Agent executed a real ordinary Node check; full logs remain on disk',
      });
    }
    expect(await readCounters()).toEqual(
      Object.fromEntries([...byteSizes.keys()].map((id) => [id, 1])),
    );
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
        acceptanceReview: fixtureAcceptanceReview(['A1', 'A2']),
        review: passedReview('reviewer-repair-2'),
        checks: agentReports,
      },
    });
    await dispatchNativePortableVerifier({
      paths,
      name,
      verifierExecutionId: 'verifier-complete',
    });
    const passed = await submitNativePortableVerifierResult({
      paths,
      name,
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
              {
                id: 'A1',
                result: 'passed',
                reason: 'All three long-output checks passed.',
              },
              {
                id: 'A2',
                result: 'passed',
                reason: 'Archive no longer reruns verification.',
              },
            ],
            risks: [],
            summary:
              'SIMULATED independent reviewer checked all acceptance criteria and real platform check logs.',
          },
        },
      }),
    });
    expect(passed.state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
      loop: {
        stage: 'await-user',
        iteration: 2,
        attempt: 1,
        next_action: 'confirm-skill-coordinated-pass',
      },
    });
    expect(passed.state.verification!.checks).toEqual([]);
    expect(passed.state.verification!.reported_checks).toEqual(
      passed.state.builder_handoff!.checks,
    );
    expect(passed.state.verification!.reported_checks).toHaveLength(3);
    expect(JSON.stringify(passed.state)).not.toContain('o'.repeat(4096));
    await expectNoLegacyVerificationArtifacts();

    // SIMULATED USER explicitly accepts the current independently reviewed result.
    const confirmed = await confirmNativePortableSkillCoordinatedPass({
      paths,
      name,
      expectedContinuation: {
        stateVersion: passed.state.state_version,
        action: 'accept-result',
      },
    });
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
    const retainedRuntime = await fs.readdir(nativePreferredChangeRuntimeDir(paths, name), {
      recursive: true,
    });
    expect(retainedRuntime.map(String).join('\n')).not.toMatch(
      /(?:^|[\\/])state\.json|check-logs|snapshot|manifest/iu,
    );
    await expectNoLegacyVerificationArtifacts();
  });
});
