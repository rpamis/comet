import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { readNativeLocalExecution } from '../../../domains/comet-native/native-local-execution.js';
import { withNativeMutationLock } from '../../../domains/comet-native/native-mutation-lock.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  confirmNativePortableShape,
  confirmNativePortableSkillCoordinatedPass,
  createNativePortableChange,
  dispatchNativePortableVerifier,
  executeNativePortableCheckPlan,
  isNativePortableChange,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  nativePortableStateFile,
  readNativePortableChange,
  recordNativePortableVerifierFailure,
  retryNativePortableVerifier,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native portable Runtime vertical path', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-portable-runtime-'));
    await fs.mkdir(path.join(root, '.git'));
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, config);
    paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('bounds portable names, state discovery, and initial project configuration', async () => {
    expect(() => nativePortableChangeDir(paths, '../escape')).toThrow('Invalid Native change name');
    await expect(isNativePortableChange(paths, 'missing')).resolves.toBe(false);

    await createNativePortableChange({
      paths,
      name: 'discovery-branches',
      language: 'en',
      initialProjectConfig: defaultProjectConfig('docs', 'en'),
    });
    expect(await fs.readFile(paths.configFile, 'utf8')).toContain('artifact_root');
    await expect(isNativePortableChange(paths, 'discovery-branches')).resolves.toBe(true);

    const stateFile = nativePortableStateFile(paths, 'discovery-branches');
    await fs.writeFile(stateFile, 'not a Native state');
    await expect(isNativePortableChange(paths, 'discovery-branches')).resolves.toBe(false);
    await fs.rm(stateFile);
    await fs.mkdir(stateFile);
    await expect(isNativePortableChange(paths, 'discovery-branches')).rejects.toMatchObject({
      code: expect.any(String),
    });
    await fs.rm(stateFile, { recursive: true });

    await expect(
      createNativePortableChange({ paths, name: 'bad_name', language: 'en' }),
    ).rejects.toThrow('Invalid Native change name');
  });

  it('discovers proposed and modified capabilities while ignoring non-directories', async () => {
    await createNativePortableChange({ paths, name: 'discovery', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'discovery');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The discovered capability is valid.\n',
    );
    await fs.writeFile(path.join(changeDir, 'specs', 'README.md'), 'ignored');
    await fs.mkdir(path.join(changeDir, 'specs', 'new-capability'));
    await fs.writeFile(
      path.join(changeDir, 'specs', 'new-capability', 'spec.md'),
      '# Requirement\nThe new capability works.\n',
    );
    await fs.mkdir(path.join(paths.specsDir, 'existing-capability'), { recursive: true });
    await fs.writeFile(path.join(paths.specsDir, 'existing-capability', 'spec.md'), 'old');
    await fs.mkdir(path.join(changeDir, 'specs', 'existing-capability'));
    await fs.writeFile(
      path.join(changeDir, 'specs', 'existing-capability', 'spec.md'),
      '# Requirement\nThe existing capability works.\n',
    );

    await expect(confirmNativePortableShape({ paths, name: 'discovery' })).resolves.toMatchObject({
      spec_changes: [
        { capability: 'existing-capability', operation: 'modify' },
        { capability: 'new-capability', operation: 'create' },
      ],
    });

    await fs.mkdir(path.join(changeDir, 'specs', 'bad_name'));
    await expect(confirmNativePortableShape({ paths, name: 'discovery' })).rejects.toThrow(
      'Invalid Native capability',
    );
  });

  it('creates only portable user artifacts and one local execution overlay', async () => {
    await createNativePortableChange({ paths, name: 'small-change', language: 'en' });

    expect((await fs.readdir(nativePortableChangeDir(paths, 'small-change'))).sort()).toEqual([
      'brief.md',
      'comet-state.yaml',
      'specs',
    ]);
    expect(await fs.readdir(path.dirname(nativeLocalExecutionFile(paths, 'small-change')))).toEqual(
      ['state.json'],
    );
    const allFiles = await fs.readdir(root, { recursive: true });
    expect(allFiles.join('\n')).not.toMatch(
      /baseline|snapshot|trajectory|checkpoint|receipt|evidence|run-state/iu,
    );
  });

  it('confirms formal Markdown larger than the retired four-megabyte budget', async () => {
    await createNativePortableChange({ paths, name: 'large-formal-doc', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'large-formal-doc');
    const padding = 'x'.repeat(4 * 1024 * 1024 + 1_024);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Acceptance examples\n- The large formal document remains valid.\n\n# Notes\n<!-- ${padding} -->\n`,
    );

    await expect(
      confirmNativePortableShape({ paths, name: 'large-formal-doc' }),
    ).resolves.toMatchObject({
      phase: 'build',
      acceptance: [{ id: 'A1', text: 'The large formal document remains valid.' }],
    });
  });

  it('keeps v2 child plans readable while retaining the complete Runtime acceptance matrix', async () => {
    await createNativePortableChange({ paths, name: 'readable-child-plan', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'readable-child-plan');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The first behavior is visible.\n- The second behavior is visible.\n',
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'demo'));
    await fs.writeFile(
      path.join(changeDir, 'specs', 'demo', 'spec.md'),
      '# Requirement: Demo\nThe Runtime MUST preserve the formal requirement.\n\n## Scenarios\n### Scenario: Formal behavior\n- **WHEN** the behavior is exercised\n- **THEN** the formal result is retained\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'children.yaml'),
      `schema: comet.native.children.v2
acceptance_index:
  A1:
    source: brief.md
    text: The first behavior is visible.
  A2:
    source: brief.md
    text: The second behavior is visible.
children:
  - name: demo-child
    depends_on: []
    covers: [A1, A2]
`,
    );
    const stateFile = nativePortableStateFile(paths, 'readable-child-plan');
    const initialState = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(
      stateFile,
      initialState
        .replace("isolation: 'current'", "isolation: 'branch'")
        .replace('change_branch: null', 'change_branch: parent')
        .replace('target_branch: null', 'target_branch: master'),
    );

    const state = await confirmNativePortableShape({ paths, name: 'readable-child-plan' });

    expect(state.acceptance.length).toBeGreaterThan(2);
    expect(state.acceptance.filter(({ source }) => source === 'brief.md')).toHaveLength(2);
    expect(state.children_contract_hash).toEqual(expect.any(String));
  });

  it('reruns a repeatable interrupted check instead of reusing its incomplete result', async () => {
    await createNativePortableChange({ paths, name: 'timeout-rerun', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'timeout-rerun');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- A repeatable timeout can be retried.\n',
    );
    let state = await confirmNativePortableShape({ paths, name: 'timeout-rerun' });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'timeout-builder',
        }),
        candidateId: 'timeout-candidate',
        summary: 'Implemented.',
        addressedAcceptanceIds: ['A1'],
      },
    });
    const plan = {
      id: 'timeout-check',
      name: 'Timeout check',
      executable: process.execPath,
      argv: ['-e', 'setTimeout(() => {}, 250)'],
      cwdRef: '.',
      timeoutMs: 20,
      repeatable: true,
    } as const;

    const first = await executeNativePortableCheckPlan({ paths, name: state.name, plans: [plan] });
    expect(first.checks).toMatchObject([{ id: plan.id, status: 'interrupted' }]);
    const second = await executeNativePortableCheckPlan({ paths, name: state.name, plans: [plan] });
    expect(second.checks).toMatchObject([{ id: plan.id, status: 'interrupted' }]);
    const local = await readNativeLocalExecution(nativeLocalExecutionFile(paths, state.name));
    expect(local?.checks).toMatchObject([
      { id: plan.id, status: 'interrupted', executionCount: 2 },
    ]);
  });

  it('runs one final check, accepts a trusted complete Verifier result, and writes the report', async () => {
    await createNativePortableChange({ paths, name: 'verify-change', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'verify-change');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Ship the behavior.

# Acceptance examples
- The implemented command prints ready.
`,
    );
    let state = await confirmNativePortableShape({ paths, name: 'verify-change' });
    expect(state).toMatchObject({ phase: 'build', loop: { iteration: 1, stage: 'building' } });

    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'builder-1',
        }),
        candidateId: 'candidate-1',
        summary: 'Implemented the behavior.',
        addressedAcceptanceIds: ['A1'],
      },
    });
    const executed = await executeNativePortableCheckPlan({
      paths,
      name: state.name,
      plans: [
        {
          id: 'behavior',
          name: 'Behavior check',
          executable: process.execPath,
          argv: ['-e', "console.log('ready')"],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: executed.checks,
      verifierExecutionId: 'verifier-1',
    });
    const submitted = await submitNativePortableVerifierResult({
      paths,
      name: state.name,
      checks: executed.checks,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: 'candidate-1',
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'verifier-1',
        }),
        payload: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [
              { id: 'A1', result: 'passed', reason: 'Ran the command and observed ready.' },
            ],
            risks: [],
            summary: 'The candidate satisfies the confirmed behavior.',
          },
        },
      }),
    });

    expect(submitted.state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
      loop: { stage: 'await-user', iteration: 1, attempt: 1 },
    });
    const confirmed = await confirmNativePortableSkillCoordinatedPass({
      paths,
      name: state.name,
    });
    expect(confirmed).toMatchObject({
      phase: 'archive',
      loop: { stage: 'archive-ready', iteration: 1, attempt: 1 },
    });
    expect(await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8')).toContain(
      'generated_from_state_version:',
    );
    expect((await readNativePortableChange(paths, state.name)).state_version).toBe(
      confirmed.state_version,
    );
  });

  it('returns to Shape when formal acceptance changes before the Verifier result', async () => {
    await createNativePortableChange({ paths, name: 'formal-drift', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'formal-drift');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The original behavior works.\n',
    );
    let state = await confirmNativePortableShape({ paths, name: 'formal-drift' });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'drift-builder',
        }),
        candidateId: 'drift-candidate',
        summary: 'Implemented.',
        addressedAcceptanceIds: ['A1'],
      },
    });
    const executed = await executeNativePortableCheckPlan({ paths, name: state.name, plans: [] });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: executed.checks,
      verifierExecutionId: 'drift-verifier',
    });
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The original behavior works.\n- A newly requested behavior works.\n',
    );

    await expect(
      submitNativePortableVerifierResult({
        paths,
        name: state.name,
        checks: executed.checks,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'drift-candidate',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'drift-verifier',
          }),
          payload: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Original behavior passed.' }],
              risks: [],
              summary: 'Passed the old requirements.',
            },
          },
        }),
      }),
    ).rejects.toThrow('returned to Shape');
    await expect(readNativePortableChange(paths, state.name)).resolves.toMatchObject({
      phase: 'shape',
      verification_result: 'pending',
      builder_handoff: null,
    });
  });

  it('bounds request-checks per attempt, reuses normalized successes, and streams new checks once', async () => {
    await createNativePortableChange({ paths, name: 'request-checks', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'request-checks');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Ship the behavior.

# Acceptance examples
- The requested checks and the behavior both pass.
`,
    );
    let state = await confirmNativePortableShape({ paths, name: 'request-checks' });
    const runner = createNativeRunnerChannel();
    const builder = runner.captureExecutionIdentity({
      identityProvider: 'test-host',
      executionRef: 'builder-request-checks',
    });
    const verifier = runner.captureExecutionIdentity({
      identityProvider: 'test-host',
      executionRef: 'verifier-request-checks',
    });
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: builder,
        candidateId: 'candidate-request-checks',
        summary: 'Implemented the requested behavior.',
        addressedAcceptanceIds: ['A1'],
      },
    });
    const baselinePlan = {
      id: 'baseline',
      name: 'Baseline check',
      executable: process.execPath,
      argv: ['-e', "console.log('baseline')"],
      cwdRef: '.',
      timeoutMs: 10_000,
      repeatable: true,
    };
    const baseline = await executeNativePortableCheckPlan({
      paths,
      name: state.name,
      plans: [baselinePlan],
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: baseline.checks,
      verifierExecutionId: 'verifier-request-checks',
    });

    const first = await submitNativePortableVerifierResult({
      paths,
      name: state.name,
      checks: baseline.checks,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: 'candidate-request-checks',
        identity: verifier,
        payload: {
          kind: 'request-checks',
          iteration: 1,
          attempt: 1,
          checks: [
            { ...baselinePlan, id: 'baseline-alias', name: 'Baseline alias' },
            { ...baselinePlan, id: 'baseline-alias', name: 'Baseline alias' },
            {
              id: 'extra',
              name: 'Extra check',
              executable: process.execPath,
              argv: ['-e', "console.log('extra')"],
              cwdRef: '.',
              timeoutMs: 10_000,
              repeatable: true,
            },
          ],
        },
      }),
    });
    expect(first.requestChecks).toEqual({
      round: 1,
      reusedCheckIds: ['baseline-alias'],
      executedCheckIds: ['extra'],
    });
    expect(first.checks.map(({ id }) => id)).toEqual(['baseline', 'extra']);

    const second = await submitNativePortableVerifierResult({
      paths,
      name: state.name,
      checks: first.checks,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: 'candidate-request-checks',
        identity: verifier,
        payload: {
          kind: 'request-checks',
          iteration: 1,
          attempt: 1,
          checks: [
            {
              ...baselinePlan,
              id: 'baseline-longer-timeout',
              name: 'Baseline with a longer timeout',
              timeoutMs: 20_000,
            },
            {
              id: 'long-output',
              name: 'Long output check',
              executable: process.execPath,
              argv: ['-e', "process.stdout.write('x'.repeat(256 * 1024))"],
              cwdRef: '.',
              timeoutMs: 10_000,
              repeatable: true,
            },
          ],
        },
      }),
    });
    expect(second.requestChecks).toEqual({
      round: 2,
      reusedCheckIds: [],
      executedCheckIds: ['baseline-longer-timeout', 'long-output'],
    });
    const local = await readNativeLocalExecution(nativeLocalExecutionFile(paths, state.name));
    expect(local?.execution?.requestCheckRounds).toBe(2);
    expect(local?.checks.find(({ id }) => id === 'baseline')?.executionCount).toBe(1);
    expect(local?.checks.find(({ id }) => id === 'baseline-longer-timeout')?.executionCount).toBe(
      1,
    );
    const longOutputLog = local?.checks.find(({ id }) => id === 'long-output')?.log;
    expect(longOutputLog).toBeTruthy();
    expect(
      (
        await fs.stat(
          path.join(path.dirname(nativeLocalExecutionFile(paths, state.name)), longOutputLog!),
        )
      ).size,
    ).toBe(256 * 1024);

    const completed = await submitNativePortableVerifierResult({
      paths,
      name: state.name,
      checks: second.checks,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: 'candidate-request-checks',
        identity: verifier,
        payload: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [
              { id: 'A1', result: 'passed', reason: 'All requested behavior was observed.' },
            ],
            risks: ['diagnostic'.repeat(100_000)],
            summary: 'The candidate and every Runtime check passed.',
          },
        },
      }),
    });
    expect(completed.state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
    });
    await expect(
      confirmNativePortableSkillCoordinatedPass({ paths, name: state.name }),
    ).resolves.toMatchObject({ phase: 'archive' });
    expect(completed.state.verification?.risks[0]).toMatchObject({ truncated: true });
  });

  it('does not hold the project mutation lock while a requested check is running', async () => {
    await createNativePortableChange({ paths, name: 'requested-check-lock', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'requested-check-lock');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- Verifier checks run without blocking unrelated Native mutations.\n',
    );
    let state = await confirmNativePortableShape({ paths, name: 'requested-check-lock' });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'lock-builder',
        }),
        candidateId: 'lock-candidate',
        summary: 'Implemented.',
        addressedAcceptanceIds: ['A1'],
      },
    });
    const baseline = await executeNativePortableCheckPlan({ paths, name: state.name, plans: [] });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: baseline.checks,
      verifierExecutionId: 'lock-verifier',
    });
    const marker = path.join(root, 'requested-check-started');
    const running = submitNativePortableVerifierResult({
      paths,
      name: state.name,
      checks: baseline.checks,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: 'lock-candidate',
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'lock-verifier',
        }),
        payload: {
          kind: 'request-checks',
          iteration: 1,
          attempt: 1,
          checks: [
            {
              id: 'slow-check',
              name: 'Slow check',
              executable: process.execPath,
              argv: [
                '-e',
                `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); setTimeout(() => process.exit(0), 2500)`,
              ],
              cwdRef: '.',
              timeoutMs: 10_000,
              repeatable: true,
            },
          ],
        },
      }),
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        await fs
          .stat(marker)
          .then(() => true)
          .catch(() => false)
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await expect(fs.stat(marker)).resolves.toBeDefined();

    const startedAt = Date.now();
    await withNativeMutationLock(paths, 'requested check lock probe', async () => undefined);
    const lockWaitMs = Date.now() - startedAt;
    await expect(running).resolves.toMatchObject({
      requestChecks: { executedCheckIds: ['slow-check'] },
    });
    expect(lockWaitMs).toBeLessThan(1_200);
  });

  it('records over-budget and malformed requests as execution errors and blocks after three', async () => {
    await createNativePortableChange({ paths, name: 'invalid-requests', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'invalid-requests');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Ship the behavior.

# Acceptance examples
- The behavior passes independent verification.
`,
    );
    let state = await confirmNativePortableShape({ paths, name: 'invalid-requests' });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'builder-invalid-requests',
        }),
        candidateId: 'candidate-invalid-requests',
        summary: 'Implemented the behavior.',
        addressedAcceptanceIds: ['A1'],
      },
    });
    const baselinePlan = {
      id: 'baseline',
      name: 'Baseline check',
      executable: process.execPath,
      argv: ['-e', 'process.exit(0)'],
      cwdRef: '.',
      timeoutMs: 10_000,
      repeatable: true,
    };
    const requestedPlans = [
      {
        id: 'round-one',
        name: 'round-one',
        executable: process.execPath,
        argv: ['-e', "console.log('one')"],
        cwdRef: '.',
        timeoutMs: 10_000,
        repeatable: true,
      },
      {
        id: 'round-two',
        name: 'round-two',
        executable: process.execPath,
        argv: ['-e', "console.log('two')"],
        cwdRef: '.',
        timeoutMs: 10_000,
        repeatable: true,
      },
    ];
    const baseline = await executeNativePortableCheckPlan({
      paths,
      name: state.name,
      plans: [baselinePlan],
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: baseline.checks,
      verifierExecutionId: 'verifier-invalid-1',
    });
    let checks = baseline.checks;
    for (const plan of requestedPlans) {
      const result = await submitNativePortableVerifierResult({
        paths,
        name: state.name,
        checks,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'candidate-invalid-requests',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'verifier-invalid-1',
          }),
          payload: {
            kind: 'request-checks',
            iteration: 1,
            attempt: 1,
            checks: [plan],
          },
        }),
      });
      checks = result.checks;
    }

    await expect(
      submitNativePortableVerifierResult({
        paths,
        name: state.name,
        checks,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'candidate-invalid-requests',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'verifier-invalid-1',
          }),
          payload: {
            kind: 'request-checks',
            iteration: 1,
            attempt: 1,
            checks: [
              {
                id: 'round-three',
                name: 'Round three',
                executable: process.execPath,
                argv: ['-e', 'process.exit(0)'],
                cwdRef: '.',
                timeoutMs: 10_000,
                repeatable: true,
              },
            ],
          },
        }),
      }),
    ).rejects.toThrow('exceeded 2 rounds');
    state = await readNativePortableChange(paths, state.name);
    expect(state.loop).toMatchObject({ execution_failure_count: 1, stage: 'verify-ready' });

    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks,
      verifierExecutionId: 'verifier-invalid-2',
    });
    await expect(
      submitNativePortableVerifierResult({
        paths,
        name: state.name,
        checks,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'candidate-invalid-requests',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'verifier-invalid-2',
          }),
          payload: { kind: 'request-checks', iteration: 1, attempt: 2, checks: [] },
        }),
      }),
    ).rejects.toThrow('batch must be non-empty');
    state = await readNativePortableChange(paths, state.name);
    expect(state.loop.execution_failure_count).toBe(2);

    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks,
      verifierExecutionId: 'verifier-invalid-3',
    });
    await expect(
      submitNativePortableVerifierResult({
        paths,
        name: state.name,
        checks,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'candidate-invalid-requests',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'verifier-invalid-3',
          }),
          payload: { kind: 'request-checks', iteration: 1, attempt: 3, checks: [] },
        }),
      }),
    ).rejects.toThrow('batch must be non-empty');
    state = await readNativePortableChange(paths, state.name);
    expect(state).toMatchObject({
      phase: 'verify',
      status: 'blocked',
      loop: {
        stage: 'blocked',
        attempt: 3,
        execution_failure_count: 3,
      },
    });

    state = await retryNativePortableVerifier({ paths, name: state.name });
    const reused = await executeNativePortableCheckPlan({
      paths,
      name: state.name,
      plans: [baselinePlan, ...requestedPlans],
    });
    const local = await readNativeLocalExecution(nativeLocalExecutionFile(paths, state.name));
    expect(reused.checks.map(({ id }) => id)).toEqual(['baseline', 'round-one', 'round-two']);
    expect(local?.checks.map(({ executionCount }) => executionCount)).toEqual([1, 1, 1]);
  });

  it('rejects a late host response without charging the current Verifier attempt', async () => {
    await createNativePortableChange({ paths, name: 'late-host-response', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'late-host-response');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- Late Verifier responses cannot mutate the current attempt.\n',
    );
    let state = await confirmNativePortableShape({ paths, name: 'late-host-response' });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'late-builder',
        }),
        candidateId: 'late-candidate',
        summary: 'Implemented.',
        addressedAcceptanceIds: ['A1'],
      },
    });
    const executed = await executeNativePortableCheckPlan({ paths, name: state.name, plans: [] });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: executed.checks,
      verifierExecutionId: 'late-verifier-1',
    });
    state = await recordNativePortableVerifierFailure({
      paths,
      name: state.name,
      summary: 'First execution ended before producing a result.',
      expected: {
        stateVersion: state.state_version,
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verifierExecutionRef: 'late-verifier-1',
      },
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: executed.checks,
      verifierExecutionId: 'late-verifier-2',
    });
    const before = state;

    await expect(
      submitNativePortableVerifierResult({
        paths,
        name: state.name,
        checks: executed.checks,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'late-candidate',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'late-verifier-1',
          }),
          payload: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Late result.' }],
              risks: [],
              summary: 'Late result.',
            },
          },
        }),
      }),
    ).rejects.toThrow('stale for the active execution');
    const after = await readNativePortableChange(paths, state.name);
    expect(after.state_version).toBe(before.state_version);
    expect(after.loop.execution_failure_count).toBe(before.loop.execution_failure_count);
    expect(after.loop.attempt).toBe(2);
  });

  it('rejects a repeated equivalent request after returning the reusable result once', async () => {
    await createNativePortableChange({ paths, name: 'repeat-request', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'repeat-request');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Ship the behavior.

# Acceptance examples
- The behavior passes verification.
`,
    );
    let state = await confirmNativePortableShape({ paths, name: 'repeat-request' });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'builder-repeat-request',
        }),
        candidateId: 'candidate-repeat-request',
        summary: 'Implemented the behavior.',
        addressedAcceptanceIds: ['A1'],
      },
    });
    const plan = {
      id: 'same-check',
      name: 'Same check',
      executable: process.execPath,
      argv: ['-e', 'process.exit(0)'],
      cwdRef: '.',
      timeoutMs: 10_000,
      repeatable: true,
    };
    const baseline = await executeNativePortableCheckPlan({
      paths,
      name: state.name,
      plans: [plan],
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: baseline.checks,
      verifierExecutionId: 'verifier-repeat-request',
    });
    const identity = runner.captureExecutionIdentity({
      identityProvider: 'test-host',
      executionRef: 'verifier-repeat-request',
    });
    const payload = {
      kind: 'request-checks' as const,
      iteration: 1,
      attempt: 1,
      checks: [plan],
    };
    const first = await submitNativePortableVerifierResult({
      paths,
      name: state.name,
      checks: baseline.checks,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: 'candidate-repeat-request',
        identity,
        payload,
      }),
    });
    expect(first.requestChecks).toEqual({
      round: 1,
      reusedCheckIds: ['same-check'],
      executedCheckIds: [],
    });
    await expect(
      submitNativePortableVerifierResult({
        paths,
        name: state.name,
        checks: first.checks,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'candidate-repeat-request',
          identity,
          payload,
        }),
      }),
    ).rejects.toThrow('equivalent checks');
    expect((await readNativePortableChange(paths, state.name)).loop.execution_failure_count).toBe(
      1,
    );
  });

  it('derives final check status from Runtime execution instead of caller summaries', async () => {
    await createNativePortableChange({ paths, name: 'runtime-owned-checks', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'runtime-owned-checks');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Ship the behavior.

# Acceptance examples
- The behavior passes its final check.
`,
    );
    let state = await confirmNativePortableShape({ paths, name: 'runtime-owned-checks' });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'builder-runtime-owned',
        }),
        candidateId: 'candidate-runtime-owned',
        summary: 'Implemented the behavior.',
        addressedAcceptanceIds: ['A1'],
      },
    });
    const executed = await executeNativePortableCheckPlan({
      paths,
      name: state.name,
      plans: [
        {
          id: 'failing-check',
          name: 'Failing check',
          executable: process.execPath,
          argv: ['-e', 'process.exit(7)'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    });
    const forgedSummary = [{ ...executed.checks[0], status: 'passed' as const, exit_code: 0 }];
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: forgedSummary,
      verifierExecutionId: 'verifier-runtime-owned',
    });
    await expect(
      submitNativePortableVerifierResult({
        paths,
        name: state.name,
        checks: forgedSummary,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'candidate-runtime-owned',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'verifier-runtime-owned',
          }),
          payload: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Claimed complete.' }],
              risks: [],
              summary: 'Claimed pass.',
            },
          },
        }),
      }),
    ).rejects.toThrow('required check');
    expect(await readNativePortableChange(paths, state.name)).toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      loop: { execution_failure_count: 1, stage: 'verify-ready' },
    });
  });
});
