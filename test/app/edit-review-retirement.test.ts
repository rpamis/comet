import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { editReviewCommand } from '../../app/commands/edit-review.js';
import { resolveWorkspaceRuntimeRootSync } from '../../domains/workflow-contract/workspace-runtime.js';
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it.each(['native', 'classic'])(
  'rejects the retired %s content-proof command without writing project or Runtime data',
  async (workflow) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edit-proof-retired-'));
    roots.push(root);
    const file = path.join(root, 'original.txt');
    await fs.writeFile(file, 'Original approved materials remain unchanged.\n');
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      chunks.push(String(chunk));
      return true;
    });
    const runtimeRoot = resolveWorkspaceRuntimeRootSync(root);
    await expect(fs.access(runtimeRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await editReviewCommand('observe', workflow, 'original', { projectRoot: root });
    await expect(fs.access(runtimeRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(chunks.join(''))).toMatchObject({
      ok: false,
      error: expect.stringContaining('内容证明协议已移除'),
    });
    expect(process.exitCode).toBe(1);
    expect(await fs.readdir(root)).toEqual(['original.txt']);
    expect(await fs.readFile(file, 'utf8')).toBe('Original approved materials remain unchanged.\n');
  },
);
