import path from 'node:path';

import {
  discoverProjectKnowledgeCorpus,
  LocalProjectKnowledgeProvider,
  RemoteProjectKnowledgeProvider,
  createProjectKnowledgeQuery,
  type ProjectKnowledgeDiagnostic,
  type ProjectKnowledgeProvider,
} from '../../domains/project-knowledge/index.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';
import { readWorkflowProjectConfig } from '../../domains/workflow-contract/project-config-reader.js';
import { DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG } from '../../domains/workflow-contract/project-config.js';
import type { AgentContextOutcomeStatus } from '../../domains/agent-learning/index.js';

export interface ProjectKnowledgeCommandOptions {
  readonly json?: boolean;
  readonly task?: string;
  readonly path?: string;
  readonly operation?: string;
  readonly phase?: string;
  readonly cacheRoot?: string;
  readonly id?: string;
  readonly text?: string;
  readonly state?: 'trial' | 'proven' | 'enforced' | 'superseded' | 'all';
  readonly limit?: number;
  readonly outcome?: AgentContextOutcomeStatus;
}

export async function projectKnowledgeStatusCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const provider = await createProvider(projectRoot, options, diagnostics);
  try {
    const status = await provider.status();
    const result = {
      provider: status.provider,
      status,
      diagnostics: [...diagnostics, ...status.diagnostics],
    };
    print(result, options);
    return result;
  } finally {
    closeProvider(provider);
  }
}

export async function projectKnowledgeQueryCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const provider = await createProvider(projectRoot, options, diagnostics);
  try {
    const result = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({
        task: required(options.task, '--task'),
        path: options.path,
        phase: options.phase,
        operation: options.operation,
      }),
      limit: options.limit,
    });
    const output = { provider: providerName(provider), result, diagnostics };
    if (options.json) print(output, options);
    else
      console.log(
        result.kind === 'search' ? JSON.stringify(result.results, null, 2) : '没有匹配的项目知识。',
      );
    return output;
  } finally {
    closeProvider(provider);
  }
}

export async function projectKnowledgeListCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const provider = await createProvider(projectRoot, options, diagnostics);
  try {
    const result = await provider.query({
      kind: 'list',
      state: options.state ?? 'proven',
      limit: options.limit,
    });
    const output = { provider: providerName(provider), result, diagnostics };
    print(output, options);
    return output;
  } finally {
    closeProvider(provider);
  }
}

export async function projectKnowledgeGetCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const provider = await createProvider(projectRoot, options, diagnostics);
  try {
    const result = await provider.query({ kind: 'get', id: required(options.id, '--id') });
    const output = { provider: providerName(provider), result, diagnostics };
    print(output, options);
    return output;
  } finally {
    closeProvider(provider);
  }
}

export async function projectKnowledgeCorrectCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const provider = await createProvider(projectRoot, options, diagnostics);
  try {
    const result = await provider.apply({
      kind: 'correct',
      id: required(options.id, '--id'),
      projectId: resolveStableProjectId(projectRoot),
      summary: required(options.text, '--text'),
      updatedAt: new Date().toISOString(),
    });
    const output = { provider: providerName(provider), result, diagnostics };
    print(output, options);
    return output;
  } finally {
    closeProvider(provider);
  }
}

export async function projectKnowledgeForgetCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const provider = await createProvider(projectRoot, options, diagnostics);
  try {
    const result = await provider.apply({
      kind: 'supersede',
      id: required(options.id, '--id'),
      projectId: resolveStableProjectId(projectRoot),
      updatedAt: new Date().toISOString(),
    });
    const output = { provider: providerName(provider), result, diagnostics };
    print(output, options);
    return output;
  } finally {
    closeProvider(provider);
  }
}

export async function projectKnowledgeRebuildCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const provider = await createProvider(projectRoot, options, diagnostics);
  try {
    const result = await provider.apply({ kind: 'refresh' });
    const output = { provider: providerName(provider), result, diagnostics };
    print(output, options);
    return output;
  } finally {
    closeProvider(provider);
  }
}

export async function projectKnowledgeFeedbackCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const provider = await createProvider(projectRoot, options, diagnostics);
  try {
    const result = await provider.apply({
      kind: 'feedback',
      id: required(options.id, '--id'),
      projectId: resolveStableProjectId(projectRoot),
      outcome: requiredOutcome(options.outcome),
      updatedAt: new Date().toISOString(),
    });
    const output = { provider: providerName(provider), result, diagnostics };
    print(output, options);
    return output;
  } finally {
    closeProvider(provider);
  }
}

async function createProvider(
  projectRoot: string,
  options: ProjectKnowledgeCommandOptions,
  diagnostics: ProjectKnowledgeDiagnostic[],
): Promise<ProjectKnowledgeProvider> {
  const config = await knowledgeConfig(projectRoot);
  if (config.provider === 'remote') {
    return new RemoteProjectKnowledgeProvider({
      config: config.remote!,
      projectRoot,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
  }
  return new LocalProjectKnowledgeProvider({
    projectRoot,
    corpus: await discoverProjectKnowledgeCorpus({
      projectRoot,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }),
    ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
}

async function knowledgeConfig(projectRoot: string) {
  const config = await readWorkflowProjectConfig(projectRoot);
  return config?.knowledge ?? { ...DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG };
}

function closeProvider(provider: ProjectKnowledgeProvider): void {
  if (provider instanceof LocalProjectKnowledgeProvider) provider.close();
}

function providerName(provider: ProjectKnowledgeProvider): 'local' | 'remote' {
  return provider instanceof LocalProjectKnowledgeProvider ? 'local' : 'remote';
}

function required(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new Error(`${option} must not be empty`);
  return value.trim();
}

function requiredOutcome(value: AgentContextOutcomeStatus | undefined): AgentContextOutcomeStatus {
  if (value === undefined) throw new Error('--outcome must not be empty');
  return value;
}

function print(value: unknown, _options: ProjectKnowledgeCommandOptions): void {
  console.log(JSON.stringify(value, null, 2));
}
