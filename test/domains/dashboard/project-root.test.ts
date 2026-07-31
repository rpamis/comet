import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { discoverDashboardProjectRoot } from '../../../domains/dashboard/project-root.js';

const temporaryRoots: string[] = [];

async function createTemporaryProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-root-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('discoverDashboardProjectRoot', () => {
  it('resolves the enclosing Git project from a nested directory', async () => {
    const root = await createTemporaryProject();
    const nested = path.join(root, 'packages', 'web', 'src');
    await fs.mkdir(path.join(root, '.git'));
    await fs.mkdir(nested, { recursive: true });

    await expect(discoverDashboardProjectRoot(nested)).resolves.toBe(root);
  });

  it('resolves a config-free legacy OpenSpec project from a nested change', async () => {
    const root = await createTemporaryProject();
    const change = path.join(root, 'openspec', 'changes', 'legacy-change');
    await fs.mkdir(change, { recursive: true });

    await expect(discoverDashboardProjectRoot(change)).resolves.toBe(root);
  });

  it('resolves a config-free docs OpenSpec project from a nested change', async () => {
    const root = await createTemporaryProject();
    const change = path.join(root, 'docs', 'openspec', 'changes', 'docs-change');
    await fs.mkdir(change, { recursive: true });

    await expect(discoverDashboardProjectRoot(change)).resolves.toBe(root);
  });

  it('does not treat the docs container as the project root', async () => {
    const root = await createTemporaryProject();
    const nested = path.join(root, 'docs', 'notes');
    await fs.mkdir(path.join(root, 'docs', 'openspec'), { recursive: true });
    await fs.mkdir(nested, { recursive: true });

    await expect(discoverDashboardProjectRoot(nested)).resolves.toBe(root);
  });

  it('resolves a Native project from its config marker without Git or Classic roots', async () => {
    const root = await createTemporaryProject();
    const nested = path.join(root, 'packages', 'app', 'src');
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(path.join(root, '.comet', 'config.yaml'), 'default_workflow: native\n');
    await fs.mkdir(nested, { recursive: true });

    await fs.appendFile(
      path.join(root, '.comet', 'config.yaml'),
      ['schema: comet.project.v1', 'native:', '  artifact_root: docs'].join(
        String.fromCharCode(10),
      ),
    );

    await expect(discoverDashboardProjectRoot(nested)).resolves.toBe(root);
  });

  it('ignores malformed nested config and keeps the enclosing Git root', async () => {
    const root = await createTemporaryProject();
    const nested = path.join(root, 'packages', 'app', 'src');
    await fs.mkdir(path.join(root, '.git'));
    await fs.mkdir(path.join(root, 'packages', 'app', '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'packages', 'app', '.comet', 'config.yaml'),
      'schema: [broken\n',
    );
    await fs.mkdir(nested, { recursive: true });

    await expect(discoverDashboardProjectRoot(nested)).resolves.toBe(root);
  });
});
