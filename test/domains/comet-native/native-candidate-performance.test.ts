import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeCandidateInputGate } from '../../../domains/comet-native/native-portable-checks.js';
import { withCometRuntimeMetrics } from '../../../platform/process/runtime-metrics.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Native candidate comparison work budgets', () => {
  it.each([false, true])(
    'batches indexed blobs for comment edits (distinct content: %s)',
    async (distinct) => {
      const base = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-candidate-budget-'));
      roots.push(base);
      const root = path.join(base, 'project');
      const home = path.join(base, 'home');
      await fs.mkdir(root);
      await fs.mkdir(home);
      vi.stubEnv('HOME', home);
      vi.stubEnv('USERPROFILE', home);
      vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
      git('init', '-b', 'main');
      const files = Array.from({ length: 24 }, (_, index) => ({
        file: path.join(root, `value-${index}.ts`),
        source: `export function value() { return ${distinct ? index : 1}; }\n`,
      }));
      await Promise.all(files.map(({ file, source }) => fs.writeFile(file, source)));
      git('add', '.');
      git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'baseline',
      );
      const options = { projectRoot: root, candidateId: 'candidate', plans: [] };
      const before = await nativeCandidateInputGate(options);
      expect(before).not.toBeNull();
      await Promise.all(
        files.map(({ file, source }) => fs.writeFile(file, `// Explanation.\n${source}`)),
      );
      const { result, metrics } = await withCometRuntimeMetrics(() =>
        nativeCandidateInputGate(options),
      );
      expect(result).toBe(before);
      expect(metrics.gitCommands).toBeLessThanOrEqual(8);
      await fs.writeFile(files[0].file, 'export function value() { return -1; }\n');
      expect(await nativeCandidateInputGate(options)).not.toBe(before);
    },
  );
});
