import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-readonly-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  await ensureNativeDirectories(await nativeProjectPaths(root, 'docs'));
  const created = await nativeNewCommand(['lock-test'], root);
  expect(created.exitCode).toBe(0);
  const name = 'lock-test';
  const lock = path.join(root, '.comet/runtime/state-projections/native', `${name}.lock`);
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
  return result;
}

describe('Native SDK read-only projection lock diagnostics', () => {
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
      'stale',
    ],
  ])(
    'status and public runtime inspect remain fast and immutable with a %s lock',
    async (_kind, content, expected) => {
      const { root, name, lock, request } = await fixture();
      await fs.writeFile(lock, content);
      const before = await files(root);
      const started = performance.now();
      expect((await nativeStatusCommand([name], root)).exitCode).toBe(0);
      const inspect = await runtimeDispatchCommand({
        projectRoot: root,
        application: 'native',
        request,
      });
      expect(inspect.exitCode, JSON.stringify(inspect.response)).toBe(0);
      const doctor = await nativeDoctorCommand([name], root);
      expect(doctor.data).toMatchObject({
        healthy: false,
        findings: [{ code: `sdk-projection-lock-${expected}` }],
      });
      expect(performance.now() - started).toBeLessThan(1800);
      expect(await files(root)).toEqual(before);
    },
  );

  it('does not steal an uncertain lock during ordinary repair and requires its exact confirmed token', async () => {
    const { root, name, lock } = await fixture();
    await fs.writeFile(lock, '{partial');
    const before = await files(root);
    const doctor = await nativeDoctorCommand([name, '--repair'], root);
    const finding = (
      doctor.data as { findings: Array<{ code: string; token: string; repairCommand: string }> }
    ).findings[0];
    expect(finding.code).toBe('sdk-projection-lock-malformed');
    expect(finding.repairCommand).toContain('--repair --confirmed --lock-token');
    expect(await files(root)).toEqual(before);
    const run = await readNativeSdkRunRecord(root, name);
    const repaired = await nativeDoctorCommand(
      [name, '--repair', '--confirmed', '--lock-token', finding.token],
      root,
    );
    expect(repaired.data).toMatchObject({ healthy: true, repaired: true });
    expect(await readNativeSdkRunRecord(root, name)).toEqual(run);
    expect((await nativeStatusCommand([name], root)).exitCode).toBe(0);
  });

  it('reports abandoned coordinator tickets even if the projection lock is missing', async () => {
    const { root, name, lock } = await fixture();
    const ticket = path.join(`${lock}.contenders`, 'abandoned.ticket');
    await fs.writeFile(
      ticket,
      JSON.stringify({
        pid: 1,
        hostname: 'another-host',
        nonce: 'abandoned',
        createdAt: 1,
        ticket: 1,
      }),
    );
    const before = await files(root);
    const doctor = await nativeDoctorCommand([name], root);
    const findings = (
      doctor.data as { healthy: boolean; findings: Array<{ code: string; token: string }> }
    ).findings;
    expect(findings[0].code).toBe('sdk-projection-coordinator-unknown');
    expect(await files(root)).toEqual(before);
    const repaired = await nativeDoctorCommand(
      [name, '--repair', '--confirmed', '--lock-token', findings[0].token],
      root,
    );
    expect(repaired.data).toMatchObject({ healthy: true, repaired: true });
  });

  it('diagnoses a missing Run without restoring it, then explicit repair preserves its revision', async () => {
    const { root, name } = await fixture();
    const original = await readNativeSdkRunRecord(root, name);
    await fs.rm(path.join(root, '.comet/runtime/sdk-runs/native'), { recursive: true });
    const before = await files(root);
    await expect(nativeStatusCommand([name], root)).rejects.toThrow(/checkpoint recovery/);
    const doctor = await nativeDoctorCommand([name], root);
    expect(doctor.data).toMatchObject({ healthy: false });
    expect(JSON.stringify(doctor.data)).toContain(
      `comet native doctor ${name} --repair --confirmed`,
    );
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

  it('reports missing projection recovery without creating a marker during status or doctor', async () => {
    const { root, name } = await fixture();
    const marker = path.join(root, '.comet/runtime/state-projections/native', `${name}.json`);
    await fs.rm(marker);
    const before = await files(root);
    await expect(nativeStatusCommand([name], root)).rejects.toThrow(/marker needs recovery/);
    expect((await nativeDoctorCommand([name], root)).data).toMatchObject({ healthy: false });
    expect(await files(root)).toEqual(before);
    expect((await nativeDoctorCommand([name, '--repair'], root)).data).toMatchObject({
      healthy: true,
    });
    expect((await nativeStatusCommand([name], root)).exitCode).toBe(0);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects unsafe projection-lock paths without writing outside the project',
    async () => {
      const { root, name, lock } = await fixture();
      const target = path.join(root, 'untouched');
      await fs.writeFile(target, 'keep');
      await fs.symlink(target, lock);
      const before = await files(root);
      const doctor = await nativeDoctorCommand([name, '--repair'], root);
      expect(doctor.data).toMatchObject({ healthy: false });
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
        workflow: { id: 'comet-native', version: '1' },
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
    await fs.rm(path.join(root, '.comet/runtime/change-owners'), { recursive: true });
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
});
