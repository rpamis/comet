import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { readNativeLocalExecution } from '../../../domains/comet-native/native-local-execution.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  nativeLocalExecutionFile,
  returnNativePortableChangeToShape,
} from '../../../domains/comet-native/native-portable-runtime.js';

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

  async function prepareBuild(
    name: string,
    acceptance: string[] = ['First behavior works.'],
    language: 'en' | 'zh-CN' = 'en',
  ) {
    await runNativeCli(['new', name, '--language', language, ...projectArgs()]);
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
    expect(confirmed.data?.state).toMatchObject({
      acceptance: { total: acceptance.length, pending: acceptance.length },
    });
    expect(confirmed.data?.state).not.toHaveProperty('builder_handoff');
    expect(confirmed.data?.state).not.toHaveProperty('history');
    expect(JSON.stringify(confirmed.data?.state)).not.toContain(acceptance[0]);
    return confirmed;
  }

  function builderHandoff(addressedAcceptanceIds: string[]) {
    return {
      kind: 'builder-handoff',
      summary: 'Implemented the confirmed behavior.',
      addressed_acceptance_ids: addressedAcceptanceIds,
      checks: [],
      known_limits: [],
      review: {
        status: 'passed',
        summary: 'A read-only reviewer found no blocking issues.',
        reviewer_execution_ref: `reviewer-${runnerInputSequence + 1}`,
      },
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
    expect(next.stdout).toContain('continuation.userCommunication');
    expect(next.stdout).toContain('--runner-input <file>');
    expect(next.stdout).toContain('--coordination-mode multi-session|single-session');
    expect(next.stdout).toContain('not trusted identity attestation');
    expect(next.stdout).toContain('Checks completed, but your confirmation is required');
    expect(next.stdout).toContain(
      'Full verification was unavailable; only automatic checks completed',
    );
    expect(next.stdout).toContain('You accepted the incomplete verification result');
    expect(next.stdout).toContain('--retry-verifier');
    expect(next.stdout).toContain('--resolve-verifier-blocker');
    expect(next.stdout).toContain('--accept-result');
    expect(next.stdout).toContain('--revise-implementation');
    expect(next.stdout).toContain('--revise-requirements');
    expect(next.stdout).not.toContain('--return-to-shape');
    expect(next.stdout).toContain('verifier-unavailable');
    expect(archive.stdout).toContain('does not repeat verification');
    expect(status.stdout).toContain('local execution availability');
    expect(status.stdout).toContain('readyChildren');
    expect(next.stdout).toContain('advance parent child changes');
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

  it('surfaces the coordination choice from an explicit Supervisor Shape decision', async () => {
    const name = 'recorded-supervisor';
    await runNativeCli(['new', name, '--language', 'zh-CN', ...projectArgs()]);
    await fs.writeFile(
      path.join(projectRoot, 'docs', 'comet', 'changes', name, 'brief.md'),
      `# 决策

- 已明确选择 Supervisor Change，因为存在两个独立结果。
- Child 1 负责第一个结果；Child 2 负责第二个结果。

# 待解决问题
- [blocking] CONFIRM: 等待用户确认。
`,
    );

    const result = json(await runNativeCli(['status', name, '--json', ...projectArgs()]));

    expect(result.data?.continuation).toMatchObject({
      disposition: 'await-user',
      action: 'confirm-shape',
      requiredInputs: ['summary', 'coordination-choice', 'shared-understanding-confirmation'],
      userCommunication: { required: true, suggestedReply: '回复 A 或 B' },
    });
  });

  it.each([
    { name: 'compact-recovery-default', runnerInput: false },
    { name: 'compact-recovery-runner', runnerInput: true },
  ])('keeps successful $name next output compact', async ({ name, runnerInput }) => {
    await prepareBuild(name, ['Recovery output stays compact.']);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await fs.writeFile(nativeLocalExecutionFile(paths, name), '{invalid-json');

    const recovered = runnerInput
      ? await runnerStep(name, builderHandoff(['A1']))
      : json(
          await runNativeCli([
            'next',
            name,
            '--summary',
            'Resume after recovery',
            '--json',
            ...projectArgs(),
          ]),
        );

    expect(recovered.error).toBeUndefined();
    expect(recovered).toMatchObject({
      exitCode: 0,
      data: {
        state: { phase: 'build' },
        recovery: { action: 'resume-stable-boundary', reason: 'invalid' },
        continuation: { action: 'builder-handoff' },
      },
    });
    expect(recovered.data?.state).not.toHaveProperty('builder_handoff');
    expect(recovered.data?.state).not.toHaveProperty('history');
    expect(recovered.data?.recovery).not.toHaveProperty('state');
    expect(recovered.data?.recovery).not.toHaveProperty('local');
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
      const expectedMessage =
        command === 'check' ? 'change name is required' : `Unknown Native command: ${command}`;
      expect(result).toMatchObject({
        command,
        exitCode: 64,
        error: { code: 'usage', message: expectedMessage },
      });
    }
  });

  it('rejects user-decision flags when combined with another public transition flag', async () => {
    await prepareBuild('revise-requirements-mutual-exclusion');

    const result = json(
      await runNativeCli([
        'next',
        'revise-requirements-mutual-exclusion',
        '--summary',
        'Ambiguous user decision',
        '--revise-requirements',
        '--revise-implementation',
        '--json',
        ...projectArgs(),
      ]),
    );

    expect(result).toMatchObject({
      exitCode: 64,
      error: {
        code: 'usage',
        message: expect.stringContaining('--revise-requirements'),
      },
    });
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

    const withoutReview = { ...builderHandoff(['A1']) } as Record<string, unknown>;
    delete withoutReview.review;
    const missingReview = await runnerStep('reject-forged-runner-fields', withoutReview);
    expect(missingReview).toMatchObject({
      exitCode: 65,
      error: { code: 'invalid-data', message: expect.stringContaining('fields are invalid') },
    });

    expect(
      json(
        await runNativeCli(['status', 'reject-forged-runner-fields', '--json', ...projectArgs()]),
      ).data,
    ).toMatchObject({ phase: 'build', loop: { attempt: 0 } });
  });

  it('drives a complete skill-coordinated CLI loop to Archive with an explicit empty check plan', async () => {
    const name = 'skill-coordinated-loop';
    const readyForBuilder = await prepareBuild(
      name,
      ['First behavior works.', 'Second behavior works.'],
      'zh-CN',
    );
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
                review: {
                  status: 'passed',
                  summary: '<review-summary>',
                  reviewer_execution_ref: '<reviewer-execution-ref>',
                },
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
          projectRoot,
          verificationRoot: projectRoot,
          changeDir: path.join(projectRoot, 'docs', 'comet', 'changes', name),
          supervisorStateRef: null,
          briefRef: 'brief.md',
          specRefs: [],
          acceptanceCount: 2,
          scopeIds: ['A1', 'A2'],
          detailsPageArgs: [
            'comet',
            'native',
            'status',
            name,
            '--details',
            '--json',
            '--project-root',
            projectRoot,
          ],
          builderReview: {
            status: 'passed',
            summary: { text: 'A read-only reviewer found no blocking issues.' },
          },
          runtimeChecks: [],
        },
      },
    });
    const dispatch = (dispatched.data as { verifierDispatch: Record<string, unknown> })
      .verifierDispatch;
    expect(JSON.stringify(dispatch)).not.toMatch(/identity|provider/iu);
    expect(dispatch).not.toHaveProperty('acceptance');
    expect(dispatch).not.toHaveProperty('builderHandoff');
    expect(JSON.stringify(dispatch)).not.toContain('First behavior works.');
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
          blockers: [
            {
              owner: 'user',
              resolution_action: 'await-user',
              reason: expect.stringContaining('cannot prove'),
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
          commandArgs: null,
          requiredInputs: ['summary', 'user-decision'],
          inputOptions: [expect.objectContaining({ name: 'summary', flag: '--summary' })],
          commandAlternatives: expect.arrayContaining([
            expect.objectContaining({
              name: 'accept-result',
              stateVersion: expect.any(Number),
              expectedAction: 'accept-result',
              commandArgs: expect.arrayContaining(['--accept-result']),
              requiredInputs: ['summary', 'user-decision'],
            }),
            expect.objectContaining({
              name: 'revise-implementation',
              stateVersion: expect.any(Number),
              expectedAction: 'revise-implementation',
              commandArgs: expect.arrayContaining(['--revise-implementation']),
              requiredInputs: ['summary', 'user-decision'],
            }),
            expect.objectContaining({
              name: 'revise-requirements',
              stateVersion: expect.any(Number),
              expectedAction: 'revise-requirements',
              commandArgs: expect.arrayContaining(['--revise-requirements']),
              requiredInputs: ['summary', 'user-decision'],
            }),
          ]),
        },
      },
    });
    expect(awaitingConfirmation.data).not.toHaveProperty('response');
    expect(awaitingConfirmation.data).not.toHaveProperty('supervisorState');
    expect(JSON.stringify(awaitingConfirmation.data)).not.toContain('Observed A1.');
    expect(JSON.stringify(awaitingConfirmation.data)).not.toContain('Observed A2.');
    const pendingReport = await fs.readFile(
      path.join(projectRoot, 'docs', 'comet', 'changes', name, 'verification.md'),
      'utf8',
    );
    expect(pendingReport).toContain('结果: **验收通过，需要你确认**');
    expect(pendingReport).toContain('验证情况: **已完成检查，但需要你确认验证结果**');

    const confirmed = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'User accepts the Skill-coordinated verification boundary',
        '--accept-result',
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
    ).toContain('结果: **验收通过，可归档**');
  });

  it('verifies only the repair scope, reuses checks, then runs one final full verification', async () => {
    const name = 'scoped-repair-verification';
    const counter = path.join(projectRoot, 'repair-check-count.txt');
    const checkPlan = {
      kind: 'dispatch-verifier',
      checks: [
        {
          id: 'focused-check',
          name: 'Focused check',
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
    await prepareBuild(name, ['First behavior works.', 'Second behavior works.']);
    await runnerStep(name, builderHandoff(['A1', 'A2']));
    await runnerStep(name, checkPlan);
    const failed = await runnerStep(name, {
      kind: 'verifier-response',
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'fail',
          acceptance: [
            { id: 'A1', result: 'passed', reason: 'Observed A1.' },
            { id: 'A2', result: 'failed', reason: 'A2 still fails.' },
          ],
          risks: [],
          summary: 'A2 needs repair.',
        },
      },
    });
    expect(failed.data?.state).toMatchObject({
      phase: 'build',
      loop: { stage: 'repairing', previous_unresolved_ids: ['A2'] },
    });

    await runnerStep(name, builderHandoff(['A2']));
    const repairDispatch = await runnerStep(name, checkPlan);
    expect(
      (repairDispatch.data as { verifierDispatch: { scopeIds: string[] } }).verifierDispatch
        .scopeIds,
    ).toEqual(['A2']);
    expect(await fs.readFile(counter, 'utf8')).toBe('2');
    const repairPass = await runnerStep(name, finalResponse(2, 1, ['A2']));
    expect(repairPass.data?.state).toMatchObject({
      phase: 'verify',
      status: 'active',
      acceptance: { total: 2, pending: 2 },
      loop: { stage: 'verify-ready', next_action: 'run-final-full-verification' },
    });

    const finalDispatch = await runnerStep(name, checkPlan);
    expect(
      (finalDispatch.data as { verifierDispatch: { scopeIds: string[] } }).verifierDispatch
        .scopeIds,
    ).toEqual(['A1', 'A2']);
    expect(await fs.readFile(counter, 'utf8')).toBe('2');
    const finalPass = await runnerStep(name, finalResponse(2, 2, ['A1', 'A2']));
    expect(finalPass.data?.state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
      loop: { next_action: 'confirm-skill-coordinated-pass' },
    });
  });

  it('revises requirements after a rejected skill-coordinated pass and starts a fresh candidate cycle', async () => {
    const name = 'skill-pass-revise-requirements';
    await prepareBuild(name, ['Original behavior works.']);
    await runnerStep(name, builderHandoff(['A1']));
    const oldCandidateId = (
      json(await runNativeCli(['show', name, '--json', ...projectArgs()])).data as {
        state: { builder_handoff: { candidate_id: string } };
      }
    ).state.builder_handoff.candidate_id;
    await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    const awaitingPassDecision = await runnerStep(name, finalResponse(1, 1, ['A1']));
    const oldAcceptResultAlternative = (
      awaitingPassDecision.data as {
        continuation: {
          commandAlternatives: Array<{ name: string; commandArgs: string[] }>;
        };
      }
    ).continuation.commandAlternatives.find(({ name }) => name === 'accept-result');
    expect(oldAcceptResultAlternative).toMatchObject({
      name: 'accept-result',
      commandArgs: expect.arrayContaining([
        '--accept-result',
        '--expected-state-version',
        '--expected-action',
        'accept-result',
      ]),
    });

    const returned = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'User-visible acceptance criteria changed',
        '--revise-requirements',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(returned).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'shape',
          status: 'active',
          acceptance: { total: 0 },
          blockers: [],
          verification_result: 'pending',
          loop: {
            stage: 'shape',
            goal_cycle: 2,
            iteration: 0,
            attempt: 0,
            next_action: 'confirm-shape',
          },
        },
        continuation: { action: 'confirm-shape' },
      },
    });

    const staleAcceptResult = json(
      await runNativeCli([
        ...oldAcceptResultAlternative!.commandArgs
          .slice(2)
          .map((value) =>
            value === '<summary>' ? 'Delayed confirmation for an obsolete pass' : value,
          ),
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(staleAcceptResult).toMatchObject({
      exitCode: 65,
      error: { message: expect.stringContaining('stale for state version') },
    });
    expect(json(await runNativeCli(['show', name, '--json', ...projectArgs()])).data).toMatchObject(
      {
        state: {
          phase: 'shape',
          status: 'active',
          acceptance: [],
          builder_handoff: null,
          loop: { next_action: 'confirm-shape' },
        },
      },
    );

    const staleArchive = json(
      await runNativeCli(['archive', name, '--dry-run', '--json', ...projectArgs()]),
    );
    expect(staleArchive).toMatchObject({
      exitCode: 0,
      data: {
        ready: false,
        continuation: { action: 'confirm-shape' },
      },
    });

    const brief = `# Outcome
Ship the updated requested behavior.
# Scope
Keep the implementation focused.
# Non-goals
No unrelated changes.
# Acceptance examples
- Updated behavior works.
# Constraints and invariants
Preserve existing behavior.
# Decisions
User rejected the previous pass because the acceptance criteria changed.
# Open questions
None.
# Verification expectations
Run applicable focused checks.
`;
    await fs.writeFile(path.join(projectRoot, 'docs', 'comet', 'changes', name, 'brief.md'), brief);
    const reconfirmed = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Updated Shape confirmed',
        '--confirmed',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(reconfirmed).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'build',
          acceptance: { total: 1, pending: 1 },
          loop: { goal_cycle: 2, iteration: 1 },
        },
      },
    });

    const rebuilt = await runnerStep(name, builderHandoff(['A1']));
    expect(rebuilt).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          verification_result: 'pending',
        },
      },
    });
    const newCandidateId = (
      json(await runNativeCli(['show', name, '--json', ...projectArgs()])).data as {
        state: { builder_handoff: { candidate_id: string } };
      }
    ).state.builder_handoff.candidate_id;
    expect(newCandidateId).not.toBe(oldCandidateId);
  });

  it('revises requirements from Archive-ready and invalidates the accepted result', async () => {
    const name = 'archive-ready-revise-requirements';
    await prepareBuild(name, ['Original behavior works.']);
    await runnerStep(name, builderHandoff(['A1']));
    await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    await runnerStep(name, finalResponse(1, 1, ['A1']));

    const accepted = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'User accepts the current verification result',
        '--accept-result',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(accepted).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'archive',
          status: 'active',
          verification_result: 'pass',
          loop: { stage: 'archive-ready', next_action: 'archive' },
        },
        continuation: { action: 'archive' },
      },
    });

    const archiveStateVersion = (accepted.data as { state: { state_version: number } }).state
      .state_version;
    const returned = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'User-visible acceptance criteria changed',
        '--revise-requirements',
        '--expected-state-version',
        String(archiveStateVersion),
        '--expected-action',
        'revise-requirements',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(returned).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'shape',
          status: 'active',
          acceptance: { total: 0, pending: 0, failed: 0, blocked: 0 },
          blockers: [],
          verification_result: 'pending',
          loop: {
            stage: 'shape',
            goal_cycle: 2,
            iteration: 0,
            attempt: 0,
            next_action: 'confirm-shape',
          },
        },
        continuation: { action: 'confirm-shape' },
      },
    });

    const archiveContinuation = accepted.data as {
      continuation: {
        action: string;
        commandAlternatives?: Array<{
          name: string;
          expectedAction: string;
          commandArgs: string[];
        }>;
      };
    };
    expect(archiveContinuation.continuation).toMatchObject({
      action: 'archive',
      commandAlternatives: expect.arrayContaining([
        expect.objectContaining({
          name: 'revise-requirements',
          expectedAction: 'revise-requirements',
          commandArgs: expect.arrayContaining([
            '--revise-requirements',
            '--expected-state-version',
            String(archiveStateVersion),
            '--expected-action',
            'revise-requirements',
          ]),
        }),
      ]),
    });

    const staleRevision = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Delayed revision for an obsolete Archive-ready result',
        '--revise-requirements',
        '--expected-state-version',
        String(archiveStateVersion),
        '--expected-action',
        'revise-requirements',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(staleRevision).toMatchObject({
      exitCode: 65,
      error: { message: expect.stringContaining('stale for state version') },
    });
  });

  it.each([
    { name: 'verifier-unavailable-empty', withCheck: false },
    { name: 'verifier-unavailable-checked', withCheck: true },
  ])(
    'requires user confirmation for degraded semantic verification ($name)',
    async ({ name, withCheck }) => {
      await prepareBuild(name, ['First behavior works.'], 'zh-CN');
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
            userCommunication: {
              required: true,
              message:
                '由于独立验收服务暂时不可用，目前只能完成自动检查。你可以选择接受当前检查结果，或者等验收服务恢复后再重试。',
              suggestedReply: null,
              agentInstruction:
                '向用户转述 message，并请用户明确选择是否接受只有自动检查的结果。不要把“继续”当作默认接受。',
            },
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
      expect(pendingReport).toContain('结果: **无法完成完整验证，只完成了自动检查**');
      expect(pendingReport).toContain('验证情况: **无法完成完整验证，只完成了自动检查**');
      expect(pendingReport).not.toContain('验证情况: **已完成独立验证**');

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
            acceptance: { total: 1, passed: 1 },
            loop: { stage: 'archive-ready', next_action: 'archive' },
          },
        },
      });
      const confirmedReport = await fs.readFile(reportFile, 'utf8');
      expect(confirmedReport).toContain('结果: **验收通过，可归档**');
      expect(confirmedReport).toContain('验证情况: **你已确认接受不完整验证结果**');
      expect(confirmedReport).not.toContain('验证情况: **已完成独立验证**');
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

  it('returns friendly localized guidance when Verifier infrastructure repeatedly fails', async () => {
    const name = 'friendly-verifier-recovery';
    await prepareBuild(name, ['The behavior remains safe during verification recovery.'], 'zh-CN');
    await runnerStep(name, builderHandoff(['A1']));

    let failed: JsonEnvelope | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const dispatched = await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
      expect(dispatched.data?.continuation).toMatchObject({
        action: 'await-verifier',
        userCommunication: {
          required: false,
          message: null,
          suggestedReply: null,
        },
      });
      failed = await runnerStep(name, {
        kind: 'verifier-execution-error',
        summary: `Verifier worker ${attempt} ended without a response.`,
      });
    }

    expect(failed).toMatchObject({
      exitCode: 0,
      data: {
        state: { status: 'blocked', loop: { attempt: 3, execution_failure_count: 3 } },
        continuation: {
          disposition: 'blocked',
          action: 'retry-verifier',
          userCommunication: {
            required: true,
            message:
              '由于独立验收任务连续几次没有正常返回结果，本次验收已暂停。你的代码和已经完成的检查都已安全保留。回复“继续”即可重新尝试，不需要处理文件或进程。',
            suggestedReply: '继续',
            agentInstruction:
              '只向用户转述 message 和 suggestedReply，并等待用户回复。不要展示内部轮次、计数、路径或恢复步骤。',
          },
        },
      },
    });
    const communication = (failed?.data?.continuation as { userCommunication: { message: string } })
      .userCommunication;
    expect(communication.message).not.toMatch(/attempt|requestCheckRounds|Runtime|Verifier/iu);
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
        },
      },
    });
    expect(json(await runNativeCli(['show', name, '--json', ...projectArgs()])).data).toMatchObject(
      {
        state: {
          verification: {
            checks: [
              { id: 'initial-focused', name: { text: 'Initial focused check' } },
              { id: 'verifier-extra', name: { text: 'Verifier requested check' } },
            ],
          },
        },
      },
    );
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
        continuation: {
          action: 'resolve-verifier-blocker',
          commandArgs: null,
          requiredInputs: ['summary', 'user-decision'],
          inputOptions: [expect.objectContaining({ name: 'summary', flag: '--summary' })],
          commandAlternatives: expect.arrayContaining([
            expect.objectContaining({
              name: 'resolve-verifier-blocker',
              commandArgs: expect.arrayContaining(['--resolve-verifier-blocker']),
              requiredInputs: ['summary', 'user-resolution'],
            }),
            expect.objectContaining({
              name: 'revise-implementation',
              commandArgs: expect.arrayContaining(['--revise-implementation']),
              requiredInputs: ['summary', 'user-decision'],
            }),
            expect.objectContaining({
              name: 'revise-requirements',
              commandArgs: expect.arrayContaining(['--revise-requirements']),
              requiredInputs: ['summary', 'user-decision'],
            }),
          ]),
        },
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

  it('keeps explicit revise-requirements phase eligibility inside the runtime mutation lock', async () => {
    const name = 'locked-revise-requirements';
    await prepareBuild(name);
    const paths = await nativeProjectPaths(projectRoot, 'docs');

    await expect(
      returnNativePortableChangeToShape({
        paths,
        name,
        reason: 'Attempt explicit Verify/Archive recovery while Build is current',
        allowedPhases: ['verify', 'archive'],
      }),
    ).rejects.toThrow('--revise-requirements is only valid from Verify or Archive');

    const shown = json(await runNativeCli(['show', name, '--json', ...projectArgs()]));
    expect(shown).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'build',
          status: 'active',
          loop: { next_action: 'submit-builder-candidate' },
        },
      },
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
