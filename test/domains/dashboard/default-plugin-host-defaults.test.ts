import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDefaultCometPluginBridge } from '../../../domains/comet-plugin/index.js';
import { createDefaultDashboardPluginHostFactory } from '../../../domains/dashboard/default-plugin-host.js';
import { ProjectKnowledgeLocalStore } from '../../../domains/project-knowledge/local-store.js';
import { openProjectKnowledgeDatabase } from '../../../domains/project-knowledge/sqlite.js';
import {
  defaultProjectKnowledgeStorageRoot,
  resolveProjectKnowledgeStorageLocation,
} from '../../../platform/paths/project-knowledge-storage.js';
import { resolveStableProjectId } from '../../../platform/paths/project-identity.js';

const projectId = 'project-default-cache';
let isolatedHome: string;
let projectRoot: string;

describe('default dashboard project knowledge cache', () => {
  beforeAll(async () => {
    isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-default-home-'));
    projectRoot = path.join(isolatedHome, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(isolatedHome, { recursive: true, force: true });
  });

  it('shares records bidirectionally without either cache path override', async () => {
    const cliBridge = await createDefaultCometPluginBridge({
      projectRoot,
      projectId,
      homeDirectory: isolatedHome,
    });
    await cliBridge.pluginRuntime.invoke(
      'comet.project-knowledge',
      'create',
      {
        type: 'constraint',
        title: 'CLI default cache rule',
        summary: 'The Dashboard reads records created through the CLI default cache.',
      },
      { scope: 'project', projectId },
    );

    const host = await createDefaultDashboardPluginHostFactory({ homeDirectory: isolatedHome })(
      projectId,
      projectRoot,
    );
    await expect(host.get('comet.project-knowledge')).resolves.toMatchObject({
      data: {
        records: [expect.objectContaining({ title: 'CLI default cache rule' })],
      },
    });

    await host.invoke('comet.project-knowledge', 'create', {
      type: 'procedure',
      title: 'Dashboard default cache rule',
      summary: 'The CLI reads records created through the Dashboard default cache.',
    });
    await expect(
      cliBridge.pluginRuntime.invoke(
        'comet.project-knowledge',
        'list',
        { state: 'all' },
        { scope: 'project', projectId },
      ),
    ).resolves.toMatchObject({
      records: expect.arrayContaining([
        expect.objectContaining({ title: 'CLI default cache rule' }),
        expect.objectContaining({ title: 'Dashboard default cache rule' }),
      ]),
    });
  });

  it('imports records and feedback state from the legacy Dashboard cache', async () => {
    const legacyProjectId = 'project-legacy-cache';
    const recordProjectId = resolveStableProjectId(projectRoot);
    const legacyCacheRoot = path.join(isolatedHome, '.comet', 'plugins', 'knowledge-cache');
    const legacyStore = new ProjectKnowledgeLocalStore({
      projectRoot,
      cacheRoot: legacyCacheRoot,
    });
    const legacyRecord = {
      id: 'legacy-dashboard-record',
      projectId: recordProjectId,
      type: 'fact' as const,
      state: 'trial' as const,
      authority: 'automatic' as const,
      title: 'Legacy Dashboard record',
      summary: 'This record and its feedback state must survive cache migration.',
      applicablePaths: [],
      operations: [],
      phases: [],
      conclusions: [],
      relations: [],
      verification: [],
      sourceVersions: [],
      applicationCount: 0,
      successCount: 0,
      failureCount: 0,
      updatedAt: '2026-08-31T00:00:00.000Z',
    };
    const failedFeedback = {
      kind: 'feedback' as const,
      id: legacyRecord.id,
      projectId: recordProjectId,
      outcome: 'contributed-to-failure' as const,
      applicationId: 'legacy-application',
      revision: 1,
      idempotencyKey: 'legacy-feedback-1',
      updatedAt: '2026-08-31T00:01:00.000Z',
    };
    await legacyStore.apply({ kind: 'upsert', record: legacyRecord });
    await expect(legacyStore.apply(failedFeedback)).resolves.toMatchObject({
      changed: true,
      record: expect.objectContaining({
        state: 'superseded',
        applicationCount: 1,
        failureCount: 1,
      }),
    });
    legacyStore.close();
    const legacyDatabasePath = resolveProjectKnowledgeStorageLocation(
      projectRoot,
      legacyCacheRoot,
    ).databasePath;
    const legacyDatabaseBeforeMigration = await fs.readFile(legacyDatabasePath);

    const host = await createDefaultDashboardPluginHostFactory({ homeDirectory: isolatedHome })(
      legacyProjectId,
      projectRoot,
    );
    await expect(host.get('comet.project-knowledge')).resolves.toMatchObject({
      data: {
        records: expect.arrayContaining([
          expect.objectContaining({ title: 'Legacy Dashboard record' }),
        ]),
      },
    });

    const canonicalBridge = await createDefaultCometPluginBridge({
      projectRoot,
      projectId: legacyProjectId,
      homeDirectory: isolatedHome,
    });
    await expect(
      canonicalBridge.pluginRuntime.invoke(
        'comet.project-knowledge',
        'list',
        { state: 'all' },
        { scope: 'project', projectId: legacyProjectId },
      ),
    ).resolves.toMatchObject({
      records: expect.arrayContaining([
        expect.objectContaining({
          title: 'Legacy Dashboard record',
          state: 'superseded',
          applicationCount: 1,
          failureCount: 1,
        }),
      ]),
    });

    const canonicalStore = new ProjectKnowledgeLocalStore({
      projectRoot,
      cacheRoot: defaultProjectKnowledgeStorageRoot(isolatedHome),
    });
    const canonicalDatabasePath = canonicalStore.databasePath;
    await expect(canonicalStore.apply(failedFeedback)).resolves.toMatchObject({ changed: false });
    await expect(
      canonicalStore.apply({
        ...failedFeedback,
        idempotencyKey: 'legacy-feedback-1-retry',
      }),
    ).resolves.toMatchObject({ changed: false });
    await expect(
      canonicalStore.apply({
        ...failedFeedback,
        outcome: 'used-successfully',
        revision: 2,
        idempotencyKey: 'legacy-feedback-2',
        updatedAt: '2026-08-31T00:02:00.000Z',
      }),
    ).resolves.toMatchObject({
      changed: true,
      record: expect.objectContaining({
        state: 'proven',
        applicationCount: 1,
        successCount: 1,
        failureCount: 0,
      }),
    });
    canonicalStore.close();

    const reopenedHost = await createDefaultDashboardPluginHostFactory({
      homeDirectory: isolatedHome,
    })(legacyProjectId, projectRoot);
    await expect(reopenedHost.get('comet.project-knowledge')).resolves.toBeDefined();
    const canonicalDatabase = openProjectKnowledgeDatabase(canonicalDatabasePath, {
      readOnly: true,
    });
    expect(
      canonicalDatabase.prepare('SELECT COUNT(*) AS count FROM pk_feedback_state').get() as {
        count: number;
      },
    ).toEqual({ count: 0 });
    canonicalDatabase.close();
    await expect(fs.readFile(legacyDatabasePath)).resolves.toEqual(legacyDatabaseBeforeMigration);
  });

  it.each(['corrupt', 'incompatible'] as const)(
    'starts when the legacy Dashboard database is %s',
    async (legacyDatabaseKind) => {
      const fallbackProjectRoot = path.join(isolatedHome, `project-${legacyDatabaseKind}`);
      await fs.mkdir(fallbackProjectRoot, { recursive: true });
      const legacyCacheRoot = path.join(isolatedHome, '.comet', 'plugins', 'knowledge-cache');
      const legacyDatabasePath = resolveProjectKnowledgeStorageLocation(
        fallbackProjectRoot,
        legacyCacheRoot,
      ).databasePath;
      await fs.mkdir(path.dirname(legacyDatabasePath), { recursive: true });
      if (legacyDatabaseKind === 'corrupt') {
        await fs.writeFile(legacyDatabasePath, 'not a sqlite database');
      } else {
        const database = openProjectKnowledgeDatabase(legacyDatabasePath);
        database.exec('CREATE TABLE unrelated (id TEXT PRIMARY KEY);');
        database.close();
      }

      const host = await createDefaultDashboardPluginHostFactory({
        homeDirectory: isolatedHome,
      })(`${legacyDatabaseKind}-project`, fallbackProjectRoot);
      await expect(host.get('comet.project-knowledge')).resolves.toMatchObject({
        data: { records: [] },
      });
    },
  );
});
