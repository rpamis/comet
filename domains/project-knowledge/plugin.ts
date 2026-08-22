import type {
  PluginContext,
  PluginDashboardContribution,
  PluginDescriptor,
  PluginModule,
} from '../comet-plugin/index.js';
import { discoverProjectKnowledgeCorpus } from './corpus.js';
import { createProjectKnowledgeDashboardSnapshot } from './dashboard.js';
import { LocalProjectKnowledgeProvider } from './local-provider.js';
import { readProjectKnowledgeIndexStatus } from './index-store.js';
import { createProjectKnowledgeQuery } from './query.js';
import { RemoteProjectKnowledgeProvider } from './remote-provider.js';
import { renderProjectKnowledgeContext, boundProjectKnowledgeResults } from './renderer.js';
import {
  createProjectKnowledgeChangedHint,
  ProjectKnowledgeLearningService,
  type ProjectKnowledgeChangedHint,
} from './learning.js';
import { ProjectKnowledgeUnitRepository } from './units.js';
import type { ProjectKnowledgeUnit } from './units.js';
import { validateProjectKnowledgeUnitShape } from './units.js';
import type {
  ProjectKnowledgePluginOptions,
  ProjectKnowledgeDashboardDiagnostic,
  ProjectKnowledgeLegacyProvider,
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
  let provider: ProjectKnowledgeLegacyProvider | null = null;
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
    recentDiagnostics.push({ code: diagnostic.code, message });
    while (recentDiagnostics.length > MAX_RECENT_DIAGNOSTICS) recentDiagnostics.shift();
    persistDiagnostics();
    context.reportDiagnostic({
      phase: 'context',
      code: 'execution-failed',
      message,
    });
  };
  const unitRepository = new ProjectKnowledgeUnitRepository({
    projectRoot: options.projectRoot,
    ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
    reportDiagnostic,
  });
  const runDeterministicLearning = async (
    event: Parameters<ProjectKnowledgeLearningService['processEvent']>[0],
  ): Promise<void> => {
    if (options.knowledgeConfig.provider !== 'local') {
      reportDiagnostic({
        code: 'remote-learning-unavailable',
        message: 'Remote Provider 尚未提供学习写入接口，本次不回退到 Local。',
      });
      return;
    }
    const corpus = await discoverProjectKnowledgeCorpus({
      projectRoot: options.projectRoot,
      reportDiagnostic,
    });
    const learningProvider = new LocalProjectKnowledgeProvider({
      projectRoot: options.projectRoot,
      corpus,
      ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
      reportDiagnostic,
    });
    try {
      const learning = new ProjectKnowledgeLearningService({
        projectRoot: options.projectRoot,
        provider: learningProvider,
        ...(options.semanticReviewer ? { reviewer: options.semanticReviewer } : {}),
        reportDiagnostic,
      });
      await learning.processEvent(event);
    } finally {
      learningProvider.close();
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
  const dashboardSnapshot = async () => {
    const snapshot = createProjectKnowledgeDashboardSnapshot({
      config: options.knowledgeConfig,
      language: options.language,
    });
    if (options.knowledgeConfig.provider !== 'local') {
      return { ...snapshot, diagnostics: [...recentDiagnostics] };
    }
    const status = await readProjectKnowledgeIndexStatus({
      projectRoot: options.projectRoot,
      ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
    });
    return {
      ...snapshot,
      local: {
        available: status.available,
        repositoryId: status.repositoryId,
        workspaceId: status.workspaceId,
        sourceCount: status.sourceCount,
        sectionCount: status.sectionCount,
        ...(status.updatedAt ? { updatedAt: status.updatedAt } : {}),
        ...(status.lastQueryMs === undefined ? {} : { lastQueryMs: status.lastQueryMs }),
        ...(status.lastCandidateCount === undefined
          ? {}
          : { lastCandidateCount: status.lastCandidateCount }),
        channels: status.channels,
        ...(await unitDashboardSummary(unitRepository, recentChangedHints)),
      },
      diagnostics: [
        ...recentDiagnostics,
        ...(status.diagnostic ? [{ code: 'index-status', message: status.diagnostic }] : []),
      ].slice(-MAX_RECENT_DIAGNOSTICS),
    };
  };
  return {
    dashboard: createProjectKnowledgeDashboardContribution(options.language),
    events: ['verification.completed', 'change.completed', 'task.completed'],
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
      provider = null;
      providerKey = '';
    },
    invoke: async (capability, input) => {
      if (capability !== 'status' && capability !== 'units' && capability !== 'share-memory')
        throw new Error(`Unknown project knowledge capability: ${capability}`);
      const snapshot = await dashboardSnapshot();
      if (capability === 'units') {
        return (snapshot as { local?: { units?: unknown } }).local?.units ?? [];
      }
      if (capability === 'share-memory') {
        const record = input as { unit?: unknown; confirm?: unknown };
        if (record.confirm !== true) throw new Error('share-memory requires confirmation');
        const unit = validateProjectKnowledgeUnitShape(record.unit);
        if (unit.origin !== 'maintained') throw new Error('shared unit must be maintained');
        const shared = await unitRepository.shareMaintained(unit, { confirm: true });
        return { shared: true, unit: shared };
      }
      return snapshot;
    },
    provideContext: async (request) => {
      const query = createProjectKnowledgeQuery(request);
      const key = options.knowledgeConfig.provider;
      let targetedProvider = false;
      if (provider === null || providerKey !== key) {
        const corpus =
          key === 'local'
            ? await discoverProjectKnowledgeCorpus({
                projectRoot: options.projectRoot,
                reportDiagnostic,
              })
            : [];
        const changedPaths = recentChangedHints.flatMap((hint) => [
          ...hint.changedPaths,
          ...hint.artifactRefs,
        ]);
        provider =
          key === 'remote'
            ? new RemoteProjectKnowledgeProvider({
                config: options.knowledgeConfig.remote!,
                reportDiagnostic,
              })
            : new LocalProjectKnowledgeProvider({
                projectRoot: options.projectRoot,
                corpus,
                ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
                reportDiagnostic,
                unitRepository,
                changedPaths,
              });
        providerKey = key;
        if (changedPaths.length > 0) {
          targetedProvider = true;
          recentChangedHints.splice(0, recentChangedHints.length);
          persistDiagnostics();
        }
      }
      const results = boundProjectKnowledgeResults(await provider.retrieve(query));
      if (targetedProvider) {
        // The hint is a one-request optimization. Recreate the provider on the
        // next request so deterministic units can perform a complete refresh.
        provider = null;
        providerKey = '';
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

async function unitDashboardSummary(
  repository: ProjectKnowledgeUnitRepository,
  changedHints: readonly ProjectKnowledgeChangedHint[],
): Promise<{
  unitCount: number;
  activeUnitCount: number;
  draftUnitCount: number;
  retiredUnitCount: number;
  relationCount: number;
  units: readonly ProjectKnowledgeUnit[];
  changedHints: readonly ProjectKnowledgeChangedHint[];
}> {
  const units = await repository.list();
  return {
    unitCount: units.length,
    activeUnitCount: units.filter((unit) => unit.state === 'active').length,
    draftUnitCount: units.filter((unit) => unit.state === 'draft').length,
    retiredUnitCount: units.filter((unit) => unit.state === 'retired').length,
    relationCount: units.reduce((total, unit) => total + unit.relations.length, 0),
    units,
    changedHints,
  };
}

function boundDiagnosticMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/Authorization:\s*\S+/giu, 'Authorization: [redacted]')
    .slice(0, 240);
}

export { createProjectKnowledgeModule };
