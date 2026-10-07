import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  assertNativeSupervisorArchiveSnapshot,
  writeMissingNativeSupervisorArchiveMaterials,
} from '../../../domains/comet-native/native-sdk-supervisor-archive.js';

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

it('binds replacement to every original archive byte and rejects committed edits, missing records and extra files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-child-archive-materials-'));
  roots.push(root);
  const archiveRelative = 'docs/comet/archive/2026-01-01-left';
  const directory = path.join(root, archiveRelative);
  await fs.mkdir(directory, { recursive: true });
  const originals = {
    'brief.md': '# Scoped Child\n',
    'spec.md': '# Accepted Parent Spec\n',
    'archive-source.md': '# Original receipt and hashes\n',
    'comet-state.yaml': 'original accepted state\n',
    'verification.md': '# Original accepted verification\n',
  };
  for (const [ref, content] of Object.entries(originals))
    await fs.writeFile(path.join(directory, ref), content);
  const git = (args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Comet Test', '-c', 'user.email=comet-test@example.com', ...args],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  git(['init', '-b', 'main']);
  git(['add', '--', archiveRelative]);
  git(['commit', '-m', 'accepted archive']);
  const archiveCommit = git(['rev-parse', 'HEAD']);
  const inspect = () =>
    assertNativeSupervisorArchiveSnapshot({
      worktree: root,
      directory,
      archiveRelative,
      archiveCommit,
    });
  await expect(inspect()).resolves.toBeInstanceOf(Map);
  for (const [ref, content] of Object.entries(originals)) {
    await fs.writeFile(path.join(directory, ref), content + '\n');
    git(['add', '--', archiveRelative + '/' + ref]);
    git(['commit', '-m', 'alter ' + ref]);
    expect(git(['status', '--porcelain'])).toBe('');
    await expect(inspect()).rejects.toThrow('material conflict: ' + ref);
    expect(await fs.readFile(path.join(directory, ref), 'utf8')).toBe(content + '\n');
    await fs.writeFile(path.join(directory, ref), content);
    git(['add', '--', archiveRelative + '/' + ref]);
    git(['commit', '-m', 'restore ' + ref]);
  }
  await fs.writeFile(path.join(directory, 'note.md'), 'preserve unrelated work\n');
  await expect(inspect()).rejects.toThrow('material conflict: note.md');
  expect(await fs.readFile(path.join(directory, 'note.md'), 'utf8')).toBe(
    'preserve unrelated work\n',
  );
  await fs.unlink(path.join(directory, 'note.md'));
  await fs.unlink(path.join(directory, 'comet-state.yaml'));
  await expect(inspect()).rejects.toThrow('material conflict: comet-state.yaml');
  for (const [ref, content] of Object.entries(originals))
    expect(
      execFileSync('git', ['show', archiveCommit + ':' + archiveRelative + '/' + ref], {
        cwd: root,
        encoding: 'utf8',
      }),
    ).toBe(content);
});

it('accepts legacy archives with no source materials only while both accepted records remain intact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-child-archive-materials-'));
  roots.push(root);
  const archiveRelative = 'docs/comet/archive/2026-01-01-left';
  const directory = path.join(root, archiveRelative);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'comet-state.yaml'), 'accepted state\n');
  await fs.writeFile(path.join(directory, 'verification.md'), 'accepted report\n');
  const git = (args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Comet Test', '-c', 'user.email=comet-test@example.com', ...args],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  git(['init', '-b', 'main']);
  git(['add', '--', archiveRelative]);
  git(['commit', '-m', 'legacy archive']);
  const inspect = () =>
    assertNativeSupervisorArchiveSnapshot({
      worktree: root,
      directory,
      archiveRelative,
      archiveCommit: git(['rev-parse', 'HEAD']),
    });
  await expect(inspect()).resolves.toBeInstanceOf(Map);
  await fs.writeFile(path.join(directory, 'archive-source.md'), 'unbound source\n');
  await expect(inspect()).rejects.toThrow('material conflict: archive-source.md');
  expect(await fs.readFile(path.join(directory, 'archive-source.md'), 'utf8')).toBe(
    'unbound source\n',
  );
});
