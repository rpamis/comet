import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { vi } from 'vitest';
import {
  assertProjectConfigDocumentValid,
  builtinCometFivePhaseWorkflow,
  builtinCometNativeWorkflow,
  defaultWorkflowProjectConfig,
  hashWorkflowProtocol,
  normalizeClassicArtifactLayout,
  parseWorkflowProjectConfigDocument,
  readWorkflowProjectConfigIdentity,
  normalizeWorkflowArtifactRoot,
  normalizeWorkflowDefinition,
  normalizeWorkflowRelativePath,
  inspectProtectedProjectPath,
  validateWorkflowDefinition,
  workflowProjectConfigRuntimeHelperScript,
  inspectWorkflowProjectConfigTransaction,
  repairWorkflowProjectConfigTransaction,
} from '../../../domains/workflow-contract/index.js';
import {
  writeWorkflowProjectConfig,
  writeWorkflowProjectConfigSource,
} from '../../../domains/workflow-contract/project-config-writer.js';

describe('workflow contract normalization', () => {
  it('keeps generated project-file reads bounded and rejects a post-inspection symlink swap', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-generated-config-race-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-generated-config-outside-'));
    const configPath = path.join(projectRoot, '.comet', 'config.yaml');
    const outsideConfig = path.join(outsideRoot, 'config.yaml');
    const helperModule = path.join(projectRoot, 'helper.mjs');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, 'schema: comet.project.v1\n', 'utf8');
    await fs.writeFile(outsideConfig, `secret: ${'x'.repeat(128 * 1024)}\n`, 'utf8');
    const linkProbe = path.join(projectRoot, 'link-probe');
    try {
      await fs.symlink(outsideConfig, linkProbe, 'file');
      await fs.rm(linkProbe);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        await fs.rm(projectRoot, { recursive: true, force: true });
        await fs.rm(outsideRoot, { recursive: true, force: true });
        return;
      }
      throw error;
    }
    await fs.writeFile(
      helperModule,
      [
        "import { constants as fsConstants, promises as fs } from 'fs';",
        "import path from 'path';",
        workflowProjectConfigRuntimeHelperScript(),
        'export { readWorkflowProtectedFile };',
        '',
      ].join('\n'),
      'utf8',
    );

    try {
      const runtime = (await import(`${pathToFileURL(helperModule).href}?race=${Date.now()}`)) as {
        readWorkflowProtectedFile: (
          projectRoot: string,
          file: string,
          label: string,
          maxBytes: number,
          hooks: { afterLstat: () => Promise<void> },
        ) => Promise<Buffer>;
      };
      const result = runtime.readWorkflowProtectedFile(
        projectRoot,
        configPath,
        '.comet/config.yaml',
        64 * 1024,
        {
          afterLstat: async () => {
            await fs.rm(configPath);
            await fs.symlink(outsideConfig, configPath, 'file');
          },
        },
      );
      await expect(result).rejects.toThrow(/real file|changed while opening/iu);
      await expect(fs.readFile(outsideConfig, 'utf8')).resolves.toBe(
        `secret: ${'x'.repeat(128 * 1024)}\n`,
      );
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('owns strict project-config parsing while preserving extension data', () => {
    const parsed = parseWorkflowProjectConfigDocument(
      [
        '---',
        'schema: "comet.project.v1"',
        'default_workflow: native',
        'workflows:',
        '  - native',
        '  - classic',
        'ambient_resume: true',
        'native:',
        '  artifact_root: "docs/native" # quoted path',
        '  language: en',
        '  clarification_mode: batch',
        '  snapshot:',
        '    include: ["**/*.ts", "packages/**"]',
        '    exclude:',
        '      - "dist/**"',
        '    max_files: 12000',
        '    max_total_bytes: 268435456',
        '    max_duration_ms: 90000',
        'classic: { artifact_layout: docs, language: zh-CN, review_mode: thorough }',
        'extension:',
        '  owners: [platform, workflow]',
        '  note: "value: with # content"',
        '...',
        '',
      ].join('\n'),
    );

    expect(parsed.config).toMatchObject({
      schema: 'comet.project.v1',
      default_workflow: 'native',
      workflows: ['native', 'classic'],
      native: {
        artifact_root: 'docs/native',
        clarification_mode: 'batch',
        snapshot: {
          include: ['**/*.ts', 'packages/**'],
          exclude: ['dist/**'],
          max_files: 12_000,
          max_duration_ms: 90_000,
        },
      },
      classic: {
        artifact_layout: 'docs',
        language: 'zh-CN',
        review_mode: 'thorough',
      },
    });
    expect(parsed.value.extension).toEqual({
      owners: ['platform', 'workflow'],
      note: 'value: with # content',
    });
  });

  it.each([
    [
      'duplicate keys',
      'schema: comet.project.v1\nschema: comet.project.v1\ndefault_workflow: classic\n',
    ],
    [
      'malformed extension YAML',
      'schema: comet.project.v1\ndefault_workflow: classic\nextension: [unterminated\n',
    ],
    [
      'invalid managed fields',
      'schema: comet.project.v1\ndefault_workflow: classic\nclassic:\n  review_mode: casual\n',
    ],
  ])('fails closed for project config with %s', (_label, source) => {
    expect(() => parseWorkflowProjectConfigDocument(source)).toThrow();
  });

  it('keeps YAML parsing ownership out of project-config consumers', async () => {
    const consumers = [
      'app/commands/resume-probe.ts',
      'domains/comet-native/native-config.ts',
      'domains/comet-classic/classic-layout.ts',
      'domains/comet-classic/classic-project-config.ts',
      'domains/comet-entry/resolve-entry.ts',
      'domains/comet-entry/hook-router.ts',
      'domains/comet-entry/init-workflow.ts',
      'domains/comet-entry/project-status.ts',
      'domains/comet-entry/resume-probe.ts',
      'domains/dashboard/native-collector.ts',
      'domains/skill/platform-install.ts',
    ];
    for (const file of consumers) {
      const source = await fs.readFile(path.resolve(file), 'utf8');
      expect(source, file).not.toMatch(/from ['"]yaml['"]/u);
      expect(source, file).not.toContain('parseDocument(');
    }
    await expect(
      fs.readFile(path.resolve('domains/factory/package.ts'), 'utf8'),
    ).resolves.toContain('workflowProjectConfigRuntimeHelperScript');
  });

  it('normalizes shared project path configuration without allowing root escape', () => {
    expect(normalizeWorkflowArtifactRoot(' docs\\native ')).toBe('docs/native');
    expect(normalizeWorkflowArtifactRoot('.')).toBe('.');
    expect(() => normalizeWorkflowArtifactRoot('../outside')).toThrow(
      'native.artifact_root must stay inside the project root',
    );
    expect(() => normalizeWorkflowArtifactRoot('/outside')).toThrow(
      'native.artifact_root must be a project-relative path',
    );
    expect(() => normalizeWorkflowArtifactRoot('docs//native')).toThrow(
      'native.artifact_root must not contain empty or dot path segments',
    );
    expect(() => normalizeWorkflowArtifactRoot('docs/./native')).toThrow(
      'native.artifact_root must not contain empty or dot path segments',
    );
    expect(() => normalizeWorkflowArtifactRoot('./docs')).toThrow(
      'native.artifact_root must not contain empty or dot path segments',
    );
    expect(() => normalizeWorkflowArtifactRoot('docs/')).toThrow(
      'native.artifact_root must not contain empty or dot path segments',
    );
    expect(normalizeClassicArtifactLayout(undefined)).toBe('docs');
    expect(() => normalizeClassicArtifactLayout('elsewhere')).toThrow(
      'classic.artifact_layout must be legacy or docs',
    );
  });

  it('rejects state and artifact paths that escape their declared workflow base', () => {
    expect(normalizeWorkflowRelativePath('changes/*/tasks.md', 'artifact path', true)).toBe(
      'changes/*/tasks.md',
    );
    expect(() => normalizeWorkflowRelativePath('../state.json', 'workflow-run statePath')).toThrow(
      'workflow-run statePath must stay inside its declared path base',
    );
    expect(() => normalizeWorkflowRelativePath('/outside.md', 'artifact path', true)).toThrow(
      'artifact path must be relative to its declared path base',
    );
  });

  it('rejects protected project paths that traverse or cross a junction', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-protected-path-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-protected-outside-'));
    try {
      await expect(
        inspectProtectedProjectPath(projectRoot, '../outside.md', {
          label: 'artifact',
          expected: 'file',
        }),
      ).rejects.toThrow('must stay inside');

      const link = path.join(projectRoot, 'docs');
      try {
        await fs.symlink(outsideRoot, link, 'junction');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }
      await expect(
        inspectProtectedProjectPath(projectRoot, 'docs/outside.md', {
          label: 'artifact',
          expected: 'file',
        }),
      ).rejects.toThrow('symbolic link or junction');
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not write project config through a linked .comet directory', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-write-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-write-outside-'));
    try {
      try {
        await fs.symlink(
          outsideRoot,
          path.join(projectRoot, '.comet'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(
        writeWorkflowProjectConfig(projectRoot, defaultWorkflowProjectConfig('docs')),
      ).rejects.toThrow(/symbolic link or junction|real directory/iu);
      await expect(fs.access(path.join(outsideRoot, 'config.yaml'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('publishes project config when the project filesystem does not support hard links', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-copy-publish-'));
    const linkSpy = vi
      .spyOn(fs, 'link')
      .mockRejectedValue(Object.assign(new Error('hard links unsupported'), { code: 'ENOTSUP' }));
    try {
      await writeWorkflowProjectConfig(projectRoot, defaultWorkflowProjectConfig('docs'));
      await expect(
        fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
      ).resolves.toContain('default_workflow: native');
    } finally {
      linkSpy.mockRestore();
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not replace a project config file symlink', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-link-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-link-outside-'));
    const outsideConfig = path.join(outsideRoot, 'config.yaml');
    try {
      await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
      await fs.writeFile(outsideConfig, 'keep: true\n', 'utf8');
      try {
        await fs.symlink(outsideConfig, path.join(projectRoot, '.comet', 'config.yaml'), 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(
        writeWorkflowProjectConfig(projectRoot, defaultWorkflowProjectConfig('docs')),
      ).rejects.toThrow(/symbolic link or junction/iu);
      await expect(fs.readFile(outsideConfig, 'utf8')).resolves.toBe('keep: true\n');
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not commit project config through a parent junction replaced after inspection', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-parent-race-'));
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'comet-config-parent-race-outside-'),
    );
    const linkProbe = path.join(projectRoot, 'link-probe');
    try {
      try {
        await fs.symlink(outsideRoot, linkProbe, process.platform === 'win32' ? 'junction' : 'dir');
        await fs.rm(linkProbe, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(
        writeWorkflowProjectConfigSource(
          projectRoot,
          [
            'schema: comet.project.v1',
            'default_workflow: native',
            'workflows: [native]',
            'native:',
            '  artifact_root: docs',
            '',
          ].join('\n'),
          {
            beforeCommit: async () => {
              const managedDirectory = path.join(projectRoot, '.comet');
              const temporaryName = (await fs.readdir(managedDirectory)).find(
                (entry) =>
                  entry.includes('config.yaml.') &&
                  (entry.endsWith('.tmp') || entry.endsWith('.next')),
              );
              expect(temporaryName).toBeDefined();
              await fs.rename(managedDirectory, path.join(projectRoot, '.comet-held'));
              await fs.writeFile(path.join(outsideRoot, 'config.yaml'), 'keep: true\n', 'utf8');
              await fs.writeFile(path.join(outsideRoot, temporaryName!), 'outside-temp\n', 'utf8');
              await fs.symlink(
                outsideRoot,
                managedDirectory,
                process.platform === 'win32' ? 'junction' : 'dir',
              );
            },
          },
        ),
      ).rejects.toThrow(/changed|junction|outside|managed parent/iu);

      await expect(fs.readFile(path.join(outsideRoot, 'config.yaml'), 'utf8')).resolves.toBe(
        'keep: true\n',
      );
      await expect(fs.readdir(outsideRoot)).resolves.toEqual(
        expect.arrayContaining([
          'config.yaml',
          expect.stringMatching(/^\.?config\.yaml\..+\.(?:tmp|next)$/u),
        ]),
      );
    } finally {
      try {
        const managedDirectory = path.join(projectRoot, '.comet');
        if ((await fs.lstat(managedDirectory)).isSymbolicLink()) {
          if (process.platform === 'win32') await fs.rmdir(managedDirectory);
          else await fs.unlink(managedDirectory);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not read project config through a symlink', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-read-link-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-read-outside-'));
    const outsideConfig = path.join(outsideRoot, 'config.yaml');
    try {
      await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
      await fs.writeFile(
        outsideConfig,
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
      try {
        await fs.symlink(outsideConfig, path.join(projectRoot, '.comet', 'config.yaml'), 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(assertProjectConfigDocumentValid(projectRoot)).rejects.toThrow(
        /symbolic link or junction/iu,
      );
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it.each(['existing', 'missing'] as const)(
    'rejects project config drift from an %s initial identity',
    async (initialState) => {
      const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-identity-'));
      try {
        if (initialState === 'existing') {
          await writeWorkflowProjectConfig(
            projectRoot,
            defaultWorkflowProjectConfig('initial-root'),
          );
        }
        const identity = await readWorkflowProjectConfigIdentity(projectRoot);
        await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
        const externalSource = [
          'schema: comet.project.v1',
          'default_workflow: native',
          'workflows: [native]',
          'native:',
          '  artifact_root: external-root',
          'extension: external-change',
          '',
        ].join('\n');
        await fs.writeFile(path.join(projectRoot, '.comet', 'config.yaml'), externalSource, 'utf8');

        await expect(
          writeWorkflowProjectConfig(projectRoot, defaultWorkflowProjectConfig('final-root'), {
            expectedIdentity: identity,
          }),
        ).rejects.toThrow('Project config changed before commit');
        await expect(
          fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
        ).resolves.toBe(externalSource);
      } finally {
        await fs.rm(projectRoot, { recursive: true, force: true });
      }
    },
  );

  it('does not overwrite a successor config published after the expected config is quarantined', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-publish-race-'));
    try {
      await writeWorkflowProjectConfig(projectRoot, defaultWorkflowProjectConfig('initial-root'));
      const identity = await readWorkflowProjectConfigIdentity(projectRoot);
      const configPath = path.join(projectRoot, '.comet', 'config.yaml');
      const successor = [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: successor-root',
        'extension: successor',
        '',
      ].join('\n');

      await expect(
        writeWorkflowProjectConfig(projectRoot, defaultWorkflowProjectConfig('final-root'), {
          expectedIdentity: identity,
          beforePublish: async () => {
            await fs.writeFile(configPath, successor, { encoding: 'utf8', flag: 'wx' });
          },
        }),
      ).rejects.toThrow(/successor was preserved/iu);

      await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(successor);
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('recovers the previous config after a process exits with it quarantined', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-crash-recovery-'));
    try {
      await writeWorkflowProjectConfig(projectRoot, defaultWorkflowProjectConfig('before-crash'));
      const previous = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8');
      const worker = path.resolve('test/helpers/project-config-crash-worker.mjs');

      const crashed = spawnSync(process.execPath, [worker, projectRoot], {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        timeout: 30_000,
      });

      expect(crashed.status, crashed.stderr).toBe(73);
      await expect(
        fs.access(path.join(projectRoot, '.comet', 'config.yaml')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(inspectWorkflowProjectConfigTransaction(projectRoot)).resolves.toMatchObject({
        stage: 'config-quarantined',
        allowedRepair: 'rollback-or-cleanup',
      });

      await expect(repairWorkflowProjectConfigTransaction(projectRoot)).resolves.toBe(true);
      await expect(
        fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
      ).resolves.toBe(previous);
      await expect(inspectWorkflowProjectConfigTransaction(projectRoot)).resolves.toBeNull();
      expect(
        (await fs.readdir(path.join(projectRoot, '.comet'))).filter(
          (entry) => entry.endsWith('.next') || entry.endsWith('.quarantine'),
        ),
      ).toEqual([]);
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not unlink a same-path successor published while an owned transaction file is cleaned', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-config-cleanup-race-'));
    try {
      await writeWorkflowProjectConfig(
        projectRoot,
        defaultWorkflowProjectConfig('before-cleanup-race'),
      );
      const worker = path.resolve('test/helpers/project-config-crash-worker.mjs');
      const crashed = spawnSync(process.execPath, [worker, projectRoot], {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(crashed.status, crashed.stderr).toBe(73);
      const transaction = await inspectWorkflowProjectConfigTransaction(projectRoot);
      expect(transaction).not.toBeNull();
      const successor = 'successor candidate must be preserved\n';

      await repairWorkflowProjectConfigTransaction(projectRoot, {
        testHooks: {
          afterOwnedFileQuarantine: async (relativePath) => {
            if (relativePath !== transaction!.candidate) return;
            await fs.writeFile(path.join(projectRoot, ...relativePath.split('/')), successor, {
              encoding: 'utf8',
              flag: 'wx',
            });
          },
        },
      });

      await expect(
        fs.readFile(path.join(projectRoot, ...transaction!.candidate.split('/')), 'utf8'),
      ).resolves.toBe(successor);
      await expect(inspectWorkflowProjectConfigTransaction(projectRoot)).resolves.toBeNull();
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('normalizes the self-contained Native workflow without external Skill calls', () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometNativeWorkflow({
        name: 'native-product-change',
        goal: 'Ship through the lightweight Native workflow.',
      }),
    );

    expect(workflow.protocol.kind).toBe('comet-native');
    expect(workflow.protocol.nodes.map((node) => node.id)).toEqual([
      'shape',
      'build',
      'verify',
      'archive',
    ]);
    expect(
      workflow.protocol.nodes.every((node) => node.implementation.skill === 'comet-native'),
    ).toBe(true);
    expect(workflow.protocol.nodes.every((node) => node.requiredSkillCalls.length === 0)).toBe(
      true,
    );
    expect(workflow.protocol.nodes.every((node) => node.augmentations.length === 0)).toBe(true);
    expect(workflow.requiredSkills).toEqual(['comet-native']);
    expect(workflow.protocol.outputSchemas.map((schema) => schema.id)).toEqual([
      'comet.native.brief.v1',
      'comet.native.spec-change.v1',
      'comet.native.implementation.v1',
      'comet.native.verify.v1',
      'comet.native.archive.v1',
    ]);
    expect(workflow.protocol.state).toEqual({
      kind: 'native-change',
      statePath: 'changes/*/comet-state.yaml',
      pathBase: 'native-root',
      currentNodeField: 'phase',
      completedNodesField: 'runtime.completedNodes',
      evidenceField: 'runtime.trajectory',
    });
  });

  it('normalizes the Comet five-phase template into Nodes with Output Schemas', () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'team-comet',
        goal: 'Use the project component library in Comet execution.',
      }),
    );

    expect(workflow.protocol.schemaVersion).toBe(1);
    expect(workflow.protocol.kind).toBe('comet-five-phase-overlay');
    expect(workflow.protocol.nodes.map((node) => node.id)).toEqual([
      'open',
      'design',
      'plan',
      'execute',
      'subagent-execute',
      'review',
      'verify',
      'archive',
    ]);
    expect(workflow.protocol.nodes.find((node) => node.id === 'open')).toMatchObject({
      kind: 'control',
      responsibility: expect.stringContaining('Intake'),
      operations: ['require', 'augment'],
      outputSchemas: ['comet.intake.v1'],
    });
    expect(workflow.protocol.nodes.find((node) => node.id === 'plan')).toMatchObject({
      kind: 'producer',
      responsibility: expect.stringContaining('implementation plan'),
      operations: ['require', 'augment', 'override'],
      outputSchemas: ['comet.plan.v1'],
    });
    expect(workflow.protocol.outputSchemas.map((schema) => schema.id)).toEqual(
      expect.arrayContaining(['comet.plan.v1', 'comet.handoff.v1', 'comet.review.v1']),
    );
    expect(workflow.protocol.state).toEqual({
      kind: 'comet-overlay',
      statePath: 'changes/*/.comet.yaml',
      pathBase: 'classic-openspec-root',
      currentNodeField: 'phase',
      completedNodesField: 'completedNodes',
      evidenceField: 'evidence',
    });
  });

  it('allows required Skill calls without replacing Node implementations', () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'team-comet',
        goal: 'Require project Skills during execution.',
      }),
      nodes: {
        execute: {
          requiredSkillCalls: [
            {
              skill: 'elementui',
              reason: 'Use project component library during direct implementation.',
            },
          ],
        },
        'subagent-execute': {
          requiredSkillCalls: [{ skill: 'elementui', scope: 'handoff' }],
        },
        review: {
          requiredSkillCalls: [{ skill: 'whitebox-code-standard' }],
        },
      },
    });

    expect(workflow.protocol.nodes.find((node) => node.id === 'execute')).toMatchObject({
      implementation: { skill: 'comet-build', operation: 'default' },
      requiredSkillCalls: [expect.objectContaining({ skill: 'elementui', operation: 'require' })],
    });
    expect(workflow.requiredSkills).toEqual(
      expect.arrayContaining(['elementui', 'whitebox-code-standard']),
    );
  });

  it('normalizes Required Skill Call and augmentation enforcement levels', () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'enforced-comet',
        goal: 'Require and augment a Comet Node.',
      }),
      nodes: {
        execute: {
          requiredSkillCalls: [{ skill: 'elementui' }],
          augmentations: [{ skill: 'grill-me', enforcement: 'guarded' }],
        },
        'subagent-execute': {
          augmentations: [{ skill: 'grill-me', scope: 'handoff' }],
        },
      },
    });

    expect(workflow.protocol.nodes.find((node) => node.id === 'execute')).toMatchObject({
      requiredSkillCalls: [expect.objectContaining({ skill: 'elementui', enforcement: 'guarded' })],
      augmentations: [expect.objectContaining({ skill: 'grill-me', enforcement: 'guarded' })],
    });
    expect(workflow.protocol.nodes.find((node) => node.id === 'subagent-execute')).toMatchObject({
      augmentations: [
        expect.objectContaining({ skill: 'grill-me', enforcement: 'handoff-guarded' }),
      ],
    });
  });

  it('attaches custom Output Schemas through Node patches', () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'comet-grill-me',
        goal: 'Use grill-me during design, planning, and review.',
      }),
      nodes: {
        design: { outputSchemas: ['comet.grill-me.v1'] },
        plan: { outputSchemas: ['comet.grill-me.v1'] },
        review: { outputSchemas: ['comet.grill-me.v1'] },
      },
      outputSchemas: [
        {
          id: 'comet.grill-me.v1',
          description: 'Grill-me critique evidence.',
          artifacts: [],
          evidence: [{ id: 'grill-summary', required: true }],
        },
      ],
    });

    expect(workflow.protocol.nodes.find((node) => node.id === 'design')?.outputSchemas).toEqual([
      'comet.design.v1',
      'comet.grill-me.v1',
    ]);
    expect(workflow.protocol.evals[0]?.requiredOutputSchemas).toEqual(
      expect.arrayContaining(['comet.grill-me.v1']),
    );
  });

  it('reports custom Output Schemas that are defined but not attached to any Node', () => {
    const result = validateWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'orphan-schema',
        goal: 'Define but do not attach a schema.',
      }),
      outputSchemas: [
        {
          id: 'orphan.schema.v1',
          description: 'Unused schema.',
          artifacts: [],
          evidence: [{ id: 'summary', required: true }],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'orphan-output-schema',
          message: expect.stringContaining('orphan.schema.v1'),
        }),
      ]),
    );
  });

  it('rejects patch Output Schemas that are not defined', () => {
    const result = validateWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'missing-patch-schema',
        goal: 'Attach a missing schema.',
      }),
      nodes: {
        plan: { outputSchemas: ['missing.schema.v1'] },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-output-schema',
          nodeId: 'plan',
          message: expect.stringContaining('missing.schema.v1'),
        }),
      ]),
    );
  });

  it('rejects ordinary override of Comet control Nodes', () => {
    expect(() =>
      normalizeWorkflowDefinition({
        ...builtinCometFivePhaseWorkflow({
          name: 'unsafe-comet',
          goal: 'Replace execution.',
        }),
        nodes: {
          execute: {
            implementation: { skill: 'custom-executor', operation: 'override' },
            satisfies: ['comet.execution-evidence.v1'],
          },
        },
      }),
    ).toThrow(/execute.*control.*override/iu);
  });

  it('rejects producer override without a satisfied Output Schema', () => {
    expect(() =>
      normalizeWorkflowDefinition({
        ...builtinCometFivePhaseWorkflow({
          name: 'team-comet',
          goal: 'Replace planning.',
        }),
        nodes: {
          plan: {
            implementation: { skill: 'team-planning', operation: 'override' },
          },
        },
      }),
    ).toThrow(/plan.*Output Schema/iu);
  });

  it('accepts producer override when it satisfies the Node Output Schema', () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'team-comet',
        goal: 'Replace planning.',
      }),
      nodes: {
        plan: {
          implementation: { skill: 'team-planning', operation: 'override' },
          satisfies: ['comet.plan.v1'],
        },
      },
    });

    expect(workflow.protocol.nodes.find((node) => node.id === 'plan')).toMatchObject({
      implementation: { skill: 'team-planning', operation: 'override' },
    });
  });

  it('preserves required Skill calls declared by custom Workflow Nodes', () => {
    const workflow = normalizeWorkflowDefinition({
      kind: 'workflow-kernel',
      name: 'release-handoff',
      goal: 'Profile a change, delegate release notes, and run security review.',
      customNodes: [
        {
          id: 'delegate-notes',
          label: 'Delegate Notes',
          kind: 'handoff',
          responsibility: 'Delegate release note drafting and require returned evidence.',
          implementation: { skill: 'handoff-coordinator', operation: 'default', scope: 'handoff' },
          requiredSkillCalls: [
            {
              skill: 'release-notes',
              scope: 'handoff',
              reason: 'The delegated agent must write release notes.',
            },
          ],
          operations: ['require', 'augment'],
          outputSchemas: ['release.notes.v1'],
          guardrails: [
            { id: 'handoff-returned', label: 'Handoff returned evidence', validation: 'semantic' },
          ],
        },
      ],
      outputSchemas: [
        {
          id: 'release.notes.v1',
          description: 'Release note handoff result.',
          artifacts: [],
          evidence: [{ id: 'summary', required: true }],
        },
      ],
    });

    expect(workflow.protocol.nodes.find((node) => node.id === 'delegate-notes')).toMatchObject({
      responsibility: expect.stringContaining('Delegate'),
      requiredSkillCalls: [
        expect.objectContaining({
          skill: 'release-notes',
          operation: 'require',
          scope: 'handoff',
        }),
      ],
    });
    expect(workflow.requiredSkills).toEqual(
      expect.arrayContaining(['handoff-coordinator', 'release-notes']),
    );
  });

  it('hashes protocols deterministically', () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({ name: 'hashable-comet', goal: 'Hash protocol.' }),
    );

    expect(hashWorkflowProtocol(workflow.protocol)).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashWorkflowProtocol(workflow.protocol)).toBe(hashWorkflowProtocol(workflow.protocol));
  });

  it('returns validation findings for advanced callers', () => {
    const result = validateWorkflowDefinition({
      kind: 'comet-five-phase-overlay',
      name: 'bad-comet',
      goal: 'Bad override.',
      nodes: {
        archive: {
          implementation: { skill: 'skip-archive', operation: 'override' },
          satisfies: ['comet.archive.v1'],
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('control-node-override');
  });
});
