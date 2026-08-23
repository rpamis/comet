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
import {
  createProjectKnowledgeChangedHint,
  ProjectKnowledgeLearningService,
  type ProjectKnowledgeChangedHint,
} from './learning.js';
import type {
  ProjectKnowledgePluginOptions,
  ProjectKnowledgeDashboardDiagnostic,
  ProjectKnowledgeProvider,
  ProjectKnowledgeResult,
} from './types.js';
import { resolveProjectKnowledgeStorageLocation } from '../../platform/paths/project-knowledge-storage.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

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
  const recentChangedHints = await readRecentChangedHints(context.storage);
  let diagnosticWrite = Promise.resolve();
  const persistDiagnostics = (): void => {
    const value = {
      diagnostics: [...recentDiagnostics],
      changedHints: [...recentChangedHints],
    };
    diagnosticWrite = diagnosticWrite
      .then(() => context.storage.write(value))
      .catch(() => undefined);
  };
  const reportDiagnostic = (diagnostic: { code: string; message: string }): void => {
    const message = boundDiagnosticMessage(`[${diagnostic.code}] ${diagnostic.message}`);
    const duplicate = recentDiagnostics.some(
      (entry) => entry.code === diagnostic.code && entry.message === message,
    );
    if (duplicate) return;
    recentDiagnostics.push({ code: diagnostic.code, message });
    while (recentDiagnostics.length > MAX_RECENT_DIAGNOSTICS) recentDiagnostics.shift();
    persistDiagnostics();
    context.reportDiagnostic({
      phase: 'context',
      code: 'execution-failed',
      message,
    });
  };
  const createProvider = async (): Promise<ProjectKnowledgeProvider> => {
    const key = options.knowledgeConfig.provider;
    const corpus =
      key === 'local'
        ? await discoverProjectKnowledgeCorpus({
            projectRoot: options.projectRoot,
            reportDiagnostic,
          })
        : [];
    return key === 'remote'
      ? new RemoteProjectKnowledgeProvider({
          config: options.knowledgeConfig.remote!,
          projectRoot: options.projectRoot,
          reportDiagnostic,
        })
      : new LocalProjectKnowledgeProvider({
          projectRoot: options.projectRoot,
          corpus,
          ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
          reportDiagnostic,
        });
  };
  const runDeterministicLearning = async (
    event: Parameters<ProjectKnowledgeLearningService['processEvent']>[0],
  ): Promise<void> => {
    const learningProvider = await createProvider();
    try {
      const learning = new ProjectKnowledgeLearningService({
        projectRoot: options.projectRoot,
        provider: learningProvider,
        ...(options.semanticReviewer ? { reviewer: options.semanticReviewer } : {}),
        reportDiagnostic,
      });
      await learning.processEvent(event);
    } finally {
      if (learningProvider instanceof LocalProjectKnowledgeProvider) learningProvider.close();
    }
  };
  const persistChangedHint = async (hint: ProjectKnowledgeChangedHint): Promise<void> => {
    recentChangedHints.push(hint);
    while (recentChangedHints.length > 8) recentChangedHints.shift();
    await context.storage.write({
      diagnostics: [...recentDiagnostics],
      changedHints: [...recentChangedHints],
    });
  };
  const getProvider = async (): Promise<ProjectKnowledgeProvider> => {
    const key = options.knowledgeConfig.provider;
    if (provider === null || providerKey !== key) {
      provider = await createProvider();
      providerKey = key;
    }
    return provider;
  };
  const clearProvider = (): void => {
    if (provider instanceof LocalProjectKnowledgeProvider) provider.close();
    provider = null;
    providerKey = '';
  };
  const dashboardSnapshot = async () => {
    let snapshotProvider: ProjectKnowledgeProvider | null = null;
    try {
      const snapshot = createProjectKnowledgeDashboardSnapshot({
        config: options.knowledgeConfig,
        language: options.language,
      });
      snapshotProvider = await createProvider();
      const activeProvider = snapshotProvider;
      const status = await activeProvider.status();
      const recordsResult = await activeProvider.query({ kind: 'list', state: 'all', limit: 100 });
      const records = recordsResult.kind === 'list' ? recordsResult.records : [];
      const localIndexStatus =
        snapshotProvider instanceof LocalProjectKnowledgeProvider
          ? await snapshotProvider.indexStatus()
          : null;
      const location = resolveProjectKnowledgeStorageLocation(
        options.projectRoot,
        options.cacheRoot,
      );
      const diagnostics = [
        ...recentDiagnostics,
        ...status.diagnostics,
        ...(recordsResult.kind === 'list' ? recordsResult.diagnostics : []),
      ].filter((diagnostic, index, all) => {
        const normalized = diagnostic.message.replace(/^\[[^\]]+\]\s*/u, '');
        return (
          all.findIndex(
            (candidate) =>
              candidate.code === diagnostic.code &&
              candidate.message.replace(/^\[[^\]]+\]\s*/u, '') === normalized,
          ) === index
        );
      });
      const result = {
        ...snapshot,
        status,
        records,
        counts: {
          active: records.filter((record) => record.state === 'active').length,
          needsReview: records.filter((record) => record.state === 'needs-review').length,
          retired: records.filter((record) => record.state === 'retired').length,
        },
        local:
          options.knowledgeConfig.provider === 'local'
            ? {
                available: status.healthy,
                repositoryId: location.repositoryId,
                workspaceId: location.workspaceId,
                sourceCount: localIndexStatus?.sourceCount ?? 0,
                sectionCount: localIndexStatus?.sectionCount ?? 0,
                ...((localIndexStatus?.updatedAt ?? status.updatedAt)
                  ? { updatedAt: localIndexStatus?.updatedAt ?? status.updatedAt }
                  : {}),
                channels: localIndexStatus?.channels ?? ['records', 'sections'],
              }
            : undefined,
        diagnostics: diagnostics.slice(-MAX_RECENT_DIAGNOSTICS),
      };
      return result;
    } finally {
      if (snapshotProvider instanceof LocalProjectKnowledgeProvider) snapshotProvider.close();
    }
  };
  return {
    dashboard: createProjectKnowledgeDashboardContribution(options.language),
    events: ['verification.completed', 'change.completed', 'task.completed'],
    dispose: async () => {
      clearProvider();
    },
    onEvent: async (event) => {
      const changedHint = createProjectKnowledgeChangedHint(event);
      if (changedHint !== null) await persistChangedHint(changedHint);
      const learn = async (): Promise<void> => {
        try {
          await runDeterministicLearning(event);
        } catch {
          reportDiagnostic({
            code: 'learning-failed',
            message: '项目知识自动学习暂不可用，本次工作流事件不受影响。',
          });
        }
      };
      if (options.runReviewInBackground !== undefined) {
        void Promise.resolve(options.runReviewInBackground(learn)).catch(() => {
          reportDiagnostic({
            code: 'learning-failed',
            message: '项目知识自动学习暂不可用，本次工作流事件不受影响。',
          });
        });
      } else {
        // Automatic learning is best effort and must not delay a checkpoint.
        void learn();
      }
      // The next context request must see the latest changed-path hint so the
      // local provider can refresh only the affected sources.
      clearProvider();
    },
    invoke: async (capability, input) => {
      try {
        const rawValue =
          input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
        if (capability === 'configure-provider') {
          if (options.updateKnowledgeConfig === undefined)
            throw new Error('Project Knowledge configuration is read-only in this host');
          const providerValue = rawValue.provider;
          if (providerValue !== 'local' && providerValue !== 'remote')
            throw new Error('provider must be local or remote');
          if (providerValue === 'local') {
            await options.updateKnowledgeConfig({ provider: 'local' });
          } else {
            const remoteValue = rawValue.remote;
            if (!remoteValue || typeof remoteValue !== 'object' || Array.isArray(remoteValue))
              throw new Error('remote provider configuration is required');
            const remote = remoteValue as Record<string, unknown>;
            if (typeof remote.endpoint !== 'string' || !remote.endpoint.trim())
              throw new Error('remote endpoint is required');
            const timeoutMs =
              typeof remote.timeoutMs === 'number' ? remote.timeoutMs : remote.timeout_ms;
            if (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs))
              throw new Error('remote timeout must be an integer');
            await options.updateKnowledgeConfig({
              provider: 'remote',
              remote: {
                endpoint: remote.endpoint.trim(),
                ...(typeof remote.tokenEnv === 'string' && remote.tokenEnv.trim()
                  ? { token_env: remote.tokenEnv.trim() }
                  : {}),
                ...(typeof remote.scope === 'string' && remote.scope.trim()
                  ? { scope: remote.scope.trim() }
                  : {}),
                timeout_ms: timeoutMs,
              },
            });
          }
          clearProvider();
          return { configured: true };
        }
        const activeProvider = await getProvider();
        const value = rawValue;
        const projectId = resolveStableProjectId(options.projectRoot);
        if (capability === 'status') return dashboardSnapshot();
        if (capability === 'list') {
          const state = value.state;
          return activeProvider.query({
            kind: 'list',
            projectId,
            ...(state === 'active' ||
            state === 'needs-review' ||
            state === 'retired' ||
            state === 'all'
              ? { state }
              : { state: 'all' }),
            limit: typeof value.limit === 'number' ? Math.min(500, Math.max(1, value.limit)) : 100,
          });
        }
        if (capability === 'get') {
          if (typeof value.id !== 'string' || !value.id.trim()) throw new Error('get requires id');
          return activeProvider.query({ kind: 'get', id: value.id.trim(), projectId });
        }
        if (capability === 'query') {
          if (typeof value.task !== 'string' || !value.task.trim())
            throw new Error('query requires task');
          return activeProvider.query({
            kind: 'search',
            query: createProjectKnowledgeQuery({
              task: value.task,
              ...(typeof value.path === 'string' ? { path: value.path } : {}),
              ...(typeof value.phase === 'string' ? { phase: value.phase } : {}),
              ...(typeof value.operation === 'string' ? { operation: value.operation } : {}),
            }),
            limit: 8,
          });
        }
        if (capability === 'correct') {
          if (typeof value.id !== 'string' || !value.id.trim())
            throw new Error('correct requires id');
          if (typeof value.text !== 'string' || !value.text.trim())
            throw new Error('correct requires text');
          return activeProvider.apply({
            kind: 'correct',
            id: value.id.trim(),
            projectId,
            summary: value.text.trim().slice(0, 2000),
            updatedAt: new Date().toISOString(),
          });
        }
        if (capability === 'forget') {
          if (typeof value.id !== 'string' || !value.id.trim())
            throw new Error('forget requires id');
          return activeProvider.apply({
            kind: 'retire',
            id: value.id.trim(),
            projectId,
            updatedAt: new Date().toISOString(),
          });
        }
        if (capability === 'refresh') {
          return activeProvider.apply({ kind: 'refresh', projectId });
        }
        throw new Error(`Unknown project knowledge capability: ${capability}`);
      } finally {
        clearProvider();
      }
    },
    provideContext: async (request) => {
      try {
        const query = createProjectKnowledgeQuery(request);
        const activeProvider = await getProvider();
        const response = await activeProvider.query({ kind: 'search', query, limit: 8 });
        const results = boundProjectKnowledgeResults(
          response.kind === 'search' ? response.results : [],
        );
        if (recentChangedHints.length > 0) {
          recentChangedHints.splice(0, recentChangedHints.length);
          persistDiagnostics();
        }
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
      } finally {
        clearProvider();
      }
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

async function readRecentChangedHints(
  storage: PluginContext['storage'],
): Promise<ProjectKnowledgeChangedHint[]> {
  try {
    const value = await storage.read();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const hints = (value as { changedHints?: unknown }).changedHints;
    if (!Array.isArray(hints)) return [];
    return hints
      .filter((hint): hint is ProjectKnowledgeChangedHint => {
        if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return false;
        const value = hint as Partial<ProjectKnowledgeChangedHint>;
        return typeof value.eventName === 'string' && typeof value.changeId === 'string';
      })
      .slice(-8);
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
