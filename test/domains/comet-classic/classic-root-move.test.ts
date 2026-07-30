import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  applyClassicRootMove,
  inspectClassicRootMove,
  planClassicRootMove,
  repairClassicRootMove,
} from '../../../domains/comet-classic/classic-root-move.js';
import { formatClassicRootMoveReport } from '../../../domains/comet-classic/classic-root-command.js';
import {
  assertClassicLayoutWritable,
  writeClassicArtifactLayout,
} from '../../../domains/comet-classic/classic-layout.js';
import {
  defaultProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  parseWorkflowProjectConfigDocument,
  renderStructuredProjectConfig,
} from '../../../domains/workflow-contract/project-config.js';

describe('Classic root move', () => {
  let projectRoot: string;
  const externalRoots: string[] = [];
  const transactionId = '11111111-1111-4111-8111-111111111111';

  function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  async function applyPlannedRootMove(
    options: NonNullable<Parameters<typeof applyClassicRootMove>[1]> = {},
  ) {
    const plan = await planClassicRootMove(projectRoot);
    return applyClassicRootMove(projectRoot, {
      ...options,
      planId: plan.planId,
    } as Parameters<typeof applyClassicRootMove>[1]);
  }

  async function sourceManifest() {
    const content = await fs.readFile(
      path.join(projectRoot, 'openspec', 'specs', 'demo', 'spec.md'),
    );
    const manifest = {
      directories: ['changes', 'changes/archive', 'specs', 'specs/demo'],
      files: [
        {
          path: 'specs/demo/spec.md',
          size: content.byteLength,
          hash: digest(content.toString()),
        },
      ],
      totalBytes: content.byteLength,
    };
    return { ...manifest, hash: digest(JSON.stringify(manifest)) };
  }

  async function writeJournal(
    stage: 'locked' | 'copying' | 'ready' | 'switched' | 'configured',
    overrides: Record<string, unknown> = {},
  ) {
    const manifest =
      (overrides.manifest as Awaited<ReturnType<typeof sourceManifest>>) ??
      (await sourceManifest());
    const planned = await planClassicRootMove(projectRoot);
    const configPath = String(overrides.configPath ?? '.comet/config.yaml');
    const originalConfigHash = String(overrides.originalConfigHash ?? planned.configHash);
    const expectedConfigHash = String(overrides.expectedConfigHash ?? planned.expectedConfigHash);
    const source = String(overrides.source ?? 'openspec');
    const target = String(overrides.target ?? 'docs/openspec');
    const staging = String(
      overrides.staging ?? `.comet/transactions/classic-root-move/${transactionId}/openspec`,
    );
    const targetInitialState = String(overrides.targetInitialState ?? 'missing');
    const artifactLayout = String(overrides.artifactLayout ?? 'legacy');
    const sourceIdentity = overrides.sourceIdentity ?? planned.sourceIdentity;
    const targetInitialIdentity =
      overrides.targetInitialIdentity ??
      (targetInitialState === 'missing'
        ? null
        : (planned.targetInitialIdentity ?? {
            dev: planned.sourceIdentity[1].dev,
            ino: planned.sourceIdentity[1].ino,
            birthtime: planned.sourceIdentity[1].birthtime,
            ctime: '1',
            mtime: '1',
          }));
    const planIdentity = {
      source,
      target,
      staging: '.comet/transactions/classic-root-move/<transaction-id>/openspec',
      artifactLayout,
      sourceIdentity,
      targetInitialIdentity,
      targetInitialState,
      fileCount: manifest.files.length,
      directoryCount: manifest.directories.length,
      totalBytes: manifest.totalBytes,
      manifestHash: manifest.hash,
      configPath,
      originalConfigHash,
      expectedConfigHash,
    };
    const journal = {
      schema: 'comet.classic-root-move.v2',
      id: transactionId,
      stage,
      source,
      target,
      staging,
      artifactLayout,
      sourceIdentity,
      targetInitialIdentity,
      configPath,
      originalConfigHash,
      expectedConfigHash,
      planId: digest(JSON.stringify(planIdentity)),
      approvedPlanId: digest(JSON.stringify(planIdentity)),
      targetInitialState,
      manifest,
      ...overrides,
    };
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'classic-root-move.json'),
      `${JSON.stringify(journal, null, 2)}\n`,
    );
    return journal;
  }

  async function writeLegacyV1Journal(stage: 'copying' | 'ready' | 'switched' | 'configured') {
    const manifest = await sourceManifest();
    const planned = await planClassicRootMove(projectRoot);
    const planIdentity = {
      source: 'openspec',
      target: 'docs/openspec',
      staging: '.comet/transactions/classic-root-move/<transaction-id>/openspec',
      targetInitialState: 'missing',
      fileCount: manifest.files.length,
      directoryCount: manifest.directories.length,
      totalBytes: manifest.totalBytes,
      manifestHash: manifest.hash,
      configPath: '.comet/config.yaml',
      originalConfigHash: planned.configHash,
      expectedConfigHash: planned.expectedConfigHash,
    };
    const journal = {
      schema: 'comet.classic-root-move.v1',
      id: transactionId,
      stage,
      source: 'openspec',
      target: 'docs/openspec',
      staging: `.comet/transactions/classic-root-move/${transactionId}/openspec`,
      configPath: '.comet/config.yaml',
      originalConfigHash: planned.configHash,
      expectedConfigHash: planned.expectedConfigHash,
      planId: digest(JSON.stringify(planIdentity)),
      targetInitialState: 'missing',
      manifest,
    };
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'classic-root-move.json'),
      `${JSON.stringify(journal, null, 2)}\n`,
    );
  }

  async function stageSource(): Promise<void> {
    const staging = path.join(
      projectRoot,
      '.comet',
      'transactions',
      'classic-root-move',
      transactionId,
      'openspec',
    );
    await fs.mkdir(path.dirname(staging), { recursive: true });
    await fs.cp(path.join(projectRoot, 'openspec'), staging, { recursive: true });
  }

  async function externalDirectory(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-root-move-outside-'));
    externalRoots.push(root);
    return root;
  }

  async function directoryLink(target: string, link: string): Promise<void> {
    await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  }

  async function writeArchivedState(
    name: string,
    options: {
      archived?: boolean;
      runStatus?: 'running' | 'waiting' | 'completed' | 'failed';
      pending?: string | null;
      checkpoint?: boolean;
    } = {},
  ): Promise<string> {
    const changeDir = path.join(projectRoot, 'openspec', 'changes', 'archive', name);
    await fs.mkdir(path.join(changeDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, '.comet.yaml'),
      `workflow: full\nphase: archive\narchived: ${options.archived ?? true}\n`,
    );
    if (options.runStatus) {
      const run = {
        runId: `run-${name}`,
        skill: 'comet-classic',
        skillVersion: '1',
        skillHash: 'a'.repeat(64),
        orchestration: 'deterministic',
        currentStep: options.runStatus === 'completed' ? 'completed' : 'full.archive.execute',
        iteration: 1,
        pending: options.pending ?? null,
        pendingRef: '.comet/pending-action.json',
        trajectoryRef: '.comet/trajectory.jsonl',
        contextRef: '.comet/context.json',
        artifactsRef: '.comet/artifacts.json',
        checkpointRef: '.comet/checkpoint.json',
        status: options.runStatus,
        retries: {},
      };
      await fs.writeFile(
        path.join(changeDir, '.comet', 'run-state.json'),
        `${JSON.stringify(run, null, 2)}\n`,
      );
      if (options.checkpoint) {
        await fs.writeFile(
          path.join(changeDir, '.comet', 'checkpoint.json'),
          `${JSON.stringify({
            runId: run.runId,
            stateVersion: 1,
            trajectoryOffset: 0,
            contextHash: null,
            artifactsHash: 'b'.repeat(64),
            createdAt: '2026-07-28T00:00:00.000Z',
          })}\n`,
        );
      }
    }
    return changeDir;
  }

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-root-move-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
    const config = defaultProjectConfig('docs', 'zh-CN');
    config.default_workflow = 'classic';
    config.workflows = ['classic'];
    config.classic = {
      artifact_layout: 'legacy',
      language: 'zh-CN',
      context_compression: 'off',
      review_mode: 'standard',
      auto_transition: true,
    };
    await writeProjectConfig(projectRoot, config);
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectRoot, 'openspec', 'specs', 'demo'), {
      recursive: true,
    });
    await fs.writeFile(path.join(projectRoot, 'openspec', 'specs', 'demo', 'spec.md'), '# Demo\n');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await Promise.all(
      externalRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  it('reports a dry run without modifying files or config', async () => {
    const plan = await planClassicRootMove(projectRoot);

    expect(plan).toMatchObject({
      source: 'openspec',
      target: 'docs/openspec',
      staging: '.comet/transactions/classic-root-move/<transaction-id>/openspec',
      fileCount: 1,
      fileSummary: [
        {
          path: 'specs/demo/spec.md',
          size: 7,
          hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      ],
      configChange: { from: 'legacy', to: 'docs' },
      conflicts: [],
      blockers: [],
      pendingRecovery: null,
      targetInitialState: 'missing',
      readyToApply: true,
      allowedRecoveryStrategies: [],
      planId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      artifactLayout: 'legacy',
      sourceIdentity: [
        {
          path: '.',
          dev: expect.any(String),
          ino: expect.any(String),
          birthtime: expect.any(String),
        },
        {
          path: 'openspec',
          dev: expect.any(String),
          ino: expect.any(String),
          birthtime: expect.any(String),
        },
      ],
      targetInitialIdentity: null,
      configHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      configPath: '.comet/config.yaml',
      expectedConfigHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(plan.historicalPointersPreserved).toEqual(
      expect.arrayContaining(['handoff hashes', 'Run state', 'checkpoints', 'trajectory']),
    );
    expect(plan.applyPreconditions).toEqual(
      expect.arrayContaining([
        'approved plan ID still matches layout, source identity and manifest, target identity, and configuration',
        'no pending root-move recovery transaction',
      ]),
    );
    const report = formatClassicRootMoveReport(plan, 'dry-run');
    expect(report).toContain(`staging: ${plan.staging}`);
    expect(report).toContain('artifact layout: legacy');
    expect(report).toContain('source identity:');
    expect(report).toContain('target initial identity: missing');
    expect(report).toContain(`file: specs/demo/spec.md 7 ${plan.fileSummary[0].hash}`);
    expect(report).toContain('config change: legacy -> docs');
    expect(report).toContain('config path: .comet/config.yaml');
    expect(report).toContain(`original config: ${plan.originalConfigHash}`);
    expect(report).toContain(`expected config: ${plan.expectedConfigHash}`);
    expect(report).toContain('blockers: none');
    const reportWithBlockers = formatClassicRootMoveReport(
      { ...plan, blockers: ['first blocker', 'second blocker'] },
      'dry-run',
    );
    expect(reportWithBlockers).toContain('blockers:\n- first blocker\n- second blocker');
    expect(reportWithBlockers).not.toContain('first blocker; second blocker');
    const chineseReport = formatClassicRootMoveReport(
      {
        ...plan,
        conflicts: ['Classic docs target is not empty'],
        blockers: ['pending Classic root move: transaction-id at locked'],
      },
      'dry-run',
      'zh-CN',
    );
    expect(chineseReport).toContain('冲突:\n- docs 目标目录非空');
    expect(chineseReport).toContain(
      '阻塞项:\n- 存在待恢复的 Classic 根目录迁移：transaction-id，阶段 locked',
    );
    expect(report).toContain('historical pointers preserved:');
    expect(report).toContain('allowed recovery strategies: none');
    expect((await readProjectConfig(projectRoot))?.classic?.artifact_layout).toBe('legacy');
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(projectRoot, 'docs', 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('accepts journals written with the previous locale-aware manifest ordering', async () => {
    const names = ['Z.md', 'a.md'];
    const localeOrdered = [...names].sort((left, right) => left.localeCompare(right));
    const codePointOrdered = [...names].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    expect(localeOrdered).not.toEqual(codePointOrdered);
    for (const name of names) {
      await fs.writeFile(path.join(projectRoot, 'openspec', 'specs', 'demo', name), name);
    }
    const files = await Promise.all(
      ['spec.md', ...localeOrdered]
        .sort((left, right) => left.localeCompare(right))
        .map(async (name) => {
          const content = await fs.readFile(
            path.join(projectRoot, 'openspec', 'specs', 'demo', name),
          );
          return {
            path: `specs/demo/${name}`,
            size: content.byteLength,
            hash: digest(content.toString()),
          };
        }),
    );
    const manifestBody = {
      directories: ['changes', 'changes/archive', 'specs', 'specs/demo'],
      files,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
    };
    const manifest = { ...manifestBody, hash: digest(JSON.stringify(manifestBody)) };
    await writeJournal('locked', { manifest });

    const plan = await planClassicRootMove(projectRoot);

    expect(plan.pendingRecovery).toMatchObject({ stage: 'locked' });
  });

  it('derives and locks the executable plan during apply', async () => {
    const applied = await applyClassicRootMove(projectRoot);
    expect(applied.readyToApply).toBe(true);

    expect((await readProjectConfig(projectRoot))?.classic?.artifact_layout).toBe('docs');
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.stat(path.join(projectRoot, 'docs', 'openspec'))).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectRoot, '.comet', 'classic-root-move.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects source and config drift against the approved dry-run plan', async () => {
    const sourcePlan = await planClassicRootMove(projectRoot);
    await fs.appendFile(path.join(projectRoot, 'openspec', 'specs', 'demo', 'spec.md'), 'drift\n');

    await expect(
      applyClassicRootMove(projectRoot, {
        planId: sourcePlan.planId,
      } as Parameters<typeof applyClassicRootMove>[1]),
    ).rejects.toThrow(/plan changed since dry-run/iu);

    await fs.writeFile(path.join(projectRoot, 'openspec', 'specs', 'demo', 'spec.md'), '# Demo\n');
    const configPlan = await planClassicRootMove(projectRoot);
    await fs.appendFile(path.join(projectRoot, '.comet', 'config.yaml'), '# drift\n');

    await expect(
      applyClassicRootMove(projectRoot, {
        planId: configPlan.planId,
      } as Parameters<typeof applyClassicRootMove>[1]),
    ).rejects.toThrow(/plan changed since dry-run/iu);

    expect((await readProjectConfig(projectRoot))?.classic?.artifact_layout).toBe('legacy');
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(projectRoot, 'docs', 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fs.stat(path.join(projectRoot, '.comet', 'classic-root-move.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a same-content replacement of the source root', async () => {
    const source = path.join(projectRoot, 'openspec');
    const displaced = path.join(projectRoot, 'displaced-openspec');
    const plan = await planClassicRootMove(projectRoot);

    await fs.rename(source, displaced);
    await fs.cp(displaced, source, { recursive: true });
    const replacementPlan = await planClassicRootMove(projectRoot);

    expect(replacementPlan.manifestHash).toBe(plan.manifestHash);
    expect(replacementPlan.sourceIdentity).not.toEqual(plan.sourceIdentity);
    expect(replacementPlan.planId).not.toBe(plan.planId);
    await expect(
      applyClassicRootMove(projectRoot, {
        planId: plan.planId,
      } as Parameters<typeof applyClassicRootMove>[1]),
    ).rejects.toThrow(/plan changed since dry-run/iu);
    await expect(fs.readFile(path.join(source, 'specs', 'demo', 'spec.md'), 'utf8')).resolves.toBe(
      '# Demo\n',
    );
    await expect(
      fs.readFile(path.join(displaced, 'specs', 'demo', 'spec.md'), 'utf8'),
    ).resolves.toBe('# Demo\n');
  });

  it('does not invalidate the plan for an unrelated project-root file', async () => {
    const plan = await planClassicRootMove(projectRoot);
    await fs.writeFile(path.join(projectRoot, 'UNRELATED.txt'), 'keep\n');

    const current = await planClassicRootMove(projectRoot);
    expect(current.planId).toBe(plan.planId);
    await expect(
      applyClassicRootMove(projectRoot, {
        planId: plan.planId,
      }),
    ).resolves.toMatchObject({ planId: plan.planId });
    await expect(fs.readFile(path.join(projectRoot, 'UNRELATED.txt'), 'utf8')).resolves.toBe(
      'keep\n',
    );
  });

  it('does not let a stale apply replace or unlink a successor published after quarantine', async () => {
    const plan = await planClassicRootMove(projectRoot);
    let interleaved = false;
    let releaseSuccessor!: () => void;
    let reportSuccessor!: (id: string) => void;
    const successorRelease = new Promise<void>((resolve) => {
      releaseSuccessor = resolve;
    });
    const successorLocked = new Promise<string>((resolve) => {
      reportSuccessor = resolve;
    });
    let successorApply: Promise<unknown> | undefined;
    let successorPaused = false;

    const staleApply = applyClassicRootMove(projectRoot, {
      planId: plan.planId,
      testHooks: {
        afterJournalQuarantine: async (operation) => {
          if (operation !== 'update-journal-commit' || interleaved) return;
          interleaved = true;
          await expect(
            fs.stat(path.join(projectRoot, '.comet', 'classic-root-move.json')),
          ).rejects.toMatchObject({ code: 'ENOENT' });
          successorApply = applyClassicRootMove(projectRoot, {
            planId: plan.planId,
            testHooks: {
              beforeMutation: async (successorOperation) => {
                if (successorOperation !== 'update-journal-temp' || successorPaused) {
                  return;
                }
                successorPaused = true;
                const successor = JSON.parse(
                  await fs.readFile(
                    path.join(projectRoot, '.comet', 'classic-root-move.json'),
                    'utf8',
                  ),
                ) as { id: string; stage: string };
                expect(successor.stage).toBe('locked');
                reportSuccessor(successor.id);
                await successorRelease;
              },
            },
          });
          await successorLocked;
        },
      },
    });

    await expect(staleApply).rejects.toThrow(
      /EEXIST|already exists|journal ownership changed|publish/iu,
    );
    const successorId = await successorLocked;
    const persisted = JSON.parse(
      await fs.readFile(path.join(projectRoot, '.comet', 'classic-root-move.json'), 'utf8'),
    ) as { id: string; stage: string };
    expect(persisted).toMatchObject({ id: successorId, stage: 'locked' });

    releaseSuccessor();
    await expect(successorApply).resolves.toMatchObject({ planId: plan.planId });
  }, 15_000);

  it('binds the identity of a pre-existing empty target into the plan ID', async () => {
    const target = path.join(projectRoot, 'docs', 'openspec');
    const displaced = path.join(projectRoot, 'docs', 'displaced-openspec');
    await fs.mkdir(target, { recursive: true });
    const plan = await planClassicRootMove(projectRoot);

    expect(plan.targetInitialIdentity).toEqual({
      dev: expect.any(String),
      ino: expect.any(String),
      birthtime: expect.any(String),
      ctime: expect.any(String),
      mtime: expect.any(String),
    });

    await fs.rename(target, displaced);
    await fs.mkdir(target);
    const replacementPlan = await planClassicRootMove(projectRoot);
    expect(replacementPlan.targetInitialIdentity).not.toEqual(plan.targetInitialIdentity);
    expect(replacementPlan.planId).not.toBe(plan.planId);

    await expect(
      applyClassicRootMove(projectRoot, {
        planId: plan.planId,
      } as Parameters<typeof applyClassicRootMove>[1]),
    ).rejects.toThrow(/plan changed since dry-run/iu);
    await expect(fs.readdir(target)).resolves.toEqual([]);
    await expect(fs.readdir(displaced)).resolves.toEqual([]);
  });

  it('moves a quiescent legacy root and switches config last', async () => {
    const plan = await applyPlannedRootMove();

    await expect(
      fs.readFile(path.join(projectRoot, 'docs', 'openspec', 'specs', 'demo', 'spec.md'), 'utf8'),
    ).resolves.toBe('# Demo\n');
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await readProjectConfig(projectRoot))?.classic?.artifact_layout).toBe('docs');
    expect(digest(await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'))).toBe(
      plan.expectedConfigHash,
    );
    await expect(
      fs.stat(path.join(projectRoot, '.comet', 'classic-root-move.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('moves active and incomplete archived changes with the complete OpenSpec tree', async () => {
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'active'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'openspec', 'changes', 'active', 'proposal.md'),
      '# Active\n',
    );
    await writeArchivedState('not-archived', { archived: false });
    await writeArchivedState('running-run', { runStatus: 'running' });

    const plan = await planClassicRootMove(projectRoot);
    expect(plan.blockers).toEqual([]);
    expect(plan.readyToApply).toBe(true);

    await applyClassicRootMove(projectRoot);

    await expect(
      fs.readFile(
        path.join(projectRoot, 'docs', 'openspec', 'changes', 'active', 'proposal.md'),
        'utf8',
      ),
    ).resolves.toBe('# Active\n');
    await expect(
      fs.readFile(
        path.join(
          projectRoot,
          'docs',
          'openspec',
          'changes',
          'archive',
          'not-archived',
          '.comet.yaml',
        ),
        'utf8',
      ),
    ).resolves.toContain('archived: false');
    await expect(
      fs.stat(
        path.join(
          projectRoot,
          'docs',
          'openspec',
          'changes',
          'archive',
          'running-run',
          '.comet',
          'run-state.json',
        ),
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a non-empty docs target without merging roots', async () => {
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'docs', 'openspec', 'foreign.md'), 'keep\n');

    const plan = await planClassicRootMove(projectRoot);
    expect(plan.conflicts).toContain('Classic docs target is not empty');
    expect(plan.readyToApply).toBe(false);
    await expect(applyPlannedRootMove()).rejects.toThrow('Classic docs target is not empty');
    await expect(
      fs.readFile(path.join(projectRoot, 'docs', 'openspec', 'foreign.md'), 'utf8'),
    ).resolves.toBe('keep\n');
  });

  it('binds and consumes a pre-existing empty docs target consistently', async () => {
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });

    const plan = await planClassicRootMove(projectRoot);
    expect(plan.targetInitialState).toBe('empty');
    expect(plan.readyToApply).toBe(true);

    await expect(applyPlannedRootMove()).resolves.toMatchObject({
      targetInitialState: 'empty',
    });
    await expect(
      fs.readFile(path.join(projectRoot, 'docs', 'openspec', 'specs', 'demo', 'spec.md'), 'utf8'),
    ).resolves.toBe('# Demo\n');
  });

  it.each([
    {
      label: 'docs-target',
      target: () => path.join(projectRoot, 'docs', 'openspec'),
      prepare: async () => {
        await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });
      },
    },
  ])(
    'does not enumerate an external directory replacing $label after inspection',
    async ({ label, target, prepare }) => {
      await prepare();
      const outside = await externalDirectory();
      const original = path.join(outside, `original-${label}`);
      const external = path.join(outside, `external-${label}`);
      await fs.mkdir(external);
      await fs.writeFile(path.join(external, 'marker.txt'), 'external marker\n');
      const targetPath = target();
      const readdirSpy = vi.spyOn(fs, 'readdir');
      let callsBeforeReplacement = 0;

      try {
        await expect(
          planClassicRootMove(projectRoot, {
            testHooks: {
              afterDirectoryInspect: async (inspectedLabel) => {
                if (inspectedLabel !== label) return;
                callsBeforeReplacement = readdirSpy.mock.calls.length;
                await fs.rename(targetPath, original);
                await directoryLink(external, targetPath);
              },
            },
          }),
        ).rejects.toThrow(/changed|symbolic link|junction/iu);

        expect(
          readdirSpy.mock.calls
            .slice(callsBeforeReplacement)
            .some(([directory]) => path.resolve(String(directory)) === path.resolve(targetPath)),
        ).toBe(false);
        await expect(fs.readFile(path.join(external, 'marker.txt'), 'utf8')).resolves.toBe(
          'external marker\n',
        );
      } finally {
        readdirSpy.mockRestore();
      }
    },
  );

  it('rejects a legacy source root that is a directory link outside the project', async () => {
    const outside = await externalDirectory();
    await fs.rename(path.join(projectRoot, 'openspec'), path.join(outside, 'openspec'));
    await directoryLink(path.join(outside, 'openspec'), path.join(projectRoot, 'openspec'));

    await expect(planClassicRootMove(projectRoot)).rejects.toThrow(
      /physical path .*symbolic link or junction/u,
    );
    await expect(
      fs.readFile(path.join(outside, 'openspec', 'specs', 'demo', 'spec.md'), 'utf8'),
    ).resolves.toBe('# Demo\n');
  });

  it('rejects a docs ancestor that is a directory link outside the project', async () => {
    const outside = await externalDirectory();
    await directoryLink(outside, path.join(projectRoot, 'docs'));

    await expect(planClassicRootMove(projectRoot)).rejects.toThrow(
      /physical path .*symbolic link or junction/u,
    );
    await expect(fs.readdir(outside)).resolves.toEqual([]);
  });

  it('rejects a transaction ancestor that is a directory link outside the project', async () => {
    const outside = await externalDirectory();
    await fs.mkdir(path.join(projectRoot, '.comet', 'transactions'), { recursive: true });
    await fs.rmdir(path.join(projectRoot, '.comet', 'transactions'));
    await directoryLink(outside, path.join(projectRoot, '.comet', 'transactions'));

    await expect(planClassicRootMove(projectRoot)).rejects.toThrow(
      /physical path .*symbolic link or junction/u,
    );
    await expect(fs.readdir(outside)).resolves.toEqual([]);
  });

  it('rejects a source file whose parent is replaced by an external junction after inspection', async () => {
    const outside = await externalDirectory();
    const original = path.join(outside, 'original-demo');
    const payload = path.join(outside, 'payload-demo');
    await fs.mkdir(payload, { recursive: true });
    await fs.writeFile(path.join(payload, 'spec.md'), 'EXTERNAL SECRET\n');
    let replaced = false;

    await expect(
      planClassicRootMove(projectRoot, {
        testHooks: {
          afterSourceFileInspect: async (relativePath) => {
            if (replaced || relativePath !== 'specs/demo/spec.md') return;
            replaced = true;
            const sourceDirectory = path.join(projectRoot, 'openspec', 'specs', 'demo');
            await fs.rename(sourceDirectory, original);
            await directoryLink(payload, sourceDirectory);
          },
        },
      }),
    ).rejects.toThrow(/symbolic link or junction|changed while/iu);

    await expect(fs.readFile(path.join(payload, 'spec.md'), 'utf8')).resolves.toBe(
      'EXTERNAL SECRET\n',
    );
  });

  it('does not copy through an external junction installed after manifest verification', async () => {
    const outside = await externalDirectory();
    const original = path.join(outside, 'original-copy-demo');
    const payload = path.join(outside, 'payload-copy-demo');
    await fs.mkdir(payload, { recursive: true });
    await fs.writeFile(path.join(payload, 'spec.md'), 'EXTERNAL SECRET\n');
    let replaced = false;

    await expect(
      applyPlannedRootMove({
        testHooks: {
          beforeSourceFileCopy: async (relativePath) => {
            if (replaced || relativePath !== 'specs/demo/spec.md') return;
            replaced = true;
            const sourceDirectory = path.join(projectRoot, 'openspec', 'specs', 'demo');
            await fs.rename(sourceDirectory, original);
            await directoryLink(payload, sourceDirectory);
          },
        },
      }),
    ).rejects.toThrow(/symbolic link or junction|changed while/iu);

    const journal = JSON.parse(
      await fs.readFile(path.join(projectRoot, '.comet', 'classic-root-move.json'), 'utf8'),
    ) as { staging: string };
    await expect(
      fs.access(path.join(projectRoot, ...journal.staging.split('/'), 'specs', 'demo', 'spec.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(payload, 'spec.md'), 'utf8')).resolves.toBe(
      'EXTERNAL SECRET\n',
    );
  });

  it('does not create the migration journal through a replaced .comet parent', async () => {
    const outside = await externalDirectory();
    const originalComet = path.join(outside, 'original-comet');
    const externalComet = path.join(outside, 'external-comet');
    await fs.mkdir(externalComet);
    await fs.writeFile(path.join(externalComet, 'marker.txt'), 'external marker\n');

    await expect(
      applyPlannedRootMove({
        testHooks: {
          beforeMutation: async (operation) => {
            if (operation !== 'create-journal-temp') return;
            await fs.rename(path.join(projectRoot, '.comet'), originalComet);
            await directoryLink(externalComet, path.join(projectRoot, '.comet'));
          },
        },
      }),
    ).rejects.toThrow(/changed|symbolic link|junction/iu);

    await expect(fs.readdir(externalComet)).resolves.toEqual(['marker.txt']);
    await expect(fs.stat(path.join(originalComet, 'config.yaml'))).resolves.toBeDefined();
  });

  it('does not update the migration journal through a replaced .comet parent', async () => {
    const outside = await externalDirectory();
    const originalComet = path.join(outside, 'original-update-comet');
    const externalComet = path.join(outside, 'external-update-comet');
    await fs.mkdir(externalComet);
    await fs.writeFile(path.join(externalComet, 'marker.txt'), 'external marker\n');

    await expect(
      applyPlannedRootMove({
        testHooks: {
          beforeMutation: async (operation) => {
            if (operation !== 'update-journal-temp') return;
            await fs.rename(path.join(projectRoot, '.comet'), originalComet);
            await directoryLink(externalComet, path.join(projectRoot, '.comet'));
          },
        },
      }),
    ).rejects.toThrow(/changed|symbolic link|junction/iu);

    await expect(fs.readdir(externalComet)).resolves.toEqual(['marker.txt']);
    const persisted = JSON.parse(
      await fs.readFile(path.join(originalComet, 'classic-root-move.json'), 'utf8'),
    ) as { stage: string };
    expect(persisted.stage).toBe('locked');
  });

  it('does not write a staged file through a replaced staging parent', async () => {
    const outside = await externalDirectory();
    const originalParent = path.join(outside, 'original-staging-parent');
    const externalParent = path.join(outside, 'external-staging-parent');
    await fs.mkdir(externalParent);
    await fs.writeFile(path.join(externalParent, 'marker.txt'), 'external marker\n');

    await expect(
      applyPlannedRootMove({
        testHooks: {
          beforeMutation: async (operation) => {
            if (operation !== 'copy-file:specs/demo/spec.md') return;
            const journal = JSON.parse(
              await fs.readFile(path.join(projectRoot, '.comet', 'classic-root-move.json'), 'utf8'),
            ) as { staging: string };
            const parent = path.join(projectRoot, ...journal.staging.split('/'), 'specs', 'demo');
            await fs.rename(parent, originalParent);
            await directoryLink(externalParent, parent);
          },
        },
      }),
    ).rejects.toThrow(/changed|symbolic link|junction/iu);

    await expect(fs.readdir(externalParent)).resolves.toEqual(['marker.txt']);
    await expect(fs.access(path.join(externalParent, 'spec.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not rename staging through a replaced docs parent', async () => {
    const outside = await externalDirectory();
    const originalDocs = path.join(outside, 'original-docs');
    const externalDocs = path.join(outside, 'external-docs');
    await fs.mkdir(externalDocs);
    await fs.writeFile(path.join(externalDocs, 'marker.txt'), 'external marker\n');

    await expect(
      applyPlannedRootMove({
        testHooks: {
          beforeMutation: async (operation) => {
            if (operation !== 'rename-staging-target') return;
            await fs.rename(path.join(projectRoot, 'docs'), originalDocs);
            await directoryLink(externalDocs, path.join(projectRoot, 'docs'));
          },
        },
      }),
    ).rejects.toThrow(/changed|symbolic link|junction/iu);

    await expect(fs.readdir(externalDocs)).resolves.toEqual(['marker.txt']);
    await expect(fs.access(path.join(externalDocs, 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not rename the source through a replaced quarantine parent', async () => {
    const outside = await externalDirectory();
    const originalTransaction = path.join(outside, 'original-transaction');
    const externalTransaction = path.join(outside, 'external-transaction');
    await fs.mkdir(externalTransaction);
    await fs.writeFile(path.join(externalTransaction, 'marker.txt'), 'external marker\n');

    await expect(
      applyPlannedRootMove({
        testHooks: {
          beforeMutation: async (operation) => {
            if (operation !== 'rename-source-quarantine') return;
            const transactionBase = path.join(
              projectRoot,
              '.comet',
              'transactions',
              'classic-root-move',
            );
            const [id] = await fs.readdir(transactionBase);
            const transaction = path.join(transactionBase, id);
            await fs.rename(transaction, originalTransaction);
            await directoryLink(externalTransaction, transaction);
          },
        },
      }),
    ).rejects.toThrow(/changed|symbolic link|junction/iu);

    await expect(fs.readdir(externalTransaction)).resolves.toEqual(['marker.txt']);
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(projectRoot, 'docs', 'openspec'))).resolves.toBeDefined();
  });

  it('does not unlink quarantine content through a replaced directory parent', async () => {
    const outside = await externalDirectory();
    const originalParent = path.join(outside, 'original-cleanup-parent');
    const externalParent = path.join(outside, 'external-cleanup-parent');
    await fs.mkdir(externalParent);
    await fs.writeFile(path.join(externalParent, 'marker.txt'), 'external marker\n');

    await expect(
      applyPlannedRootMove({
        testHooks: {
          beforeMutation: async (operation) => {
            if (operation !== 'remove-quarantine-file:specs/demo/spec.md') return;
            const transactionBase = path.join(
              projectRoot,
              '.comet',
              'transactions',
              'classic-root-move',
            );
            const [id] = await fs.readdir(transactionBase);
            const parent = path.join(transactionBase, id, 'legacy-source', 'specs', 'demo');
            await fs.rename(parent, originalParent);
            await directoryLink(externalParent, parent);
          },
        },
      }),
    ).rejects.toThrow(/changed|symbolic link|junction/iu);

    await expect(fs.readdir(externalParent)).resolves.toEqual(['marker.txt']);
    await expect(fs.readFile(path.join(externalParent, 'marker.txt'), 'utf8')).resolves.toBe(
      'external marker\n',
    );
  });

  it('rejects a persisted staging root that is a directory link outside the project', async () => {
    const outside = await externalDirectory();
    await fs.cp(path.join(projectRoot, 'openspec'), path.join(outside, 'openspec'), {
      recursive: true,
    });
    const staging = path.join(
      projectRoot,
      '.comet',
      'transactions',
      'classic-root-move',
      transactionId,
      'openspec',
    );
    await fs.mkdir(path.dirname(staging), { recursive: true });
    await directoryLink(path.join(outside, 'openspec'), staging);
    await writeJournal('ready');

    await expect(repairClassicRootMove(projectRoot, 'continue')).rejects.toThrow(
      /physical path .*symbolic link or junction/u,
    );
    await expect(
      fs.readFile(path.join(outside, 'openspec', 'specs', 'demo', 'spec.md'), 'utf8'),
    ).resolves.toBe('# Demo\n');
  });

  it.each([
    ['source', '../victim'],
    ['target', '../victim'],
    ['staging', '../victim/staged'],
    ['configPath', '../victim/config.yaml'],
  ])('rejects a journal whose %s escapes the project', async (field, value) => {
    const victim = path.join(path.dirname(projectRoot), 'victim');
    const sentinel = path.join(victim, 'keep.txt');
    await fs.mkdir(victim, { recursive: true });
    await fs.writeFile(sentinel, 'keep\n');
    await writeJournal('switched', { [field]: value });

    await expect(repairClassicRootMove(projectRoot, 'continue')).rejects.toThrow(
      /invalid Classic root move journal|must stay inside/u,
    );
    await expect(fs.readFile(sentinel, 'utf8')).resolves.toBe('keep\n');
    await fs.rm(victim, { recursive: true, force: true });
  });

  it('rejects a journal whose parent becomes an external junction after inspection', async () => {
    await writeJournal('copying');
    const outside = await externalDirectory();
    const externalComet = path.join(outside, 'external-comet');
    const originalComet = path.join(outside, 'original-comet');
    await fs.mkdir(externalComet, { recursive: true });
    await fs.writeFile(
      path.join(externalComet, 'classic-root-move.json'),
      '{"external":"untrusted"',
      'utf8',
    );
    let replaced = false;

    await expect(
      inspectClassicRootMove(projectRoot, {
        testHooks: {
          afterJournalInspect: async () => {
            if (replaced) return;
            replaced = true;
            const cometDirectory = path.join(projectRoot, '.comet');
            await fs.rename(cometDirectory, originalComet);
            await directoryLink(externalComet, cometDirectory);
          },
        },
      }),
    ).rejects.toThrow(/symbolic link or junction|changed while/iu);

    await expect(
      fs.readFile(path.join(externalComet, 'classic-root-move.json'), 'utf8'),
    ).resolves.toBe('{"external":"untrusted"');
  });

  it('rejects a root-move journal that exceeds the 16 MiB read budget', async () => {
    const journal = path.join(projectRoot, '.comet', 'classic-root-move.json');
    await fs.writeFile(journal, '{}', 'utf8');
    await fs.truncate(journal, 16 * 1024 * 1024 + 1);

    await expect(inspectClassicRootMove(projectRoot)).rejects.toThrow(
      /bounded regular file|exceeds 16777216 bytes/iu,
    );
  });

  it('rejects traversal inside a persisted manifest before copying', async () => {
    const manifest = await sourceManifest();
    manifest.files[0].path = '../outside.txt';
    manifest.hash = digest(
      JSON.stringify({
        directories: manifest.directories,
        files: manifest.files,
        totalBytes: manifest.totalBytes,
      }),
    );
    await writeJournal('copying', { manifest });

    await expect(repairClassicRootMove(projectRoot, 'continue')).rejects.toThrow(
      /invalid Classic root move journal|manifest path/u,
    );
  });

  it('continues a verified ready transaction only when explicitly requested', async () => {
    await stageSource();
    await writeJournal('ready');

    const recoveryPlan = await planClassicRootMove(projectRoot);
    expect(recoveryPlan).toMatchObject({
      staging: `.comet/transactions/classic-root-move/${transactionId}/openspec`,
      blockers: [`pending Classic root move: ${transactionId} at ready`],
      allowedRecoveryStrategies: ['continue', 'rollback'],
      readyToApply: false,
      pendingRecovery: {
        id: transactionId,
        stage: 'ready',
        staging: `.comet/transactions/classic-root-move/${transactionId}/openspec`,
      },
    });
    await expect(applyPlannedRootMove()).rejects.toThrow(
      /use comet doctor --repair --strategy continue\|rollback/u,
    );
    await expect(repairClassicRootMove(projectRoot)).rejects.toThrow(/strategy is required/u);
    expect((await inspectClassicRootMove(projectRoot))?.allowedStrategies).toEqual([
      'continue',
      'rollback',
    ]);
    expect((await inspectClassicRootMove(projectRoot))?.staging).toBe(
      `.comet/transactions/classic-root-move/${transactionId}/openspec`,
    );

    await expect(repairClassicRootMove(projectRoot, 'continue')).resolves.toBe(true);
    expect((await readProjectConfig(projectRoot))?.classic?.artifact_layout).toBe('docs');
  });

  it('keeps legacy v1 journals explicitly recoverable after v2 is introduced', async () => {
    await stageSource();
    await writeLegacyV1Journal('ready');

    await expect(inspectClassicRootMove(projectRoot)).resolves.toMatchObject({
      stage: 'ready',
      allowedStrategies: ['continue', 'rollback'],
    });
    await expect(repairClassicRootMove(projectRoot, 'rollback')).resolves.toBe(true);
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectRoot, '.comet', 'classic-root-move.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back a verified ready transaction only when explicitly requested', async () => {
    await stageSource();
    await writeJournal('ready');

    await expect(repairClassicRootMove(projectRoot, 'rollback')).resolves.toBe(true);
    expect((await readProjectConfig(projectRoot))?.classic?.artifact_layout).toBe('legacy');
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectRoot, '.comet', 'classic-root-move.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not recursively remove rollback staging through a replacement junction', async () => {
    await stageSource();
    await writeJournal('ready');
    const outside = await externalDirectory();
    const originalParent = path.join(outside, 'original-rollback-parent');
    const externalParent = path.join(outside, 'external-rollback-parent');
    await fs.mkdir(externalParent);
    await fs.writeFile(path.join(externalParent, 'marker.txt'), 'external marker\n');

    await expect(
      repairClassicRootMove(projectRoot, 'rollback', {
        testHooks: {
          beforeMutation: async (operation) => {
            if (operation !== 'rollback-remove-staging-file:specs/demo/spec.md') return;
            const parent = path.join(
              projectRoot,
              '.comet',
              'transactions',
              'classic-root-move',
              transactionId,
              'openspec',
              'specs',
              'demo',
            );
            await fs.rename(parent, originalParent);
            await directoryLink(externalParent, parent);
          },
        },
      }),
    ).rejects.toThrow(/changed|symbolic link|junction/iu);

    await expect(fs.readFile(path.join(externalParent, 'marker.txt'), 'utf8')).resolves.toBe(
      'external marker\n',
    );
    await expect(
      fs.stat(path.join(projectRoot, '.comet', 'classic-root-move.json')),
    ).resolves.toBeDefined();
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).resolves.toBeDefined();
  });

  it('restores a bound pre-existing empty target when recovery rolls back', async () => {
    await stageSource();
    await writeJournal('ready', { targetInitialState: 'empty' });

    await expect(repairClassicRootMove(projectRoot, 'rollback')).resolves.toBe(true);

    await expect(fs.readdir(path.join(projectRoot, 'docs', 'openspec'))).resolves.toEqual([]);
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).resolves.toBeDefined();
  });

  it('preserves all trees when project config drifts after the journal is written', async () => {
    await stageSource();
    await writeJournal('ready');
    await fs.appendFile(path.join(projectRoot, '.comet', 'config.yaml'), 'extension: drifted\n');

    await expect(repairClassicRootMove(projectRoot, 'continue')).rejects.toThrow(
      /config changed after migration preflight/u,
    );
    await expect(repairClassicRootMove(projectRoot, 'rollback')).rejects.toThrow(
      /config changed after migration preflight/u,
    );
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).resolves.toBeDefined();
    await expect(
      fs.stat(
        path.join(
          projectRoot,
          '.comet',
          'transactions',
          'classic-root-move',
          transactionId,
          'openspec',
        ),
      ),
    ).resolves.toBeDefined();
  });

  it('binds original and expected config hashes to one protected config snapshot', async () => {
    const configPath = path.join(projectRoot, '.comet', 'config.yaml');
    const originalSource = await fs.readFile(configPath, 'utf8');
    const parsed = parseWorkflowProjectConfigDocument(originalSource, {
      allowPartialProject: true,
    });
    const expectedSource = renderStructuredProjectConfig(
      {
        ...parsed.value,
        classic: {
          ...(parsed.value.classic as Record<string, unknown>),
          artifact_layout: 'docs',
        },
      },
      'zh-CN',
    );

    const plan = await planClassicRootMove(projectRoot, {
      testHooks: {
        afterConfigSnapshot: () =>
          fs.appendFile(configPath, 'concurrent_extension: keep\n', 'utf8'),
      },
    });

    expect(plan.originalConfigHash).toBe(digest(originalSource));
    expect(plan.expectedConfigHash).toBe(digest(expectedSource));
    await expect(fs.readFile(configPath, 'utf8')).resolves.toContain('concurrent_extension: keep');
  });

  it('does not overwrite config drift after the root-move identity check and before commit', async () => {
    const plan = await planClassicRootMove(projectRoot);
    const configPath = path.join(projectRoot, '.comet', 'config.yaml');
    const concurrentSource =
      (await fs.readFile(configPath, 'utf8')) + 'concurrent_extension: keep\n';

    await expect(
      writeClassicArtifactLayout(projectRoot, 'docs', {
        expectedIdentity: {
          exists: true,
          sha256: plan.originalConfigHash,
        },
        beforeCommit: () => fs.writeFile(configPath, concurrentSource, 'utf8'),
      }),
    ).rejects.toThrow('Project config changed before commit');
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(concurrentSource);
  });

  it('rejects post-switch config drift against the deterministic expected config hash', async () => {
    await stageSource();
    await writeJournal('configured');
    await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await fs.rename(
      path.join(
        projectRoot,
        '.comet',
        'transactions',
        'classic-root-move',
        transactionId,
        'openspec',
      ),
      path.join(projectRoot, 'docs', 'openspec'),
    );
    await writeClassicArtifactLayout(projectRoot, 'docs');
    await fs.appendFile(path.join(projectRoot, '.comet', 'config.yaml'), 'extension: drifted\n');

    expect((await inspectClassicRootMove(projectRoot))?.allowedStrategies).toEqual([]);
    await expect(repairClassicRootMove(projectRoot, 'continue')).rejects.toThrow(
      /expected post-switch config hash/u,
    );
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).resolves.toBeDefined();
  });

  it('continues an interrupted manifest-bound quarantine cleanup idempotently', async () => {
    await stageSource();
    await writeJournal('configured');
    const transactionRoot = path.join(
      projectRoot,
      '.comet',
      'transactions',
      'classic-root-move',
      transactionId,
    );
    await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await fs.rename(
      path.join(transactionRoot, 'openspec'),
      path.join(projectRoot, 'docs', 'openspec'),
    );
    await writeClassicArtifactLayout(projectRoot, 'docs');
    const quarantine = path.join(transactionRoot, 'legacy-source');
    await fs.rename(path.join(projectRoot, 'openspec'), quarantine);
    await fs.rm(path.join(quarantine, 'specs', 'demo', 'spec.md'));
    await fs.rmdir(path.join(quarantine, 'specs', 'demo'));

    expect((await inspectClassicRootMove(projectRoot))?.allowedStrategies).toEqual(['continue']);
    await expect(repairClassicRootMove(projectRoot, 'continue')).resolves.toBe(true);
    await expect(fs.stat(quarantine)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.stat(path.join(projectRoot, '.comet', 'classic-root-move.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a partial quarantine when it contains unknown content', async () => {
    await stageSource();
    await writeJournal('configured');
    const transactionRoot = path.join(
      projectRoot,
      '.comet',
      'transactions',
      'classic-root-move',
      transactionId,
    );
    await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await fs.rename(
      path.join(transactionRoot, 'openspec'),
      path.join(projectRoot, 'docs', 'openspec'),
    );
    await writeClassicArtifactLayout(projectRoot, 'docs');
    const quarantine = path.join(transactionRoot, 'legacy-source');
    await fs.rename(path.join(projectRoot, 'openspec'), quarantine);
    await fs.writeFile(path.join(quarantine, 'unknown.txt'), 'keep\n');

    expect((await inspectClassicRootMove(projectRoot))?.allowedStrategies).toEqual([]);
    await expect(repairClassicRootMove(projectRoot, 'continue')).rejects.toThrow(
      /unknown or changed content/u,
    );
    await expect(fs.readFile(path.join(quarantine, 'unknown.txt'), 'utf8')).resolves.toBe('keep\n');
  });

  it('preserves all trees when the source tree drifts after the journal is written', async () => {
    await stageSource();
    await writeJournal('ready');
    await fs.appendFile(
      path.join(projectRoot, 'openspec', 'specs', 'demo', 'spec.md'),
      'changed\n',
    );

    await expect(repairClassicRootMove(projectRoot, 'continue')).rejects.toThrow(
      /legacy root changed after migration preflight/u,
    );
    await expect(repairClassicRootMove(projectRoot, 'rollback')).rejects.toThrow(
      /legacy root changed after migration preflight/u,
    );
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).resolves.toBeDefined();
  });

  it('blocks ordinary Classic writes while a root move is pending', async () => {
    await writeJournal('copying');

    await expect(assertClassicLayoutWritable(projectRoot)).rejects.toThrow(
      /Classic root move .* is incomplete/u,
    );
  });
});
