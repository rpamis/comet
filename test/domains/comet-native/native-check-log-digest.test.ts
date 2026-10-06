import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeNativeCheck } from '../../../domains/comet-native/native-check-executor.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Native streamed check log digests', () => {
  it.each(['mixed', 'empty', 'spawn-error'] as const)(
    'hashes the actual %s output bytes without reading the log back',
    async (kind) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-check-log-digest-'));
      roots.push(root);
      const runtimeDir = path.join(root, '.comet/runtime/checks');
      const reads = vi.spyOn(fs, 'readFile');
      const result = await executeNativeCheck({
        projectRoot: root,
        runtimeDir,
        operationId: 'digest',
        plan: {
          id: kind,
          name: kind,
          executable:
            kind === 'spawn-error' ? path.join(root, 'missing-executable') : process.execPath,
          argv:
            kind === 'mixed'
              ? [
                  '-e',
                  'for(let i=0;i<64;i++){process.stdout.write(Buffer.alloc(8192,i));process.stderr.write(Buffer.alloc(4096,255-i));}',
                ]
              : ['-e', ''],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      });
      const logFile = path.join(runtimeDir, result.logRef);
      expect(reads.mock.calls.filter(([file]) => String(file) === logFile)).toHaveLength(0);
      const bytes = await fs.readFile(logFile);
      expect(result.logSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(result.status).toBe(kind === 'spawn-error' ? 'interrupted' : 'passed');
      if (kind === 'mixed') expect(bytes.byteLength).toBe(64 * (8192 + 4096));
      if (kind === 'spawn-error') expect(bytes.toString('utf8')).toContain('failed to start check');
    },
  );
});
