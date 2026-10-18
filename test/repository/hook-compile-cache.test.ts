import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const hook = path.resolve('assets/skills/comet/scripts/comet-hook-router.mjs');
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('standalone Hook compile cache', () => {
  it('keeps decisions identical when the optional cache is unavailable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-cache-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.comet'));
    const blockedCache = path.join(root, 'not-a-directory');
    await fs.writeFile(blockedCache, 'keep');
    const run = (cache: string, disabled: string) =>
      spawnSync(process.execPath, [hook, '--platform', 'claude', '--project-root', root], {
        cwd: root,
        encoding: 'utf8',
        input: JSON.stringify({
          cwd: root,
          tool_name: 'Write',
          tool_input: { file_path: path.join(root, 'example.ts'), content: 'fixture' },
        }),
        env: {
          ...process.env,
          HOME: root,
          USERPROFILE: root,
          COMET_DATA_DIR: path.join(root, 'data'),
          NODE_COMPILE_CACHE: cache,
          NODE_DISABLE_COMPILE_CACHE: disabled,
        },
      });
    const uncached = run(path.join(root, 'disabled-cache'), '1');
    const blocked = run(blockedCache, '');
    const cached = run(path.join(root, 'enabled-cache'), '');
    for (const result of [uncached, blocked, cached]) {
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(uncached.status);
      expect(result.stdout).toBe(uncached.stdout);
      expect(result.stderr).toBe(uncached.stderr);
    }
    expect(await fs.readFile(blockedCache, 'utf8')).toBe('keep');
    await expect(fs.stat(path.join(root, 'example.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
