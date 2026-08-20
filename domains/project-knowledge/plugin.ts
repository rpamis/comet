import type {
  PluginContext,
  PluginDashboardContribution,
  PluginDescriptor,
  PluginModule,
} from '../comet-plugin/index.js';
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
const MAX_RECENT_DIAGNOSTICS = 3;

export function createProjectKnowledgeDashboardContribution(
  language: ProjectKnowledgePluginOptions['language'] = 'zh-CN',
): PluginDashboardContribution {
  return {
    id: 'project-knowledge',
    label: language === 'en' ? 'Project Knowledge' : '项目知识',
    route: '/plugins/project-knowledge',
    load: async ({ invoke }) => invoke('status'),
  };
}

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
  const recentDiagnostics = await readRecentDiagnostics(context.storage);
  let diagnosticWrite = Promise.resolve();
  const persistDiagnostics = (): void => {
    const value = { diagnostics: [...recentDiagnostics] };
    diagnosticWrite = diagnosticWrite
      .then(() => context.storage.write(value))
      .catch(() => undefined);
  };
  const reportDiagnostic = (diagnostic: { code: string; message: string }): void => {
    const message = boundDiagnosticMessage(`[${diagnostic.code}] ${diagnostic.message}`);
    recentDiagnostics.push({ code: diagnostic.code, message });
    while (recentDiagnostics.length > MAX_RECENT_DIAGNOSTICS) recentDiagnostics.shift();
    persistDiagnostics();
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
    dashboard: createProjectKnowledgeDashboardContribution(options.language),
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
      await diagnosticWrite;
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

async function readRecentDiagnostics(
  storage: PluginContext['storage'],
): Promise<ProjectKnowledgeDashboardDiagnostic[]> {
  try {
    const value = await storage.read();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const diagnostics = (value as { diagnostics?: unknown }).diagnostics;
    if (!Array.isArray(diagnostics)) return [];
    return diagnostics
      .map((diagnostic): ProjectKnowledgeDashboardDiagnostic | null => {
        if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) return null;
        const code = (diagnostic as { code?: unknown }).code;
        const message = (diagnostic as { message?: unknown }).message;
        if (typeof code !== 'string' || typeof message !== 'string') return null;
        const boundedCode = code.trim().slice(0, 64);
        const boundedMessage = boundDiagnosticMessage(message);
        if (!boundedCode || !boundedMessage) return null;
        return { code: boundedCode, message: boundedMessage };
      })
      .filter(
        (diagnostic): diagnostic is ProjectKnowledgeDashboardDiagnostic => diagnostic !== null,
      )
      .slice(-MAX_RECENT_DIAGNOSTICS);
  } catch {
    return [];
  }
}

function boundDiagnosticMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/Authorization:\s*\S+/giu, 'Authorization: [redacted]')
    .slice(0, 240);
}

export { createProjectKnowledgeModule };
