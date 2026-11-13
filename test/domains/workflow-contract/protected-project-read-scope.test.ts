import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  readProtectedProjectFile,
  withProtectedProjectReadScope,
} from '../../../domains/workflow-contract/protected-project-path.js';

it('rejects a replaced parent before publishing a read scope and reads fresh files in the next scope', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-read-scope-'));
  const root = path.join(base, 'project');
  const parent = path.join(root, 'notes');
  const saved = path.join(root, 'saved');
  const outside = path.join(base, 'outside');
  await fs.mkdir(parent, { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(parent, 'guide.md'), 'first');
  await fs.writeFile(path.join(outside, 'guide.md'), 'outside');
  const read = async () =>
    (
      await readProtectedProjectFile(root, 'notes/guide.md', 1024, { label: 'Guide' })
    ).bytes.toString();
  try {
    await expect(
      withProtectedProjectReadScope(async () => {
        expect(await withProtectedProjectReadScope(read)).toBe('first');
        await fs.rename(parent, saved);
        await fs.symlink(outside, parent, 'junction');
        return 'must not publish';
      }),
    ).rejects.toThrow(/directory changed/u);
    await fs.unlink(parent);
    await fs.rename(saved, parent);
    await fs.writeFile(path.join(parent, 'guide.md'), 'fresh');
    expect(await withProtectedProjectReadScope(read)).toBe('fresh');
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
