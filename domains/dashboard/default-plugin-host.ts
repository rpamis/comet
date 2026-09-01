import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createDefaultCometPluginBridge } from '../comet-plugin/index.js';
import {
  createProjectKnowledgeDashboardContribution,
  ProjectKnowledgeLocalStore,
  PROJECT_KNOWLEDGE_PLUGIN_ID,
  readProjectKnowledgeStoreSnapshot,
} from '../project-knowledge/index.js';
import { DashboardPluginHost, type DashboardPluginHostFactory } from './plugin-host.js';
import { getCurrentVersion } from '../../platform/version/version.js';
import {
  defaultProjectKnowledgeStorageRoot,
  resolveProjectKnowledgeStorageLocation,
} from '../../platform/paths/project-knowledge-storage.js';

const LEGACY_DASHBOARD_CACHE_MIGRATION_KEY = 'legacy_dashboard_cache_v1';

export interface DefaultDashboardPluginHostOptions {
  readonly stateRoot?: string;
  readonly memoryRoot?: string;
  readonly knowledgeCacheRoot?: string;
  /** Optional isolated user home, primarily for hosts and tests. */
  readonly homeDirectory?: string;
  readonly cometVersion?: string;
}

function importLegacyProjectKnowledgeState(
  projectRoot: string,
  homeDirectory: string,
  canonicalCacheRoot: string,
): void {
  const legacyCacheRoot = path.join(homeDirectory, '.comet', 'plugins', 'knowledge-cache');
  const legacyLocation = resolveProjectKnowledgeStorageLocation(projectRoot, legacyCacheRoot);
  if (!existsSync(legacyLocation.databasePath)) return;

  let snapshot;
  try {
    snapshot = readProjectKnowledgeStoreSnapshot(legacyLocation.databasePath);
  } catch {
    return;
  }

  const canonicalStore = new ProjectKnowledgeLocalStore({
    projectRoot,
    cacheRoot: canonicalCacheRoot,
  });
  try {
    canonicalStore.importSnapshot(snapshot, LEGACY_DASHBOARD_CACHE_MIGRATION_KEY);
  } finally {
    canonicalStore.close();
  }
}

export function createDefaultDashboardPluginHostFactory(
  options: DefaultDashboardPluginHostOptions = {},
): DashboardPluginHostFactory {
  const configuredHomeDirectory =
    options.homeDirectory === undefined ? undefined : path.resolve(options.homeDirectory);
  const homeDirectory = configuredHomeDirectory ?? os.homedir();
  const stateRoot = options.stateRoot === undefined ? undefined : path.resolve(options.stateRoot);
  const memoryRoot = path.resolve(
    options.memoryRoot ?? path.join(homeDirectory, '.comet', 'memory'),
  );
  const knowledgeCacheRoot =
    options.knowledgeCacheRoot === undefined ? undefined : path.resolve(options.knowledgeCacheRoot);
  const cometVersion = options.cometVersion ?? getCurrentVersion();

  return async (projectId, projectPath) => {
    if (stateRoot === undefined && knowledgeCacheRoot === undefined) {
      importLegacyProjectKnowledgeState(
        projectPath,
        homeDirectory,
        defaultProjectKnowledgeStorageRoot(configuredHomeDirectory),
      );
    }
    const bridge = await createDefaultCometPluginBridge({
      projectRoot: projectPath,
      projectId,
      memoryRoot,
      ...(configuredHomeDirectory === undefined ? {} : { homeDirectory: configuredHomeDirectory }),
      ...(stateRoot === undefined ? {} : { stateRoot }),
      ...(knowledgeCacheRoot === undefined ? {} : { knowledgeCacheRoot }),
      cometVersion,
    });
    const projectKnowledgePage = createProjectKnowledgeDashboardContribution(
      bridge.currentLanguage,
    );
    return new DashboardPluginHost({
      runtime: bridge.pluginRuntime,
      projectId,
      pages: [
        {
          pluginId: PROJECT_KNOWLEDGE_PLUGIN_ID,
          label: projectKnowledgePage.label,
          route: projectKnowledgePage.route,
          ...(projectKnowledgePage.load ? { load: projectKnowledgePage.load } : {}),
        },
      ],
    });
  };
}
