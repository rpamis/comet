import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  archiveNativeChange,
  recoverArchiveTransaction,
} from '../../../domains/comet-native/native-archive.js';
import {
  createNativeChange,
  nativeChangeDir,
  readNativeChangeFile,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { sha256File } from '../../../domains/comet-native/native-hash.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  NATIVE_RUNTIME_HASH,
  NATIVE_RUNTIME_PACKAGE,
} from '../../../domains/comet-native/native-runtime-package.js';
import { readNativeTransaction } from '../../../domains/comet-native/native-transaction.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
  NativeSpecChange,
} from '../../../domains/comet-native/native-types.js';
import { NATIVE_RUN_STORAGE } from '../../../domains/engine/storage-layout.js';
import { startRunWithStorage, writeRunStateAt } from '../../../domains/engine/storage-run.js';

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
  specChanges: NativeSpecChange[];
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
    spec_changes: options.specChanges,
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

describe('Native archive recovery', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-recovery-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function preparedChange(name: string): Promise<{
    changeDir: string;
    canonical: string;
    specChanges: NativeSpecChange[];
  }> {
    const canonical = path.join(paths.specsDir, 'authentication', 'spec.md');
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, 'old auth\n');
    const specChanges: NativeSpecChange[] = [
      {
        capability: 'authentication',
        operation: 'replace',
        source: 'specs/authentication.md',
        base_hash: await sha256File(canonical),
      },
      { capability: 'sessions', operation: 'create', source: 'specs/sessions.md', base_hash: null },
    ];
    const { changeDir } = await prepareArchiveChange({ paths, name, specChanges });
    await fs.writeFile(path.join(changeDir, 'specs', 'authentication.md'), 'new auth\n');
    await fs.writeFile(path.join(changeDir, 'specs', 'sessions.md'), 'new sessions\n');
    return { changeDir, canonical, specChanges };
  }

  it('continues after all staged specs were prepared', async () => {
    const { changeDir, canonical } = await preparedChange('prepared-crash');
    let transactionId = '';
    await expect(
      archiveNativeChange({
        paths,
        name: 'prepared-crash',
        now: new Date('2026-07-17T00:00:00.000Z'),
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
            throw new Error('crash after prepared');
          },
        },
      }),
    ).rejects.toThrow('crash after prepared');
    expect((await readNativeTransaction(paths, transactionId)).status).toBe('prepared');
    expect(await fs.readFile(canonical, 'utf8')).toBe('old auth\n');
    expect(await fs.stat(changeDir)).toBeTruthy();
    await expect(
      createNativeChange({ paths, name: 'blocked-by-recovery', language: 'en' }),
    ).rejects.toThrow('transaction recovery is required');

    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'continue',
    });
    expect(recovered.status).toBe('committed');
    expect(await fs.readFile(canonical, 'utf8')).toBe('new auth\n');
  });

  it('rolls back after one canonical spec was replaced', async () => {
    const { changeDir, canonical } = await preparedChange('replace-crash');
    let transactionId = '';
    await expect(
      archiveNativeChange({
        paths,
        name: 'replace-crash',
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
          },
          afterOperation(_operation, completed) {
            if (completed === 1) throw new Error('crash after replace');
          },
        },
      }),
    ).rejects.toThrow('crash after replace');
    expect(await fs.readFile(canonical, 'utf8')).toBe('new auth\n');

    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'rollback',
    });
    expect(recovered.status).toBe('rolled-back');
    expect(await fs.readFile(canonical, 'utf8')).toBe('old auth\n');
    await expect(fs.access(path.join(paths.specsDir, 'sessions', 'spec.md'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
    expect(await fs.stat(changeDir)).toBeTruthy();
  });

  it('continues when canonical specs are complete but the active change still exists', async () => {
    const { changeDir } = await preparedChange('specs-complete-crash');
    let transactionId = '';
    await expect(
      archiveNativeChange({
        paths,
        name: 'specs-complete-crash',
        now: new Date('2026-07-18T00:00:00.000Z'),
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
          },
          afterOperation(_operation, completed) {
            if (completed === 2) throw new Error('crash before move');
          },
        },
      }),
    ).rejects.toThrow('crash before move');
    expect(await fs.stat(changeDir)).toBeTruthy();
    expect((await readNativeTransaction(paths, transactionId)).status).toBe('applying');

    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'continue',
    });
    expect(recovered.status).toBe('committed');
    await expect(fs.access(changeDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('finalizes when the active change moved before the journal committed', async () => {
    const { changeDir } = await preparedChange('move-crash');
    let transactionId = '';
    const archiveDir = path.join(paths.archiveDir, '2026-07-19-move-crash');
    await expect(
      archiveNativeChange({
        paths,
        name: 'move-crash',
        now: new Date('2026-07-19T00:00:00.000Z'),
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
          },
          afterOperation(operation) {
            if (operation.id === 'archive-change') throw new Error('crash after move');
          },
        },
      }),
    ).rejects.toThrow('crash after move');
    await expect(fs.access(changeDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readNativeChangeFile(path.join(archiveDir, 'change.yaml'))).archived).toBe(false);

    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'continue',
    });
    expect(recovered.status).toBe('committed');
    expect((await readNativeChangeFile(path.join(archiveDir, 'change.yaml'))).archived).toBe(true);
  });
});
