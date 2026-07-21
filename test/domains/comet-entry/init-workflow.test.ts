import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveInitWorkflow } from '../../../domains/comet-entry/init-workflow.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

describe('Comet init workflow policy', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-init-workflow-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('defaults a project with no Comet history to Native without writing during resolution', async () => {
    const before = await fs.readdir(projectRoot);

    await expect(resolveInitWorkflow(projectRoot)).resolves.toEqual({
      workflow: 'native',
      source: 'new-project-default',
      artifactRoot: 'docs',
      writeProjectConfig: true,
      legacyEvidence: [],
    });

    expect(await fs.readdir(projectRoot)).toEqual(before);
  });

  it.each([
    '.comet/config.yaml',
    'openspec/changes/active-change/.comet.yaml',
    'openspec/changes/archive/old-change/.comet.yaml',
  ])('preserves the Classic fallback when legacy evidence exists at %s', async (legacyPath) => {
    const file = path.join(projectRoot, ...legacyPath.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'workflow: full\n', 'utf8');

    await expect(resolveInitWorkflow(projectRoot)).resolves.toMatchObject({
      workflow: 'classic',
      source: 'legacy-project',
      writeProjectConfig: false,
      legacyEvidence: [legacyPath],
    });
  });

  it.each(['openspec', 'docs/superpowers'])(
    'does not mistake standalone %s usage for an existing Comet Classic project',
    async (standalonePath) => {
      await fs.mkdir(path.join(projectRoot, ...standalonePath.split('/')), { recursive: true });

      await expect(resolveInitWorkflow(projectRoot)).resolves.toMatchObject({
        workflow: 'native',
        source: 'new-project-default',
        writeProjectConfig: true,
        legacyEvidence: [],
      });
    },
  );

  it('treats a managed Ambient Resume block as legacy Comet evidence', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'AGENTS.md'),
      '<comet-ambient-resume>\nold guidance\n</comet-ambient-resume>\n',
      'utf8',
    );

    await expect(resolveInitWorkflow(projectRoot)).resolves.toMatchObject({
      workflow: 'classic',
      source: 'legacy-project',
      legacyEvidence: ['AGENTS.md#comet-ambient-resume'],
    });
  });

  it('does not mistake the workflow-neutral v2 resume block for Classic state', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'AGENTS.md'),
      [
        '<comet-ambient-resume>',
        '<!-- Contract: comet.resume_probe.v2 -->',
        '</comet-ambient-resume>',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(resolveInitWorkflow(projectRoot)).resolves.toMatchObject({
      workflow: 'native',
      source: 'new-project-default',
      legacyEvidence: [],
    });
  });

  it('lets an explicit Native choice override legacy fallback and select a custom root', async () => {
    const state = path.join(projectRoot, 'openspec', 'changes', 'legacy', '.comet.yaml');
    await fs.mkdir(path.dirname(state), { recursive: true });
    await fs.writeFile(state, 'workflow: full\n', 'utf8');

    await expect(
      resolveInitWorkflow(projectRoot, { workflow: 'native', artifactRoot: 'docs' }),
    ).resolves.toMatchObject({
      workflow: 'native',
      source: 'explicit-option',
      artifactRoot: 'docs',
      writeProjectConfig: true,
      legacyEvidence: ['openspec/changes/legacy/.comet.yaml'],
    });
  });

  it('treats an explicit Native root as an explicit Native choice', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'));
    await fs.writeFile(path.join(projectRoot, '.comet', 'config.yaml'), 'language: en\n', 'utf8');

    await expect(resolveInitWorkflow(projectRoot, { artifactRoot: 'docs' })).resolves.toMatchObject(
      {
        workflow: 'native',
        source: 'explicit-option',
        artifactRoot: 'docs',
        writeProjectConfig: true,
      },
    );
  });

  it('persists an explicit Classic choice for a new project', async () => {
    await expect(resolveInitWorkflow(projectRoot, { workflow: 'classic' })).resolves.toEqual({
      workflow: 'classic',
      source: 'explicit-option',
      artifactRoot: 'docs',
      writeProjectConfig: true,
      legacyEvidence: [],
    });
  });

  it.each(['native', 'classic'] as const)(
    'keeps an existing %s project config authoritative',
    async (workflow) => {
      const config = defaultProjectConfig('docs');
      config.default_workflow = workflow;
      await writeProjectConfig(projectRoot, config);

      await expect(resolveInitWorkflow(projectRoot)).resolves.toEqual({
        workflow,
        source: 'project-config',
        artifactRoot: 'docs',
        writeProjectConfig: false,
        legacyEvidence: [],
      });
    },
  );

  it('lets an explicit workflow change only the configured default entry', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));

    await expect(resolveInitWorkflow(projectRoot, { workflow: 'classic' })).resolves.toEqual({
      workflow: 'classic',
      source: 'explicit-option',
      artifactRoot: '.',
      writeProjectConfig: true,
      legacyEvidence: [],
    });
  });

  it('fails closed when an explicit root conflicts with project config', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));

    await expect(resolveInitWorkflow(projectRoot, { artifactRoot: 'artifacts' })).rejects.toThrow(
      /configured Native artifact root is docs/u,
    );
  });

  it('rejects a Native artifact root for an explicitly Classic initialization', async () => {
    await expect(
      resolveInitWorkflow(projectRoot, { workflow: 'classic', artifactRoot: 'docs' }),
    ).rejects.toThrow(/--root is only valid with the Native workflow/u);
  });
});
