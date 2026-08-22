import path from 'node:path';

import {
  boundProjectKnowledgeResults,
  createProjectKnowledgeDashboardSnapshot,
  createProjectKnowledgeQuery,
  discoverProjectKnowledgeCorpus,
  LocalProjectKnowledgeProvider,
  ProjectKnowledgeIndexStore,
  readProjectKnowledgeIndexStatus,
  RemoteProjectKnowledgeProvider,
  renderProjectKnowledgeContext,
  type ProjectKnowledgeDiagnostic,
} from '../../domains/project-knowledge/index.js';
import { readWorkflowProjectConfig } from '../../domains/workflow-contract/project-config-reader.js';
import { DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG } from '../../domains/workflow-contract/project-config.js';

export interface ProjectKnowledgeCommandOptions {
  readonly json?: boolean;
  readonly query?: string;
  readonly path?: string;
  readonly operation?: string;
  readonly cacheRoot?: string;
}

export async function projectKnowledgeStatusCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const config = await knowledgeConfig(projectRoot);
  const base = createProjectKnowledgeDashboardSnapshot({ config });
  if (config.provider === 'remote') {
    print(base, options);
    return base;
  }
  const status = await readProjectKnowledgeIndexStatus({
    projectRoot,
    ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
  });
  const result = {
    ...base,
    index: {
      available: status.available,
      repositoryId: status.repositoryId,
      workspaceId: status.workspaceId,
      sources: status.sourceCount,
      sections: status.sectionCount,
      updatedAt: status.updatedAt ?? null,
      lastQueryMs: status.lastQueryMs ?? null,
      lastCandidateCount: status.lastCandidateCount ?? null,
      channels: status.channels,
    },
    diagnostics: status.diagnostic ? [status.diagnostic] : [],
  };
  print(result, options);
  return result;
}

export async function projectKnowledgeQueryCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const config = await knowledgeConfig(projectRoot);
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const reportDiagnostic = (diagnostic: ProjectKnowledgeDiagnostic): void => {
    diagnostics.push(diagnostic);
  };
  const query = createProjectKnowledgeQuery({
    task: required(options.query, '--query'),
    ...(options.path ? { path: options.path } : {}),
    ...(options.operation ? { operation: options.operation } : {}),
  });
  const provider =
    config.provider === 'remote'
      ? new RemoteProjectKnowledgeProvider({ config: config.remote!, reportDiagnostic })
      : new LocalProjectKnowledgeProvider({
          projectRoot,
          corpus: await discoverProjectKnowledgeCorpus({ projectRoot, reportDiagnostic }),
          ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
          reportDiagnostic,
        });
  const results = boundProjectKnowledgeResults(await provider.retrieve(query));
  const result = {
    provider: config.provider,
    results: results.map(({ source, title, content, score }) => ({
      source,
      ...(title ? { title } : {}),
      content,
      ...(score === undefined ? {} : { score }),
    })),
    diagnostics,
  };
  if (options.json) print(result, options);
  else console.log(renderProjectKnowledgeContext(results) ?? '没有匹配的项目知识。');
  return result;
}

export async function projectKnowledgeRebuildCommand(
  targetPath = '.',
  options: ProjectKnowledgeCommandOptions = {},
): Promise<unknown> {
  const projectRoot = path.resolve(targetPath);
  const config = await knowledgeConfig(projectRoot);
  if (config.provider !== 'local') {
    throw new Error('comet knowledge rebuild is only available for the Local provider');
  }
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const corpus = await discoverProjectKnowledgeCorpus({
    projectRoot,
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const store = new ProjectKnowledgeIndexStore({
    projectRoot,
    ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  try {
    const status = await store.rebuild(corpus);
    const result = {
      provider: 'local',
      rebuilt: true,
      repositoryId: status.repositoryId,
      workspaceId: status.workspaceId,
      sources: status.sourceCount,
      sections: status.sectionCount,
      updatedAt: status.updatedAt ?? null,
      diagnostics,
    };
    print(result, options);
    return result;
  } finally {
    store.close();
  }
}

async function knowledgeConfig(projectRoot: string) {
  const config = await readWorkflowProjectConfig(projectRoot);
  return config?.knowledge ?? { ...DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG };
}

function required(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new Error(`${option} must not be empty`);
  return value.trim();
}

function print(value: unknown, options: ProjectKnowledgeCommandOptions): void {
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else console.log(JSON.stringify(value, null, 2));
}
