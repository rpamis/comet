import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { loadOwnedNativeSdkRuntime } from '../../../domains/comet-native/native-runtime-ownership.js';
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function builderFixture(boundary: 'source' | 'bundle' = 'source', branch?: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-agent-report-'));
  roots.push(root);
  if (branch) {
    for (const args of [
      ['init', '-b', branch],
      ['config', 'user.name', 'Fixture'],
      ['config', 'user.email', 'fixture@example.invalid'],
      ['commit', '--allow-empty', '-m', 'baseline'],
    ]) {
      const git = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
      expect(git.status, git.stderr).toBe(0);
    }
  } else await fs.mkdir(path.join(root, '.git'));
  const name = 'agent-report';
  const cli = async (args: string[]) => {
    const argv = [
      ...args,
      ...(args.includes('--project-root') ? [] : ['--project-root', root]),
      ...(args.includes('--json') ? [] : ['--json']),
    ];
    const child =
      boundary === 'bundle'
        ? spawnSync(
            process.execPath,
            [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...argv],
            { cwd: root, encoding: 'utf8', windowsHide: true },
          )
        : null;
    const result = child
      ? { exitCode: child.status ?? 1, stdout: child.stdout, stderr: child.stderr }
      : await runNativeCli(argv);
    return { ...result, envelope: JSON.parse(result.stdout) };
  };
  expect((await cli(['new', name])).exitCode).toBe(0);
  const change = path.join(root, 'docs/comet/changes', name);
  await fs.writeFile(path.join(change, 'brief.md'), 'Implement the approved workflow behavior.');
  await fs.mkdir(path.join(change, 'specs/workflow'), { recursive: true });
  await fs.writeFile(path.join(change, 'specs/workflow/spec.md'), 'The workflow works.');
  const file = path.join(root, 'result.json');
  const submit = async (action: string, output: unknown, extra: string[] = []) => {
    await fs.writeFile(file, JSON.stringify({ status: 'succeeded', output }));
    return cli([
      'next',
      name,
      '--action',
      action,
      '--session',
      'actual-agent',
      '--result',
      file,
      ...extra,
    ]);
  };
  const shape = await cli(['next', name, '--session', 'actual-agent']);
  expect(shape.exitCode, shape.stdout).toBe(0);
  const prepared = await submit(shape.envelope.data.task.actionId, {
    acceptance: [{ source: 'specs/workflow/spec.md', text: 'The workflow works.' }],
  });
  expect(prepared.exitCode, prepared.stdout).toBe(0);
  const { runtime } = await loadOwnedNativeSdkRuntime(root, name);
  const run = await runtime.inspect(name);
  const wait = run.waits.find((entry) => entry.status === 'pending')!;
  expect(wait.status).toBe('pending');
  const choices = prepared.envelope.data.next.commandAlternatives;
  const confirmation = choices?.find((choice: { commandArgs?: string[] }) =>
    choice.commandArgs?.includes('--confirmed'),
  );
  expect(confirmation, prepared.stdout).toBeDefined();
  expect(prepared.envelope.data.next.askUser).toBeTruthy();
  expect(confirmation.commandArgs).toContain('--expected-state-version');
  // 这次批准只属于隔离夹具，不能替代真实用户批准。
  const confirmed = await cli(
    confirmation.commandArgs
      .slice(2)
      .map((value: string) =>
        value === '<summary>' ? 'Fixture user approved the complete Shape.' : value,
      ),
  );
  expect(confirmed.exitCode, confirmed.stdout).toBe(0);
  const builder = await cli(['next', name, '--session', 'actual-agent']);
  expect(builder.exitCode, builder.stdout).toBe(0);
  return { root, name, cli, submit, runtime, builder: builder.envelope.data };
}
it('preserves real approvals and completes Native platform reports through authorized Archive', async () => {
  const f = await builderFixture('source', 'archive-origin');
  const before = await f.runtime.inspect(f.name);
  expect(before.waits.filter((wait) => wait.status === 'resolved')).toHaveLength(1);
  const checks = [
    {
      name: 'Platform test',
      result: 'passed',
      note: 'Isolated fixture simulates an accepted platform report; no model or Eval is executed.',
    },
  ];
  const built = await f.submit(f.builder.task.actionId, {
    summary: 'Implemented.',
    addressedAcceptanceIds: ['A1'],
    checks,
    knownLimits: [],
  });
  expect(built.exitCode, built.stdout).toBe(0);
  expect(built.envelope.data.task.role).toBe('verify');
  const output = built.envelope.data.resultTemplate.output;
  output.checks = checks;
  Object.assign(output.response.result, {
    verdict: 'pass',
    acceptance: [{ id: 'A1', result: 'passed', reason: 'Observed the approved fixture behavior.' }],
    risks: [],
    summary: 'Fixture behavior verified.',
  });
  const completed = await f.submit(built.envelope.data.task.actionId, output, [
    '--accept-on-pass',
    'Isolated fixture simulates explicit user delegation for this acceptance and Archive.',
  ]);
  expect(completed.exitCode, completed.stdout).toBe(0);
  const run = await f.runtime.inspect(f.name);
  expect(run.status).toBe('completed');
  expect(run.waits[0]).toEqual(before.waits[0]);
  expect(
    run.actions.some((action) =>
      ['build.checks', 'verify.checks', 'verify.requested-checks'].includes(action.stepId),
    ),
  ).toBe(false);
  expect(JSON.stringify(run.state)).toContain('accepted platform report');
});
