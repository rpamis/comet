import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  nativeWorkspaceIsClean,
  recordNativeWorkspaceConfig,
  removeNativeWorkspaceConfig,
} from '../../../domains/comet-native/native-workspace-config.js';

describe('Native Runtime-created workspace configuration', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-config-copy-'));
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    await fs.mkdir(path.join(root, '.comet'));
    await fs.appendFile(path.join(root, '.git/info/exclude'), '\n/.comet/runtime/\n');
    await fs.writeFile(path.join(root, '.comet/config.yaml'), 'native: {}\n');
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  it('allows only the unchanged Runtime copy and preserves later user edits', async () => {
    expect(nativeWorkspaceIsClean(root)).toBe(false);
    await recordNativeWorkspaceConfig(root);
    expect(nativeWorkspaceIsClean(root)).toBe(true);
    await fs.appendFile(path.join(root, '.comet/config.yaml'), '# user change\n');
    expect(nativeWorkspaceIsClean(root)).toBe(false);
    await removeNativeWorkspaceConfig(root);
    expect(await fs.readFile(path.join(root, '.comet/config.yaml'), 'utf8')).toContain(
      '# user change',
    );
  });
  it('removes its exact untracked copy but never a tracked configuration', async () => {
    await recordNativeWorkspaceConfig(root);
    execFileSync('git', ['add', '.comet/config.yaml'], { cwd: root });
    expect(nativeWorkspaceIsClean(root)).toBe(false);
    await removeNativeWorkspaceConfig(root);
    expect(await fs.readFile(path.join(root, '.comet/config.yaml'), 'utf8')).toBe('native: {}\n');
    execFileSync('git', ['rm', '--cached', '.comet/config.yaml'], { cwd: root });
    await removeNativeWorkspaceConfig(root);
    await expect(fs.stat(path.join(root, '.comet/config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
