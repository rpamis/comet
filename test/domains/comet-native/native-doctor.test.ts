import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
  readProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { moveNativeRoot } from '../../../domains/comet-native/native-root-move.js';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-doctor-current-business-'));
  roots.push(root);
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  return { root, paths: await nativeProjectPaths(root, '.') };
}
it('fails closed on malformed config and preserves its exact bytes through the public Doctor entry', async () => {
  const f = await fixture(),
    file = path.join(f.root, '.comet/config.yaml'),
    malformed = 'schema: comet.project.v1\nnative: [broken\n';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, malformed);
  for (const flags of [[], ['--repair']]) {
    const result = await runNativeCli(['doctor', ...flags, '--project-root', f.root, '--json']);
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout).error).toBeDefined();
    expect(await fs.readFile(file, 'utf8')).toBe(malformed);
  }
});
it('inspects a real pending root move read-only and repairs it only with the requested rollback strategy', async () => {
  const f = await fixture();
  await writeProjectConfig(f.root, defaultProjectConfig('.', 'en'));
  const spec = path.join(f.paths.specsDir, 'example/spec.md');
  await fs.mkdir(path.dirname(spec), { recursive: true });
  await fs.writeFile(spec, 'Original canonical Spec\n');
  await expect(
    moveNativeRoot({
      projectRoot: f.root,
      toArtifactRoot: 'docs',
      hooks: {
        afterRootMoveStage(stage) {
          if (stage === 'ready') throw Error('SIMULATED crash at actual root-move ready boundary');
        },
      },
    }),
  ).rejects.toThrow('SIMULATED crash');
  const config = path.join(f.root, '.comet/config.yaml'),
    before = await fs.readFile(config, 'utf8');
  expect((await readProjectConfig(f.root))?.native.pending_root_move).toBeTruthy();
  const diagnosis = await nativeDoctorCommand([], f.root);
  expect(diagnosis.data).toMatchObject({
    healthy: false,
    pendingRootMove: expect.any(Object),
  });
  expect(await fs.readFile(config, 'utf8')).toBe(before);
  expect(await fs.readFile(spec, 'utf8')).toBe('Original canonical Spec\n');
  const repaired = await nativeDoctorCommand(['--repair', '--strategy', 'rollback'], f.root);
  expect(repaired.data).toMatchObject({ healthy: true, repaired: true });
  expect((await readProjectConfig(f.root))?.native.pending_root_move).toBeFalsy();
  expect((await readProjectConfig(f.root))?.native.artifact_root).toBe('.');
  expect(await fs.readFile(spec, 'utf8')).toBe('Original canonical Spec\n');
});

import {
  nativeSelectionFile,
  readNativeSelectionRecord,
  clearNativeSelection,
} from '../../../domains/comet-native/native-selection.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';
it('keeps stale selection reads unchanged and changes only selection after an explicit current user choice', async () => {
  const f = await fixture();
  await writeProjectConfig(f.root, defaultProjectConfig('.', 'en'));
  const created = await runNativeCli([
    'new',
    'current-selection',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(created.exitCode, created.stdout).toBe(0);
  const run = (await inspectNativeSdkRun(f.root, 'current-selection')).run,
    file = nativeSelectionFile(f.paths),
    source = JSON.stringify({
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'missing-change',
      branch: null,
    });
  await fs.writeFile(file, source);
  expect((await readNativeSelectionRecord(f.paths))!.change).toBe('missing-change');
  expect(await fs.readFile(file, 'utf8')).toBe(source);
  const selected = await runNativeCli([
    'select',
    'current-selection',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(selected.exitCode, selected.stdout).toBe(0);
  expect((await readNativeSelectionRecord(f.paths))!.change).toBe('current-selection');
  expect((await inspectNativeSdkRun(f.root, 'current-selection')).run).toEqual(run);
  await clearNativeSelection(f.paths);
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await inspectNativeSdkRun(f.root, 'current-selection')).run).toEqual(run);
});
it('rejects a large malformed selection while preserving the exact input bytes', async () => {
  const f = await fixture(),
    file = nativeSelectionFile(f.paths),
    bytes = Buffer.alloc(16 * 1024 + 1, 0x61);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  await expect(readNativeSelectionRecord(f.paths)).rejects.toThrow(/invalid JSON/);
  expect(await fs.readFile(file)).toEqual(bytes);
});

it('rejects an escaped Runtime directory without writing outside the selected project', async () => {
  const f = await fixture(),
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'native-doctor-escaped-runtime-'));
  roots.push(outside);
  await writeProjectConfig(f.root, defaultProjectConfig('.', 'en'));
  await fs.mkdir(path.dirname(f.paths.runtimeDir), { recursive: true });
  await fs.symlink(outside, f.paths.runtimeDir, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await runNativeCli(['doctor', '--repair', '--project-root', f.root, '--json']);
  expect(result.exitCode, result.stdout).not.toBe(0);
  expect(await fs.readdir(outside)).toEqual([]);
});
