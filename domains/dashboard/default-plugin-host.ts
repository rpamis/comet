import os from 'node:os';
import path from 'node:path';
import { JsonPluginStateStore, PluginRuntime } from '../comet-plugin/index.js';
import {
  createPersonalMemoryPluginDescriptor,
  FileMemoryRepository,
  PersonalMemoryService,
} from '../comet-memory/index.js';
import { createProjectRulesPluginDescriptor } from '../project-rules/index.js';
import { JsonFilePluginStorageStore, JsonFileTextStore } from '../../platform/fs/plugin-store.js';
import {
  DashboardPluginHost,
  type DashboardPluginHostFactory,
  type DashboardPluginPageRegistration,
} from './plugin-host.js';
import { getCurrentVersion } from '../../platform/version/version.js';

export interface DefaultDashboardPluginHostOptions {
  readonly stateRoot?: string;
  readonly memoryRoot?: string;
  readonly cometVersion?: string;
}

export function createDefaultDashboardPluginHostFactory(
  options: DefaultDashboardPluginHostOptions = {},
): DashboardPluginHostFactory {
  const stateRoot = path.resolve(options.stateRoot ?? path.join(os.homedir(), '.comet', 'plugins'));
  const memoryRoot = path.resolve(
    options.memoryRoot ?? path.join(os.homedir(), '.comet', 'memory'),
  );
  const cometVersion = options.cometVersion ?? getCurrentVersion();

  return async (projectId, projectPath) => {
    const runtime = new PluginRuntime({
      cometVersion,
      store: new JsonPluginStateStore(new JsonFileTextStore(path.join(stateRoot, 'state.json'))),
      storage: new JsonFilePluginStorageStore(path.join(stateRoot, 'storage')),
      descriptors: [
        createPersonalMemoryPluginDescriptor({
          createService: () =>
            new PersonalMemoryService({ repository: new FileMemoryRepository(memoryRoot) }),
        }),
        createProjectRulesPluginDescriptor({ projectRoot: projectPath, projectId }),
      ],
    });
    await runtime.reconcileFirstParty();
    return new DashboardPluginHost({
      runtime,
      projectId,
      pages: firstPartyPages,
    });
  };
}

const firstPartyPages: readonly DashboardPluginPageRegistration[] = [
  {
    pluginId: 'comet.personal-memory',
    label: '个人记忆',
    route: '/plugins/personal-memory',
    load: async ({ projectId, invoke }) => ({
      status: await invoke('status'),
      retrieval: await invoke('retrieve', { projectKey: projectId }),
      operations: ['correct', 'remove', 'rollback', 'sync', 'set-learning', 'set-retrieval'],
    }),
  },
  {
    pluginId: 'comet.project-rules',
    label: '项目规则',
    route: '/plugins/project-rules',
    load: async ({ invoke }) => {
      const status = (await invoke('status')) as Record<string, unknown>;
      return {
        ...status,
        operations: ['init', 'scan', 'add', 'adopt', 'ignore', 'snooze', 'restore'],
      };
    },
  },
];
