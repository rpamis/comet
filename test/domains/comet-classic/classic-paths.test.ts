import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import * as classicPaths from '../../../domains/comet-classic/classic-paths.js';

const { resolveClassicChangeDirectory } = classicPaths;

type ChangeDirectory = {
  label: string;
  directory: string;
};

function exportedFunction<T>(name: string): T | undefined {
  return (classicPaths as unknown as Record<string, T | undefined>)[name];
}

describe('Classic change paths', () => {
  let projectRoot: string;
  let outsideRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-paths-'));
    outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-paths-outside-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
    await fs.mkdir(path.join(projectRoot, '.comet'));
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: legacy',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'archive'), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await Promise.all([
      fs.rm(projectRoot, { recursive: true, force: true }),
      fs.rm(outsideRoot, { recursive: true, force: true }),
    ]);
  });

  it('fails closed when an active change directory is a directory link', async () => {
    await fs.writeFile(path.join(outsideRoot, '.comet.yaml'), 'workflow: full\n', 'utf8');
    await fs.symlink(
      outsideRoot,
      path.join(projectRoot, 'openspec', 'changes', 'demo'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(resolveClassicChangeDirectory('demo', projectRoot)).rejects.toThrow(
      /symbolic link or junction/iu,
    );
  });

  it('inspects a missing active change without creating it', async () => {
    const inspect = exportedFunction<
      (
        name: string,
        projectRoot: string,
      ) => Promise<ChangeDirectory & { exists: boolean; stateExists: boolean }>
    >('inspectClassicActiveChangeDirectory');
    expect(inspect).toBeTypeOf('function');
    if (!inspect) return;

    await expect(inspect('demo', projectRoot)).resolves.toEqual({
      label: 'openspec/changes/demo',
      directory: path.join(projectRoot, 'openspec', 'changes', 'demo'),
      exists: false,
      stateExists: false,
    });
    await expect(
      fs.access(path.join(projectRoot, 'openspec', 'changes', 'demo')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('creates a missing active change directory through protected path segments', async () => {
    const ensure = exportedFunction<
      (name: string, projectRoot: string) => Promise<ChangeDirectory>
    >('ensureClassicActiveChangeDirectory');
    expect(ensure).toBeTypeOf('function');
    if (!ensure) return;

    await expect(ensure('demo', projectRoot)).resolves.toEqual({
      label: 'openspec/changes/demo',
      directory: path.join(projectRoot, 'openspec', 'changes', 'demo'),
    });
    await expect(
      fs.stat(path.join(projectRoot, 'openspec', 'changes', 'demo')),
    ).resolves.toMatchObject({});
  });

  it('does not resolve a longer archived change that merely shares the requested suffix', async () => {
    const wrong = path.join(projectRoot, 'openspec', 'changes', 'archive', '2026-07-28-other-demo');
    await fs.mkdir(wrong);
    await fs.writeFile(path.join(wrong, '.comet.yaml'), 'workflow: full\n', 'utf8');

    await expect(resolveClassicChangeDirectory('demo', projectRoot)).resolves.toEqual({
      label: 'openspec/changes/demo',
      directory: path.join(projectRoot, 'openspec', 'changes', 'demo'),
    });
  });

  it('fails closed when an archived change state is not a real file', async () => {
    const archived = path.join(projectRoot, 'openspec', 'changes', 'archive', '2026-07-28-demo');
    await fs.mkdir(path.join(archived, '.comet.yaml'), { recursive: true });

    await expect(resolveClassicChangeDirectory('demo', projectRoot)).rejects.toThrow(
      /must be a real file/iu,
    );
  });

  it('selects the latest strict date-prefixed archive for the exact change name', async () => {
    for (const date of ['2026-07-27', '2026-07-28']) {
      const archived = path.join(projectRoot, 'openspec', 'changes', 'archive', `${date}-demo`);
      await fs.mkdir(archived);
      await fs.writeFile(path.join(archived, '.comet.yaml'), 'workflow: full\n', 'utf8');
    }

    await expect(resolveClassicChangeDirectory('demo', projectRoot)).resolves.toEqual({
      label: 'openspec/changes/archive/2026-07-28-demo',
      directory: path.join(projectRoot, 'openspec', 'changes', 'archive', '2026-07-28-demo'),
    });
  });

  it('finds an exact compatibility archive through the protected archive lookup', async () => {
    const find = exportedFunction<
      (name: string, projectRoot: string) => Promise<ChangeDirectory | null>
    >('findClassicArchiveChangeDirectory');
    expect(find).toBeTypeOf('function');
    if (!find) return;

    const archived = path.join(projectRoot, 'openspec', 'changes', 'archive', 'demo');
    await fs.mkdir(archived);
    await fs.writeFile(path.join(archived, '.comet.yaml'), 'workflow: full\n', 'utf8');

    await expect(find('demo', projectRoot)).resolves.toEqual({
      label: 'openspec/changes/archive/demo',
      directory: archived,
    });
  });

  it('prefers the exact archive produced by the current archive operation', async () => {
    const exact = path.join(projectRoot, 'openspec', 'changes', 'archive', 'demo');
    const preferred = path.join(projectRoot, 'openspec', 'changes', 'archive', '2026-07-28-demo');
    for (const archived of [exact, preferred]) {
      await fs.mkdir(archived);
      await fs.writeFile(path.join(archived, '.comet.yaml'), 'workflow: full\n', 'utf8');
    }

    await expect(
      classicPaths.findClassicArchiveChangeDirectory('demo', projectRoot, {
        preferredArchiveName: '2026-07-28-demo',
      }),
    ).resolves.toEqual({
      label: 'openspec/changes/archive/2026-07-28-demo',
      directory: preferred,
    });
  });

  it('does not fall back to an old archive when the preferred archive is missing', async () => {
    const exact = path.join(projectRoot, 'openspec', 'changes', 'archive', 'demo');
    await fs.mkdir(exact);
    await fs.writeFile(path.join(exact, '.comet.yaml'), 'workflow: full\n', 'utf8');

    await expect(
      classicPaths.findClassicArchiveChangeDirectory('demo', projectRoot, {
        preferredArchiveName: '2026-07-28-demo',
      }),
    ).resolves.toBeNull();
  });

  it('can ignore an exact compatibility archive when resolving fresh dated output', async () => {
    const exact = path.join(projectRoot, 'openspec', 'changes', 'archive', 'demo');
    const dated = path.join(projectRoot, 'openspec', 'changes', 'archive', '2026-07-27-demo');
    for (const archived of [exact, dated]) {
      await fs.mkdir(archived);
      await fs.writeFile(path.join(archived, '.comet.yaml'), 'workflow: full\n', 'utf8');
    }

    await expect(
      classicPaths.findClassicArchiveChangeDirectory('demo', projectRoot, {
        skipExactCompatibility: true,
      }),
    ).resolves.toEqual({
      label: 'openspec/changes/archive/2026-07-27-demo',
      directory: dated,
    });
  });

  it('rejects a preferred archive name for a different change', async () => {
    await expect(
      classicPaths.findClassicArchiveChangeDirectory('demo', projectRoot, {
        preferredArchiveName: '2026-07-28-other-demo',
      }),
    ).rejects.toThrow(/preferred archive name/iu);
  });
});
