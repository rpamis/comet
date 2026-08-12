import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertTrustedReadonlyFile,
  registerTrustedReadonlyFileForTest,
  trustedReadonlyPosixFactsIssue,
} from '../../platform/fs/trusted-readonly-file.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('trusted read-only file capability', () => {
  it('rejects a same-uid writable external trust file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-writable-anchor-'));
    roots.push(root);
    const file = path.join(root, 'controller-trust.json');
    await fs.writeFile(file, '{}\n');

    await expect(assertTrustedReadonlyFile({ file })).rejects.toThrow(
      process.platform === 'win32' ? 'host read-only mount capability' : 'different host identity',
    );
  });

  it('accepts a host-isolated read-only test capability', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-isolated-anchor-'));
    roots.push(root);
    const file = path.join(root, 'controller-trust.json');
    await fs.writeFile(file, '{}\n');
    const unregister = registerTrustedReadonlyFileForTest(file);
    try {
      await expect(assertTrustedReadonlyFile({ file })).resolves.toMatchObject({
        realPath: await fs.realpath(file),
      });
    } finally {
      unregister();
    }
  });

  it('accepts POSIX facts for a different-owner read-only mount', () => {
    expect(
      trustedReadonlyPosixFactsIssue({
        currentUid: 1000,
        fileUid: 0,
        fileMode: 0o100444,
        fileWritable: false,
        parents: [
          { uid: 0, mode: 0o40555, writable: false },
          { uid: 0, mode: 0o40755, writable: false },
        ],
      }),
    ).toBeNull();
    expect(
      trustedReadonlyPosixFactsIssue({
        currentUid: 1000,
        fileUid: 1000,
        fileMode: 0o100644,
        fileWritable: true,
        parents: [],
      }),
    ).toContain('different host identity');
    expect(
      trustedReadonlyPosixFactsIssue({
        currentUid: 1000,
        fileUid: 0,
        fileMode: 0o100444,
        fileWritable: true,
        parents: [],
      }),
    ).toContain('writable by the current process');
    expect(
      trustedReadonlyPosixFactsIssue({
        currentUid: 1000,
        fileUid: 0,
        fileMode: 0o100444,
        fileWritable: false,
        parents: [{ uid: 1000, mode: 0o40555, writable: false }],
      }),
    ).toContain('parent chain');
    expect(
      trustedReadonlyPosixFactsIssue({
        currentUid: 1000,
        fileUid: 0,
        fileMode: 0o100444,
        fileWritable: false,
        parents: [{ uid: 0, mode: 0o40777, writable: false }],
      }),
    ).toContain('parent chain');
  });

  it('rejects non-files and detects a changed identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-anchor-identity-'));
    roots.push(root);
    const file = path.join(root, 'controller-trust.json');
    await fs.writeFile(file, '{}\n');
    const unregister = registerTrustedReadonlyFileForTest(file);
    try {
      const identity = await assertTrustedReadonlyFile({ file });
      await fs.writeFile(file, '{"changed":true}\n');
      await expect(assertTrustedReadonlyFile({ file, previous: identity })).rejects.toThrow(
        'identity changed',
      );
      await expect(assertTrustedReadonlyFile({ file: root })).rejects.toThrow('regular');
    } finally {
      unregister();
    }
  });
});
