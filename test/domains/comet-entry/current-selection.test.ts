import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs, renameSync, symlinkSync, unlinkSync } from 'fs';
import { execFileSync } from 'node:child_process';
import os from 'os';
import path from 'path';

import {
  clearCometCurrentSelectionIf,
  cometCurrentSelectionFile,
  migrateLegacyClassicSelection,
  readCometCurrentSelection,
  writeCometCurrentSelection,
} from '../../../domains/comet-entry/current-selection.js';

describe('shared Comet current selection', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-selection-v2-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes and reads one workflow owner atomically', async () => {
    const selection = {
      schema: 'comet.selection.v2' as const,
      workflow: 'native' as const,
      change: 'one-change',
      branch: null,
    };

    await writeCometCurrentSelection(root, selection);

    await expect(readCometCurrentSelection(root)).resolves.toEqual({
      status: 'selected',
      selection,
      legacy: false,
    });
  });

  it('migrates the released Classic v1 record in place', async () => {
    const file = cometCurrentSelectionFile(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `${JSON.stringify({ version: 1, change: 'legacy-change', branch: 'main' }, null, 2)}\n`,
    );

    await expect(migrateLegacyClassicSelection(root)).resolves.toBe(true);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      schema: 'comet.selection.v2',
      workflow: 'classic',
      change: 'legacy-change',
      branch: 'main',
    });
    await expect(migrateLegacyClassicSelection(root)).resolves.toBe(false);
  });

  it('clears only an exact workflow and change owner', async () => {
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'classic',
      change: 'classic-change',
      branch: null,
    });

    await expect(clearCometCurrentSelectionIf(root, 'native', 'classic-change')).resolves.toBe(
      false,
    );
    await expect(clearCometCurrentSelectionIf(root, 'classic', 'other')).resolves.toBe(false);
    await expect(clearCometCurrentSelectionIf(root, 'classic', 'classic-change')).resolves.toBe(
      true,
    );
    await expect(readCometCurrentSelection(root)).resolves.toEqual({ status: 'missing' });
  });

  it('fails closed on malformed and invalid workflow records', async () => {
    const file = cometCurrentSelectionFile(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{broken\n');
    await expect(readCometCurrentSelection(root)).rejects.toThrow('invalid JSON');

    await fs.writeFile(
      file,
      `${JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'both',
        change: 'bad',
        branch: null,
      })}\n`,
    );
    await expect(readCometCurrentSelection(root)).rejects.toThrow('native or classic');
  });

  it('bounds and regular-file checks the shared selection before parsing', async () => {
    const file = cometCurrentSelectionFile(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.alloc(16 * 1024 + 1, 0x61));
    await expect(readCometCurrentSelection(root)).rejects.toThrow('exceeds 16384 bytes');

    await fs.rm(file);
    await fs.mkdir(file);
    await expect(readCometCurrentSelection(root)).rejects.toThrow('regular file');
  });

  it('rejects a symlink at the selection path instead of following it', async () => {
    const outside = path.join(root, 'outside-secret.json');
    await fs.writeFile(
      outside,
      JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'native',
        change: 'not-the-real-selection',
        branch: null,
      }),
    );

    const file = cometCurrentSelectionFile(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.symlink(outside, file);

    await expect(readCometCurrentSelection(root)).rejects.toThrow(/regular file|symbolic link/);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a FIFO at the selection path without blocking on open',
    async () => {
      const file = cometCurrentSelectionFile(root);
      await fs.mkdir(path.dirname(file), { recursive: true });
      execFileSync('mkfifo', [file]);

      await expect(readCometCurrentSelection(root)).rejects.toThrow('regular file');
    },
  );

  it('never returns content read past the byte limit when the file is swapped for a bigger one mid-read', async () => {
    const file = cometCurrentSelectionFile(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'native',
        change: 'small-before-swap',
        branch: null,
      }),
    );

    const oversized = path.join(root, 'oversized.json');
    const oversizedChange = 'x'.repeat(16 * 1024);
    await fs.writeFile(
      oversized,
      JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'native',
        change: oversizedChange,
        branch: null,
      }),
    );

    // Start the read (dispatches its first fs call asynchronously), then swap
    // the file for an over-limit one synchronously before yielding back to
    // the event loop. The synchronous rename below is guaranteed to run
    // before any pending async fs callback for this read is delivered.
    const pending = readCometCurrentSelection(root);
    renameSync(oversized, file);

    const result = await pending.catch((error: unknown) => error as Error);
    if (result instanceof Error) {
      // Depending on where the swap lands relative to the pre-open lstat,
      // the read is rejected either for size or because the file identity
      // changed between checkpoints. Both refuse the oversized content.
      expect(result.message).toMatch(/exceeds 16384 bytes|changed while (opening|reading)/);
    } else {
      // If the open/read happened to land on the swapped-in file entirely
      // (rather than racing mid-read), that is fine too, as long as it was
      // still rejected for size rather than silently accepted.
      expect(result).not.toMatchObject({
        status: 'selected',
        selection: { change: oversizedChange },
      });
    }
  });

  it('does not follow a symlink swapped in after the regular-file check', async () => {
    const file = cometCurrentSelectionFile(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'native',
        change: 'small-before-swap',
        branch: null,
      }),
    );

    const outside = path.join(root, 'outside-secret.json');
    await fs.writeFile(
      outside,
      JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'native',
        change: 'read-through-symlink',
        branch: null,
      }),
    );

    const pending = readCometCurrentSelection(root);
    unlinkSync(file);
    symlinkSync(outside, file);

    const result = await pending.catch((error: unknown) => error as Error);
    if (result instanceof Error) {
      expect(result.message).toMatch(/regular file|symbolic link|changed/);
    } else {
      expect(result).not.toMatchObject({
        status: 'selected',
        selection: { change: 'read-through-symlink' },
      });
    }
  });
});
