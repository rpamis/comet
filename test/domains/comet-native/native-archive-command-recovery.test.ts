import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class NativeUsageError extends Error {}
  class NativeWorkspaceFinishError extends Error {
    constructor(readonly result: unknown) {
      super('workspace finish blocked');
    }
  }
  class NativeWorkspaceFinishPreparationError extends Error {
    paths: string[] = [];
    workspaceRoot = '';
  }
  return {
    NativeUsageError,
    NativeWorkspaceFinishError,
    NativeWorkspaceFinishPreparationError,
    configuredPaths: vi.fn(),
    readJournal: vi.fn(),
    writeJournal: vi.fn(),
    clearJournal: vi.fn(),
    prepareFinish: vi.fn(),
    finishArchivedWorkspace: vi.fn(),
    readStatusRecord: vi.fn(),
    success: vi.fn((command: string, data: unknown, text?: string) => ({
      command,
      exitCode: 0,
      data,
      ...(text === undefined ? {} : { text }),
    })),
    isNativePortableChange: vi.fn(),
    hasArchiveRecovery: vi.fn(),
    readTransaction: vi.fn(),
    readPortableChange: vi.fn(),
    recoverPortableChange: vi.fn(),
    migrateLegacyChange: vi.fn(),
    setWorkspaceFinish: vi.fn(),
    autoAdvanceParent: vi.fn(),
    continuation: vi.fn((state: unknown) => ({ disposition: 'continue', state })),
  };
});

vi.mock('../../../domains/comet-native/native-cli-shared.js', () => ({
  NativeUsageError: mocks.NativeUsageError,
  assertNoArguments: (args: string[]) => {
    if (args.length > 0) throw new mocks.NativeUsageError(`Unexpected argument: ${args[0]}`);
  },
  configuredPaths: mocks.configuredPaths,
  requiredPositional: (args: string[], label: string) => {
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new mocks.NativeUsageError(`${label} is required`);
    return value;
  },
  success: mocks.success,
  takeFlag: (args: string[], name: string) => {
    const index = args.indexOf(name);
    if (index < 0) return false;
    args.splice(index, 1);
    return true;
  },
  takeOption: (args: string[], name: string) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith('--'))
      throw new mocks.NativeUsageError(`${name} requires a value`);
    args.splice(index, 2);
    return value;
  },
}));
vi.mock('../../../domains/comet-native/native-portable-archive.js', () => ({
  archiveNativePortableChange: vi.fn(),
  hasNativePortableArchiveRecovery: mocks.hasArchiveRecovery,
  inspectNativePortableArchive: vi.fn(),
  NativePortableArchiveOrderRequiredError: class extends Error {},
  NativePortableArchiveRequiresReverificationError: class extends Error {},
}));
vi.mock('../../../domains/comet-native/native-portable-continuation.js', () => ({
  nativePortableContinuation: mocks.continuation,
}));
vi.mock('../../../domains/comet-native/native-portable-migration-runtime.js', () => ({
  migrateNativeLegacyChangeToPortable: mocks.migrateLegacyChange,
}));
vi.mock('../../../domains/comet-native/native-portable-recovery.js', () => ({
  recoverNativePortableChange: mocks.recoverPortableChange,
}));
vi.mock('../../../domains/comet-native/native-portable-transactions.js', () => ({
  readNativePortableTransaction: mocks.readTransaction,
}));
vi.mock('../../../domains/comet-native/native-portable-runtime.js', () => ({
  isNativePortableChange: mocks.isNativePortableChange,
  readNativePortableChange: mocks.readPortableChange,
  setNativePortableWorkspaceFinish: mocks.setWorkspaceFinish,
  tryAutoAdvanceNativeV1SupervisorParent: mocks.autoAdvanceParent,
}));
vi.mock('../../../domains/comet-native/native-workspace-finish.js', () => ({
  clearNativeWorkspaceFinishJournal: mocks.clearJournal,
  finishArchivedNativeWorkspace: mocks.finishArchivedWorkspace,
  NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA: 'comet.native.workspace-finish.v1',
  NativeWorkspaceFinishError: mocks.NativeWorkspaceFinishError,
  NativeWorkspaceFinishPreparationError: mocks.NativeWorkspaceFinishPreparationError,
  prepareNativePortableWorkspaceFinish: mocks.prepareFinish,
  readNativeWorkspaceFinishJournal: mocks.readJournal,
  writeNativeWorkspaceFinishJournal: mocks.writeJournal,
}));
vi.mock('../../../domains/comet-native/native-paths.js', () => ({
  isInsidePath: (parent: string, target: string) => {
    const relative = path.relative(parent, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  },
}));
vi.mock('../../../domains/comet-native/native-archived-status.js', () => ({
  readNativeStatusRecord: mocks.readStatusRecord,
}));

import { nativeArchiveCommand } from '../../../domains/comet-native/native-archive-command.js';

describe('Native Archive workspace finish recovery command', () => {
  const root = path.resolve('native-archive-recovery-test');
  const archiveDir = path.join(root, 'docs', 'comet', 'archive');
  const journal = {
    schema: 'comet.native.workspace-finish.v1' as const,
    name: 'finish-change',
    transactionId: 'transaction-1',
    archiveDir: path.join(archiveDir, '2026-09-20-finish-change'),
    status: 'pending' as const,
    result: null,
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configuredPaths.mockResolvedValue({
      paths: { archiveDir, projectRoot: root, transactionsDir: path.join(root, 'transactions') },
      config: { native: { archive_confirmation: 'optional', finish: { pull_request: null } } },
    });
    mocks.isNativePortableChange.mockResolvedValue(false);
    mocks.hasArchiveRecovery.mockResolvedValue(false);
    mocks.readTransaction.mockResolvedValue(null);
    mocks.readJournal.mockResolvedValue(journal);
    mocks.prepareFinish.mockResolvedValue(null);
    mocks.autoAdvanceParent.mockResolvedValue(null);
  });

  it('reports a pending workspace finish during dry-run and validates retry flags', async () => {
    await expect(nativeArchiveCommand(['finish-change', '--dry-run'], root)).resolves.toMatchObject(
      {
        command: 'archive --dry-run',
        exitCode: 73,
        data: { change: 'finish-change', archived: true },
        error: { code: 'conflict' },
      },
    );
    await expect(
      nativeArchiveCommand(['finish-change', '--expect-preflight', 'hash'], root),
    ).rejects.toThrow('A recorded workspace finish does not use preflight hashes');
    mocks.readJournal.mockResolvedValue({
      ...journal,
      result: {
        action: 'merge',
        status: 'blocked',
        blockedPaths: [],
        recoveryArgs: ['comet', 'native', 'archive', 'finish-change', '--confirmed'],
      },
    });
    await expect(nativeArchiveCommand(['finish-change', '--finish', 'push'], root)).rejects.toThrow(
      "Recorded workspace finish is 'merge'; retry it without changing --finish",
    );
  });

  it('clears a completed finish journal when the archived record is valid', async () => {
    mocks.readStatusRecord.mockResolvedValue({
      state: {
        name: 'finish-change',
        archived: true,
        status: 'done',
        workspace: { finish: 'keep' },
      },
    });
    await expect(
      nativeArchiveCommand(['finish-change', '--confirmed'], root),
    ).resolves.toMatchObject({
      command: 'archive',
      exitCode: 0,
      data: { archived: true, archiveDir: journal.archiveDir, workspaceFinish: 'keep' },
    });
    expect(mocks.clearJournal).toHaveBeenCalledWith(expect.anything(), 'finish-change');
  });

  it('records a blocked retry when workspace finish preparation still fails', async () => {
    mocks.readStatusRecord.mockResolvedValue({
      state: {
        name: 'finish-change',
        archived: true,
        status: 'done',
        workspace: { finish: 'keep' },
      },
    });
    mocks.prepareFinish.mockRejectedValue(new Error('workspace is dirty'));
    await expect(
      nativeArchiveCommand(['finish-change', '--confirmed'], root),
    ).resolves.toMatchObject({
      command: 'archive',
      exitCode: 73,
      data: {
        archived: true,
        workspaceFinishResult: { status: 'blocked', message: 'workspace is dirty' },
      },
      error: { code: 'conflict', message: 'workspace is dirty' },
    });
    expect(mocks.writeJournal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'blocked' }),
    );
  });
});
