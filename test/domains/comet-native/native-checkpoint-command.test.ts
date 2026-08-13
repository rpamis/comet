import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkpointNativeChange = vi.hoisted(() => vi.fn());
const inspectNativeStatus = vi.hoisted(() => vi.fn());

vi.mock('../../../domains/comet-native/native-progress-checkpoint.js', () => ({
  checkpointNativeChange,
}));
vi.mock('../../../domains/comet-native/native-diagnostics.js', () => ({ inspectNativeStatus }));

import { nativeCheckpointCommand } from '../../../domains/comet-native/native-checkpoint-command.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

describe('Native checkpoint command argument branches', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-checkpoint-command-'));
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    checkpointNativeChange.mockReset();
    inspectNativeStatus.mockReset();
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('requires both summary and next action', async () => {
    await expect(nativeCheckpointCommand(['demo'], projectRoot)).rejects.toThrow(
      '--summary is required',
    );
    await expect(
      nativeCheckpointCommand(['demo', '--summary', 'checkpoint'], projectRoot),
    ).rejects.toThrow('--next-action is required');
  });

  it('dispatches a valid checkpoint and includes continuation status', async () => {
    checkpointNativeChange.mockResolvedValue({ revision: 4, phase: 'build' });
    inspectNativeStatus.mockResolvedValue({ continuation: { kind: 'build' } });

    await expect(
      nativeCheckpointCommand(
        ['demo', '--summary', 'checkpoint', '--next-action', 'continue', '--artifact', 'src.ts'],
        projectRoot,
      ),
    ).resolves.toMatchObject({ command: 'checkpoint', exitCode: 0 });
    expect(checkpointNativeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'demo',
        summary: 'checkpoint',
        nextAction: 'continue',
        artifacts: ['src.ts'],
        expectedRevision: undefined,
      }),
    );
  });
});
