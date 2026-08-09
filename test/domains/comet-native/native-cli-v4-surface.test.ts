import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { readNativeLocalExecution } from '../../../domains/comet-native/native-local-execution.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { nativeLocalExecutionFile } from '../../../domains/comet-native/native-portable-runtime.js';

interface JsonEnvelope {
  command: string | null;
  exitCode: number;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function json(result: Awaited<ReturnType<typeof runNativeCli>>): JsonEnvelope {
  expect(result.stdout).toBeTruthy();
  return JSON.parse(result.stdout!) as JsonEnvelope;
}

describe('Native v4 public CLI surface', () => {
  let projectRoot: string;
  let runnerInputSequence: number;
  const projectArgs = () => ['--project-root', projectRoot] as const;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-v4-cli-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    runnerInputSequence = 0;
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function runnerStep(name: string, input: unknown): Promise<JsonEnvelope> {
    runnerInputSequence += 1;
    let payload = input;
    if (
      input &&
      typeof input === 'object' &&
      (input as { kind?: string }).kind &&
      ['verifier-execution-error', 'verifier-unavailable'].includes(
        (input as { kind: string }).kind,
      ) &&
      !('stateVersion' in input)
    ) {
      const current = json(await runNativeCli(['show', name, '--json', ...projectArgs()]));
      const state = current.data?.state as {
        state_version: number;
        loop: { iteration: number; attempt: number };
      };
      const local = await readNativeLocalExecution(
        nativeLocalExecutionFile(await nativeProjectPaths(projectRoot, 'docs'), name),
      );
      payload = {
        ...(input as Record<string, unknown>),
        stateVersion: state.state_version,
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verifierExecutionRef: local?.execution?.executionId,
      };
    }
    const file = path.join(projectRoot, `.native-runner-input-${runnerInputSequence}.json`);
    await fs.writeFile(file, JSON.stringify(payload));
    try {
      return json(
        await runNativeCli(['next', name, '--runner-input', file, '--json', ...projectArgs()]),
      );
    } finally {
      await fs.rm(file, { force: true });
    }
  }

  async function prepareBuild(name: string, acceptance: string[] = ['First behavior works.']) {
    await runNativeCli(['new', name, ...projectArgs()]);
    const brief = `# Outcome
Ship the requested behavior.
# Scope
Keep the implementation focused.
# Non-goals
No unrelated changes.
# Acceptance examples
${acceptance.map((entry) => `- ${entry}`).join('\n')}
# Constraints and invariants
Preserve existing behavior.
# Decisions
Use the smallest implementation.
# Open questions
None.
# Verification expectations
Run applicable focused checks.
`;
    await fs.writeFile(path.join(projectRoot, 'docs', 'comet', 'changes', name, 'brief.md'), brief);
    const confirmed = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Shared understanding confirmed',
        '--confirmed',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(confirmed).toMatchObject({ exitCode: 0, data: { state: { phase: 'build' } } });
    return confirmed;
  }

  function builderHandoff(addressedAcceptanceIds: string[]) {
    return {
      kind: 'builder-handoff',
      summary: 'Implemented the confirmed behavior.',
      addressed_acceptance_ids: addressedAcceptanceIds,
      checks: [],
      known_limits: [],
    };
  }

  function finalResponse(iteration: number, attempt: number, acceptanceIds: string[]) {
    return {
      kind: 'verifier-response',
      response: {
        kind: 'final-result',
        result: {
          iteration,
          attempt,
          verdict: 'pass',
          acceptance: acceptanceIds.map((id) => ({
            id,
            result: 'passed',
            reason: `Observed ${id}.`,
          })),
          risks: [],
          summary: 'All acceptance criteria were independently reviewed.',
        },
      },
    };
  }

  it('documents stable-boundary and honestly labeled Skill coordination operations', async () => {
    const root = await runNativeCli(['--help']);
    const next = await runNativeCli(['next', '--help']);
    const archive = await runNativeCli(['archive', '--help']);
    const status = await runNativeCli(['status', '--help']);

    expect(root.stdout).toContain('skill-coordinated');
    expect(next.stdout).toContain('continuation.runnerAction');
    expect(next.stdout).toContain('--runner-input <file>');
    expect(next.stdout).toContain('not trusted identity attestation');
    expect(next.stdout).toContain('--retry-verifier');
    expect(next.stdout).toContain('--resolve-verifier-blocker');
    expect(next.stdout).toContain('verifier-unavailable');
    expect(archive.stdout).toContain('does not repeat verification');
    expect(status.stdout).toContain('local execution availability');
    for (const output of [root.stdout!, next.stdout!, archive.stdout!, status.stdout!]) {
      expect(output).not.toMatch(
        /checkpoint|receipt|evidence|preflight|sha256|--result|--report|--acceptance-cursor/iu,
      );
    }
    expect([root.stdout!, next.stdout!].join('\n')).not.toMatch(
      /runner-attested|host-attested|trusted Runner operations/iu,
    );

    const retiredSpec = json(await runNativeCli(['spec', 'rebase', '--help', '--json']));
    expect(retiredSpec).toMatchObject({ exitCode: 64, error: { code: 'usage' } });
  });

  it('returns v4 continuations and rejects retired Agent-authored verification inputs', async () => {
    const created = json(await runNativeCli(['new', 'surface-test', '--json', ...projectArgs()]));
    expect(created).toMatchObject({
      command: 'new',
      exitCode: 0,
      data: {
        schema: 'comet.native.v4',
        continuation: {
          schema: 'comet.native.continuation.v2',
          action: 'confirm-shape',
          runnerAction: { kind: 'none' },
        },
      },
    });

    for (const command of ['show', 'status', 'doctor']) {
      const result = json(
        await runNativeCli([command, 'surface-test', '--json', ...projectArgs()]),
      );
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        continuation: {
          schema: 'comet.native.continuation.v2',
          action: 'confirm-shape',
          runnerAction: { kind: 'none' },
        },
      });
    }

    const removed = json(
      await runNativeCli([
        'spec',
        'remove',
        'surface-test',
        'legacy-capability',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(removed).toMatchObject({
      exitCode: 0,
      data: {
        continuation: {
          schema: 'comet.native.continuation.v2',
          action: 'confirm-shape',
          runnerAction: { kind: 'none' },
        },
      },
    });

    const archive = json(
      await runNativeCli(['archive', 'surface-test', '--dry-run', '--json', ...projectArgs()]),
    );
    expect(archive).toMatchObject({
      exitCode: 0,
      data: {
        ready: false,
        continuation: { runnerAction: { kind: 'none' } },
      },
    });

    for (const args of [
      ['next', 'surface-test', '--summary', 'self reported', '--result', 'pass'],
      ['archive', 'surface-test', '--expect-preflight', 'a'.repeat(64)],
    ]) {
      const result = json(await runNativeCli([...args, '--json', ...projectArgs()]));
      expect(result).toMatchObject({ exitCode: 64, error: { code: 'usage' } });
    }

    const portableStrategy = json(
      await runNativeCli([
        'doctor',
        'surface-test',
        '--strategy',
        'continue',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(portableStrategy).toMatchObject({
      exitCode: 64,
      error: {
        code: 'usage',
        message: '--strategy is only available to the legacy transaction doctor',
      },
    });

    const projectRepair = json(
      await runNativeCli(['doctor', '--repair', '--json', ...projectArgs()]),
    );
    expect(projectRepair).toMatchObject({
      exitCode: 0,
      data: { healthy: true, workflow: 'native-portable', repaired: true },
    });

    for (const command of ['checkpoint', 'check', 'evidence', 'receipt']) {
      const result = json(await runNativeCli([command, '--json', ...projectArgs()]));
      expect(result).toMatchObject({
        command,
        exitCode: 64,
        error: { code: 'usage', message: `Unknown Native command: ${command}` },
      });
    }
  });

  it('rejects caller-supplied identity, provider, execution, and candidate bindings', async () => {
    await prepareBuild('reject-forged-runner-fields');
    for (const forged of [
      { identity: { provider: 'forged-host', execution_ref: 'forged-builder' } },
      { provider: 'forged-host' },
      { execution_ref: 'forged-builder' },
      { candidate_id: 'forged-candidate' },
    ]) {
      const result = await runnerStep('reject-forged-runner-fields', {
        ...builderHandoff(['A1']),
        ...forged,
      });
      expect(result).toMatchObject({
        exitCode: 65,
        error: { code: 'invalid-data', message: expect.stringContaining('fields are invalid') },
      });
    }

    expect(
      json(
        await runNativeCli(['status', 'reject-forged-runner-fields', '--json', ...projectArgs()]),
      ).data,
    ).toMatchObject({ phase: 'build', loop: { attempt: 0 } });
  });

  it('drives a complete skill-coordinated CLI loop to Archive with an explicit empty check plan', async () => {
    const name = 'skill-coordinated-loop';
    const readyForBuilder = await prepareBuild(name, [
      'First behavior works.',
      'Second behavior works.',
    ]);
    expect(readyForBuilder).toMatchObject({
      data: {
        continuation: {
          action: 'builder-handoff',
          inputOptions: [
            {
              flag: '--runner-input',
              valueKind: 'json-file',
              template: {
                kind: 'builder-handoff',
                summary: '<summary>',
                addressed_acceptance_ids: ['<acceptance-id>'],
                known_limits: [],
              },
            },
          ],
        },
      },
    });

    const built = await runnerStep(name, builderHandoff(['A1', 'A2']));
    expect(built).toMatchObject({
      exitCode: 0,
      data: {
        coordination: 'skill-coordinated',
        state: {
          phase: 'verify',
          builder_handoff: { candidate_id: expect.any(String) },
          loop: { iteration: 1, attempt: 0 },
        },
        continuation: {
          action: 'dispatch-verifier',
          commandArgs: ['comet', 'native', 'next', name, '--runner-input', '<temporary-json-file>'],
        },
      },
    });
    expect(built.data).not.toHaveProperty('runnerAssurance');

    const dispatched = await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    expect(dispatched).toMatchObject({
      exitCode: 0,
      data: {
        coordination: 'skill-coordinated',
        checks: [],
        state: { phase: 'verify', loop: { iteration: 1, attempt: 1 } },
        verifierDispatch: {
          coordination: 'skill-coordinated',
          change: name,
          candidateId: expect.any(String),
          iteration: 1,
          attempt: 1,
          briefRef: 'brief.md',
          specRefs: [],
          acceptance: [
            { id: 'A1', source: 'brief.md', text: 'First behavior works.' },
            { id: 'A2', source: 'brief.md', text: 'Second behavior works.' },
          ],
          builderHandoff: {
            summary: { text: 'Implemented the confirmed behavior.' },
            addressedAcceptanceIds: ['A1', 'A2'],
          },
          runtimeChecks: [],
        },
      },
    });
    const dispatch = (dispatched.data as { verifierDispatch: Record<string, unknown> })
      .verifierDispatch;
    expect(JSON.stringify(dispatch)).not.toMatch(/identity|provider/iu);
    expect(dispatch).toMatchObject({
      stateVersion: expect.any(Number),
      verifierExecutionRef: expect.stringContaining('skill-coordinated:verifier:'),
    });
    const responseInputs = (
      dispatched.data as {
        continuation: { inputOptions: Array<{ template: unknown }> };
      }
    ).continuation.inputOptions;
    expect(JSON.stringify(responseInputs)).toContain('request-checks');
    expect(JSON.stringify(responseInputs)).toContain('final-result');
    expect(JSON.stringify(responseInputs)).toContain('verifier-execution-error');
    expect(JSON.stringify(responseInputs)).not.toMatch(/identity|provider/iu);

    const forgedCandidate = await runnerStep(name, {
      ...finalResponse(1, 1, ['A1', 'A2']),
      candidate_id: 'caller-selected-candidate',
    });
    expect(forgedCandidate).toMatchObject({
      exitCode: 65,
      error: { message: expect.stringContaining('fields are invalid') },
    });

    const awaitingConfirmation = await runnerStep(name, finalResponse(1, 1, ['A1', 'A2']));
    expect(awaitingConfirmation).toMatchObject({
      exitCode: 0,
      data: {
        coordination: 'skill-coordinated',
        state: {
          phase: 'verify',
          status: 'await-user',
          verification_result: 'pass',
          verification: { checks: [] },
          blockers: [
            {
              owner: 'user',
              resolution_action: 'await-user',
              reason: { text: expect.stringContaining('cannot prove') },
            },
          ],
          loop: {
            stage: 'await-user',
            iteration: 1,
            attempt: 1,
            next_action: 'confirm-skill-coordinated-pass',
          },
        },
        verifierDispatch: null,
        continuation: {
          disposition: 'await-user',
          action: 'confirm-skill-coordinated-pass',
        },
      },
    });
    const pendingReport = await fs.readFile(
      path.join(projectRoot, 'docs', 'comet', 'changes', name, 'verification.md'),
      'utf8',
    );
    expect(pendingReport).toContain('Result: **Passed, user confirmation required**');
    expect(pendingReport).toContain('Assurance: **skill-coordinated**');

    const confirmed = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'User accepts the Skill-coordinated verification boundary',
        '--confirmed',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(confirmed).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'archive',
          status: 'active',
          blockers: [],
          loop: { stage: 'archive-ready', next_action: 'archive' },
        },
        continuation: { action: 'archive' },
      },
    });
    expect(
      await fs.readFile(
        path.join(projectRoot, 'docs', 'comet', 'changes', name, 'verification.md'),
        'utf8',
      ),
    ).toContain('Result: **Passed**');
  });

  it.each([
    { name: 'verifier-unavailable-empty', withCheck: false },
    { name: 'verifier-unavailable-checked', withCheck: true },
  ])(
    'requires user confirmation for degraded semantic verification ($name)',
    async ({ name, withCheck }) => {
      await prepareBuild(name);
      await runnerStep(name, builderHandoff(['A1']));
      const checks = withCheck
        ? [
            {
              id: 'runtime-pass',
              name: 'Runtime pass',
              executable: process.execPath,
              argv: ['-e', 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10_000,
              repeatable: true,
            },
          ]
        : [];
      await runnerStep(name, { kind: 'dispatch-verifier', checks });

      const forged = await runnerStep(name, {
        kind: 'verifier-unavailable',
        summary: 'No independent Agent execution is available.',
        provider: 'caller-selected-provider',
      });
      expect(forged).toMatchObject({
        exitCode: 65,
        error: { message: expect.stringContaining('fields are invalid') },
      });

      const unavailable = await runnerStep(name, {
        kind: 'verifier-unavailable',
        summary: 'This platform cannot start an independent Agent execution.',
      });
      expect(unavailable).toMatchObject({
        exitCode: 0,
        data: {
          coordination: 'skill-coordinated',
          state: {
            phase: 'verify',
            status: 'await-user',
            verification_result: 'blocked',
            verification: {
              assurance: 'semantic-verification-unavailable',
              verdict: 'blocked',
              checks: withCheck ? [{ id: 'runtime-pass', status: 'passed' }] : [],
            },
            blockers: [
              {
                owner: 'user',
                resolution_action: 'confirm-verifier-unavailable',
              },
            ],
            loop: { next_action: 'confirm-verifier-unavailable' },
          },
          continuation: {
            disposition: 'await-user',
            action: 'confirm-verifier-unavailable',
          },
        },
      });
      const reportFile = path.join(
        projectRoot,
        'docs',
        'comet',
        'changes',
        name,
        'verification.md',
      );
      const pendingReport = await fs.readFile(reportFile, 'utf8');
      expect(pendingReport).toContain(
        'Result: **Semantic verification unavailable, user confirmation required**',
      );
      expect(pendingReport).toContain('Assurance: **semantic-verification-unavailable**');
      expect(pendingReport).not.toContain('Assurance: **host-attested**');

      const confirmed = json(
        await runNativeCli([
          'next',
          name,
          '--summary',
          'User accepts completion with degraded semantic assurance',
          '--confirmed',
          '--json',
          ...projectArgs(),
        ]),
      );
      expect(confirmed).toMatchObject({
        exitCode: 0,
        data: {
          state: {
            phase: 'archive',
            status: 'active',
            verification_result: 'pass',
            verification: {
              assurance: 'user-confirmed-degraded',
              verdict: 'pass',
            },
            acceptance: [{ id: 'A1', result: 'passed' }],
            loop: { stage: 'archive-ready', next_action: 'archive' },
          },
        },
      });
      const confirmedReport = await fs.readFile(reportFile, 'utf8');
      expect(confirmedReport).toContain(
        'Result: **Passed with user-confirmed degraded assurance**',
      );
      expect(confirmedReport).toContain('Assurance: **user-confirmed-degraded**');
      expect(confirmedReport).not.toContain('Assurance: **host-attested**');
    },
  );

  it('rejects delayed generic Verifier errors and unavailable messages from an older attempt', async () => {
    const name = 'stale-generic-verifier-message';
    await prepareBuild(name);
    await runnerStep(name, builderHandoff(['A1']));
    const firstDispatch = await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    const first = (
      firstDispatch.data as {
        verifierDispatch: {
          stateVersion: number;
          iteration: number;
          attempt: number;
          verifierExecutionRef: string;
        };
      }
    ).verifierDispatch;
    const firstError = await runnerStep(name, {
      kind: 'verifier-execution-error',
      summary: 'The first Verifier execution ended.',
      stateVersion: first.stateVersion,
      iteration: first.iteration,
      attempt: first.attempt,
      verifierExecutionRef: first.verifierExecutionRef,
    });
    expect(firstError).toMatchObject({
      exitCode: 0,
      data: { state: { loop: { stage: 'verify-ready' } } },
    });

    const secondDispatch = await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    const second = (
      secondDispatch.data as {
        verifierDispatch: {
          stateVersion: number;
          iteration: number;
          attempt: number;
          verifierExecutionRef: string;
        };
      }
    ).verifierDispatch;
    expect(second.attempt).toBe(first.attempt + 1);
    const before = json(await runNativeCli(['show', name, '--json', ...projectArgs()]));

    for (const kind of ['verifier-execution-error', 'verifier-unavailable'] as const) {
      const delayed = await runnerStep(name, {
        kind,
        summary: 'Delayed message from the previous Verifier.',
        stateVersion: first.stateVersion,
        iteration: first.iteration,
        attempt: first.attempt,
        verifierExecutionRef: first.verifierExecutionRef,
      });
      expect(delayed).toMatchObject({
        exitCode: 65,
        error: { message: expect.stringContaining('stale for the current attempt') },
      });
    }
    const after = json(await runNativeCli(['show', name, '--json', ...projectArgs()]));
    expect(after.data?.state).toMatchObject({
      state_version: (before.data?.state as { state_version: number }).state_version,
      loop: { attempt: second.attempt, execution_failure_count: 1 },
    });
  });

  it('rejects verifier-unavailable while a resolved Runtime check failed', async () => {
    const name = 'verifier-unavailable-failed-check';
    await prepareBuild(name);
    await runnerStep(name, builderHandoff(['A1']));
    await runnerStep(name, {
      kind: 'dispatch-verifier',
      checks: [
        {
          id: 'runtime-fail',
          name: 'Runtime fail',
          executable: process.execPath,
          argv: ['-e', 'process.exit(1)'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    });
    const unavailable = await runnerStep(name, {
      kind: 'verifier-unavailable',
      summary: 'No independent execution is available.',
    });
    expect(unavailable).toMatchObject({
      exitCode: 65,
      error: { message: expect.stringContaining('every resolved Runtime check to pass') },
    });
    expect(json(await runNativeCli(['show', name, '--json', ...projectArgs()])).data).toMatchObject(
      { state: { status: 'active', loop: { attempt: 1 } } },
    );
  });

  it('executes Verifier-requested checks and resumes the same programmatic attempt', async () => {
    const name = 'skill-request-checks';
    await prepareBuild(name);
    await runnerStep(name, builderHandoff(['A1']));
    const dispatched = await runnerStep(name, {
      kind: 'dispatch-verifier',
      checks: [
        {
          id: 'initial-focused',
          name: 'Initial focused check',
          executable: process.execPath,
          argv: ['-e', 'process.exit(0)'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    });
    const firstDispatch = (
      dispatched.data as { verifierDispatch: { iteration: number; attempt: number } }
    ).verifierDispatch;

    const requested = await runnerStep(name, {
      kind: 'verifier-response',
      response: {
        kind: 'request-checks',
        iteration: firstDispatch.iteration,
        attempt: firstDispatch.attempt,
        checks: [
          {
            id: 'verifier-extra',
            name: 'Verifier requested check',
            executable: process.execPath,
            argv: ['-e', "process.stdout.write('extra-check')"],
            cwdRef: '.',
            timeoutMs: 10_000,
            repeatable: true,
          },
        ],
      },
    });
    expect(requested).toMatchObject({
      exitCode: 0,
      data: {
        coordination: 'skill-coordinated',
        requestChecks: { round: 1, executedCheckIds: ['verifier-extra'] },
        verifierDispatch: {
          iteration: firstDispatch.iteration,
          attempt: firstDispatch.attempt,
          runtimeChecks: [
            {
              id: 'initial-focused',
              name: { text: 'Initial focused check' },
              status: 'passed',
              exit_code: 0,
            },
            {
              id: 'verifier-extra',
              name: { text: 'Verifier requested check' },
              status: 'passed',
              exit_code: 0,
            },
          ],
        },
      },
    });

    const verified = await runnerStep(
      name,
      finalResponse(firstDispatch.iteration, firstDispatch.attempt, ['A1']),
    );
    expect(verified).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          status: 'await-user',
          loop: {
            attempt: firstDispatch.attempt,
            next_action: 'confirm-skill-coordinated-pass',
          },
          verification: {
            checks: [
              { id: 'initial-focused', name: { text: 'Initial focused check' } },
              { id: 'verifier-extra', name: { text: 'Verifier requested check' } },
            ],
          },
        },
      },
    });
    const changeDir = path.join(projectRoot, 'docs', 'comet', 'changes', name);
    const portableYaml = await fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8');
    const report = await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8');
    for (const checkName of ['Initial focused check', 'Verifier requested check']) {
      expect(portableYaml).toContain(checkName);
      expect(report).toContain(checkName);
    }
  });

  it('resolves a semantic Verifier blocker with a new attempt and retained checks', async () => {
    const name = 'resolve-semantic-blocker';
    await prepareBuild(name);
    await runnerStep(name, builderHandoff(['A1']));
    const counter = path.join(projectRoot, 'semantic-blocker-count.txt');
    const plan = {
      kind: 'dispatch-verifier',
      checks: [
        {
          id: 'semantic-baseline',
          name: 'Semantic baseline',
          executable: process.execPath,
          argv: [
            '-e',
            "const fs=require('node:fs');const f=process.argv[1];let n=0;try{n=Number(fs.readFileSync(f,'utf8'))}catch{}fs.writeFileSync(f,String(n+1))",
            counter,
          ],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    };
    await runnerStep(name, plan);
    const blocked = await runnerStep(name, {
      kind: 'verifier-response',
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'blocked',
          acceptance: [
            { id: 'A1', result: 'blocked', reason: 'A user-visible choice is required.' },
          ],
          risks: [],
          summary: 'Semantic verification needs a user decision.',
        },
      },
    });
    expect(blocked).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          status: 'await-user',
          loop: { iteration: 1, attempt: 1, retry_epoch: 0 },
          blockers: [{ resolution_action: 'resolve-verifier-blocker' }],
        },
        continuation: { action: 'resolve-verifier-blocker' },
      },
    });
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const localFile = nativeLocalExecutionFile(paths, name);
    expect(await readNativeLocalExecution(localFile)).toMatchObject({
      execution: { stage: 'checking', status: 'completed' },
      checks: [{ id: 'semantic-baseline', executionCount: 1, status: 'passed' }],
    });

    const resolved = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Retry semantic verification without implementation changes',
        '--resolve-verifier-blocker',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(resolved).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          status: 'active',
          verification_result: 'pending',
          verification: null,
          loop: {
            stage: 'verify-ready',
            iteration: 1,
            attempt: 1,
            retry_epoch: 1,
          },
        },
        continuation: { action: 'dispatch-verifier' },
      },
    });
    expect(await readNativeLocalExecution(localFile)).toMatchObject({
      checks: [{ id: 'semantic-baseline', executionCount: 1, status: 'passed' }],
    });

    const redispatched = await runnerStep(name, plan);
    expect(redispatched).toMatchObject({
      exitCode: 0,
      data: {
        state: { loop: { iteration: 1, attempt: 2, retry_epoch: 1 } },
        verifierDispatch: { iteration: 1, attempt: 2 },
      },
    });
    expect(await fs.readFile(counter, 'utf8')).toBe('1');
    expect(await readNativeLocalExecution(localFile)).toMatchObject({
      checks: [{ id: 'semantic-baseline', executionCount: 1, status: 'passed' }],
    });
  });

  it('reserves concurrent check-plan dispatch and never reruns an already resolved plan', async () => {
    const name = 'skill-concurrent-dispatch';
    await prepareBuild(name);
    await runnerStep(name, builderHandoff(['A1']));
    const counter = path.join(projectRoot, 'dispatch-count.txt');
    const plan = {
      kind: 'dispatch-verifier',
      checks: [
        {
          id: 'once',
          name: 'Run once',
          executable: process.execPath,
          argv: [
            '-e',
            "const fs=require('node:fs');const f=process.argv[1];let n=0;try{n=Number(fs.readFileSync(f,'utf8'))}catch{}fs.writeFileSync(f,String(n+1));setTimeout(()=>process.exit(0),400)",
            counter,
          ],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    };

    const concurrent = await Promise.all([runnerStep(name, plan), runnerStep(name, plan)]);
    expect(concurrent.map(({ exitCode }) => exitCode).sort((left, right) => left - right)).toEqual([
      0, 65,
    ]);
    expect(concurrent.find(({ exitCode }) => exitCode === 65)?.error?.message).toMatch(
      /already in progress|Verify ready state/iu,
    );
    expect(await fs.readFile(counter, 'utf8')).toBe('1');

    const repeated = await runnerStep(name, plan);
    expect(repeated).toMatchObject({ exitCode: 65, error: { code: 'invalid-data' } });
    expect(await fs.readFile(counter, 'utf8')).toBe('1');
  });

  it('rejects a final result that omits an acceptance ID', async () => {
    const name = 'skill-missing-acceptance';
    await prepareBuild(name, ['First behavior works.', 'Second behavior works.']);
    await runnerStep(name, builderHandoff(['A1', 'A2']));
    await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });

    const missing = await runnerStep(name, finalResponse(1, 1, ['A1']));
    expect(missing).toMatchObject({
      exitCode: 65,
      error: { code: 'invalid-data', message: expect.stringContaining('missing: A2') },
    });
  });
});
