import { discoverNativeProject } from '../comet-native/native-paths.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import type { CometEntryResolution, CometWorkflow } from './types.js';

function configuredResolution(workflow: CometWorkflow): CometEntryResolution {
  return {
    workflow,
    skill: workflow === 'native' ? 'comet-native' : 'comet-classic',
    source: 'project-config',
  };
}

export async function resolveCometEntry(startPath: string): Promise<CometEntryResolution> {
  const projectRoot = await discoverNativeProject(startPath);
  const config = await readWorkflowProjectConfig(projectRoot);
  if (!config) {
    throw new Error('Comet workflow entry is unavailable because .comet/config.yaml is missing');
  }
  return configuredResolution(config.default_workflow);
}
