import type { PluginContext, PluginDescriptor, PluginModule } from '../comet-plugin/index.js';
import { discoverProjectKnowledgeCorpus } from './corpus.js';
import { createProjectKnowledgeDashboardSnapshot } from './dashboard.js';
import { LocalProjectKnowledgeProvider } from './local-provider.js';
import { createProjectKnowledgeQuery } from './query.js';
import { RemoteProjectKnowledgeProvider } from './remote-provider.js';
import { renderProjectKnowledgeContext, boundProjectKnowledgeResults } from './renderer.js';
import type {
  ProjectKnowledgePluginOptions,
  ProjectKnowledgeDashboardDiagnostic,
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
  const recentDiagnostics: ProjectKnowledgeDashboardDiagnostic[] = [];
  const reportDiagnostic = (diagnostic: { code: string; message: string }): void => {
    const message = boundDiagnosticMessage(`[${diagnostic.code}] ${diagnostic.message}`);
    recentDiagnostics.push({ code: diagnostic.code, message });
    while (recentDiagnostics.length > 3) recentDiagnostics.shift();
    context.reportDiagnostic({
      phase: 'context',
      code: 'execution-failed',
      message,
    });
  };
  const dashboardSnapshot = () => ({
    ...createProjectKnowledgeDashboardSnapshot({
      config: options.knowledgeConfig,
      language: options.language,
    }),
    diagnostics: [...recentDiagnostics],
  });
  return {
    dashboard: {
      id: 'project-knowledge',
      label: options.language === 'en' ? 'Project Knowledge' : '项目知识',
      route: '/plugins/project-knowledge',
      load: async ({ invoke }) => invoke('status'),
    },
    invoke: async (capability) => {
      if (capability !== 'status')
        throw new Error(`Unknown project knowledge capability: ${capability}`);
      return dashboardSnapshot();
    },
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

function boundDiagnosticMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/Authorization:\s*\S+/giu, 'Authorization: [redacted]')
    .slice(0, 240);
}

export { createProjectKnowledgeModule };
