import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

const runtime = path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs');
const router = path.resolve('assets/skills/comet/scripts/comet-hook-router.mjs');

describe('packaged Runtime issue regressions', () => {
  let root: string;
  let external: string;
  let sequence: number;
  const name = 'issue-runtime';
  function invoke(args: string[]) {
    const result = spawnSync(
      process.execPath,
      [runtime, ...args, '--project-root', root, '--json'],
      { encoding: 'utf8', timeout: 60_000, windowsHide: true },
    );
    expect(result.error).toBeUndefined();
    const output = JSON.parse(result.stdout);
    expect(result.status).toBe(output.exitCode);
    return output;
  }
  async function input(payload: unknown, inside = false) {
    const file = path.join(inside ? root : external, `input-${++sequence}.json`);
    await fs.writeFile(file, JSON.stringify(payload));
    // Retained protocol files must be as safe as files removed after consumption.
    return invoke(['next', name, '--runner-input', file]);
  }
  function handoff() {
    return {
      kind: 'builder-handoff',
      summary: 'Both fixture behaviors implemented.',
      addressed_acceptance_ids: ['A1', 'A2'],
      acceptance_review: fixtureAcceptanceReview(['A1', 'A2']),
      checks: [],
      known_limits: [],
    };
  }
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'comet-packaged-issues-')));
    external = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-packaged-input-'));
    sequence = 0;
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    await fs.writeFile(path.join(root, 'source.txt'), 'Both fixture behaviors implemented.\n');
    execFileSync('git', ['add', 'source.txt'], { cwd: root, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-m',
        'fixture',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    expect(invoke(['new', name]).exitCode).toBe(0);
    const change = path.join(root, 'docs/comet/changes', name);
    await fs.writeFile(
      path.join(change, 'brief.md'),
      '# Outcome\nShip both fixture behaviors.\n# Scope\nBoth fixture behaviors.\n# Non-goals\nNo unrelated work.\n# Acceptance examples\n- First behavior works.\n- Second behavior works.\n# Constraints and invariants\nKeep scope fixed.\n# Decisions\nUse fixture implementation.\n# Open questions\nNone.\n# Verification expectations\nRun applicable checks.\n',
    );
    await fs.mkdir(path.join(change, 'specs/fixture'), { recursive: true });
    await fs.writeFile(
      path.join(change, 'specs/fixture/spec.md'),
      '# Fixture target\n\nThe fixture requirements are defined in brief.md.\n',
    );
    const prepared = invoke(['next', name, '--summary', 'Shape ready']);
    expect(prepared.exitCode).toBe(0);
    expect(
      invoke([
        'next',
        name,
        '--summary',
        'Confirmed',
        '--confirmed',
        '--expected-state-version',
        String(prepared.data.state.state_version),
        '--expected-action',
        'confirm-shape',
      ]).exitCode,
    ).toBe(0);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(external, { recursive: true, force: true });
  });

  it('rejects incomplete Build and reuses checks across retained in-repository protocol files', async () => {
    const before = invoke(['show', name]).data.state;
    expect(
      (await input({ ...handoff(), acceptance_review: fixtureAcceptanceReview(['A1']) }, true))
        .exitCode,
    ).toBe(65);
    expect(invoke(['show', name]).data.state).toEqual(before);
    const rejectedInput = path.join(root, `input-${sequence}.json`);
    const counter = path.join(root, '.comet/runtime/count.txt');
    const plan = {
      id: 'fixture',
      name: 'Fixture',
      executable: process.execPath,
      argv: ['-e', `require('fs').appendFileSync(${JSON.stringify(counter)}, 'run\\n')`],
      cwdRef: '.',
      timeoutMs: 10_000,
      repeatable: true,
    };
    expect((await input({ ...handoff(), verification_checks: [plan] }, true)).exitCode).toBe(0);
    await fs.rm(rejectedInput);
    expect(await input({ kind: 'dispatch-verifier', checks: [plan] }, true)).toMatchObject({
      exitCode: 0,
      data: {
        runtimeCheckExecution: { disposition: 'reused' },
        continuation: { action: 'await-verifier' },
      },
    });
    expect(await fs.readFile(counter, 'utf8')).toBe('run\n');
  });

  it.each(['verify', 'archive'])(
    'preserves completed acceptance in %s for resource targets but invalidates real mixed writes',
    async (phase) => {
      expect((await input(handoff())).exitCode).toBe(0);
      const d = (await input({ kind: 'dispatch-verifier', checks: [] })).data.verifierDispatch;
      const completed = await input({
        kind: 'verifier-response',
        candidateId: d.candidateId,
        verifierExecutionRef: d.verifierExecutionRef,
        response: {
          kind: 'final-result',
          result: {
            iteration: d.iteration,
            attempt: d.attempt,
            verdict: 'pass',
            acceptance: ['A1', 'A2'].map((id) => ({
              id,
              result: 'passed',
              reason: 'Fixture observed.',
            })),
            risks: [],
            summary: 'All fixture requirements passed.',
          },
        },
      });
      expect(completed.exitCode).toBe(0);
      if (phase === 'archive')
        expect(
          invoke([
            'next',
            name,
            '--summary',
            'Accepted result',
            '--accept-result',
            '--expected-state-version',
            String(completed.data.state.state_version),
            '--expected-action',
            'accept-result',
          ]).exitCode,
        ).toBe(0);
      const before = invoke(['show', name]).data.state;
      expect(before).toMatchObject({
        phase,
        verification_result: 'pass',
        acceptance: [
          { id: 'A1', result: 'passed' },
          { id: 'A2', result: 'passed' },
        ],
      });
      function hook(event: unknown) {
        const result = spawnSync(
          process.execPath,
          [router, '--platform', 'oh-my-pi', '--project-root', root],
          {
            cwd: root,
            input: JSON.stringify(event),
            encoding: 'utf8',
            timeout: 30_000,
            windowsHide: true,
          },
        );
        expect(result.status, result.stderr).toBe(0);
      }
      hook({
        tool_input: { targets: ['agent:/Main', 'proc:/verify-server/kill', 'xd:/report_issue'] },
      });
      hook({ tool_name: 'write', tool_input: { path: 'agent:/Main' } });
      expect(invoke(['show', name]).data.state).toEqual(before);
      hook({
        tool_name: 'write',
        tool_input: { targets: ['file://%broken', 'agent:/Main', 'src/new-file.ts'] },
      });
      expect(invoke(['show', name]).data.state).toMatchObject({
        phase: 'build',
        verification_result: 'pending',
        acceptance: [
          { id: 'A1', result: 'pending' },
          { id: 'A2', result: 'pending' },
        ],
      });
    },
  );
});
