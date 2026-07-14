import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  archiveNativeChange,
  NativeSpecConflictError,
} from '../../../domains/comet-native/native-archive.js';
import {
  createNativeChange,
  nativeChangeDir,
  readNativeChangeFile,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { sha256File } from '../../../domains/comet-native/native-hash.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { selectNativeChange } from '../../../domains/comet-native/native-selection.js';
import { readNativeTransaction } from '../../../domains/comet-native/native-transaction.js';
import {
  NATIVE_RUNTIME_HASH,
  NATIVE_RUNTIME_PACKAGE,
} from '../../../domains/comet-native/native-runtime-package.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
  NativeSpecChange,
} from '../../../domains/comet-native/native-types.js';
import { NATIVE_RUN_STORAGE } from '../../../domains/engine/storage-layout.js';
import {
  readRunStateAt,
  startRunWithStorage,
  writeRunStateAt,
} from '../../../domains/engine/storage-run.js';

const brief = `# Outcome
Ship the capability.
# Scope
One focused behavior.
# Non-goals
No Classic migration.
# Acceptance examples
- The capability works.
# Constraints and invariants
Keep Native self-contained.
# Decisions
Use canonical specs.
# Open questions
None.
# Verification expectations
Run focused tests.
`;

const verification = `# Acceptance evidence
Acceptance examples passed.
# Commands and results
Focused tests passed.
# Skipped checks
None.
# Spec consistency
Consistent.
# Known limitations and risks
None.
# Conclusion
Pass.
`;

async function prepareArchiveChange(options: {
  paths: NativeProjectPaths;
  name: string;
  specChanges?: NativeSpecChange[];
}): Promise<{ state: NativeChangeState; changeDir: string }> {
  const state = await createNativeChange({
    paths: options.paths,
    name: options.name,
    language: 'en',
  });
  const changeDir = nativeChangeDir(options.paths, options.name);
  await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
  await fs.writeFile(path.join(changeDir, 'verification.md'), verification);
  const ready: NativeChangeState = {
    ...state,
    phase: 'archive',
    approval: 'implicit',
    verification_result: 'pass',
    verification_report: 'verification.md',
    spec_changes: options.specChanges ?? [],
    run_id: `run-${options.name}`,
  };
  await writeNativeChange(options.paths, ready);
  const run = startRunWithStorage(
    NATIVE_RUNTIME_PACKAGE,
    ready.run_id!,
    NATIVE_RUNTIME_HASH,
    NATIVE_RUN_STORAGE,
  );
  run.currentStep = 'archive';
  run.iteration = 3;
  await writeRunStateAt(changeDir, run, NATIVE_RUN_STORAGE);
  return { state: ready, changeDir };
}

describe('Native archive', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('applies create, replace, and remove specs before archiving the active change', async () => {
    const replace = path.join(paths.specsDir, 'authentication', 'spec.md');
    const remove = path.join(paths.specsDir, 'legacy-auth', 'spec.md');
    await fs.mkdir(path.dirname(replace), { recursive: true });
    await fs.mkdir(path.dirname(remove), { recursive: true });
    await fs.writeFile(replace, 'old authentication\n');
    await fs.writeFile(remove, 'legacy authentication\n');
    const specChanges: NativeSpecChange[] = [
      { capability: 'sessions', operation: 'create', source: 'specs/sessions.md', base_hash: null },
      {
        capability: 'authentication',
        operation: 'replace',
        source: 'specs/authentication.md',
        base_hash: await sha256File(replace),
      },
      {
        capability: 'legacy-auth',
        operation: 'remove',
        base_hash: await sha256File(remove),
      },
    ];
    const { changeDir } = await prepareArchiveChange({ paths, name: 'auth-update', specChanges });
    await fs.mkdir(path.join(changeDir, 'specs'), { recursive: true });
    await fs.writeFile(path.join(changeDir, 'specs', 'sessions.md'), 'session spec\n');
    await fs.writeFile(path.join(changeDir, 'specs', 'authentication.md'), 'new auth spec\n');
    await selectNativeChange(paths, 'auth-update');

    const result = await archiveNativeChange({
      paths,
      name: 'auth-update',
      now: new Date('2026-07-14T02:00:00.000Z'),
    });

    expect(result.archiveDir).toBe(path.join(paths.archiveDir, '2026-07-14-auth-update'));
    expect(await fs.readFile(path.join(paths.specsDir, 'sessions', 'spec.md'), 'utf8')).toBe(
      'session spec\n',
    );
    expect(await fs.readFile(replace, 'utf8')).toBe('new auth spec\n');
    await expect(fs.access(remove)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(changeDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readNativeChangeFile(path.join(result.archiveDir, 'change.yaml'))).toMatchObject({
      archived: true,
      phase: 'archive',
    });
    expect((await readRunStateAt(result.archiveDir, NATIVE_RUN_STORAGE))?.status).toBe('completed');
    expect(await readNativeTransaction(paths, result.transactionId)).toMatchObject({
      kind: 'archive',
      status: 'committed',
    });
    await expect(
      fs.access(path.join(paths.runtimeDir, 'current-change.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('supports an archive with no spec changes', async () => {
    await prepareArchiveChange({ paths, name: 'docs-only' });
    const result = await archiveNativeChange({
      paths,
      name: 'docs-only',
      now: new Date('2026-07-15T00:00:00.000Z'),
    });
    expect(await fs.readdir(paths.specsDir).catch(() => [])).toEqual([]);
    expect(await readNativeChangeFile(path.join(result.archiveDir, 'change.yaml'))).toMatchObject({
      archived: true,
    });
  });

  it('returns structured base-hash conflicts and leaves canonical specs unchanged', async () => {
    const canonical = path.join(paths.specsDir, 'authentication', 'spec.md');
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, 'current canonical\n');
    const expectedHash = 'a'.repeat(64);
    const actualHash = await sha256File(canonical);
    const { changeDir } = await prepareArchiveChange({
      paths,
      name: 'conflicting-auth',
      specChanges: [
        {
          capability: 'authentication',
          operation: 'replace',
          source: 'specs/authentication.md',
          base_hash: expectedHash,
        },
      ],
    });
    await fs.writeFile(path.join(changeDir, 'specs', 'authentication.md'), 'proposed spec\n');

    let thrown: unknown;
    try {
      await archiveNativeChange({ paths, name: 'conflicting-auth' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NativeSpecConflictError);
    expect(thrown).toMatchObject({
      code: 'native-spec-conflict',
      capability: 'authentication',
      expectedHash,
      actualHash,
      canonicalPath: canonical,
    });
    expect(await fs.readFile(canonical, 'utf8')).toBe('current canonical\n');
    expect(await fs.stat(changeDir)).toBeTruthy();
  });

  it('never overwrites an existing date-prefixed archive target', async () => {
    const { changeDir } = await prepareArchiveChange({ paths, name: 'immutable-target' });
    const target = path.join(paths.archiveDir, '2026-07-16-immutable-target');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'sentinel.txt'), 'keep');
    await expect(
      archiveNativeChange({
        paths,
        name: 'immutable-target',
        now: new Date('2026-07-16T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/already exists/u);
    expect(await fs.readFile(path.join(target, 'sentinel.txt'), 'utf8')).toBe('keep');
    expect(await fs.stat(changeDir)).toBeTruthy();
  });
});
