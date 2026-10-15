import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { digestNativeInputFileContent } from '../../../domains/comet-native/native-portable-checks.js';

describe('Native portable check input digests', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-portable-digest-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads a small input once and still rejects growth during that read', async () => {
    const file = path.join(root, 'small.bin');
    await fs.writeFile(file, 'small input');
    const open = fs.open.bind(fs);
    let reads = 0;
    let grow = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      const read = handle.read.bind(handle);
      handle.read = (async (...parameters: Parameters<typeof handle.read>) => {
        reads++;
        const result = await read(...parameters);
        if (grow) {
          grow = false;
          await fs.appendFile(file, 'changed');
        }
        return result;
      }) as typeof handle.read;
      return handle;
    });
    await digestNativeInputFileContent(file);
    expect(reads).toBe(1);
    grow = true;
    await expect(digestNativeInputFileContent(file)).rejects.toThrow('changed while reading');
  });

  it.each([
    ['empty file', Buffer.alloc(0)],
    ['within one chunk', randomBytes(1024)],
    ['spanning chunk boundaries', randomBytes(65_535 * 2 + 7)],
  ])('matches the legacy whole-file base64 digest for %s', async (_label, bytes) => {
    const file = path.join(root, 'input.bin');
    await fs.writeFile(file, bytes);

    const { digest, size } = await digestNativeInputFileContent(file);

    expect(size).toBe(bytes.byteLength);
    expect(digest).toBe(createHash('sha256').update(bytes.toString('base64')).digest('hex'));
  });

  it('preserves the whole-file digest when the descriptor returns short reads', async () => {
    const file = path.join(root, 'short-reads.bin');
    const bytes = randomBytes(1025);
    await fs.writeFile(file, bytes);
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      const read = handle.read.bind(handle);
      handle.read = ((buffer: Buffer, offset: number, length: number, position: number | null) =>
        read(buffer, offset, Math.min(length, 5), position)) as typeof handle.read;
      return handle;
    });
    expect(await digestNativeInputFileContent(file)).toEqual({
      size: bytes.length,
      digest: createHash('sha256').update(bytes.toString('base64')).digest('hex'),
    });
  });
});
