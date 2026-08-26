import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type {
  PluginContext,
  PluginDashboardContribution,
  PluginDescriptor,
  PluginModule,
} from '../comet-plugin/index.js';
import {
  compileProjectPolicy,
  contextOutcomeTargetIds,
  reflectionEvents,
  type AgentContextCandidate,
  type AgentLearningDelta,
  type ProjectPolicyActivation,
  type ProjectPolicyKind,
} from '../agent-learning/index.js';
import { discoverProjectKnowledgeCorpus } from './corpus.js';
import { createProjectKnowledgeDashboardSnapshot } from './dashboard.js';
import { LocalProjectKnowledgeProvider } from './local-provider.js';
import { createProjectKnowledgeQuery } from './query.js';
import {
  createUserProjectKnowledgeRecord,
  type ProjectKnowledgeRecord,
  type ProjectKnowledgeRecordSource,
  type ProjectKnowledgeRecordType,
  type ProjectKnowledgeRecordVerification,
} from './records.js';
import { RemoteProjectKnowledgeProvider } from './remote-provider.js';
import {
  createProjectKnowledgeChangedHint,
  ProjectKnowledgeLearningService,
  type ProjectKnowledgeChangedHint,
} from './learning.js';
import type {
  ProjectKnowledgePluginOptions,
  ProjectKnowledgeDashboardDiagnostic,
  ProjectKnowledgeProvider,
  ProjectKnowledgeQueryResult,
  ProjectKnowledgeResult,
} from './types.js';
import { resolveProjectKnowledgeStorageLocation } from '../../platform/paths/project-knowledge-storage.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';
import { RaceSafeReadError } from '../../platform/fs/race-safe-read.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';

export const PROJECT_KNOWLEDGE_PLUGIN_ID = 'comet.project-knowledge';
const MAX_RECENT_DIAGNOSTICS = 3;
const DASHBOARD_SOURCE_MAX_BYTES = 2 * 1024 * 1024;

const PROJECT_KNOWLEDGE_RECORD_TYPES = new Set<ProjectKnowledgeRecordType>([
  'topology',
  'fact',
  'dependency',
  'decision',
  'pattern',
  'procedure',
  'constraint',
  'failure-resolution',
]);

const PROJECT_POLICY_TYPES = new Set<ProjectPolicyKind>([
  'decision',
  'pattern',
  'procedure',
  'constraint',
  'failure-resolution',
]);

function stringList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim())
      throw new Error(`${label}[${index}] must be a non-empty string`);
    return entry.trim();
  });
}

function recordSources(value: unknown): ProjectKnowledgeRecordSource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('sources must be an array');
  return value.map((entry, index) => {
    if (typeof entry === 'string' && entry.trim()) return { source: entry.trim() };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error(`sources[${index}] must be a source object or string`);
    const source = (entry as { source?: unknown }).source;
    if (typeof source !== 'string' || !source.trim())
      throw new Error(`sources[${index}].source must be a non-empty string`);
    const anchor = (entry as { anchor?: unknown }).anchor;
    return {
      source: source.trim(),
      ...(typeof anchor === 'string' && anchor.trim() ? { anchor: anchor.trim() } : {}),
    };
  });
}

function recordVerification(value: unknown): ProjectKnowledgeRecordVerification[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('verification must be an array');
  return value.map((entry, index) => {
    if (typeof entry === 'string' && entry.trim()) return { command: entry.trim() };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error(`verification[${index}] must be a command object or string`);
    const command = (entry as { command?: unknown }).command;
    if (typeof command !== 'string' || !command.trim())
      throw new Error(`verification[${index}].command must be a non-empty string`);
    const expected = (entry as { expected?: unknown }).expected;
    return {
      command: command.trim(),
      ...(typeof expected === 'string' && expected.trim() ? { expected: expected.trim() } : {}),
    };
  });
}

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
  const clearDiagnostic = (code: string): void => {
    const retained = recentDiagnostics.filter((entry) => entry.code !== code);
    if (retained.length === recentDiagnostics.length) return;
    recentDiagnostics.splice(0, recentDiagnostics.length, ...retained);
    persistDiagnostics();
  };
  const clearRecoveredLocalSearchDiagnostic = (response: ProjectKnowledgeQueryResult): void => {
    if (options.knowledgeConfig.provider !== 'local' || response.kind !== 'search') return;
    if (response.diagnostics.some((diagnostic) => diagnostic.code === 'local-tool-missing')) return;
    clearDiagnostic('local-tool-missing');
  };
  const createProvider = async (
    providerOptions: { readonly discoverCorpus?: boolean } = {},
  ): Promise<ProjectKnowledgeProvider> => {
    const key = options.knowledgeConfig.provider;
    const corpus =
      key === 'local' && providerOptions.discoverCorpus !== false
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
  const reflectProjectKnowledge = async (
    event: Parameters<ProjectKnowledgeLearningService['processEvent']>[0],
  ) => {
    const learningProvider = await createProvider();
    try {
      const learning = new ProjectKnowledgeLearningService({
        projectRoot: options.projectRoot,
        provider: learningProvider,
        language: options.language,
        ...(options.semanticReviewer ? { reviewer: options.semanticReviewer } : {}),
        reportDiagnostic,
      });
      return await learning.reflectEvent(event);
    } finally {
      if (learningProvider instanceof LocalProjectKnowledgeProvider) learningProvider.close();
    }
  };
  const ensureProjectModel = async (provider: ProjectKnowledgeProvider): Promise<void> => {
    const projectId = resolveStableProjectId(options.projectRoot);
    const listed = await provider.query({ kind: 'list', projectId, state: 'all', limit: 500 });
    if (
      listed.kind === 'list' &&
      listed.records.some(
        (record) =>
          record.state !== 'superseded' && ['topology', 'fact', 'dependency'].includes(record.type),
      )
    ) {
      return;
    }
    const corpus =
      options.knowledgeConfig.provider === 'local'
        ? await discoverProjectKnowledgeCorpus({
            projectRoot: options.projectRoot,
            reportDiagnostic,
          })
        : [];
    const learning = new ProjectKnowledgeLearningService({
      projectRoot: options.projectRoot,
      provider,
      language: options.language,
      reportDiagnostic,
    });
    await learning.bootstrapProjectModel(corpus.map((document) => document.source));
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
    let snapshotProvider: ProjectKnowledgeProvider | null = null;
    try {
      const snapshot = createProjectKnowledgeDashboardSnapshot({
        config: options.knowledgeConfig,
        language: options.language,
      });
      snapshotProvider = await createProvider({ discoverCorpus: false });
      const activeProvider = snapshotProvider;
      const status = await activeProvider.status();
      const recordsResult = await activeProvider.query({ kind: 'list', state: 'all', limit: 100 });
      const records = recordsResult.kind === 'list' ? recordsResult.records : [];
      const applications = (await options.listContextApplications?.()) ?? [];
      const dashboardRecords = records.map((record) => ({
        ...record,
        ...contextApplicationProjection(record.id, applications),
        ...(projectPolicyActivation(record) === undefined
          ? {}
          : { activation: projectPolicyActivation(record) }),
      }));
      const currentManifest = latestApplicationBatch(applications, PROJECT_KNOWLEDGE_PLUGIN_ID);
      const recordsById = new Map(dashboardRecords.map((record) => [record.id, record]));
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
        records: dashboardRecords,
        counts: {
          trial: records.filter((record) => record.state === 'trial').length,
          proven: records.filter((record) => record.state === 'proven').length,
          enforced: records.filter((record) => record.state === 'enforced').length,
          superseded: records.filter((record) => record.state === 'superseded').length,
        },
        manifestPreview: currentManifest.flatMap((application) => {
          const record = recordsById.get(application.candidateId);
          const history = applications.filter(
            (entry) =>
              entry.owner === PROJECT_KNOWLEDGE_PLUGIN_ID &&
              entry.candidateId === application.candidateId,
          );
          if (
            record === undefined &&
            (application.candidateTitle === undefined ||
              application.candidateSummary === undefined ||
              application.candidateState === undefined)
          ) {
            return [];
          }
          return [
            {
              id: record?.id ?? application.candidateId,
              memoryType:
                record === undefined
                  ? application.memoryType === 'project-model'
                    ? 'project-model'
                    : 'project-policy'
                  : ['topology', 'fact', 'dependency'].includes(record.type)
                    ? 'project-model'
                    : 'project-policy',
              state: record?.state ?? application.candidateState!,
              title: record?.title ?? application.candidateTitle!,
              summary: record?.summary ?? application.candidateSummary!,
              whyApplied: application.whyApplied,
              applicationCount: record?.applicationCount ?? history.length,
              successCount:
                record?.successCount ??
                history.filter((entry) => entry.outcome === 'used-successfully').length,
              failureCount:
                record?.failureCount ??
                history.filter(
                  (entry) =>
                    entry.outcome === 'corrected' || entry.outcome === 'contributed-to-failure',
                ).length,
              delivery: application.delivery,
              appliedAt: application.appliedAt,
              ...(application.outcome === undefined ? {} : { outcome: application.outcome }),
              lastApplication: application,
              ...(record?.activation === undefined ? {} : { activation: record.activation }),
            },
          ];
        }),
        local:
          options.knowledgeConfig.provider === 'local'
            ? {
                available: status.healthy,
                repositoryId: location.repositoryId,
                workspaceId: location.workspaceId,
                sourceCount: localIndexStatus?.sourceCount ?? 0,
                sources: localIndexStatus?.sources ?? [],
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
    events: [
      'verification.completed',
      'review.resolved',
      'failure.resolved',
      'change.archived',
      'repository.changed',
      'context.outcome',
    ],
    reflect: async (request) => {
      const deltas: AgentLearningDelta[] = [];
      let deferred = false;
      for (const event of reflectionEvents(request)) {
        if (event.type === 'context.outcome' && event.outcome !== undefined) {
          for (const id of contextOutcomeTargetIds(
            event.outcome.unitIds,
            PROJECT_KNOWLEDGE_PLUGIN_ID,
          )) {
            deltas.push({
              action: 'update',
              owner: PROJECT_KNOWLEDGE_PLUGIN_ID,
              targetId: id,
              memoryType: 'project-policy',
              kind: 'application-feedback',
              statement: event.outcome.summary ?? `Context outcome: ${event.outcome.status}`,
              applicability: projectExperienceApplicability(event),
              evidence: event.evidence,
              ...(event.outcome.applicationId === undefined || event.outcome.revision === undefined
                ? {}
                : {
                    feedback: {
                      applicationId: event.outcome.applicationId,
                      status: event.outcome.status,
                      ...(event.outcome.previousStatus === undefined
                        ? {}
                        : { previousStatus: event.outcome.previousStatus }),
                      revision: event.outcome.revision,
                    },
                  }),
              recommendedState:
                event.outcome.status === 'corrected' ||
                event.outcome.status === 'contributed-to-failure'
                  ? 'superseded'
                  : 'proven',
            });
          }
          continue;
        }
        const changedHint = createProjectKnowledgeChangedHint(event);
        if (changedHint !== null) await persistChangedHint(changedHint);
        const result = await reflectProjectKnowledge(event);
        deferred ||= result.deferred;
        deltas.push(...result.deltas);
      }
      return { deltas, deferred };
    },
    consolidate: async ({ deltas }) => {
      let consolidationProvider: ProjectKnowledgeProvider | null = null;
      try {
        consolidationProvider = await createProvider({ discoverCorpus: false });
        for (const { delta, idempotencyKey } of deltas) {
          await consolidationProvider.apply({
            kind: 'experience-delta',
            delta,
            idempotencyKey,
            updatedAt: new Date().toISOString(),
          });
        }
      } finally {
        if (consolidationProvider instanceof LocalProjectKnowledgeProvider) {
          consolidationProvider.close();
        }
      }
    },
    invoke: async (capability, input) => {
      let activeProvider: ProjectKnowledgeProvider | null = null;
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
            await options.updateKnowledgeConfig({
              provider: 'local',
              ...(options.knowledgeConfig.local
                ? { local: { include: [...options.knowledgeConfig.local.include] } }
                : {}),
            });
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
              ...(options.knowledgeConfig.local
                ? { local: { include: [...options.knowledgeConfig.local.include] } }
                : {}),
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
          return { configured: true };
        }
        const value = rawValue;
        const projectId = resolveStableProjectId(options.projectRoot);
        if (capability === 'status') return dashboardSnapshot();
        if (capability === 'read-source') {
          if (typeof value.source !== 'string' || !value.source.trim())
            throw new Error('read-source requires source');
          const source = value.source.trim().replaceAll('\\', '/');
          try {
            const result = await readProtectedProjectFile(
              options.projectRoot,
              source,
              DASHBOARD_SOURCE_MAX_BYTES,
              { label: `Project Knowledge source ${source}` },
            );
            if (result.bytes.includes(0)) throw new Error('来源文件不是可查看的文本文件');
            return {
              kind: 'source',
              source,
              content: result.bytes.toString('utf8'),
              size: Number(result.stat.size),
              modifiedAt: new Date(Number(result.stat.mtimeMs)).toISOString(),
              truncated: false,
            };
          } catch (error) {
            if (error instanceof RaceSafeReadError && error.reason === 'too-large') {
              throw new Error('来源文件过大，无法在 Dashboard 内完整查看', { cause: error });
            }
            if (error instanceof Error && error.message.includes('不是可查看的文本文件')) {
              throw error;
            }
            throw new Error('来源文件无法读取', { cause: error });
          }
        }
        activeProvider = await createProvider();
        if (capability === 'list') {
          const state = value.state;
          return await activeProvider.query({
            kind: 'list',
            projectId,
            ...(state === 'trial' ||
            state === 'proven' ||
            state === 'enforced' ||
            state === 'superseded' ||
            state === 'all'
              ? { state }
              : { state: 'all' }),
            limit: typeof value.limit === 'number' ? Math.min(500, Math.max(1, value.limit)) : 100,
          });
        }
        if (capability === 'get') {
          if (typeof value.id !== 'string' || !value.id.trim()) throw new Error('get requires id');
          return await activeProvider.query({ kind: 'get', id: value.id.trim(), projectId });
        }
        if (capability === 'query') {
          if (typeof value.task !== 'string' || !value.task.trim())
            throw new Error('query requires task');
          const response = await activeProvider.query({
            kind: 'search',
            query: createProjectKnowledgeQuery({
              task: value.task,
              ...(typeof value.path === 'string' ? { path: value.path } : {}),
              ...(typeof value.phase === 'string' ? { phase: value.phase } : {}),
              ...(typeof value.operation === 'string' ? { operation: value.operation } : {}),
            }),
            limit: 8,
          });
          clearRecoveredLocalSearchDiagnostic(response);
          return response;
        }
        if (capability === 'create') {
          const type = value.type;
          if (
            typeof type !== 'string' ||
            !PROJECT_KNOWLEDGE_RECORD_TYPES.has(type as ProjectKnowledgeRecordType)
          )
            throw new Error('create requires a supported type');
          if (typeof value.title !== 'string' || !value.title.trim())
            throw new Error('create requires title');
          if (typeof value.summary !== 'string' || !value.summary.trim())
            throw new Error('create requires summary');
          const record = createUserProjectKnowledgeRecord(
            {
              type: type as ProjectKnowledgeRecordType,
              title: value.title.trim(),
              summary: value.summary.trim(),
              applicablePaths: stringList(value.applicablePaths, 'applicablePaths'),
              operations: stringList(value.operations, 'operations'),
              phases: stringList(value.phases, 'phases'),
              sources: recordSources(value.sources),
              verification: recordVerification(value.verification),
            },
            projectId,
          );
          return await activeProvider.apply({ kind: 'upsert', record });
        }
        if (capability === 'correct') {
          if (typeof value.id !== 'string' || !value.id.trim())
            throw new Error('correct requires id');
          if (typeof value.text !== 'string' || !value.text.trim())
            throw new Error('correct requires text');
          return await activeProvider.apply({
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
          return await activeProvider.apply({
            kind: 'supersede',
            id: value.id.trim(),
            projectId,
            updatedAt: new Date().toISOString(),
          });
        }
        if (capability === 'feedback') {
          if (typeof value.id !== 'string' || !value.id.trim())
            throw new Error('feedback requires id');
          if (
            ![
              'used-successfully',
              'ignored',
              'overridden',
              'corrected',
              'contributed-to-failure',
            ].includes(String(value.outcome))
          ) {
            throw new Error('feedback requires a supported outcome');
          }
          return await activeProvider.apply({
            kind: 'feedback',
            id: value.id.trim(),
            projectId,
            outcome:
              value.outcome as import('../agent-learning/index.js').AgentContextOutcomeStatus,
            updatedAt: new Date().toISOString(),
          });
        }
        if (capability === 'refresh') {
          return await activeProvider.apply({
            kind: 'refresh',
            projectId,
            ...(typeof value.id === 'string' && value.id.trim() ? { id: value.id.trim() } : {}),
          });
        }
        throw new Error(`Unknown project knowledge capability: ${capability}`);
      } finally {
        if (activeProvider instanceof LocalProjectKnowledgeProvider) activeProvider.close();
      }
    },
    provideContext: async (request) => {
      let activeProvider: ProjectKnowledgeProvider | null = null;
      try {
        const query = createProjectKnowledgeQuery(request);
        activeProvider = await createProvider();
        await ensureProjectModel(activeProvider);
        const response = await activeProvider.query({ kind: 'search', query, limit: 8 });
        clearRecoveredLocalSearchDiagnostic(response);
        const results = response.kind === 'search' ? response.results : [];
        if (recentChangedHints.length > 0) {
          recentChangedHints.splice(0, recentChangedHints.length);
          persistDiagnostics();
        }
        await diagnosticWrite;
        if (results.length === 0) return null;
        return results.map((result) =>
          projectKnowledgeContextCandidate(result, request.projectId, options.language),
        );
      } finally {
        if (activeProvider instanceof LocalProjectKnowledgeProvider) activeProvider.close();
      }
    },
    resolveContext: async (id, request) => {
      let activeProvider: ProjectKnowledgeProvider | null = null;
      try {
        activeProvider = await createProvider({ discoverCorpus: false });
        const projectId = resolveStableProjectId(options.projectRoot);
        const response = await activeProvider.query({ kind: 'expand', id, projectId });
        if (response.kind === 'expand' && response.record !== null) {
          return projectKnowledgeContextCandidate(
            {
              source: `record:${response.record.id}`,
              title: response.record.title,
              content: response.record.summary,
              record: response.record,
            },
            request.projectId,
            options.language,
          );
        }
      } finally {
        if (activeProvider instanceof LocalProjectKnowledgeProvider) activeProvider.close();
      }
      if (!id.startsWith('document-') || options.knowledgeConfig.provider !== 'local') return null;
      const corpus = await discoverProjectKnowledgeCorpus({
        projectRoot: options.projectRoot,
        reportDiagnostic,
      });
      const document = corpus.find(
        (entry) =>
          `document-${createHash('sha256').update(entry.source).digest('hex').slice(0, 24)}` === id,
      );
      if (document === undefined) return null;
      return projectKnowledgeContextCandidate(
        {
          source: document.source,
          title: document.source,
          content: await readFile(document.absolutePath, 'utf8'),
          document,
        },
        request.projectId,
        options.language,
      );
    },
  };
}

function contextApplicationProjection(
  candidateId: string,
  applications: readonly import('../agent-learning/index.js').AgentContextApplicationRecord[],
): {
  readonly contextApplicationCount?: number;
  readonly lastApplication?: import('../agent-learning/index.js').AgentContextApplicationRecord;
  readonly applicationHistory?: readonly import('../agent-learning/index.js').AgentContextApplicationRecord[];
} {
  const matches = applications
    .filter(
      (application) =>
        application.owner === PROJECT_KNOWLEDGE_PLUGIN_ID &&
        application.candidateId === candidateId,
    )
    .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt));
  return matches[0] === undefined
    ? {}
    : {
        contextApplicationCount: matches.length,
        lastApplication: matches[0],
        applicationHistory: matches,
      };
}

function latestApplicationBatch(
  applications: readonly import('../agent-learning/index.js').AgentContextApplicationRecord[],
  owner: string,
): readonly import('../agent-learning/index.js').AgentContextApplicationRecord[] {
  const ordered = applications
    .filter((application) => application.owner === owner)
    .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt));
  const episodeId = ordered[0]?.episodeId;
  return episodeId === undefined
    ? []
    : ordered
        .filter((application) => application.episodeId === episodeId)
        .sort((left, right) => left.applicationId.localeCompare(right.applicationId));
}

function projectExperienceApplicability(
  event: import('../agent-learning/index.js').AgentExperienceEvent,
) {
  return {
    ...(event.projectId === undefined ? {} : { projectId: event.projectId }),
    ...(event.context.paths === undefined ? {} : { paths: event.context.paths }),
    ...(event.context.operation === undefined ? {} : { operations: [event.context.operation] }),
    ...(event.context.phase === undefined ? {} : { phases: [event.context.phase] }),
    ...(event.context.task === undefined ? {} : { tasks: [event.context.task] }),
  };
}

function projectKnowledgeContextCandidate(
  result: ProjectKnowledgeResult,
  projectId: string | undefined,
  language: 'zh-CN' | 'en' | undefined,
): AgentContextCandidate {
  const record = result.record;
  if (record !== undefined) {
    const policy = isProjectPolicyType(record.type);
    const activation = projectPolicyActivation(record);
    return {
      id: record.id,
      owner: PROJECT_KNOWLEDGE_PLUGIN_ID,
      scope: 'project',
      memoryType: policy ? 'project-policy' : 'project-model',
      kind: record.type,
      state: record.state,
      authority: record.authority === 'automatic' ? 'inferred' : record.authority,
      title: record.title,
      summary: record.summary,
      content: record.summary,
      selectors: {
        projectId: record.projectId,
        paths: record.applicablePaths,
        operations: record.operations,
        phases: record.phases ?? [],
      },
      sources: record.conclusions.flatMap((conclusion) =>
        conclusion.sources.map((source) => ({
          type: 'repository' as const,
          source: source.source,
          anchor: source.anchor,
        })),
      ),
      verification: record.verification,
      ...(activation?.kind === 'verification'
        ? {
            priority: 120,
            matchReasons: [
              language === 'en'
                ? 'This project policy is enforced by an existing verification command.'
                : '当前策略由项目验证命令强制执行',
            ],
          }
        : activation?.kind === 'skill-candidate'
          ? {
              priority: 20,
              matchReasons: [
                language === 'en'
                  ? 'This stable multi-step procedure can become a Skill after user confirmation.'
                  : '该流程已形成稳定的多步骤程序，可在用户确认后整理为 Skill。',
              ],
            }
          : {}),
    };
  }
  const id = `document-${createHash('sha256').update(result.source).digest('hex').slice(0, 24)}`;
  return {
    id,
    owner: PROJECT_KNOWLEDGE_PLUGIN_ID,
    scope: 'project',
    memoryType: 'project-model',
    kind: 'fact',
    state: 'proven',
    authority: 'repository',
    title: result.title ?? result.source,
    summary: result.content.slice(0, 1000),
    content: result.content,
    selectors: { ...(projectId === undefined ? {} : { projectId }) },
    sources: [{ type: 'repository', source: result.source }],
    verification: [],
  };
}

function projectPolicyActivation(
  record: ProjectKnowledgeRecord,
): ProjectPolicyActivation | undefined {
  if (!isProjectPolicyType(record.type)) return undefined;
  const steps =
    record.type === 'procedure'
      ? [...record.conclusions.map((entry) => entry.text), ...record.summary.split(/\r?\n/u)]
          .map((entry) => entry.replace(/^\s*(?:\d+[.)]|[-*])\s*/u, '').trim())
          .filter(Boolean)
      : undefined;
  return compileProjectPolicy({
    kind: record.type,
    state: record.state,
    verification: record.verification,
    ...(steps === undefined ? {} : { steps }),
    applicationCount: record.applicationCount,
    successCount: record.successCount,
    failureCount: record.failureCount,
  });
}

function isProjectPolicyType(type: ProjectKnowledgeRecordType): type is ProjectPolicyKind {
  return PROJECT_POLICY_TYPES.has(type as ProjectPolicyKind);
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
