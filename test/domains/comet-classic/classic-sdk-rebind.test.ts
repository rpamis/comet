import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { readClassicSdkRunRecord } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    expect(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  }
});
async function fixture(layout: 'legacy' | 'docs' = 'legacy', profile: 'tweak' | 'full' = 'tweak') {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-rebind-'));
  roots.push(parent);
  const root = path.join(parent, 'project');
  const home = path.join(parent, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('COMET_DATA_DIR', path.join(parent, 'data'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await prepareClassicLegacyProject(root);
  if (layout === 'docs') {
    const config = path.join(root, '.comet/config.yaml');
    await fs.writeFile(
      config,
      (await fs.readFile(config, 'utf8')).replace(
        'artifact_layout: legacy',
        'artifact_layout: docs',
      ),
    );
    await fs.mkdir(path.join(root, 'docs'));
    await fs.rename(path.join(root, 'openspec'), path.join(root, 'docs/openspec'));
  }
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const invoke = (...args: string[]) =>
    runClassicCli([...args, '--json'], undefined, { invocationCwd: root });
  expect(
    (await invoke('state', 'init', 'example', profile, '--isolation', 'current')).exitCode,
  ).toBe(0);
  const before = (await inspectClassicSdkRun(root, 'example')).run;
  const cold = async () => {
    const directory = path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs', 'classic');
    expect(path.resolve(directory).startsWith(path.resolve(parent) + path.sep)).toBe(true);
    await fs.rm(directory, { recursive: true, force: true });
    expect(await readClassicSdkRunRecord(root, 'example')).toBeNull();
  };
  return { root, git, invoke, before, cold };
}

describe('Classic SDK branch rebinding', () => {
  it('rebinds a full docs-layout Run from its portable checkpoint after deletion of its old branch', async () => {
    const f = await fixture('docs', 'full');
    f.git('checkout', '-b', 'next');
    f.git('branch', '-D', 'main');
    await f.cold();
    const rebound = await f.invoke('state', 'rebind', 'example');
    expect(rebound.exitCode, rebound.stdout).toBe(0);
    const after = (await inspectClassicSdkRun(f.root, 'example')).run;
    expect(after.runId).toBe(f.before.runId);
    expect(after.actions).toEqual(f.before.actions);
    expect((after.state as { boundBranch: string }).boundBranch).toBe('next');
    await f.cold();
    expect((await inspectClassicSdkRun(f.root, 'example')).run).toEqual(after);
  });
  it.each(['switched', 'deleted', 'portable'] as const)(
    'rebinds the same Run after the original branch is %s',
    async (mode) => {
      const f = await fixture();
      f.git('checkout', '-b', 'next');
      if (mode !== 'switched') f.git('branch', '-D', 'main');
      if (mode === 'portable') await f.cold();
      const result = await f.invoke('state', 'rebind', 'example');
      expect(result.exitCode, result.stdout || result.stderr).toBe(0);
      const after = (await inspectClassicSdkRun(f.root, 'example')).run;
      expect(after.runId).toBe(f.before.runId);
      expect(after.workflow).toEqual(f.before.workflow);
      expect(after.actions).toEqual(f.before.actions);
      expect(after.waits).toEqual(f.before.waits);
      expect(after.state).toEqual({ ...(f.before.state as object), boundBranch: 'next' });
      const document = parse(
        await fs.readFile(path.join(f.root, 'openspec/changes/example/comet-state.yaml'), 'utf8'),
      );
      expect(document.bound_branch).toBe('next');
      expect(document.run_checkpoint.run.state.boundBranch).toBe('next');
      await f.cold();
      expect((await inspectClassicSdkRun(f.root, 'example')).state.boundBranch).toBe('next');
    },
  );

  it('rejects rebinding with an unresolved original Action or detached HEAD', async () => {
    const f = await fixture();
    const { runtime, run } = await inspectClassicSdkRun(f.root, 'example');
    const action = run.actions.find((a) => a.status === 'pending')!;
    await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'original-worker',
      claimToken: randomUUID(),
      expectedRevision: run.revision,
    });
    f.git('checkout', '-b', 'next');
    expect((await f.invoke('state', 'rebind', 'example')).exitCode).not.toBe(0);
    const after = await readClassicSdkRunRecord(f.root, 'example');
    expect(after?.state).toEqual(f.before.state);
    expect(after?.actions.find((a) => a.id === action.id)?.claim?.executorId).toBe(
      'original-worker',
    );
    f.git('checkout', '--detach');
    expect((await f.invoke('state', 'rebind', 'example')).exitCode).not.toBe(0);
  });

  it('rejects edited portable branch fields rather than trusting a rewritten projection', async () => {
    const f = await fixture();
    f.git('checkout', '-b', 'next');
    await f.cold();
    const file = path.join(f.root, 'openspec/changes/example/comet-state.yaml');
    const source = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, source.replace('bound_branch: main', 'bound_branch: next'));
    expect((await f.invoke('state', 'rebind', 'example')).exitCode).not.toBe(0);
    expect(await readClassicSdkRunRecord(f.root, 'example')).toBeNull();
  });
});
