import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCometEntry } from '../../../domains/comet-entry/resolve-entry.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

describe('Comet entry resolution', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-entry-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('uses the read-only Classic fallback when project config is absent', async () => {
    const before = await fs.readdir(projectRoot);

    await expect(resolveCometEntry(projectRoot)).resolves.toEqual({
      workflow: 'classic',
      skill: 'comet-classic',
      source: 'legacy-fallback',
    });

    expect(await fs.readdir(projectRoot)).toEqual(before);
    await expect(fs.access(path.join(projectRoot, '.comet', 'config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    ['native', 'comet-native'],
    ['classic', 'comet-classic'],
  ] as const)('obeys an explicit %s project default', async (workflow, skill) => {
    const config = defaultProjectConfig('docs');
    config.default_workflow = workflow;
    await writeProjectConfig(projectRoot, config);
    const before = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'));

    await expect(resolveCometEntry(projectRoot)).resolves.toEqual({
      workflow,
      skill,
      source: 'project-config',
    });

    await expect(fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'))).resolves.toEqual(
      before,
    );
  });

  it('discovers the configured project when resolution starts in a nested directory', async () => {
    const nested = path.join(projectRoot, 'packages', 'app', 'src');
    await fs.mkdir(nested, { recursive: true });
    await fs.mkdir(path.join(projectRoot, '.git'));
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));

    await expect(resolveCometEntry(nested)).resolves.toMatchObject({
      workflow: 'native',
      skill: 'comet-native',
      source: 'project-config',
    });
  });

  it.each([
    ['malformed YAML', 'schema: ['],
    [
      'unknown fields',
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: .',
        '  unexpected: true',
        '',
      ].join('\n'),
    ],
  ])('fails closed for %s instead of using the Classic fallback', async (_label, source) => {
    await fs.mkdir(path.join(projectRoot, '.comet'));
    await fs.writeFile(path.join(projectRoot, '.comet', 'config.yaml'), source, 'utf8');

    await expect(resolveCometEntry(projectRoot)).rejects.toThrow();
  });
});
