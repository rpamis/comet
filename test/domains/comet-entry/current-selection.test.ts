import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
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
});
