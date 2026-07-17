import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  hashNativeArchiveTree,
  inspectNativeArchiveContent,
} from '../../../domains/comet-native/native-archive-content.js';

describe('Native Archive content identity budgets', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-content-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects a file that exceeds the per-file budget before hashing it', async () => {
    const file = path.join(root, 'large.md');
    await fs.writeFile(file, '12345');

    await expect(inspectNativeArchiveContent(file, { maxFileBytes: 4 })).rejects.toThrow(
      'exceeds 4 bytes',
    );
  });

  it('rejects a tree that exceeds the global entry budget', async () => {
    await fs.writeFile(path.join(root, 'one.md'), 'one');
    await fs.writeFile(path.join(root, 'two.md'), 'two');

    await expect(hashNativeArchiveTree(root, { maxEntries: 1 })).rejects.toThrow(
      'exceeds 1 entries',
    );
  });

  it('rejects a tree that exceeds the cumulative file budget', async () => {
    await fs.writeFile(path.join(root, 'one.md'), '123');
    await fs.writeFile(path.join(root, 'two.md'), '456');

    await expect(hashNativeArchiveTree(root, { maxTotalBytes: 5 })).rejects.toThrow(
      'exceeds 5 total file bytes',
    );
  });

  it('rejects a tree that exceeds the directory depth budget', async () => {
    const nested = path.join(root, 'one', 'two');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'leaf.md'), 'leaf');

    await expect(hashNativeArchiveTree(root, { maxDepth: 1 })).rejects.toThrow('exceeds depth 1');
  });

  it('produces a stable content identity without embedding the absolute root', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-content-copy-'));
    try {
      await fs.mkdir(path.join(root, 'nested'));
      await fs.writeFile(path.join(root, 'nested', 'spec.md'), 'same\n');
      await fs.mkdir(path.join(other, 'nested'));
      await fs.writeFile(path.join(other, 'nested', 'spec.md'), 'same\n');

      await expect(hashNativeArchiveTree(root)).resolves.toBe(await hashNativeArchiveTree(other));
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });
});
