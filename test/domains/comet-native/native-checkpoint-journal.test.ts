import { describe, expect, it, vi } from 'vitest';

const readNativeCheckpointJournal = vi.hoisted(() => vi.fn());
const writeNativeCheckpointManifest = vi.hoisted(() => vi.fn());
const writeNativeCheckpointJournal = vi.hoisted(() => vi.fn());

vi.mock('../../../domains/comet-native/native-checkpoint-storage.js', () => ({
  nativeCheckpointJournalFile: vi.fn(() => 'checkpoint-journal.json'),
  readNativeCheckpointJournal,
  writeNativeCheckpointJournal,
  writeNativeCheckpointManifest,
  writeNativeProgressCheckpoint: vi.fn(),
}));
vi.mock('../../../domains/comet-native/native-change.js', () => ({
  compareAndSwapNativeChangeLocked: vi.fn(),
}));
vi.mock('../../../domains/comet-native/native-mutation-lock.js', () => ({
  withNativeMutationLock: vi.fn(),
}));
vi.mock('../../../domains/comet-native/native-transition-journal.js', () => ({
  continueNativeTransitionLocked: vi.fn(),
  withNativeTransitionLock: vi.fn(),
}));

import {
  continueNativeCheckpointLocked,
  prepareNativeCheckpointJournal,
} from '../../../domains/comet-native/native-checkpoint-journal.js';

describe('Native checkpoint journal branches', () => {
  const paths = {} as never;
  const previousState = { name: 'demo', revision: 1 } as never;
  const nextState = { name: 'demo', revision: 2 } as never;
  const checkpoint = { inputHash: 'a'.repeat(64), manifestHash: 'b'.repeat(64) } as never;
  const manifest = { files: [] } as never;

  it('generates a journal id when no id factory is supplied', async () => {
    writeNativeCheckpointManifest.mockResolvedValueOnce('b'.repeat(64));

    const journal = await prepareNativeCheckpointJournal({
      paths,
      previousState,
      nextState,
      checkpoint,
      manifest,
      now: new Date('2026-07-17T00:00:00.000Z'),
    });

    expect(journal.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(writeNativeCheckpointJournal).toHaveBeenCalledWith(paths, journal);
  });

  it('rejects recovery when the checkpoint manifest hash changed', async () => {
    const journal = {
      change: 'demo',
      checkpoint,
      manifest,
      previousState,
      nextState,
    } as never;
    readNativeCheckpointJournal.mockResolvedValueOnce(journal);
    writeNativeCheckpointManifest.mockResolvedValueOnce('c'.repeat(64));

    await expect(continueNativeCheckpointLocked(paths, 'demo')).rejects.toThrow(
      'manifest hash mismatch',
    );
  });
});
