import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCometEntry } from '../../../domains/comet-entry/resolve-entry.js';
import { resolveOrActivateCometEntry } from '../../../domains/comet-entry/project-activation.js';
import { writeWorkflowGlobalConfig } from '../../../domains/workflow-contract/global-config.js';
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

  it('does not guess a Classic workflow when project config is absent', async () => {
    const before = await fs.readdir(projectRoot);

    await expect(resolveCometEntry(projectRoot)).rejects.toThrow(
      'Comet workflow entry is unavailable',
    );

    expect(await fs.readdir(projectRoot)).toEqual(before);
    await expect(fs.access(path.join(projectRoot, '.comet', 'config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('activates an unconfigured project from the global workflow template', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-global-home-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
    const globalConfig = defaultProjectConfig('artifacts', 'zh-CN');
    globalConfig.workflows = ['native'];
    await writeWorkflowGlobalConfig(homeDir, {
      ...globalConfig,
      schema: 'comet.global.v1',
    });

    try {
      await expect(resolveOrActivateCometEntry(projectRoot, { homeDir })).resolves.toEqual({
        workflow: 'native',
        skill: 'comet-native',
        source: 'global-config',
      });

      await expect(
        fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
      ).resolves.toContain('artifact_root: artifacts');
      await expect(
        fs.access(path.join(projectRoot, 'artifacts', 'comet', 'changes')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(homeDir, 'artifacts', 'comet', 'changes')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  });

  it('keeps an activated project stable after the global template changes', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-global-home-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
    const initial = defaultProjectConfig('docs');
    await writeWorkflowGlobalConfig(homeDir, { ...initial, schema: 'comet.global.v1' });

    try {
      await resolveOrActivateCometEntry(projectRoot, { homeDir });
      const changed = defaultProjectConfig('other-root');
      changed.default_workflow = 'classic';
      changed.workflows = ['classic'];
      await writeWorkflowGlobalConfig(homeDir, {
        ...changed,
        schema: 'comet.global.v1',
      });

      await expect(resolveOrActivateCometEntry(projectRoot, { homeDir })).resolves.toEqual({
        workflow: 'native',
        skill: 'comet-native',
        source: 'project-config',
      });
      await expect(
        fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
      ).resolves.toContain('artifact_root: docs');
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  });

  it('uses a built-in Native default when no global template exists', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-empty-home-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
    try {
      await expect(resolveOrActivateCometEntry(projectRoot, { homeDir })).resolves.toEqual({
        workflow: 'native',
        skill: 'comet-native',
        source: 'built-in-default',
      });
      await expect(
        fs.access(path.join(projectRoot, 'docs', 'comet', 'changes')),
      ).resolves.toBeUndefined();
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  });

  it('fails closed on malformed global config without activating the project', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-broken-home-'));
    await fs.mkdir(path.join(homeDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(homeDir, '.comet', 'config.yaml'), 'schema: [\n', 'utf8');
    try {
      await expect(resolveOrActivateCometEntry(projectRoot, { homeDir })).rejects.toThrow(
        'Invalid global Comet config',
      );
      await expect(
        fs.access(path.join(projectRoot, '.comet', 'config.yaml')),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true });
    }
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

  it('fails closed for malformed YAML instead of using the Classic fallback', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'));
    await fs.writeFile(path.join(projectRoot, '.comet', 'config.yaml'), 'schema: [', 'utf8');

    await expect(resolveCometEntry(projectRoot)).rejects.toThrow();
  });

  it('accepts unknown extension fields without changing workflow ownership', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'));
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: .',
        '  unexpected: true',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(resolveCometEntry(projectRoot)).resolves.toMatchObject({
      workflow: 'native',
      source: 'project-config',
    });
  });
});
