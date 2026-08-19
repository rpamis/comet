import type { PluginContext, PluginDescriptor, PluginModule } from '../comet-plugin/index.js';
import { discoverProjectKnowledgeCorpus } from './corpus.js';
import { LocalProjectKnowledgeProvider } from './local-provider.js';
import { createProjectKnowledgeQuery } from './query.js';
import { RemoteProjectKnowledgeProvider } from './remote-provider.js';
import { renderProjectKnowledgeContext, boundProjectKnowledgeResults } from './renderer.js';
import type {
  ProjectKnowledgePluginOptions,
  ProjectKnowledgeProvider,
  ProjectKnowledgeResult,
} from './types.js';

export const PROJECT_KNOWLEDGE_PLUGIN_ID = 'comet.project-knowledge';

export function createProjectKnowledgePluginDescriptor(
  options: ProjectKnowledgePluginOptions,
): PluginDescriptor {
  return {
    id: PROJECT_KNOWLEDGE_PLUGIN_ID,
    kind: 'first-party',
    version: options.version ?? '1.0.0',
    scopes: ['project'],
    compatible: options.cometVersionRange ?? (() => true),
    create: async (context) => createProjectKnowledgeModule(context, options),
  };
}

async function createProjectKnowledgeModule(
  context: PluginContext,
  options: ProjectKnowledgePluginOptions,
): Promise<PluginModule> {
  let provider: ProjectKnowledgeProvider | null = null;
  let providerKey = '';
  const reportDiagnostic = (diagnostic: { code: string; message: string }): void => {
    context.reportDiagnostic({
      phase: 'context',
      code: 'execution-failed',
      message: `[${diagnostic.code}] ${diagnostic.message}`,
    });
  };
  return {
    provideContext: async (request) => {
      const query = createProjectKnowledgeQuery(request);
      const key = options.knowledgeConfig.provider;
      if (provider === null || providerKey !== key) {
        const corpus =
          key === 'local'
            ? await discoverProjectKnowledgeCorpus({
                projectRoot: options.projectRoot,
                reportDiagnostic,
              })
            : [];
        provider =
          key === 'remote'
            ? new RemoteProjectKnowledgeProvider({
                config: options.knowledgeConfig.remote!,
                reportDiagnostic,
              })
            : new LocalProjectKnowledgeProvider({
                projectRoot: options.projectRoot,
                corpus,
                reportDiagnostic,
              });
        providerKey = key;
      }
      const results = boundProjectKnowledgeResults(await provider.retrieve(query));
      const text = renderProjectKnowledgeContext(results, options.language ?? 'zh-CN');
      if (!text) return null;
      return {
        text,
        records: results.map((result: ProjectKnowledgeResult) => ({
          source: result.source,
          ...(result.title ? { title: result.title } : {}),
          content: result.content,
        })),
      };
    },
  };
}

export { createProjectKnowledgeModule };
