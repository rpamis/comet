import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  nativeProjectPaths,
  nativeChangeRuntimeDir,
} from '../../../domains/comet-native/native-paths.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { writeNativeWorkspaceIdentity } from '../../../domains/comet-native/native-workspace.js';
import { readNativePortableChange } from '../../../domains/comet-native/native-portable-runtime.js';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});
it('preserves a published approved pending Shape transition on read-only diagnosis and explicit legacy upgrade', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-published-doctor-transition-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(root, '.'),
    frozen = JSON.parse(
      await fs.readFile(
        path.resolve('test/fixtures/native-052-transition-journal/remove-after-recovery.json'),
        'utf8',
      ),
    );
  for (const item of frozen.materials.files) {
    const file = path.join(paths.nativeRoot, ...item.ref.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(item.bytesBase64, 'base64'));
  }
  const runtime = nativeChangeRuntimeDir(paths, frozen.name);
  await fs.mkdir(runtime, { recursive: true });
  for (const item of frozen.changeRuntime.files.filter((f: any) => f.ref === 'transition.json'))
    await fs.writeFile(path.join(runtime, item.ref), Buffer.from(item.bytesBase64, 'base64'));
  await writeNativeWorkspaceIdentity({
    paths,
    name: frozen.name,
    revision: frozen.originalState.revision,
  });
  const stateFile = path.join(paths.changesDir, frozen.name, 'comet-state.yaml'),
    before = await fs.readFile(stateFile, 'utf8'),
    journal = await fs.readFile(path.join(runtime, 'transition.json'), 'utf8');
  await nativeDoctorCommand([frozen.name], root);
  expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  expect(await fs.readFile(path.join(runtime, 'transition.json'), 'utf8')).toBe(journal);
  const result = await nativeDoctorCommand([frozen.name, '--repair'], root);
  const state = await readNativePortableChange(paths, frozen.name);
  expect(state.phase).toBe('build');
  expect(state.loop.stage).toBe('building');
  expect(state.history.some((h) => h.outcome === 'recovery')).toBe(true);
});
