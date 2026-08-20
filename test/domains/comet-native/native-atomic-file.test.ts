import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { atomicWriteText } from '../../../domains/comet-native/native-atomic-file.js';

describe('Native atomic file containment', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-atomic-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-atomic-outside-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('commits a normal write even though writing changes size and ctime', async () => {
    const target = path.join(root, 'state.json');
    await atomicWriteText(target, '{"ok":true}\n', {
      containedRoot: root,
      beforeCommit: async () => {
        await fs.realpath(root);
        await fs.readdir(root);
      },
    });

    expect(await fs.readFile(target, 'utf8')).toBe('{"ok":true}\n');
    const leftovers = (await fs.readdir(root)).filter((entry) => entry.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('rejects a temporary file replaced before commit', async () => {
    const target = path.join(root, 'state.json');
    await expect(
      atomicWriteText(target, 'original', {
        containedRoot: root,
        beforeCommit: async () => {
          const temporary = (await fs.readdir(root)).find((entry) => entry.endsWith('.tmp'));
          if (!temporary) throw new Error('temporary file not found before commit');
          const temporaryPath = path.join(root, temporary);
          await fs.unlink(temporaryPath);
          await fs.writeFile(temporaryPath, 'tampered');
        },
      }),
    ).rejects.toThrow(/temporary file changed before commit/u);
  });

  it('never writes content after the final parent is replaced before temporary open', async () => {
    const parent = path.join(root, 'a', 'b');
    const displaced = path.join(root, 'a', 'b-displaced');
    await fs.mkdir(parent, { recursive: true });

    await expect(
      atomicWriteText(path.join(parent, 'evidence.json'), 'SECRET-EVIDENCE', {
        containedRoot: root,
        beforeTemporaryOpen: async () => {
          await fs.rename(parent, displaced);
          await fs.symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
        },
      }),
    ).rejects.toThrow(/managed parent|parent changed/iu);

    const escapedFiles = await fs.readdir(outside);
    const escapedContents = await Promise.all(
      escapedFiles.map((entry) => fs.readFile(path.join(outside, entry), 'utf8')),
    );
    expect(escapedContents).not.toContain('SECRET-EVIDENCE');
    expect(escapedContents.every((content) => content.length === 0)).toBe(true);
  });
});
