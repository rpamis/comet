import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';

import {
  assertClassicLayoutReadable,
  assertClassicLayoutWritable,
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
  vi.restoreAllMocks();
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

  it('keeps the configured Classic root writable when a standalone OpenSpec root also exists', async () => {
    const root = await project();
    await config(root, '  artifact_layout: docs\n');
    await fs.mkdir(path.join(root, 'openspec'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs', 'openspec'), { recursive: true });

    await expect(assertClassicLayoutWritable(root)).resolves.toMatchObject({
      artifactLayout: 'docs',
      openSpecRoot: path.join(root, 'docs', 'openspec'),
    });
  });

  it('allows initialization to use its selected root without mutating an alternate root', async () => {
    const root = await project();
    await config(root, '  artifact_layout: docs\n');
    await fs.mkdir(path.join(root, 'openspec'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs', 'openspec'), { recursive: true });

    await expect(assertClassicLayoutWritable(root, 'docs')).resolves.toMatchObject({
      artifactLayout: 'docs',
      openSpecRoot: path.join(root, 'docs', 'openspec'),
    });
  });

  it('reads the configured root without scanning the standalone OpenSpec root', async () => {
    const root = await project();
    await config(root, '  artifact_layout: docs\n');
    await fs.mkdir(path.join(root, 'openspec'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs', 'openspec'), { recursive: true });

    await expect(assertClassicLayoutReadable(root)).resolves.toMatchObject({
      artifactLayout: 'docs',
      openSpecRoot: path.join(root, 'docs', 'openspec'),
    });
  });

  it('keeps the configured root readable when the standalone root is a directory link', async () => {
    const root = await project();
    const outside = await externalDirectory();
    await config(root, '  artifact_layout: docs\n');
    await fs.mkdir(path.join(root, 'docs', 'openspec'), { recursive: true });
    await directoryLink(outside, path.join(root, 'openspec'));

    await expect(assertClassicLayoutReadable(root)).resolves.toMatchObject({
      artifactLayout: 'docs',
      openSpecRoot: path.join(root, 'docs', 'openspec'),
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

describe('Classic project discovery boundaries', () => {
  it.each(['.', 'src'])(
    'rejects malformed child project YAML from %s instead of selecting its parent',
    async (start) => {
      const parent = await project();
      execFileSync('git', ['init'], { cwd: parent, stdio: 'ignore' });
      await config(parent, '  artifact_layout: docs\n');
      const child = path.join(parent, 'child');
      await config(child, '  artifact_layout: docs\nextension: [unterminated\n');
      const cwd = path.join(child, start);
      await fs.mkdir(cwd, { recursive: true });

      await expect(discoverClassicProject(cwd)).rejects.toThrow('Invalid .comet/config.yaml');
      await expect(fs.access(path.join(child, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each(['"comet.project.v1" # project', "'comet.project.v1'"])(
    'retains malformed ancestor boundaries with schema %s',
    async (schema) => {
      const parent = await project();
      const child = path.join(parent, 'child');
      const nested = path.join(child, 'src');
      await fs.mkdir(nested, { recursive: true });
      await fs.mkdir(path.join(child, '.comet'));
      await fs.writeFile(
        path.join(child, '.comet', 'config.yaml'),
        `schema: ${schema}\nextension: [\n`,
      );

      await expect(discoverClassicProject(nested)).rejects.toThrow('Invalid .comet/config.yaml');
    },
  );

  it.each([
    '"schema": comet.project.v1\nclassic: { artifact_layout: invalid }\n',
    '{ schema: comet.project.v1, classic: { artifact_layout: invalid } }',
    '"schema": comet.project.v1\nextension: [',
    '{ schema: comet.project.v1, extension: [',
  ])('retains declared ancestor boundaries across YAML syntax: %s', async (source) => {
    const parent = await project();
    const child = path.join(parent, 'child');
    const nested = path.join(child, 'src');
    await fs.mkdir(nested, { recursive: true });
    await fs.mkdir(path.join(child, '.comet'));
    await fs.writeFile(path.join(child, '.comet', 'config.yaml'), source);

    await expect(discoverClassicProject(nested)).rejects.toThrow(
      /Invalid \.comet\/config.yaml|classic.artifact_layout must be/,
    );
  });

  it.each([
    'schema: other\nschema: comet.project.v1\n',
    'schema: comet.project.v1\nschema: other\n',
  ])('preserves duplicate schema errors regardless of key order: %s', async (source) => {
    const parent = await project();
    const child = path.join(parent, 'child');
    const nested = path.join(child, 'src');
    await fs.mkdir(nested, { recursive: true });
    await fs.mkdir(path.join(child, '.comet'));
    await fs.writeFile(path.join(child, '.comet', 'config.yaml'), source);

    await expect(discoverClassicProject(nested)).rejects.toThrow('Map keys must be unique');
  });

  it.each([
    ['value', 'value: &s comet.project.v1\nschema: *s\n'],
    ['key', 'key: &k schema\n*k : comet.project.v1\n'],
  ])(
    'validates schema %s aliases at invocation and ancestor project roots',
    async (_kind, declaration) => {
      const parent = await project();
      const child = path.join(parent, 'child');
      const nested = path.join(child, 'src');
      await fs.mkdir(nested, { recursive: true });
      await fs.mkdir(path.join(child, '.comet'));
      const file = path.join(child, '.comet', 'config.yaml');
      const source =
        declaration + 'default_workflow: classic\nclassic: { artifact_layout: docs }\n';
      await fs.writeFile(file, source);
      await expect(readClassicArtifactLayout(child)).resolves.toBe('docs');
      await expect(discoverClassicProject(nested)).resolves.toBe(child);
      await fs.writeFile(file, source.replace('artifact_layout: docs', 'artifact_layout: invalid'));

      for (const cwd of [child, nested]) {
        await expect(discoverClassicProject(cwd)).rejects.toThrow(
          'classic.artifact_layout must be legacy or docs',
        );
      }
    },
  );

  it.each(['schema: *missing\n', 'value: &s [comet.project.v1]\nschema: *s\n'])(
    'does not infer an ancestor project from an unresolved or non-scalar alias: %s',
    async (source) => {
      const parent = await project();
      const child = path.join(parent, 'child');
      const nested = path.join(child, 'src');
      await fs.mkdir(nested, { recursive: true });
      await fs.mkdir(path.join(child, '.comet'));
      await fs.writeFile(path.join(child, '.comet', 'config.yaml'), source);

      await expect(discoverClassicProject(nested)).resolves.toBe(parent);
    },
  );

  it.each(['.comet', '.comet/config.yaml'])(
    'rejects a dangling %s link instead of selecting a parent project',
    async (relative) => {
      const parent = await project();
      const child = path.join(parent, 'child');
      const nested = path.join(child, 'src');
      await fs.mkdir(nested, { recursive: true });
      const target = path.join(parent, 'missing');
      const link = path.join(child, relative);
      await fs.mkdir(path.dirname(link), { recursive: true });
      if (relative === '.comet') await directoryLink(target, link);
      else await fs.symlink(target, link, 'file');

      await expect(discoverClassicProject(nested)).rejects.toThrow(/symbolic link or junction/u);
    },
  );

  it('does not mistake schema text inside a block scalar for a project declaration', async () => {
    const parent = await project();
    const child = path.join(parent, 'child');
    const nested = path.join(child, 'src');
    await fs.mkdir(nested, { recursive: true });
    await fs.mkdir(path.join(child, '.comet'));
    await fs.writeFile(
      path.join(child, '.comet', 'config.yaml'),
      'description: |\n  schema: comet.project.v1\nclassic: { artifact_layout: invalid }\n',
    );

    await expect(discoverClassicProject(nested)).resolves.toBe(parent);
  });

  it('still validates HOME configuration when HOME is the invocation root', async () => {
    const home = await externalDirectory();
    await config(home, '  artifact_layout: invalid\n');
    vi.spyOn(os, 'homedir').mockReturnValue(home);

    await expect(discoverClassicProject(home)).rejects.toThrow(
      'classic.artifact_layout must be legacy or docs',
    );
  });

  it('preserves the original validation error for a declared ancestor project', async () => {
    const parent = await project();
    const child = path.join(parent, 'child');
    await config(child, '  artifact_layout: invalid\n');
    const nested = path.join(child, 'src');
    await fs.mkdir(nested);

    await expect(discoverClassicProject(nested)).rejects.toThrow(
      'classic.artifact_layout must be legacy or docs',
    );
  });

  it('rejects malformed invocation config even without a readable schema declaration', async () => {
    const parent = await project();
    const child = path.join(parent, 'child');
    await fs.mkdir(path.join(child, '.comet'), { recursive: true });
    await fs.writeFile(path.join(child, '.comet', 'config.yaml'), 'schema: [');

    await expect(discoverClassicProject(child)).rejects.toThrow('Invalid .comet/config.yaml');
  });

  it.each(['classic:\n  language: en\n', 'schema: comet.project.v1\nextension: ['])(
    'does not select ancestor HOME configuration: %s',
    async (source) => {
      const parent = await project();
      const home = path.join(parent, 'home');
      const nested = path.join(home, 'unconfigured', 'src');
      await fs.mkdir(nested, { recursive: true });
      await fs.mkdir(path.join(home, '.comet'));
      await fs.writeFile(path.join(home, '.comet', 'config.yaml'), source);
      vi.spyOn(os, 'homedir').mockReturnValue(home);

      await expect(discoverClassicProject(nested)).resolves.toBe(parent);
    },
  );

  it('does not treat an undeclared malformed ancestor configuration as a project', async () => {
    const parent = await project();
    const ancestor = path.join(parent, 'ancestor');
    const nested = path.join(ancestor, 'src');
    await fs.mkdir(nested, { recursive: true });
    await fs.mkdir(path.join(ancestor, '.comet'));
    await fs.writeFile(path.join(ancestor, '.comet', 'config.yaml'), 'classic: [');

    await expect(discoverClassicProject(nested)).resolves.toBe(parent);
  });

  it('does not swallow unsafe child configuration paths while discovering a parent', async () => {
    const parent = await project();
    const child = path.join(parent, 'child');
    const outside = await externalDirectory();
    await fs.mkdir(child);
    await fs.writeFile(path.join(outside, 'config.yaml'), 'schema: comet.project.v1\n');
    await directoryLink(outside, path.join(child, '.comet'));

    await expect(discoverClassicProject(child)).rejects.toThrow(/symbolic link or junction/u);
  });
});
