import { select } from '@inquirer/prompts';

import type { InstallScope } from '../../platform/install/types.js';

export type ProjectScopeMode = 'current-project' | 'all-projects';
export type ProjectScopeCommand = 'update' | 'uninstall';

export interface ProjectScopeOptions {
  allProjects?: boolean;
  currentProject?: boolean;
  force?: boolean;
  json?: boolean;
  scope?: InstallScope;
}

export function assertProjectScopeOptions(options: ProjectScopeOptions): void {
  if (options.allProjects && options.currentProject) {
    throw new Error('--all-projects cannot be combined with --current-project');
  }
  if (options.allProjects && options.scope === 'global') {
    throw new Error('--all-projects cannot be combined with --scope global');
  }
}

function commandLabel(command: ProjectScopeCommand): string {
  return command === 'update' ? 'Update' : 'Uninstall';
}

export async function resolveProjectScopeMode(
  command: ProjectScopeCommand,
  options: ProjectScopeOptions,
  indexedProjectCount: number,
): Promise<ProjectScopeMode> {
  assertProjectScopeOptions(options);

  if (options.allProjects) return 'all-projects';
  if (options.currentProject) return 'current-project';
  if (options.scope === 'global') return 'current-project';
  if (options.force) return 'current-project';
  if (options.json) return 'current-project';
  if (indexedProjectCount === 0) return 'current-project';

  return select<ProjectScopeMode>({
    message: `${commandLabel(command)} scope:`,
    choices: [
      { name: 'All indexed projects', value: 'all-projects' },
      { name: 'Current project only', value: 'current-project' },
    ],
  });
}
