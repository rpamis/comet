import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { digestNativeInputFileContent } from '../../../domains/comet-native/native-portable-checks.js';

describe('Native portable check input digests', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-portable-digest-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
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
});
