import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  assertClassicLayoutInitializationSafe,
  beginClassicLayoutInitialization,
  checkpointClassicLayoutInitialization,
  completeClassicLayoutInitialization,
  rollbackClassicLayoutInitialization,
} from '../../../domains/comet-classic/classic-layout-initialization.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

describe('Classic layout initialization safety', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-layout-init-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('allows an explicit desired layout only for a fresh project with both roots missing', async () => {
    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).resolves.toMatchObject(
      {
        artifactLayout: 'docs',
        openSpecRoot: path.join(projectRoot, 'docs', 'openspec'),
      },
    );
  });

  it('revalidates the desired root created by the same initialization without weakening later calls', async () => {
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    await fs.mkdir(initialization.openSpecRoot, { recursive: true });

    await expect(
      assertClassicLayoutInitializationSafe(
        projectRoot,
        'docs',
        initialization.initializationPermit,
      ),
    ).resolves.toMatchObject({
      artifactLayout: 'docs',
      openSpecRoot: path.join(projectRoot, 'docs', 'openspec'),
    });
    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
      /cannot initialize Classic layout without.*config/iu,
    );
  });

  it('recovers a prior owned initialization across processes without allowing unmanaged roots', async () => {
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    const owned = await beginClassicLayoutInitialization(projectRoot, initialization);
    await fs.mkdir(path.join(owned.openSpecRoot, 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(owned.openSpecRoot, 'specs'), { recursive: true });
    await fs.writeFile(path.join(owned.openSpecRoot, 'config.yaml'), 'schema: spec-driven\n');

    const resumed = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    expect(resumed.initializationPermit.ownershipId).toBe(owned.initializationPermit.ownershipId);
    await checkpointClassicLayoutInitialization(projectRoot, resumed.initializationPermit);

    await expect(
      fs.stat(path.join(projectRoot, '.comet', 'classic-init-ownership.json')),
    ).resolves.toBeDefined();
  });

  it('quarantines an unchanged manifest-bound root without deleting its contents', async () => {
    await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'docs', 'keep.txt'), 'keep\n');
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    const owned = await beginClassicLayoutInitialization(projectRoot, initialization);
    await fs.mkdir(path.join(owned.openSpecRoot, 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(owned.openSpecRoot, 'specs'), { recursive: true });
    await fs.writeFile(path.join(owned.openSpecRoot, 'config.yaml'), 'schema: spec-driven\n');
    await checkpointClassicLayoutInitialization(projectRoot, owned.initializationPermit);

    await expect(
      rollbackClassicLayoutInitialization(projectRoot, owned.initializationPermit),
    ).resolves.toBe(true);

    await expect(fs.stat(owned.openSpecRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(projectRoot, 'docs', 'keep.txt'), 'utf8')).resolves.toBe(
      'keep\n',
    );
    const journal = JSON.parse(
      await fs.readFile(path.join(projectRoot, '.comet', 'classic-init-ownership.json'), 'utf8'),
    ) as { stage: string; quarantine: string };
    expect(journal.stage).toBe('quarantined');
    await expect(
      fs.readFile(path.join(projectRoot, ...journal.quarantine.split('/'), 'config.yaml'), 'utf8'),
    ).resolves.toBe('schema: spec-driven\n');
  });

  it('preserves an owned root when its checkpointed manifest drifts', async () => {
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    const owned = await beginClassicLayoutInitialization(projectRoot, initialization);
    await fs.mkdir(path.join(owned.openSpecRoot, 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(owned.openSpecRoot, 'specs'), { recursive: true });
    await checkpointClassicLayoutInitialization(projectRoot, owned.initializationPermit);
    await fs.writeFile(path.join(owned.openSpecRoot, 'user.md'), 'preserve me\n');

    await expect(
      rollbackClassicLayoutInitialization(projectRoot, owned.initializationPermit),
    ).rejects.toThrow(/changed after the ownership checkpoint/iu);
    await expect(fs.readFile(path.join(owned.openSpecRoot, 'user.md'), 'utf8')).resolves.toBe(
      'preserve me\n',
    );
    await expect(
      fs.stat(path.join(projectRoot, '.comet', 'classic-init-ownership.json')),
    ).resolves.toBeDefined();
  });

  it('publishes only one ownership journal when two initializers race', async () => {
    const first = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    const second = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');

    const results = await Promise.allSettled([
      beginClassicLayoutInitialization(projectRoot, first),
      beginClassicLayoutInitialization(projectRoot, second),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const persisted = JSON.parse(
      await fs.readFile(path.join(projectRoot, '.comet', 'classic-init-ownership.json'), 'utf8'),
    ) as { id: string; stage: string };
    expect(persisted).toMatchObject({ stage: 'initializing' });
    expect(
      results.some(
        (result) =>
          result.status === 'fulfilled' &&
          result.value.initializationPermit.ownershipId === persisted.id,
      ),
    ).toBe(true);
  });

  it('does not let a stale checkpoint overwrite a successor journal', async () => {
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    const owned = await beginClassicLayoutInitialization(projectRoot, initialization);
    await fs.mkdir(path.join(owned.openSpecRoot, 'specs'), { recursive: true });
    const successorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    await expect(
      checkpointClassicLayoutInitialization(projectRoot, owned.initializationPermit, {
        testHooks: {
          afterJournalQuarantine: async (operation) => {
            if (operation !== 'checkpoint-journal') return;
            await publishSuccessorJournal(successorId);
          },
        },
      }),
    ).rejects.toThrow(/successor journal was preserved/iu);

    const persisted = JSON.parse(
      await fs.readFile(path.join(projectRoot, '.comet', 'classic-init-ownership.json'), 'utf8'),
    ) as { id: string };
    expect(persisted.id).toBe(successorId);
  });

  it('does not let stale completion delete a successor journal', async () => {
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    const owned = await beginClassicLayoutInitialization(projectRoot, initialization);
    await fs.mkdir(path.join(owned.openSpecRoot, 'specs'), { recursive: true });
    await checkpointClassicLayoutInitialization(projectRoot, owned.initializationPermit);
    const successorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    await expect(
      completeClassicLayoutInitialization(projectRoot, owned.initializationPermit, {
        testHooks: {
          afterJournalQuarantine: async (operation) => {
            if (operation !== 'remove-journal') return;
            await publishSuccessorJournal(successorId);
          },
        },
      }),
    ).resolves.toBe(true);

    const persisted = JSON.parse(
      await fs.readFile(path.join(projectRoot, '.comet', 'classic-init-ownership.json'), 'utf8'),
    ) as { id: string };
    expect(persisted.id).toBe(successorId);
  });

  it('preserves both a replacement root and the verified rollback quarantine', async () => {
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    const owned = await beginClassicLayoutInitialization(projectRoot, initialization);
    await fs.mkdir(path.join(owned.openSpecRoot, 'specs'), { recursive: true });
    await fs.writeFile(path.join(owned.openSpecRoot, 'config.yaml'), 'schema: spec-driven\n');
    await checkpointClassicLayoutInitialization(projectRoot, owned.initializationPermit);

    await expect(
      rollbackClassicLayoutInitialization(projectRoot, owned.initializationPermit, {
        testHooks: {
          afterRootQuarantine: async () => {
            await fs.mkdir(owned.openSpecRoot, { recursive: true });
            await fs.writeFile(path.join(owned.openSpecRoot, 'user.md'), 'new root\n');
          },
        },
      }),
    ).resolves.toBe(true);

    await expect(fs.readFile(path.join(owned.openSpecRoot, 'user.md'), 'utf8')).resolves.toBe(
      'new root\n',
    );
    const journal = JSON.parse(
      await fs.readFile(path.join(projectRoot, '.comet', 'classic-init-ownership.json'), 'utf8'),
    ) as { quarantine: string; stage: string };
    expect(journal.stage).toBe('quarantined');
    await expect(
      fs.readFile(path.join(projectRoot, ...journal.quarantine.split('/'), 'config.yaml'), 'utf8'),
    ).resolves.toBe('schema: spec-driven\n');
  });

  async function publishSuccessorJournal(id: string): Promise<void> {
    const cometDir = path.join(projectRoot, '.comet');
    const quarantine = (await fs.readdir(cometDir)).find((entry) => entry.endsWith('.quarantine'));
    if (!quarantine) throw new Error('expected a quarantined ownership journal');
    const successor = JSON.parse(
      await fs.readFile(path.join(cometDir, quarantine), 'utf8'),
    ) as Record<string, unknown>;
    successor.id = id;
    successor.stage = 'initializing';
    successor.quarantine = null;
    await fs.writeFile(
      path.join(cometDir, 'classic-init-ownership.json'),
      JSON.stringify(successor, null, 2) + '\n',
      { flag: 'wx' },
    );
  }

  it('uses the configured layout for an existing project', async () => {
    await writeClassicConfig('docs');
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).resolves.toMatchObject(
      {
        artifactLayout: 'docs',
        openSpecRoot: path.join(projectRoot, 'docs', 'openspec'),
      },
    );
  });

  it('allows a configured Classic project to initialize its missing root when both roots are absent', async () => {
    await writeClassicConfig('docs');

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).resolves.toMatchObject(
      {
        artifactLayout: 'docs',
        openSpecRoot: path.join(projectRoot, 'docs', 'openspec'),
      },
    );
  });

  it('binds an existing configured Classic project to the initial config identity', async () => {
    await writeClassicConfig('docs');
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    const configPath = path.join(projectRoot, '.comet', 'config.yaml');
    await fs.appendFile(configPath, 'extension: changed\n', 'utf8');

    await expect(
      assertClassicLayoutInitializationSafe(
        projectRoot,
        'docs',
        initialization.initializationPermit,
      ),
    ).rejects.toThrow(/project config changed during Classic layout initialization/iu);
  });

  it('allows a Native-only project to initialize its first explicit Classic layout', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).resolves.toMatchObject(
      {
        artifactLayout: 'docs',
        openSpecRoot: path.join(projectRoot, 'docs', 'openspec'),
      },
    );
  });

  it('rejects an initialization permit after the protected project config changes', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    await fs.mkdir(initialization.openSpecRoot, { recursive: true });
    const configPath = path.join(projectRoot, '.comet', 'config.yaml');
    const source = await fs.readFile(configPath, 'utf8');
    await fs.writeFile(
      configPath,
      source.replace('artifact_root: docs', 'artifact_root: artifacts'),
    );

    await expect(
      assertClassicLayoutInitializationSafe(
        projectRoot,
        'docs',
        initialization.initializationPermit,
      ),
    ).rejects.toThrow(/project config changed during Classic layout initialization/iu);
  });

  it('rejects a desired layout that disagrees with existing configuration', async () => {
    await writeClassicConfig('legacy');
    await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
      /configured Classic layout is legacy.*requested docs/iu,
    );
  });

  it('rejects an existing configured project when only the alternate root exists', async () => {
    await writeClassicConfig('docs');
    await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
      /configured Classic OpenSpec root is missing/iu,
    );
  });

  it('rejects a fresh project when either unmanaged OpenSpec root already exists', async () => {
    await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
      /cannot initialize Classic layout without.*config/iu,
    );
  });

  it('rejects a fresh project when the alternate docs root is a directory link', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-init-outside-'));
    try {
      await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
      try {
        await fs.symlink(
          outsideRoot,
          path.join(projectRoot, 'docs', 'openspec'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(assertClassicLayoutInitializationSafe(projectRoot, 'legacy')).rejects.toThrow(
        /symbolic link or junction/iu,
      );
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects a pending root move before initializing OpenSpec artifacts', async () => {
    await writeClassicConfig('docs');
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'classic-root-move.json'),
      '{"status":"prepared"}\n',
      'utf8',
    );

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
      /root move transaction is incomplete/iu,
    );
  });

  it('rejects a configured OpenSpec root that crosses a junction', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-layout-outside-'));
    try {
      await writeClassicConfig('docs');
      await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
      try {
        await fs.symlink(
          outsideRoot,
          path.join(projectRoot, 'docs', 'openspec'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
        /symbolic link or junction/iu,
      );
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  async function writeClassicConfig(artifactLayout: 'legacy' | 'docs'): Promise<void> {
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows:',
        '  - classic',
        'classic:',
        `  artifact_layout: ${artifactLayout}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }
});
