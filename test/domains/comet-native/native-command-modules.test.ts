import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeSpecCommand } from '../../../domains/comet-native/native-spec-command.js';
describe('Native command modules', () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-command-modules-'));
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
  });
  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  it('rejects retired Native spec mutation variants', async () => {
    await expect(
      nativeSpecCommand(
        ['rebase', 'demo-change', '--summary', 'Rebase the current spec set'],
        projectRoot,
      ),
    ).rejects.toThrow('Unknown spec command: rebase');
    await expect(nativeSpecCommand(['unknown', 'demo-change'], projectRoot)).rejects.toThrow(
      'Unknown spec command',
    );
  });
});
