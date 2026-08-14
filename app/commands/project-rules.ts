import path from 'node:path';

import { ProjectRulesService, type ProjectRulesStatus } from '../../domains/project-rules/index.js';

interface ProjectRulesCommandOptions {
  readonly json?: boolean;
}

function printStatus(status: ProjectRulesStatus): void {
  console.log(`Project rules: ${status.initialized ? 'initialized' : 'not initialized'}`);
  console.log(`Sources: ${status.sources.length}`);
  for (const source of status.sources) {
    console.log(`  - ${source.path} (${source.sectionCount} sections)`);
  }
  console.log('Verification entrypoints:');
  if (status.verificationEntrypoints.length === 0) {
    console.log('  - none discovered');
  } else {
    for (const entrypoint of status.verificationEntrypoints) {
      console.log(`  - ${entrypoint.label} (${entrypoint.sourcePath})`);
    }
  }
  console.log(`Pending candidates: ${status.candidates.length}`);
}

function outputStatus(status: ProjectRulesStatus, options: ProjectRulesCommandOptions): void {
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  printStatus(status);
}

export async function projectRulesInitCommand(
  targetPath = '.',
  options: ProjectRulesCommandOptions = {},
): Promise<ProjectRulesStatus> {
  const status = await new ProjectRulesService({ projectRoot: path.resolve(targetPath) }).init();
  outputStatus(status, options);
  return status;
}

export async function projectRulesScanCommand(
  targetPath = '.',
  options: ProjectRulesCommandOptions = {},
): Promise<ProjectRulesStatus> {
  const status = await new ProjectRulesService({ projectRoot: path.resolve(targetPath) }).scan();
  outputStatus(status, options);
  return status;
}

export async function projectRulesStatusCommand(
  targetPath = '.',
  options: ProjectRulesCommandOptions = {},
): Promise<ProjectRulesStatus> {
  const status = await new ProjectRulesService({ projectRoot: path.resolve(targetPath) }).status();
  outputStatus(status, options);
  return status;
}
