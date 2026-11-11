import '../../helpers/isolated-agent-home.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableChange,
  confirmNativePortableShape as confirmPreparedShape,
  prepareNativePortableShapeConfirmation,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { nativeNextCommand } from '../../../domains/comet-native/native-next-command.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-current-guard-business-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(root, '.'),
    name = 'guarded-change';
  await createNativePortableChange({ paths, name, language: 'en' });
  const dir = path.join(paths.changesDir, name),
    stateFile = path.join(dir, 'comet-state.yaml');
  return { root, paths, name, dir, stateFile };
}
it('blocks an empty Shape brief without mutating state through the current confirmation boundary', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.dir, 'brief.md'), '');
  const before = await fs.readFile(f.stateFile, 'utf8');
  await expect(
    prepareNativePortableShapeConfirmation({ paths: f.paths, name: f.name }),
  ).rejects.toThrow();
  expect(await fs.readFile(f.stateFile, 'utf8')).toBe(before);
  const state = await readNativePortableChange(f.paths, f.name);
  expect(state.phase).toBe('shape');
  expect(state.shape_confirmation_hash).toBeFalsy();
});
it('requires explicit shared-understanding confirmation and rejects a stale confirmation without advancing Build', async () => {
  const f = await fixture();
  await fs.writeFile(
    path.join(f.dir, 'brief.md'),
    '# Acceptance examples\n- The selected workflow remains guarded.\n',
  );
  let state = await prepareNativePortableShapeConfirmation({
    paths: f.paths,
    name: f.name,
  });
  expect(state.phase).toBe('shape');
  expect(state.status).toBe('await-user');
  const before = await fs.readFile(f.stateFile, 'utf8');
  await nativeNextCommand([f.name], f.root);
  expect(await fs.readFile(f.stateFile, 'utf8')).toBe(before);
  await expect(
    nativeNextCommand(
      [
        f.name,
        '--confirmed',
        '--expected-state-version',
        String(state.state_version - 1),
        '--expected-action',
        'confirm-shape',
      ],
      f.root,
    ),
  ).rejects.toThrow();
  expect(await fs.readFile(f.stateFile, 'utf8')).toBe(before);
  state = await confirmPreparedShape({ paths: f.paths, name: f.name });
  expect(state.phase).toBe('build');
});
it('requires complete Agent acceptance evidence before Build can reach Verify and leaves rejected reports unchanged', async () => {
  const f = await fixture();
  await fs.writeFile(
    path.join(f.dir, 'brief.md'),
    '# Acceptance examples\n- The selected workflow remains guarded.\n',
  );
  const state = await confirmNativePortableShape({
      paths: f.paths,
      name: f.name,
    }),
    before = await fs.readFile(f.stateFile, 'utf8'),
    runner = createNativeRunnerChannel();
  for (const acceptanceReview of [
    undefined,
    state.acceptance.map((a) => ({
      id: a.id,
      status: 'known-fail' as const,
      evidence: [],
      note: 'SIMULATED incomplete isolated Agent report',
    })),
  ]) {
    await expect(
      submitNativePortableBuilderCandidate({
        paths: f.paths,
        name: f.name,
        input: {
          identity: runner.captureExecutionIdentity({
            identityProvider: 'SIMULATED-fixture',
            executionRef: 'SIMULATED-builder',
          }),
          summary: 'SIMULATED isolated report.',
          addressedAcceptanceIds: state.acceptance.map((a) => a.id),
          acceptanceReview,
          checks: [],
          knownLimits: [],
        },
      }),
    ).rejects.toThrow(/handoff is incomplete/);
    expect(await fs.readFile(f.stateFile, 'utf8')).toBe(before);
  }
});
