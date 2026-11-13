import { promises as fs } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';
import { loadPreparedNativeArchive } from '../../helpers/native-archive-wal.js';
import { readNativeChangeFile } from '../../../domains/comet-native/native-change.js';

type Tree = { directories: string[]; files: Array<{ ref: string; bytesBase64: string }> };
type Frozen = {
  run: WorkflowRun;
  projectMaterials: Tree;
  runtimeMaterials: Tree;
  git: { branch: string; head: string };
};
const fixtureRoot = path.resolve('test/fixtures/native-052-sdk-archive-upgrade');
const roots: string[] = [];
beforeAll(() => ensureCliBuilt(path.resolve('.')), 120_000);
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function materialize(root: string, tree: Tree, keep: (ref: string) => boolean) {
  for (const directory of tree.directories) {
    const ref = directory.replaceAll('\\', '/');
    if (keep(ref)) await fs.mkdir(path.join(root, ref), { recursive: true });
  }
  for (const file of tree.files) {
    const ref = file.ref.replaceAll('\\', '/');
    if (!keep(ref)) continue;
    const target = path.join(root, ref);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(file.bytesBase64, 'base64'));
  }
}
async function identity(file: string) {
  try {
    const stat = await fs.stat(file, { bigint: true });
    return { dev: stat.dev, ino: stat.ino, mtimeNs: stat.mtimeNs, size: stat.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

it('imports a published prepared Archive WAL and business Run before explicit transaction recovery', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-old-layout-archive-wal-'));
  roots.push(temporary);
  const root = path.join(temporary, 'project');
  await fs.mkdir(root);
  vi.stubEnv('COMET_DATA_DIR', path.join(temporary, 'data'));
  const paths = await nativeProjectPaths(root, '.'),
    legacy = path.join(root, '.comet/runtime');
  const fixture = await loadPreparedNativeArchive(
    {
      ...paths,
      workspaceRuntimeRoot: legacy,
      runtimeDir: path.join(legacy, 'native'),
      changesRuntimeDir: path.join(legacy, 'native/changes'),
      locksDir: path.join(legacy, 'native/locks'),
      transactionsDir: path.join(legacy, 'native/transactions'),
    },
    'replace-create',
  );
  const invoke = (args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [path.resolve('dist/app/cli/index.js'), ...args, '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
        env: { ...process.env, COMET_DAEMON: 'off', COMET_SKIP_UPDATE_CHECK: '1' },
      },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return JSON.parse(result.stdout);
  };
  const imported = invoke(['doctor', root, '--import-legacy-runtime']);
  expect(imported.imported).toContain(
    'native/transactions/' + fixture.journal.id + '/transaction.json',
  );
  expect(imported.imported).toContain('native/changes/' + fixture.state.name + '/run-state.json');
  invoke([
    'native',
    'doctor',
    '--transaction',
    fixture.journal.id,
    '--repair',
    '--strategy',
    'continue',
    '--project-root',
    root,
  ]);
  expect(await fs.readFile(path.join(paths.specsDir, 'authentication/spec.md'), 'utf8')).toBe(
    'new auth\n',
  );
  expect(
    (
      await readNativeChangeFile(
        path.join(paths.archiveDir, '2026-07-24-archive-fixture/comet-state.yaml'),
      )
    ).archived,
  ).toBe(true);
  const original = JSON.parse(
    await fs.readFile(
      path.join(legacy, 'native/transactions', fixture.journal.id, 'transaction.json'),
      'utf8',
    ),
  );
  expect(original.status).toBe('prepared');
});

it.each([
  'archive-prepare-pending',
  'archive-applied-finalize-pending',
  'archive-finalize-running-before-move',
  'archive-moved-finalize-result-unreported',
] as const)(
  'continues published 0.5.2 Archive without replaying accepted work (%s)',
  async (stage) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-published-archive-upgrade-'));
    roots.push(temporary);
    const root = path.join(temporary, 'project');
    await fs.mkdir(root);
    vi.stubEnv('COMET_DATA_DIR', path.join(temporary, 'data'));
    const frozen = JSON.parse(
      await fs.readFile(path.join(fixtureRoot, stage + '.json'), 'utf8'),
    ) as Frozen;
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git('init', '-b', frozen.git.branch);
    git('config', 'user.name', 'Archive Upgrade Test');
    git('config', 'user.email', 'fixture@example.invalid');
    git('fetch', path.join(fixtureRoot, 'original-git.bundle'), frozen.git.branch);
    git('update-ref', 'refs/heads/' + frozen.git.branch, frozen.git.head);
    git('read-tree', frozen.git.head);
    await materialize(root, frozen.projectMaterials, (ref) => ref !== '.comet/runtime');
    const paths = await nativeProjectPaths(root, 'docs');
    const legacy = path.join(root, '.comet/runtime');
    await materialize(legacy, frozen.runtimeMaterials, () => true);
    const source = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(legacy, 'sdk-runs/native'),
    });
    expect(await source.read(frozen.run.runId)).toEqual(frozen.run);
    const cli = (args: string[]) => {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve('dist/app/cli/index.js'),
          ...args,
          ...(args[0] === 'doctor' ? [] : ['--project-root', root]),
          '--json',
        ],
        {
          cwd: root,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, COMET_DAEMON: 'off', COMET_SKIP_UPDATE_CHECK: '1' },
        },
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);
      return JSON.parse(result.stdout);
    };
    let requestIndex = 0;
    const dispatch = async (request: Record<string, unknown>) => {
      const file = path.join(temporary, `request-${++requestIndex}.json`);
      await fs.writeFile(file, JSON.stringify(request));
      const response = cli(['runtime', 'dispatch', '--application', 'native', '--request', file]);
      expect(response.status).toBe('succeeded');
      return response.data as WorkflowRun;
    };
    const canonical = path.join(paths.specsDir, 'workflow/spec.md');
    const archiveRef = (
      frozen.run.outputs['archive.execute']?.value as { archiveRef?: string } | undefined
    )?.archiveRef;
    const archive = archiveRef ? path.join(paths.archiveDir, archiveRef) : undefined;
    const beforeCanonical = await identity(canonical),
      beforeArchive = archive ? await identity(archive) : null;
    const beforeBytes = beforeCanonical ? await fs.readFile(canonical) : null;
    const imported = cli(['doctor', root, '--import-legacy-runtime']);
    expect(imported.status).toBe('imported');
    const business = frozen.runtimeMaterials.files.filter(
      (file) =>
        file.ref.startsWith('native/transactions/') ||
        file.ref.startsWith('native/sdk-archive-receipts/'),
    );
    for (const file of business) {
      expect(imported.imported).toContain(file.ref);
      expect(await fs.readFile(path.join(paths.workspaceRuntimeRoot, file.ref))).toEqual(
        Buffer.from(file.bytesBase64, 'base64'),
      );
      expect(await fs.readFile(path.join(legacy, file.ref))).toEqual(
        Buffer.from(file.bytesBase64, 'base64'),
      );
    }
    await expect(
      fs.access(path.join(paths.workspaceRuntimeRoot, 'native/sdk-checks')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const upgraded = await dispatch({ operation: 'inspect', runId: frozen.run.runId });
    expect(upgraded.workflow.version).toBe('4');
    if (stage === 'archive-moved-finalize-result-unreported') {
      const original = JSON.parse(
        await fs.readFile(path.join(fixtureRoot, 'original-finalize-result-request.json'), 'utf8'),
      );
      await dispatch(original);
    } else if (stage === 'archive-finalize-running-before-move') {
      const action = frozen.run.actions.find(
        (action) => action.stepId === 'archive.finalize' && action.status === 'running',
      )!;
      await dispatch({
        operation: 'mark-unknown',
        runId: frozen.run.runId,
        actionId: action.id,
        attempt: action.attempt,
        reason:
          'SIMULATED lost platform reply: original claim exists, no outcome was submitted. No stop or successful work is asserted.',
      });
      cli(['native', 'archive', frozen.run.runId, '--recover']);
    } else cli(['native', 'archive', frozen.run.runId]);
    const completed = await dispatch({ operation: 'inspect', runId: frozen.run.runId });
    expect(completed.status).toBe('completed');
    expect(completed.waits).toEqual(frozen.run.waits);
    for (const original of frozen.run.actions) {
      const current = completed.actions.find((action) => action.id === original.id)!;
      expect(current.input).toEqual(original.input);
      expect(current.inputHash).toBe(original.inputHash);
      if (original.claim) expect(current.claim).toEqual(original.claim);
      if (original.outcome) expect(current.outcome).toEqual(original.outcome);
    }
    if (beforeCanonical) {
      expect(await identity(canonical)).toEqual(beforeCanonical);
      expect(await fs.readFile(canonical)).toEqual(beforeBytes);
    }
    if (beforeArchive)
      expect(await identity(archive!)).toMatchObject({
        dev: beforeArchive.dev,
        ino: beforeArchive.ino,
      });
    expect(git('rev-parse', 'HEAD')).toBe(frozen.git.head);
    const finalCanonical = await identity(canonical),
      actualArchive =
        archive ??
        path.join(
          paths.archiveDir,
          (completed.outputs['archive.execute'].value as { archiveRef: string }).archiveRef,
        ),
      finalArchive = await identity(actualArchive);
    cli(['native', 'archive', frozen.run.runId, '--recover']);
    expect(await identity(canonical)).toEqual(finalCanonical);
    expect(await identity(actualArchive)).toEqual(finalArchive);
    expect((await dispatch({ operation: 'inspect', runId: frozen.run.runId })).actions).toEqual(
      completed.actions,
    );
  },
  60_000,
);
