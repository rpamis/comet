import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashGitPaths } from '../../../domains/comet-classic/classic-check-snapshot.js';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawnSync: vi.fn() };
});

const digest = (name: string) => createHash('sha256').update(name).digest('hex');
const batches = () =>
  vi.mocked(spawnSync).mock.calls.map(([, args]) => (args as string[]).slice(5));

beforeEach(() => {
  vi.mocked(spawnSync)
    .mockReset()
    .mockImplementation((_command, args) => {
      const paths = (args as string[]).slice(5);
      const failed = paths.some((name) => name === 'missing' || name.length > 20_000);
      return {
        pid: 1,
        status: failed ? 128 : 0,
        signal: null,
        output: [],
        stdout: failed ? '' : paths.map(digest).join('\n') + '\n',
        stderr: '',
      };
    });
});

describe('Classic Git hash argument batches', () => {
  it('hashes 1000 short paths in four bounded processes and preserves order', () => {
    const names = Array.from({ length: 1000 }, (_, index) => `source-${index}.ts`);
    expect([...hashGitPaths('/project', names)]).toEqual(names.map((name) => [name, digest(name)]));
    expect(batches()).toHaveLength(4);
    expect(batches().every((batch) => batch.length <= 256)).toBe(true);
  });

  it('bounds arguments with non-ASCII, spaces, quotes and backslashes without rewriting paths', () => {
    const root = 'C:\\working directory\\项目';
    const names = Array.from({ length: 200 }, (_, index) => `${'目录 '.repeat(30)}${index} \\".ts`);
    expect([...hashGitPaths(root, names).keys()]).toEqual(names);
    expect(batches().length).toBeGreaterThan(1);
    for (const [, args, options] of vi.mocked(spawnSync).mock.calls) {
      const argumentList = args as string[];
      const quotedUpperBound = argumentList.reduce(
        (total, argument) => total + Buffer.byteLength(argument, 'utf8') * 2 + 3,
        0,
      );
      expect(quotedUpperBound).toBeLessThanOrEqual(16 * 1024);
      expect(options).not.toHaveProperty('shell', true);
    }
  });

  it('isolates an over-budget path so it cannot poison neighboring successful batches', () => {
    const oversized = 'x'.repeat(30_000);
    const names = ['before.ts', oversized, 'after.ts'];
    expect([...hashGitPaths('/project', names).keys()]).toEqual(['before.ts', 'after.ts']);
    expect(batches()).toEqual([['before.ts'], [oversized], ['after.ts']]);
  });

  it('retains successes outside a failed batch and recursively isolates only that failure', () => {
    const names = Array.from({ length: 800 }, (_, index) => `source-${index}.ts`);
    const inputs = [...names.slice(0, 300), 'missing', ...names.slice(300)];
    expect([...hashGitPaths('/project', inputs).keys()]).toEqual(names);
    expect(batches()).toHaveLength(20);
    expect(batches().filter((batch) => batch.includes(names[0]))).toHaveLength(1);
    expect(batches().filter((batch) => batch.includes(names[799]))).toHaveLength(1);
  });

  it('does not spawn Git for an empty path set', () => {
    expect(hashGitPaths('/project', []).size).toBe(0);
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
