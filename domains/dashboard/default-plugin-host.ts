import os from 'node:os';
import path from 'node:path';
import { createDefaultCometPluginBridge } from '../comet-plugin/index.js';
import {
  createProjectKnowledgeDashboardContribution,
  PROJECT_KNOWLEDGE_PLUGIN_ID,
} from '../project-knowledge/index.js';
import { DashboardPluginHost, type DashboardPluginHostFactory } from './plugin-host.js';
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
    const bridge = await createDefaultCometPluginBridge({
      projectRoot: projectPath,
      projectId,
      memoryRoot,
      stateRoot,
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
