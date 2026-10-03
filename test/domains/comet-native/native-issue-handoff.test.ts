import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';

describe('Native issue handoff regressions', () => {
  let root: string;
  let inputs: string;
  const name = 'issue-handoff';
  let sequence: number;
  async function cli(args: string[], input?: unknown, inside = false, retain = false) {
    const file = path.join(inside ? root : inputs, `input-${++sequence}.json`);
    if (input) await fs.writeFile(file, JSON.stringify(input));
    try {
      const result = await runNativeCli([
        ...args,
        '--project-root',
        root,
        '--json',
        ...(input ? ['--runner-input', file] : []),
      ]);
      return JSON.parse(result.stdout!);
    } finally {
      if (input && !retain) await fs.rm(file, { force: true });
    }
  }
  function review(ids = ['A1', 'A2']) {
    return ids.map((id) => ({
      id,
      status: 'implemented-with-evidence',
      evidence: [`source.txt implements the fixture behavior for ${id}`],
      note: `The fixture requirement ${id} was checked.`,
    }));
  }
  function handoff() {
    return {
      kind: 'builder-handoff',
      summary: 'Implemented both fixture behaviors.',
      addressed_acceptance_ids: ['A1', 'A2'],
      acceptance_review: review(),
      checks: [],
      known_limits: [],
    };
  }
  function plan(failOnce = false) {
    const counter = path.join(root, '.comet/runtime/check-count.txt');
    return {
      id: 'fixture-check',
      name: 'Fixture check',
      executable: process.execPath,
      argv: [
        '-e',
        `const fs=require('fs');const f=${JSON.stringify(counter)};fs.appendFileSync(f,'run\\n');${failOnce ? "if(fs.readFileSync(f,'utf8')==='run\\n')process.exit(1);" : ''}`,
      ],
      cwdRef: '.',
      timeoutMs: 10000,
      repeatable: true,
    };
  }
  function response(dispatch: any, result: any) {
    return {
      kind: 'verifier-response',
      candidateId: dispatch.candidateId,
      verifierExecutionRef: dispatch.verifierExecutionRef,
      response: result,
    };
  }
  function final(dispatch: any) {
    return {
      kind: 'final-result',
      result: {
        iteration: dispatch.iteration,
        attempt: dispatch.attempt,
        verdict: 'pass',
        acceptance: ['A1', 'A2'].map((id) => ({
          id,
          result: 'passed',
          reason: 'Observed fixture behavior.',
        })),
        risks: [],
        summary: 'All fixture requirements passed.',
      },
    };
  }
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-issue-handoff-'));
    inputs = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-issue-input-'));
    sequence = 0;
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    await fs.writeFile(
      path.join(root, 'source.txt'),
      'Fixture implements first and second behavior.\n',
    );
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
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
    expect((await cli(['new', name])).exitCode).toBe(0);
    await fs.writeFile(
      path.join(root, 'docs/comet/changes', name, 'brief.md'),
      '# Outcome\nShip fixture behaviors.\n# Scope\nFirst and second behaviors.\n# Non-goals\nNo unrelated work.\n# Acceptance examples\n- First behavior works.\n- Second behavior works.\n# Constraints and invariants\nKeep scope fixed.\n# Decisions\nUse fixture implementation.\n# Open questions\nNone.\n# Verification expectations\nRun applicable checks.\n',
    );
    await fs.mkdir(path.join(root, 'docs/comet/changes', name, 'specs/fixture'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, 'docs/comet/changes', name, 'specs/fixture/spec.md'),
      '# Fixture target\n\nThe fixture requirements are defined in brief.md.\n',
    );
    const prepared = await cli(['next', name, '--summary', 'Shape ready']);
    expect(prepared.exitCode, JSON.stringify(prepared.error)).toBe(0);
    expect(
      (
        await cli([
          'next',
          name,
          '--summary',
          'Confirmed',
          '--confirmed',
          '--expected-state-version',
          String(prepared.data.state.state_version),
          '--expected-action',
          'confirm-shape',
        ])
      ).exitCode,
    ).toBe(0);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(inputs, { recursive: true, force: true });
  });

  it('reuses checks when validated untracked runner input files are replaced inside the repository', async () => {
    const check = plan();
    const handedOff = await cli(
      ['next', name],
      { ...handoff(), verification_checks: [check] },
      true,
    );
    expect(handedOff.exitCode).toBe(0);
    const d = handedOff.data.verifierDispatch;
    const dispatched = await cli(
      ['next', name],
      response(d, {
        kind: 'request-checks',
        iteration: d.iteration,
        attempt: d.attempt,
        checks: [check],
      }),
      true,
    );
    expect(dispatched).toMatchObject({
      exitCode: 0,
      data: {
        requestChecks: { reusedCheckIds: [check.id], executedCheckIds: [] },
        continuation: { action: 'await-verifier' },
      },
    });
    expect(await fs.readFile(path.join(root, '.comet/runtime/check-count.txt'), 'utf8')).toBe(
      'run\n',
    );
  });

  it('does not classify protocol files during validate-only', async () => {
    expect((await cli(['next', name, '--validate-only'], handoff(), true)).exitCode).toBe(0);
    await expect(
      fs.lstat(path.join(root, '.comet/runtime/native/runner-input-artifacts.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a rejected pass submission on the same active Verifier so checks can be repaired', async () => {
    expect((await cli(['next', name], handoff())).exitCode).toBe(0);
    const check = plan(true);
    const dispatched = await cli(['next', name], { kind: 'dispatch-verifier', checks: [check] });
    const d = dispatched.data.verifierDispatch;
    const before = (await cli(['show', name])).data.state;
    const rejected = await cli(['next', name], response(d, final(d)));
    expect(rejected.exitCode).toBe(65);
    expect(rejected.data.continuation).toMatchObject({ action: 'await-verifier' });
    expect(rejected.data.continuation.inputOptions[0].template).toMatchObject({
      candidateId: d.candidateId,
      verifierExecutionRef: d.verifierExecutionRef,
    });
    expect((await cli(['show', name])).data.state).toEqual(before);
    const checked = await cli(
      ['next', name],
      response(d, {
        kind: 'request-checks',
        iteration: d.iteration,
        attempt: d.attempt,
        checks: [check],
      }),
    );
    expect(checked.exitCode).toBe(0);
    expect((await cli(['next', name], response(d, final(d)))).exitCode).toBe(0);
  });

  it('keeps retained, rejected transport input out of a later completed candidate', async () => {
    const rejected = await cli(
      ['next', name],
      { ...handoff(), acceptance_review: review(['A1']) },
      true,
      true,
    );
    expect(rejected.exitCode).toBe(65);
    const retained = path.join(root, `input-${sequence}.json`);
    const check = plan();
    const handedOff = await cli(
      ['next', name],
      { ...handoff(), verification_checks: [check] },
      true,
    );
    expect(handedOff.exitCode).toBe(0);
    const d = handedOff.data.verifierDispatch;
    await fs.rm(retained);
    const dispatched = await cli(
      ['next', name],
      response(d, {
        kind: 'request-checks',
        iteration: d.iteration,
        attempt: d.attempt,
        checks: [check],
      }),
      true,
    );
    expect(dispatched).toMatchObject({
      exitCode: 0,
      data: { requestChecks: { reusedCheckIds: [check.id], executedCheckIds: [] } },
    });
    expect(await fs.readFile(path.join(root, '.comet/runtime/check-count.txt'), 'utf8')).toBe(
      'run\n',
    );
  });

  it.each([
    'missing',
    'partial',
    'not-implemented',
    'implemented-no-evidence',
    'known-fail',
    'no-evidence',
  ])('rejects a %s completion declaration without freezing a candidate', async (mode) => {
    const input: any = handoff();
    if (mode === 'missing') delete input.acceptance_review;
    if (mode === 'partial') input.acceptance_review = review(['A1']);
    if (mode === 'not-implemented') input.acceptance_review[1].status = 'not-implemented';
    if (mode === 'implemented-no-evidence' || mode === 'known-fail')
      input.acceptance_review[1].status = mode;
    if (mode === 'no-evidence') input.acceptance_review[1].evidence = [];
    const before = (await cli(['show', name])).data.state;
    const rejected = await cli(['next', name], input);
    expect(rejected).toMatchObject({
      exitCode: 65,
      data: { builderReadiness: { ready: false }, continuation: { action: 'builder-handoff' } },
    });
    expect((await cli(['show', name])).data.state).toEqual(before);
  });

  it('still rejects source drift after an otherwise complete handoff', async () => {
    const check = plan();
    expect(
      (await cli(['next', name], { ...handoff(), verification_checks: [check] }, true)).exitCode,
    ).toBe(0);
    await fs.writeFile(path.join(root, 'source.txt'), 'Changed implementation.\n');
    expect(
      (await cli(['next', name], { kind: 'dispatch-verifier', checks: [check] }, true)).exitCode,
    ).toBe(65);
    expect((await cli(['show', name])).data.state.phase).toBe('build');
  });
});
