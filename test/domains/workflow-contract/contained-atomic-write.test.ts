import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  atomicWriteContainedText,
  removeContainedFile,
} from '../../../domains/workflow-contract/index.js';

async function temporaryFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory).catch(() => [] as string[]);
  return entries.filter((entry) => entry.endsWith('.tmp'));
}

describe('contained atomic write', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-contained-write-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-contained-write-outside-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('commits a normal write even though writing changes size and ctime', async () => {
    const target = path.join(root, 'state.yaml');
    await atomicWriteContainedText(target, 'schema: comet.project.v1\n', {
      containedRoot: root,
      beforeCommit: async () => {
        // Mirror the real caller's guard work between write and commit.
        await fs.realpath(root);
        await fs.readdir(path.dirname(target));
      },
    });

    expect(await fs.readFile(target, 'utf8')).toBe('schema: comet.project.v1\n');
    expect(await temporaryFiles(root)).toEqual([]);
  });

  it('rejects a temporary file replaced before commit and cleans it up', async () => {
    const target = path.join(root, 'state.yaml');
    await expect(
      atomicWriteContainedText(target, 'original', {
        containedRoot: root,
        beforeCommit: async () => {
          const temporary = (await temporaryFiles(root))[0];
          if (!temporary) throw new Error('temporary file not found before commit');
          await fs.unlink(path.join(root, temporary));
          await fs.writeFile(path.join(root, temporary), 'tampered');
        },
      }),
    ).rejects.toThrow(/temporary file changed before commit/u);

    expect(await fs.readFile(target, 'utf8').catch(() => null)).toBe(null);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  it('rejects a temporary file swapped for a link before commit', async () => {
    const target = path.join(root, 'state.yaml');
    await expect(
      atomicWriteContainedText(target, 'original', {
        containedRoot: root,
        beforeCommit: async () => {
          const temporary = (await temporaryFiles(root))[0];
          if (!temporary) throw new Error('temporary file not found before commit');
          const temporaryPath = path.join(root, temporary);
          await fs.unlink(temporaryPath);
          await fs.symlink(
            outside,
            temporaryPath,
            process.platform === 'win32' ? 'junction' : 'dir',
          );
        },
      }),
    ).rejects.toThrow(/temporary file changed before commit/u);
  });

  it('rejects the write when the managed parent is displaced before commit', async () => {
    const parent = path.join(root, 'a', 'b');
    const displaced = path.join(root, 'a', 'b-displaced');
    await fs.mkdir(parent, { recursive: true });

    await expect(
      atomicWriteContainedText(path.join(parent, 'state.yaml'), 'original', {
        containedRoot: root,
        beforeCommit: async () => {
          await fs.rename(parent, displaced);
          await fs.symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
        },
      }),
    ).rejects.toThrow(/parent changed before commit/u);

    const escaped = await fs.readdir(outside);
    expect(escaped).toEqual([]);
  });

  it('removes an unchanged contained file and rejects a replaced removal target', async () => {
    const target = path.join(root, 'extra.md');
    await fs.writeFile(target, 'content');

    expect(await removeContainedFile(target, { containedRoot: root })).toBe(true);
    expect(await fs.readFile(target, 'utf8').catch(() => null)).toBe(null);

    await fs.writeFile(target, 'content');
    await expect(
      removeContainedFile(target, {
        containedRoot: root,
        beforeRemove: async () => {
          await fs.unlink(target);
          await fs.writeFile(target, 'replaced');
        },
      }),
    ).rejects.toThrow(/removal target changed before removal/u);
  });
});
