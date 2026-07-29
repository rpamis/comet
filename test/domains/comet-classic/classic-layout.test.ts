import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  assertClassicLayoutReadable,
  assertClassicLayoutWritable,
  ClassicLayoutConflictError,
  classicLayoutPaths,
  discoverClassicProject,
  inspectClassicLayout,
  readClassicArtifactLayout,
} from '../../../domains/comet-classic/classic-layout.js';

const roots: string[] = [];

async function project(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-layout-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  return root;
}

async function externalDirectory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-layout-outside-'));
  roots.push(root);
  return root;
}

async function directoryLink(target: string, link: string): Promise<void> {
  await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

async function config(root: string, classic: string): Promise<void> {
  await fs.mkdir(path.join(root, '.comet'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.comet', 'config.yaml'),
    `schema: comet.project.v1\ndefault_workflow: classic\nnative:\n  artifact_root: docs\nclassic:\n${classic}`,
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Classic artifact layout', () => {
  it('does not guess a Classic layout when project config is missing', async () => {
    const root = await project();

    await expect(readClassicArtifactLayout(root)).rejects.toThrow(
      'Classic artifact layout is unavailable',
    );
  });

  it('does not treat a Native-only project as legacy Classic', async () => {
    const root = await project();
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(readClassicArtifactLayout(root)).rejects.toThrow(
      'Classic artifact layout is unavailable because Classic is not enabled',
    );
  });

  it('defaults a missing Classic layout to docs', async () => {
    const root = await project();
    await config(root, '  language: zh-CN\n');

    await expect(readClassicArtifactLayout(root)).resolves.toBe('docs');
    expect(classicLayoutPaths(root, 'docs').changesDir).toBe(
      path.join(root, 'docs', 'openspec', 'changes'),
    );
  });

  it('resolves the docs catalogue without changing the Superpowers root', async () => {
    const root = await project();
    await config(root, '  artifact_layout: docs\n');

    const inspection = await inspectClassicLayout(root);
    expect(inspection.paths.openSpecRoot).toBe(path.join(root, 'docs', 'openspec'));
    expect(inspection.paths.superpowersRoot).toBe(path.join(root, 'docs', 'superpowers'));
  });

  it('rejects invalid layout values', async () => {
    const root = await project();
    await config(root, '  artifact_layout: elsewhere\n');

    await expect(readClassicArtifactLayout(root)).rejects.toThrow(
      'classic.artifact_layout must be legacy or docs',
    );
  });

  it('fails closed when unrelated project-config YAML is malformed', async () => {
    const root = await project();
    await config(root, '  artifact_layout: docs\nextension: [unterminated\n');

    await expect(readClassicArtifactLayout(root)).rejects.toThrow('Invalid .comet/config.yaml');
  });

  it('fails closed for writes when both OpenSpec roots exist', async () => {
    const root = await project();
    await config(root, '  artifact_layout: docs\n');
    await fs.mkdir(path.join(root, 'openspec'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs', 'openspec'), { recursive: true });

    await expect(assertClassicLayoutWritable(root)).rejects.toThrow('Classic layout conflict');
  });

  it('reports a structured dual-root error from the read-only layout boundary', async () => {
    const root = await project();
    await config(root, '  artifact_layout: docs\n');
    await fs.mkdir(path.join(root, 'openspec'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs', 'openspec'), { recursive: true });

    const error = await assertClassicLayoutReadable(root).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ClassicLayoutConflictError);
    expect(error).toMatchObject({
      code: 'classic-layout-conflict',
      configuredRoot: path.join(root, 'docs', 'openspec'),
      alternateRoot: path.join(root, 'openspec'),
    });
  });

  it('fails closed for writes when the configured OpenSpec root is missing', async () => {
    const root = await project();
    await config(root, '  artifact_layout: docs\n');

    await expect(assertClassicLayoutWritable(root)).rejects.toThrow(
      'Configured Classic OpenSpec root is missing: docs/openspec',
    );
  });

  it('reports both root states when the configured root is missing', async () => {
    const root = await project();
    await config(root, '  artifact_layout: docs\n');

    await expect(assertClassicLayoutReadable(root)).rejects.toThrow(
      'Configured Classic OpenSpec root is missing: docs/openspec (alternate openspec is missing)',
    );

    await fs.mkdir(path.join(root, 'openspec'), { recursive: true });
    await expect(assertClassicLayoutReadable(root)).rejects.toThrow(
      'Configured Classic OpenSpec root is missing: docs/openspec (alternate openspec is present)',
    );
  });

  it('fails closed for writes when the configured OpenSpec root is not a directory', async () => {
    const root = await project();
    await config(root, '  artifact_layout: docs\n');
    await fs.mkdir(path.join(root, 'docs'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'openspec'), 'not a directory\n');

    await expect(assertClassicLayoutWritable(root)).rejects.toThrow(/must be a real directory/u);
  });

  it('allows read-only layout inspection while a root move journal is pending', async () => {
    const root = await project();
    await config(root, '  artifact_layout: legacy\n');
    await fs.mkdir(path.join(root, 'openspec'), { recursive: true });
    await fs.writeFile(path.join(root, '.comet', 'classic-root-move.json'), '{}\n');

    await expect(assertClassicLayoutReadable(root)).resolves.toMatchObject({
      artifactLayout: 'legacy',
      openSpecRoot: path.join(root, 'openspec'),
    });
    await expect(assertClassicLayoutWritable(root)).rejects.toThrow(
      /Classic root move transaction is incomplete/u,
    );
  });

  it.each([
    ['legacy OpenSpec root', 'legacy'],
    ['docs ancestor', 'docs'],
  ])('fails closed when the %s escapes through a directory link', async (_label, layout) => {
    const root = await project();
    const outside = await externalDirectory();
    await config(root, `  artifact_layout: ${layout}\n`);
    await fs.mkdir(path.join(outside, 'openspec'), { recursive: true });
    await fs.writeFile(path.join(outside, 'keep.txt'), 'keep\n');

    if (layout === 'legacy') {
      await directoryLink(path.join(outside, 'openspec'), path.join(root, 'openspec'));
    } else {
      await directoryLink(outside, path.join(root, 'docs'));
    }

    await expect(assertClassicLayoutWritable(root)).rejects.toThrow(/symbolic link or junction/u);
    await expect(fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).resolves.toBe('keep\n');
  });

  it('fails closed before reading config through a linked .comet ancestor', async () => {
    const root = await project();
    const outside = await externalDirectory();
    await fs.writeFile(
      path.join(outside, 'config.yaml'),
      'classic:\n  artifact_layout: docs\n',
      'utf8',
    );
    await directoryLink(outside, path.join(root, '.comet'));

    await expect(readClassicArtifactLayout(root)).rejects.toThrow(/symbolic link or junction/u);
  });

  it('discovers a project from a nested Classic artifact directory', async () => {
    const root = await project();
    const nested = path.join(root, 'docs', 'openspec', 'changes', 'demo');
    await fs.mkdir(nested, { recursive: true });

    await expect(discoverClassicProject(nested)).resolves.toBe(root);
  });
});
