import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { writeMissingNativeSupervisorArchiveMaterials } from '../../../domains/comet-native/native-sdk-supervisor-archive.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('adds missing archive materials without changing accepted records, reuses identical content and rejects a conflict before writing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-child-archive-materials-'));
  roots.push(directory);
  const originals = {
    'comet-state.yaml': Buffer.from('original accepted state\r\n'),
    'verification.md': Buffer.from('original accepted verification\n'),
  };
  for (const [ref, bytes] of Object.entries(originals))
    await fs.writeFile(path.join(directory, ref), bytes);
  const materials = {
    'brief.md': '# Scoped Child\n',
    'spec.md': '# Original Parent Spec\n',
    'archive-source.md': '# Original receipt and hashes\n',
  };
  expect(await writeMissingNativeSupervisorArchiveMaterials(directory, materials, true)).toEqual(
    Object.keys(materials),
  );
  expect(await fs.readdir(directory)).toEqual(expect.arrayContaining(Object.keys(originals)));
  await expect(fs.access(path.join(directory, 'brief.md'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await writeMissingNativeSupervisorArchiveMaterials(directory, materials, false)).toEqual(
    Object.keys(materials),
  );
  expect(await writeMissingNativeSupervisorArchiveMaterials(directory, materials, false)).toEqual(
    [],
  );
  for (const [ref, bytes] of Object.entries(originals))
    expect(await fs.readFile(path.join(directory, ref))).toEqual(bytes);
  for (const [ref, content] of Object.entries(materials))
    expect(await fs.readFile(path.join(directory, ref), 'utf8')).toEqual(content);
  await fs.unlink(path.join(directory, 'brief.md'));
  await fs.writeFile(path.join(directory, 'spec.md'), '# User edited source\n');
  await expect(
    writeMissingNativeSupervisorArchiveMaterials(directory, materials, false),
  ).rejects.toThrow('material conflict: spec.md');
  await expect(fs.access(path.join(directory, 'brief.md'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await fs.readFile(path.join(directory, 'spec.md'), 'utf8')).toBe('# User edited source\n');
  for (const [ref, bytes] of Object.entries(originals))
    expect(await fs.readFile(path.join(directory, ref))).toEqual(bytes);
});
