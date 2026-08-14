import path from 'node:path';

import { createDefaultCometPluginBridge } from '../../domains/comet-plugin/index.js';
import { ProjectRulesService, type ProjectRulesStatus } from '../../domains/project-rules/index.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

interface ProjectRulesCommandOptions {
  readonly json?: boolean;
  readonly text?: string;
  readonly targetPath?: string;
  readonly id?: string;
  readonly task?: string;
  readonly path?: string;
  readonly workflow?: string;
  readonly change?: string;
  readonly candidateKey?: string;
  readonly source?: string;
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

export async function projectRulesAddCommand(
  targetPath = '.',
  options: ProjectRulesCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath);
  const result = await bridge.addRule(requireText(options.text, '--text'), options.targetPath);
  print(result, options);
  return result;
}

export async function projectRulesObserveCommand(
  targetPath = '.',
  options: ProjectRulesCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath);
  const result = await bridge.projectRulesAction('observe', {
    candidateKey: requireText(options.candidateKey, '--candidate-key'),
    text: requireText(options.text, '--text'),
    workflow: requireText(options.workflow, '--workflow'),
    changeId: requireText(options.change, '--change'),
    success: true,
  });
  print(result, options);
  return result;
}

export async function projectRulesCandidatesCommand(
  targetPath = '.',
  options: ProjectRulesCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath);
  const result = await bridge.projectRulesAction('details');
  print(result, options);
  return result;
}

export async function projectRulesCandidateActionCommand(
  action: 'adopt' | 'ignore' | 'snooze' | 'restore',
  targetPath = '.',
  options: ProjectRulesCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath);
  const input = {
    ...(options.id ? { id: options.id } : {}),
    ...(options.text ? { text: options.text } : {}),
    ...(options.targetPath ? { targetPath: options.targetPath } : {}),
  };
  const result = await bridge.projectRulesAction(action, input);
  print(result, options);
  return result;
}

export async function projectRulesContextCommand(
  targetPath = '.',
  options: ProjectRulesCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath);
  const result = await bridge.selectRules({
    task: requireText(options.task, '--task'),
    ...(options.path ? { path: options.path } : {}),
  });
  print(result, options);
  return result;
}

export async function projectRulesProposeCommand(
  targetPath = '.',
  options: ProjectRulesCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath);
  const result = await bridge.projectRulesAction('propose');
  print(result, options);
  return result;
}

export async function projectRulesVerifyCommand(
  targetPath = '.',
  options: ProjectRulesCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath);
  const result = await bridge.projectRulesAction('verify');
  print(result, options);
  return result;
}

async function createBridge(targetPath: string) {
  const projectRoot = path.resolve(targetPath);
  return createDefaultCometPluginBridge({
    projectRoot,
    projectId: resolveStableProjectId(projectRoot),
  });
}

function requireText(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new Error(`${option} must not be empty`);
  return value.trim();
}

function print(value: unknown, options: ProjectRulesCommandOptions): void {
  if (options.json) {
    console.log(JSON.stringify(value, null, 2));
  } else if (value !== undefined) {
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  }
}
