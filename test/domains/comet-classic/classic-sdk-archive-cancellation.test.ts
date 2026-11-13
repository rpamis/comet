import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import { createOpenSpecArchiveFixture } from '../../helpers/classic-openspec-fixture.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(profile: 'full' | 'tweak' = 'full') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-cancellation-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const cli = async (...args: string[]) => {
    const result = await runClassicCli([args[0], '--json', ...args.slice(1)], undefined, {
      projectRoot: root,
      invocationCwd: root,
    });
    return JSON.parse(result.stdout!);
  };
  expect((await cli('state', 'init', 'demo', profile, '--isolation', 'current')).exitCode).toBe(0);
  expect((await cli('state', 'select', 'demo')).exitCode).toBe(0);
  const dispatch = async (request: object) => {
    const file = path.join(root, 'request.json');
    await fs.writeFile(file, JSON.stringify(request));
    const result = await runtimeDispatchCommand(
      { request: file, application: `classic-${profile}`, projectRoot: root },
      { invocationCwd: root },
    );
    expect(result.exitCode, JSON.stringify(result.response)).toBe(0);
    return result.response;
  };
  const request = {
    intent: 'write' as const,
    toolName: 'Write',
    targets: [path.join(root, 'src/example.js')],
  };
  return { root, cli, dispatch, request };
}

function commitFixture(root: string): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('config', 'user.name', 'Comet cancellation test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '.');
  git('commit', '-m', 'fixture');
}

import { executeClassicSdkArchivePreflight } from '../../../domains/comet-classic/classic-sdk-archive-preflight.js';
import {
  runClassicSdkArchive,
  recoverClassicSdkArchive,
} from '../../../domains/comet-classic/classic-sdk-archive.js';
import { resolveWorkspaceRuntimeRoot } from '../../../domains/workflow-contract/workspace-runtime.js';
async function fileBytes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(dir: string) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.name === '.git' || item.name === 'request.json') continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await visit(file);
      else if (item.isFile())
        result[path.relative(root, file).replaceAll('\\', '/')] = (
          await fs.readFile(file)
        ).toString('base64');
    }
  }
  await visit(root);
  return result;
}
async function archiveFixture() {
  const f = await fixture('tweak');
  commitFixture(f.root);
  for (const file of ['proposal.md', 'design.md', 'tasks.md'])
    await fs.writeFile(
      path.join(f.root, 'openspec/changes/demo', file),
      file === 'tasks.md' ? '- [ ] SIMULATED documentation task\n' : '# SIMULATED ' + file + '\n',
    );
  const opened = await f.cli('guard', 'demo', 'open');
  expect(
    (await f.cli('guard', 'demo', 'open', '--apply', '--approval-hash', opened.data.approvalHash))
      .exitCode,
  ).toBe(0);
  await fs.writeFile(
    path.join(f.root, 'openspec/changes/demo/tasks.md'),
    '- [x] SIMULATED documentation task\n',
  );
  await fs.writeFile(
    path.join(f.root, 'checks.json'),
    JSON.stringify({
      checks: [],
      checksReason: 'SIMULATED Agent: documentation-only fixture; no command applies.',
    }),
  );
  expect((await f.cli('state', 'complete-build', 'demo', '--checks', 'checks.json')).exitCode).toBe(
    0,
  );
  await fs.mkdir(path.join(f.root, 'docs/superpowers/reports'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(f.root, 'docs/superpowers/reports/verify.md'),
    '# SIMULATED Agent independent verification\nAll scope reviewed.\n',
  );
  expect(
    (
      await f.cli(
        'guard',
        'demo',
        'verify',
        '--report',
        'docs/superpowers/reports/verify.md',
        '--apply',
        '--checks',
        'checks.json',
      )
    ).exitCode,
  ).toBe(0);
  const proposed = await f.cli(
    'state',
    'propose-archive',
    'demo',
    '--summary',
    'SIMULATED USER approves local archive',
  );
  expect(proposed.exitCode).toBe(0);
  expect(
    (
      await f.cli(
        'state',
        'decide-archive',
        'demo',
        '--proposal-hash',
        proposed.data.wait.proposalHash,
        '--choice',
        'local',
      )
    ).exitCode,
  ).toBe(0);
  const { run, runtime } = await inspectClassicSdkRun(f.root, 'demo');
  const ready = await executeClassicSdkArchivePreflight(runtime, {
    runId: run.runId,
    projectRoot: f.root,
  });
  const action = ready.actions.find((a) => a.status === 'pending')!;
  expect(action.ref).toBe('classic-archive');
  const claimed = await runtime.claim({
    runId: 'demo',
    expectedRevision: ready.revision,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-archive',
    claimToken: 'SIMULATED original Archive caller',
    context: { requestId: 'SIMULATED archive launch', projectRoot: f.root },
  });
  return {
    ...f,
    runtime,
    claimed,
    action: claimed.actions.find((a) => a.id === action.id)!,
  };
}
it.each(['running', 'unknown'] as const)(
  'rejects cancelling the original %s Classic Archive before changing its Run or files and recovers only that Archive claim',
  async (status) => {
    const f = await archiveFixture();
    const openspec = await createOpenSpecArchiveFixture(f.root, 'demo');
    vi.stubEnv('COMET_OPENSPEC', openspec.command);
    // The unknown sample performs the real local OpenSpec archive before losing its result.
    if (status === 'unknown') {
      const result = await runClassicSdkArchive(f.claimed, f.action, f.root);
      expect(result.status, JSON.stringify(result)).toBe('succeeded');
      await f.runtime.markUnknown({
        runId: 'demo',
        actionId: f.action.id,
        attempt: f.action.attempt,
        reason: 'SIMULATED lost return after actual OpenSpec archive',
      });
    }
    const before = (await inspectClassicSdkRun(f.root, 'demo')).run,
      projectBytes = await fileBytes(f.root),
      runtimeRoot = await resolveWorkspaceRuntimeRoot(f.root),
      runtimeBytes = await fileBytes(runtimeRoot);
    const request = path.join(f.root, 'request.json');
    await fs.writeFile(
      request,
      JSON.stringify({
        operation: 'cancel',
        runId: 'demo',
        reason: 'SIMULATED USER cancel during unfinished Archive',
      }),
    );
    const rejected = await runtimeDispatchCommand(
      { request, application: 'classic-tweak', projectRoot: f.root },
      { invocationCwd: f.root },
    );
    expect(rejected.exitCode).not.toBe(0);
    expect(JSON.stringify(rejected.response)).toMatch(/Archive must finish or recover/u);
    expect((await inspectClassicSdkRun(f.root, 'demo')).run).toEqual(before);
    expect(await fileBytes(f.root)).toEqual(projectBytes);
    expect(await fileBytes(runtimeRoot)).toEqual(runtimeBytes);
    const diagnosed = await f.cli('state', 'check', 'demo', 'archive', '--recover');
    expect(diagnosed.exitCode).not.toBe(0);
    expect(diagnosed.data.recovery.action.actionId).toBe(f.action.id);
    expect(diagnosed.data.recovery.claim).toEqual(f.action.claim);
    if (status === 'running') {
      await expect(
        recoverClassicSdkArchive(f.runtime, {
          runId: 'demo',
          projectRoot: f.root,
        }),
      ).rejects.toThrow(/may still be running/u);
      expect((await f.runtime.inspect('demo')).runId).toBe(before.runId);
      const result = await runClassicSdkArchive(
        before,
        before.actions.find((a) => a.id === f.action.id)!,
        f.root,
      );
      expect(result.status, JSON.stringify(result)).toBe('succeeded');
      await f.runtime.markUnknown({
        runId: 'demo',
        actionId: f.action.id,
        attempt: f.action.attempt,
        reason: 'SIMULATED lost return after actual synchronous OpenSpec archive',
      });
    }
    const recovered = await recoverClassicSdkArchive(f.runtime, {
      runId: 'demo',
      projectRoot: f.root,
    });
    const done = recovered.actions.find((a) => a.id === f.action.id)!;
    expect(done.status).toBe('succeeded');
    expect(done.claim).toEqual(f.action.claim);
    expect(done.attempt).toBe(f.action.attempt);
    expect(done.inputHash).toBe(f.action.inputHash);
    expect(recovered.waits).toEqual(before.waits);
    expect(recovered.state).toMatchObject({ archived: true });
    const after = await recoverClassicSdkArchive(f.runtime, {
      runId: 'demo',
      projectRoot: f.root,
    });
    expect(after).toEqual(recovered);
  },
);
