import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { atomicWriteContainedText } from '../../../domains/workflow-contract/contained-atomic-write.js';

afterEach(() => vi.restoreAllMocks());

describe('strict exclusive atomic publication', () => {
  it('does not publish a partial file when atomic hard links are unsupported', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-strict-publication-'));
    try {
      const file = path.join(root, 'revision.json');
      vi.spyOn(fs, 'link').mockRejectedValue(
        Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }),
      );
      await expect(
        atomicWriteContainedText(file, '{"revision":1}', {
          containedRoot: root,
          exclusive: true,
          requireAtomicPublication: true,
        }),
      ).rejects.toMatchObject({ code: 'ENOTSUP' });
      await expect(fs.readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the existing copy fallback for callers that do not require atomic publication', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-compatible-publication-'));
    try {
      const file = path.join(root, 'revision.json');
      vi.spyOn(fs, 'link').mockRejectedValue(
        Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }),
      );
      await atomicWriteContainedText(file, '{"revision":1}', {
        containedRoot: root,
        exclusive: true,
      });
      expect(await fs.readFile(file, 'utf8')).toBe('{"revision":1}');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
