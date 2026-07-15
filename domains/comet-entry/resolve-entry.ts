import { readProjectConfig } from '../comet-native/native-config.js';
import { discoverNativeProject } from '../comet-native/native-paths.js';
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
  const config = await readProjectConfig(projectRoot);
  if (!config) {
    return {
      workflow: 'classic',
      skill: 'comet-classic',
      source: 'legacy-fallback',
    };
  }
  return configuredResolution(config.default_workflow);
}
