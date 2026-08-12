import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const moveNativeRoot = vi.hoisted(() => vi.fn());
vi.mock('../../../domains/comet-native/native-root-move.js', () => ({ moveNativeRoot }));

import { nativeRootCommand } from '../../../domains/comet-native/native-root-command.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

describe('Native root command branches', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-root-command-'));
    moveNativeRoot.mockReset();
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('requires config for root show and returns configured root metadata', async () => {
    await expect(nativeRootCommand(['show'], projectRoot)).rejects.toThrow(
      '.comet/config.yaml was not found',
    );

    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'zh-CN'));
    await expect(nativeRootCommand(['show'], projectRoot)).resolves.toMatchObject({
      command: 'root show',
      exitCode: 0,
      data: { artifactRoot: 'docs', language: 'zh-CN', pendingRootMove: null },
    });
  });

  it('dispatches root move and rejects unknown root commands', async () => {
    moveNativeRoot.mockResolvedValue({ toNativeRoot: path.join(projectRoot, 'new-docs') });

    await expect(nativeRootCommand(['move', 'new-docs'], projectRoot)).resolves.toMatchObject({
      command: 'root move',
      exitCode: 0,
    });
    await expect(nativeRootCommand(['unknown'], projectRoot)).rejects.toThrow(
      'Unknown root command',
    );
  });
});
