import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectDashboardProjectConfigSettings,
  DashboardProjectConfigError,
  updateDashboardProjectConfigSettings,
} from '../../../domains/dashboard/project-config-settings.js';
import {
  defaultWorkflowProjectConfig,
  mergeWorkflowProjectConfigDocument,
  parseWorkflowProjectConfigDocument,
  renderStructuredProjectConfig,
} from '../../../domains/workflow-contract/project-config.js';

describe('Dashboard project config settings', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-config-'));
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    const config = defaultWorkflowProjectConfig('docs', 'zh-CN');
    config.workflows = ['native', 'classic'];
    config.classic = {
      artifact_layout: 'docs',
      language: 'zh-CN',
      context_compression: 'beta',
      review_mode: 'standard',
      auto_transition: true,
    };
    const source = renderStructuredProjectConfig(
      mergeWorkflowProjectConfigDocument({ extension: { keep: true } }, config),
      'zh-CN',
    );
    await fs.writeFile(path.join(projectRoot, '.comet', 'config.yaml'), source, 'utf8');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('loads a structured view and saves managed values without dropping unknown fields', async () => {
    const loaded = await collectDashboardProjectConfigSettings(projectRoot);
    expect(loaded).toMatchObject({
      path: '.comet/config.yaml',
      schema: 'comet.project.v1',
      defaultWorkflow: 'native',
      workflows: ['native', 'classic'],
      native: { artifactRoot: 'docs', language: 'zh-CN' },
      classic: { reviewMode: 'standard', autoTransition: true },
    });

    const saved = await updateDashboardProjectConfigSettings(projectRoot, {
      expectedRevision: loaded.revision,
      config: {
        defaultWorkflow: 'classic',
        workflows: ['native', 'classic'],
        ambientResume: false,
        hookAllowPaths: ['docs/generated'],
        native: {
          ...loaded.native,
          clarificationMode: 'sequential',
          archiveConfirmation: 'required',
          maxVerifyFailures: 7,
        },
        classic: {
          ...loaded.classic,
          contextCompression: 'off',
          reviewMode: 'thorough',
          autoTransition: false,
        },
      },
    });

    expect(saved.revision).not.toBe(loaded.revision);
    expect(saved).toMatchObject({
      defaultWorkflow: 'classic',
      ambientResume: false,
      hookAllowPaths: ['docs/generated'],
      native: {
        clarificationMode: 'sequential',
        archiveConfirmation: 'required',
        maxVerifyFailures: 7,
      },
      classic: {
        contextCompression: 'off',
        reviewMode: 'thorough',
        autoTransition: false,
      },
    });
    const written = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8');
    const document = parseWorkflowProjectConfigDocument(written);
    expect(document.value.extension).toEqual({ keep: true });
    expect(written).toContain('# Comet 使用的配置格式版本，请勿修改此值。');
  });

  it('rejects a stale settings revision instead of overwriting a newer config', async () => {
    const loaded = await collectDashboardProjectConfigSettings(projectRoot);
    await fs.appendFile(path.join(projectRoot, '.comet', 'config.yaml'), '# external edit\n');

    const update = updateDashboardProjectConfigSettings(projectRoot, {
      expectedRevision: loaded.revision,
      config: {
        defaultWorkflow: loaded.defaultWorkflow,
        workflows: loaded.workflows,
        ambientResume: loaded.ambientResume,
        hookAllowPaths: loaded.hookAllowPaths,
        native: loaded.native,
        classic: loaded.classic,
      },
    });
    await expect(update).rejects.toMatchObject<Partial<DashboardProjectConfigError>>({
      statusCode: 409,
    });
  });

  it('loads and saves additional local knowledge include patterns', async () => {
    const current = parseWorkflowProjectConfigDocument(
      await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
    ).config!;
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      renderStructuredProjectConfig(
        mergeWorkflowProjectConfigDocument(
          {},
          {
            ...current,
            knowledge: {
              provider: 'local',
              local: { include: ['docs/**/*.md'] },
            },
          },
        ),
        'zh-CN',
      ),
      'utf8',
    );

    const loaded = await collectDashboardProjectConfigSettings(projectRoot);
    expect(loaded.knowledge).toEqual({ provider: 'local', localInclude: ['docs/**/*.md'] });

    const saved = await updateDashboardProjectConfigSettings(projectRoot, {
      expectedRevision: loaded.revision,
      config: {
        defaultWorkflow: loaded.defaultWorkflow,
        workflows: loaded.workflows,
        ambientResume: loaded.ambientResume,
        hookAllowPaths: loaded.hookAllowPaths,
        knowledge: {
          provider: 'local',
          localInclude: ['docs/architecture/**/*.md', 'packages/*/README.md'],
        },
        native: loaded.native,
        classic: loaded.classic,
      },
    });

    expect(saved.knowledge).toEqual({
      provider: 'local',
      localInclude: ['docs/architecture/**/*.md', 'packages/*/README.md'],
    });
    expect(
      parseWorkflowProjectConfigDocument(
        await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
      ).config?.knowledge,
    ).toEqual({
      provider: 'local',
      local: { include: ['docs/architecture/**/*.md', 'packages/*/README.md'] },
    });
  });
});
