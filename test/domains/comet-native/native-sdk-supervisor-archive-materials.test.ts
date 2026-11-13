import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { writeMissingNativeSupervisorArchiveMaterials } from '../../../domains/comet-native/native-sdk-supervisor-archive.js';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
it('restores only missing child archive materials while preserving existing originals and dry runs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-archive-materials-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'brief.md'), 'Existing original');
  const materials = { 'brief.md': 'Later rendering', 'spec.md': 'Original specification' };
  expect(await writeMissingNativeSupervisorArchiveMaterials(root, materials, true)).toEqual([
    'spec.md',
  ]);
  await expect(fs.stat(path.join(root, 'spec.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await writeMissingNativeSupervisorArchiveMaterials(root, materials, false)).toEqual([
    'spec.md',
  ]);
  expect(await fs.readFile(path.join(root, 'brief.md'), 'utf8')).toBe('Existing original');
  expect(await fs.readFile(path.join(root, 'spec.md'), 'utf8')).toBe('Original specification');
  expect(await writeMissingNativeSupervisorArchiveMaterials(root, materials, false)).toEqual([]);
  await expect(
    writeMissingNativeSupervisorArchiveMaterials(root, { '../outside.md': 'Escape' }, false),
  ).rejects.toThrow();
});
