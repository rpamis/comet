import { discoverProjectKnowledgeCorpus } from './corpus.js';
import { LocalProjectKnowledgeProvider } from './local-provider.js';
import { RemoteProjectKnowledgeProvider } from './remote-provider.js';
import type { ProjectKnowledgeDiagnosticReporter, ProjectKnowledgeProvider } from './types.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import { DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG } from '../workflow-contract/project-config.js';

export interface ProjectKnowledgeProviderFactoryOptions {
  readonly projectRoot: string;
  readonly cacheRoot?: string;
  readonly reportDiagnostic?: ProjectKnowledgeDiagnosticReporter;
}

export async function createProjectKnowledgeProvider(
  options: ProjectKnowledgeProviderFactoryOptions,
): Promise<ProjectKnowledgeProvider> {
  const config = await readWorkflowProjectConfig(options.projectRoot);
  const knowledge = config?.knowledge ?? { ...DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG };
  if (knowledge.provider === 'remote') {
    return new RemoteProjectKnowledgeProvider({
      config: knowledge.remote!,
      projectRoot: options.projectRoot,
      ...(options.reportDiagnostic ? { reportDiagnostic: options.reportDiagnostic } : {}),
    });
  }
  return new LocalProjectKnowledgeProvider({
    projectRoot: options.projectRoot,
    corpus: await discoverProjectKnowledgeCorpus({
      projectRoot: options.projectRoot,
      ...(options.reportDiagnostic ? { reportDiagnostic: options.reportDiagnostic } : {}),
    }),
    ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
    ...(options.reportDiagnostic ? { reportDiagnostic: options.reportDiagnostic } : {}),
  });
}

export function closeProjectKnowledgeProvider(provider: ProjectKnowledgeProvider): void {
  if (provider instanceof LocalProjectKnowledgeProvider) provider.close();
}

export function projectKnowledgeProviderName(
  provider: ProjectKnowledgeProvider,
): 'local' | 'remote' {
  return provider instanceof LocalProjectKnowledgeProvider ? 'local' : 'remote';
}
