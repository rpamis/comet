import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readLegacyClassicArchiveInputs } from '../../../domains/comet-classic/classic-sdk-archive-legacy-manifest.js';
import type { RuntimeAction, WorkflowRun } from '../../../domains/engine/runtime.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(profile: 'full' | 'hotfix' = 'hotfix') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-legacy-paths-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  const activeRef = 'openspec/changes/example',
    archiveRef = 'openspec/changes/archive/2026-11-09-example';
  const put = async (ref: string, text = 'Original material') => {
    await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
    await fs.writeFile(path.join(root, ref), text);
  };
  await put(archiveRef + '/.comet.yaml', 'phase: archive\narchived: true\n');
  await put(archiveRef + '/proposal.md');
  await put(archiveRef + '/tasks.md');
  const run = {
    runId: 'example',
    input: { changeDir: activeRef },
    state: { workflow: profile },
    outputs: {},
    actions: [],
    actionContexts: {},
    waits: [],
  } as unknown as WorkflowRun;
  const action = {
    runId: 'example',
    id: 'archive-1',
    stepId: profile + '.archive.execute',
    status: 'succeeded',
    input: {
      outputs:
        profile === 'full'
          ? {
              'full.design.document': { designDoc: 'docs/design/example.md' },
              'full.build.plan': { plan: 'docs/plans/example.md' },
            }
          : {},
    },
    claim: { executorId: 'comet-classic-archive' },
    outcome: { status: 'succeeded', output: { archiveDirectory: archiveRef } },
  } as RuntimeAction;
  run.actions.push(action);
  const read = () => readLegacyClassicArchiveInputs(root, run, action, archiveRef);
  return { root, activeRef, archiveRef, run, action, put, read };
}

it.each(['full', 'hotfix'] as const)(
  'restores deterministic %s archive paths without artifacts',
  async (profile) => {
    const f = await fixture(profile);
    const r = await f.read();
    expect(r.paths).toEqual(
      expect.arrayContaining([f.archiveRef + '/proposal.md', f.activeRef + '/proposal.md']),
    );
    expect(r.sourcePaths).toEqual(
      expect.arrayContaining([f.activeRef + '/proposal.md', f.activeRef + '/tasks.md']),
    );
    expect(r.stateFiles).toEqual([f.archiveRef + '/.comet.yaml', f.activeRef + '/.comet.yaml']);
    expect(r.optionalPaths).toEqual([]);
    if (profile === 'full')
      expect(r.paths).toEqual(
        expect.arrayContaining(['docs/design/example.md', 'docs/plans/example.md']),
      );
    await expect(fs.stat(path.join(f.root, f.activeRef))).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('limits reconstructed sources to its archive and explicit Spec outputs', async () => {
  const f = await fixture();
  await f.put(f.archiveRef + '/.comet/notes.json', '{}');
  await f.put(f.archiveRef + '/specs/changed/spec.md');
  await f.put('openspec/specs/unrelated/spec.md');
  const r = await f.read();
  expect(r.paths).toContain(f.archiveRef + '/.comet/notes.json');
  expect(r.paths).toContain('openspec/specs/changed/spec.md');
  expect(r.paths).not.toContain('openspec/specs/unrelated/spec.md');
  expect(r.sourcePaths.every((ref) => ref.startsWith(f.activeRef + '/'))).toBe(true);
});

it.each(['.comet-state.lock', '.comet-state-transaction.json'])(
  'binds only the exact valid migration marker in %s',
  async (name) => {
    const f = await fixture();
    const marker = f.archiveRef + '/' + name + '/.comet-runtime-migration.json';
    await f.put(marker, '{"schema":"comet.workspace-runtime-migration.v1"}');
    await f.put(f.archiveRef + '/' + name + '/unrelated.json', '{}');
    const r = await f.read();
    expect(r.optionalPaths).toEqual([marker]);
    expect(r.paths).toContain(f.activeRef + '/' + name + '/.comet-runtime-migration.json');
    expect(r.paths).not.toContain(f.archiveRef + '/' + name + '/unrelated.json');
  },
);

it.each(['unfinished', 'wrong-executor', 'wrong-directory'] as const)(
  'rejects legacy archive recovery with %s execution',
  async (kind) => {
    const f = await fixture();
    if (kind === 'unfinished') f.action.status = 'pending';
    if (kind === 'wrong-executor') f.action.claim!.executorId = 'another-executor';
    if (kind === 'wrong-directory')
      f.action.outcome!.output = { archiveDirectory: 'openspec/changes/archive/other' };
    await expect(f.read()).rejects.toThrow('成功的原执行结果');
  },
);
