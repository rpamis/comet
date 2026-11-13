import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as projectionLocking from '../../../platform/fs/recoverable-file-lock.js';
import { nativeNewCommand } from '../../../domains/comet-native/native-new-command.js';
import { nativeStatusCommand } from '../../../domains/comet-native/native-status-command.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { readNativeSdkRunRecord } from '../../../domains/comet-native/native-sdk-state-store.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-readonly-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  await ensureNativeDirectories(await nativeProjectPaths(root, 'docs'));
  const name = 'lock-test';
  const created = await nativeNewCommand([name], root);
  expect(created.exitCode).toBe(0);
  const lock = path.join(
    resolveWorkspaceRuntimeRootSync(root),
    'state-projections/native',
    `${name}.lock`,
  );
  const request = path.join(root, 'inspect.json');
  await fs.writeFile(request, JSON.stringify({ operation: 'inspect', runId: name }));
  return { root, name, lock, request };
}
async function files(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const ref = path.relative(root, file);
      if (entry.isDirectory()) {
        result[`${ref}/`] = 'directory';
        await walk(file);
      } else if (entry.isSymbolicLink()) result[ref] = `symlink:${await fs.readlink(file)}`;
      else {
        const stat = await fs.stat(file, { bigint: true });
        result[ref] = `${stat.mtimeNs}:${(await fs.readFile(file)).toString('base64')}`;
      }
    }
  }
  await walk(root);
  // The authoritative Runtime is isolated outside projectRoot; read-only checks must preserve it too.
  await walk(resolveWorkspaceRuntimeRootSync(root));
  return result;
}

describe('Native SDK read-only history and checkpoint recovery', () => {
  it.each([
    ['empty', '', 'malformed'],
    ['partial', '{partial-owner:', 'malformed'],
    [
      'remote',
      JSON.stringify({ pid: 2_147_483_647, nonce: 'old-host', hostname: 'old-host', createdAt: 1 }),
      'unknown',
    ],
    [
      'dead',
      JSON.stringify({
        pid: 2_147_483_647,
        nonce: 'dead-owner',
        hostname: os.hostname(),
        createdAt: Date.now(),
      }),
      'unknown',
    ],
  ])(
    'status and public runtime inspect ignore a retired %s lock without writing',
    async (_kind, content) => {
      const { root, name, lock, request } = await fixture();
      await fs.mkdir(path.dirname(lock), { recursive: true });
      await fs.writeFile(lock, content);
      const before = await files(root);
      // 直接拒绝获取写锁，避免并发调度和磁盘负载影响固定耗时断言。
      const acquireLock = vi
        .spyOn(projectionLocking, 'withRecoverableFileLock')
        .mockImplementation(async () => {
          throw new Error('只读查询不能获取写锁');
        });
      expect((await nativeStatusCommand([name], root)).exitCode).toBe(0);
      const inspect = await runtimeDispatchCommand({
        projectRoot: root,
        application: 'native',
        request,
      });
      expect(inspect.exitCode, JSON.stringify(inspect.response)).toBe(0);
      const doctor = await nativeDoctorCommand([name], root);
      expect(doctor.data).toMatchObject({
        healthy: true,
      });
      expect(acquireLock).not.toHaveBeenCalled();
      expect(await files(root)).toEqual(before);
    },
  );

  it('diagnoses a missing Run without restoring it, then explicit repair preserves its revision', async () => {
    const { root, name } = await fixture();
    const original = await readNativeSdkRunRecord(root, name);
    await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'), {
      recursive: true,
    });
    const before = await files(root);
    await expect(nativeStatusCommand([name], root)).rejects.toThrow(/checkpoint recovery/);
    const doctor = await nativeDoctorCommand([name], root);
    expect(doctor.data).toMatchObject({ healthy: false });
    expect(doctor.data).toMatchObject({
      recovery: { commandArgs: ['comet', 'native', 'doctor', name, '--repair', '--confirmed'] },
    });
    expect(await files(root)).toEqual(before);
    const repaired = await nativeDoctorCommand([name, '--repair', '--confirmed'], root);
    expect(repaired.data).toMatchObject({ healthy: true, repaired: true });
    expect(await readNativeSdkRunRecord(root, name)).toEqual(original);
    expect((await nativeStatusCommand([name], root)).exitCode).toBe(0);
    expect((await nativeDoctorCommand([name, '--repair'], root)).data).toMatchObject({
      healthy: true,
      repaired: false,
    });
  });

  it('reads the authoritative Run without requiring or recreating a retired projection marker', async () => {
    const { root, name } = await fixture();
    const marker = path.join(
      resolveWorkspaceRuntimeRootSync(root),
      'state-projections/native',
      name + '.json',
    );
    await fs.rm(marker, { force: true });
    const original = await readNativeSdkRunRecord(root, name);
    const before = await files(root);
    expect((await nativeStatusCommand([name], root)).exitCode).toBe(0);
    expect((await nativeDoctorCommand([name], root)).data).toMatchObject({
      healthy: true,
      repaired: false,
    });
    expect(await readNativeSdkRunRecord(root, name)).toEqual(original);
    expect(await files(root)).toEqual(before);
    await expect(fs.access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')(
    'ignores an unsafe retired projection-lock path without writing its target',
    async () => {
      const { root, name, lock } = await fixture();
      const target = path.join(root, 'untouched');
      await fs.writeFile(target, 'keep');
      await fs.mkdir(path.dirname(lock), { recursive: true });
      await fs.symlink(target, lock);
      const before = await files(root);
      const doctor = await nativeDoctorCommand([name, '--repair'], root);
      expect(doctor.data).toMatchObject({ healthy: true });
      expect(await fs.readFile(target, 'utf8')).toBe('keep');
      expect(await files(root)).toEqual(before);
    },
  );
  it('reads a healthy raw SDK start before Native artifacts exist without creating a projection', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-raw-readonly-'));
    roots.push(root);
    await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
    const name = 'raw-sdk';
    const request = path.join(root, 'request.json');
    await fs.writeFile(
      request,
      JSON.stringify({
        operation: 'start',
        runId: name,
        workflow: { id: 'comet-native', version: '4' },
        input: { name, artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name,
          language: 'en',
          nextAction: 'prepare-shape-confirmation',
        }),
      }),
    );
    expect(
      (await runtimeDispatchCommand({ projectRoot: root, application: 'native', request }))
        .exitCode,
    ).toBe(0);
    await fs.writeFile(request, JSON.stringify({ operation: 'inspect', runId: name }));
    const before = await files(root);
    expect(
      (await runtimeDispatchCommand({ projectRoot: root, application: 'native', request }))
        .exitCode,
    ).toBe(0);
    expect((await nativeStatusCommand([name], root)).exitCode).toBe(0);
    expect((await nativeDoctorCommand([name], root)).data).toMatchObject({
      healthy: true,
      repaired: false,
    });
    expect(await files(root)).toEqual(before);
    await expect(fs.access(path.join(root, 'docs/comet/changes', name))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('diagnoses lost ownership read-only and explicitly restores the same existing Run', async () => {
    const { root, name } = await fixture();
    const original = await readNativeSdkRunRecord(root, name);
    await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(root), 'change-owners'), {
      recursive: true,
    });
    const before = await files(root);
    await expect(nativeStatusCommand([name], root)).rejects.toThrow(/checkpoint recovery/);
    expect((await nativeDoctorCommand([name], root)).data).toMatchObject({ healthy: false });
    expect(await files(root)).toEqual(before);
    expect((await nativeDoctorCommand([name, '--repair', '--confirmed'], root)).data).toMatchObject(
      { healthy: true, repaired: true },
    );
    expect(await readNativeSdkRunRecord(root, name)).toEqual(original);
    expect((await nativeStatusCommand([name], root)).exitCode).toBe(0);
  });
  it('does not register a root owner for a stored Child Run during explicit Doctor repair', async () => {
    const { root, name } = await fixture();
    const raw = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'),
    });
    const original = (await raw.read(name))!;
    // SIMULATED stored Child lineage at the owner-recovery boundary; no execution receipt or approval is fabricated.
    expect(
      await raw.compareAndSwap(name, original.revision, {
        ...original,
        revision: original.revision + 1,
        lineage: ['parent-run'],
      }),
    ).toBe(true);
    await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(root), 'change-owners'), {
      recursive: true,
    });
    const child = await raw.read(name),
      before = await files(root);
    const result = await runNativeCli([
      'doctor',
      name,
      '--repair',
      '--confirmed',
      '--project-root',
      root,
      '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain('original parent');
    expect(await raw.read(name)).toEqual(child);
    expect(await files(root)).toEqual(before);
    await expect(
      fs.access(
        path.join(resolveWorkspaceRuntimeRootSync(root), 'change-owners/native', name + '.json'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
