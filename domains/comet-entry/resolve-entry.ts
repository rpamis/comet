import { discoverCachedNativeProject, readCachedProjectConfig } from './entry-reads.js';
import type { CometEntryResolution, CometWorkflow } from './types.js';

function configuredResolution(workflow: CometWorkflow): CometEntryResolution {
  return {
    workflow,
    skill: workflow === 'native' ? 'comet-native' : 'comet-classic',
    source: 'project-config',
  };
}

export async function resolveCometEntry(startPath: string): Promise<CometEntryResolution> {
  const projectRoot = await discoverCachedNativeProject(startPath);
  const config = await readCachedProjectConfig(projectRoot);
  if (!config) {
    throw new Error('Comet workflow entry is unavailable because .comet/config.yaml is missing');
  }
  return configuredResolution(config.default_workflow);
}
