import { createHash, randomUUID } from 'node:crypto';

import type {
  AgentContextCandidate,
  AgentContextOutcomeStatus,
  AgentContextSelectors,
} from './types.js';
import { validateAgentContextCandidate } from './types.js';

export interface AgentContextRequest {
  readonly task: string;
  readonly projectId?: string;
  readonly path?: string;
  readonly operation?: string;
  readonly phase?: string;
  readonly sessionId?: string;
  readonly charBudget?: number;
  readonly language?: 'zh-CN' | 'en';
}

export interface AgentContextManifestItem {
  readonly id: string;
  readonly expansionId: string;
  readonly owner: string;
  readonly memoryType: AgentContextCandidate['memoryType'];
  readonly state: AgentContextCandidate['state'];
  readonly title: string;
  readonly summary: string;
  readonly sourceType: string;
  readonly whyApplied: string;
}

export interface AgentContextApplicationRecord {
  readonly applicationId: string;
  readonly candidateId: string;
  readonly candidateDigest: string;
  readonly owner: string;
  readonly scope: 'user' | 'project';
  readonly projectId?: string;
  readonly memoryType: AgentContextCandidate['memoryType'];
  /** Immutable display snapshot so an application stays explainable after its source changes. */
  readonly candidateState?: AgentContextCandidate['state'];
  readonly candidateTitle?: string;
  readonly candidateSummary?: string;
  readonly episodeId: string;
  readonly sessionId?: string;
  readonly task: string;
  readonly path?: string;
  readonly operation?: string;
  readonly phase?: string;
  readonly whyApplied: string;
  readonly delivery: 'full' | 'manifest';
  readonly appliedAt: string;
  readonly appliedEventDispatchedAt?: string;
  readonly outcome?: AgentContextOutcomeStatus;
  readonly outcomeRevision?: number;
  readonly outcomeEvents?: readonly AgentContextOutcomeEvent[];
}

export interface AgentContextOutcomeEvent {
  readonly revision: number;
  readonly status: AgentContextOutcomeStatus;
  readonly previousStatus?: AgentContextOutcomeStatus;
  readonly occurredAt: string;
  readonly dispatchedAt?: string;
}

export interface AgentContextOutcomeUpdate {
  readonly changed: boolean;
  readonly previousOutcome?: AgentContextOutcomeStatus;
  readonly record: AgentContextApplicationRecord;
}

export interface AgentContextApplicationStore {
  list(candidateId?: string): Promise<readonly AgentContextApplicationRecord[]>;
  append(record: AgentContextApplicationRecord): Promise<void>;
  setOutcome(
    applicationId: string,
    outcome: AgentContextOutcomeStatus,
    expectedProjectId?: string,
  ): Promise<AgentContextOutcomeUpdate | null>;
  markAppliedEventDispatched(applicationId: string, dispatchedAt?: string): Promise<void>;
  markOutcomeEventDispatched(
    applicationId: string,
    revision: number,
    dispatchedAt?: string,
  ): Promise<void>;
}

export interface AgentContextApplicationStorage {
  read(): Promise<unknown | null>;
  write(value: unknown): Promise<void>;
  withLock?<T>(operation: () => Promise<T>): Promise<T>;
}

export class MemoryAgentContextApplicationStore implements AgentContextApplicationStore {
  private records: AgentContextApplicationRecord[] = [];

  public async list(candidateId?: string): Promise<readonly AgentContextApplicationRecord[]> {
    return this.records
      .filter((record) => candidateId === undefined || record.candidateId === candidateId)
      .map(cloneApplicationRecord);
  }

  public async append(record: AgentContextApplicationRecord): Promise<void> {
    if (this.records.some((entry) => entry.applicationId === record.applicationId)) return;
    this.records.push({ ...record });
  }

  public async setOutcome(
    applicationId: string,
    outcome: AgentContextOutcomeStatus,
    expectedProjectId?: string,
  ): Promise<AgentContextOutcomeUpdate | null> {
    const index = this.records.findIndex((record) => record.applicationId === applicationId);
    if (index < 0) return null;
    const current = this.records[index]!;
    if (!applicationIsVisibleFromProject(current, expectedProjectId)) return null;
    if (current.outcome === outcome)
      return { changed: false, record: cloneApplicationRecord(current) };
    const next = {
      ...current,
      outcome,
      outcomeRevision: (current.outcomeRevision ?? 0) + 1,
      outcomeEvents: [...(current.outcomeEvents ?? []), contextOutcomeEvent(current, outcome)],
    };
    this.records = this.records.map((record, currentIndex) =>
      currentIndex === index ? next : record,
    );
    return {
      changed: true,
      ...(current.outcome === undefined ? {} : { previousOutcome: current.outcome }),
      record: cloneApplicationRecord(next),
    };
  }

  public async markAppliedEventDispatched(
    applicationId: string,
    dispatchedAt = new Date().toISOString(),
  ): Promise<void> {
    this.records = this.records.map((record) =>
      record.applicationId === applicationId && record.appliedEventDispatchedAt === undefined
        ? { ...record, appliedEventDispatchedAt: dispatchedAt }
        : record,
    );
  }

  public async markOutcomeEventDispatched(
    applicationId: string,
    revision: number,
    dispatchedAt = new Date().toISOString(),
  ): Promise<void> {
    this.records = this.records.map((record) =>
      record.applicationId === applicationId
        ? {
            ...record,
            outcomeEvents: (record.outcomeEvents ?? []).map((event) =>
              event.revision === revision && event.dispatchedAt === undefined
                ? { ...event, dispatchedAt }
                : event,
            ),
          }
        : record,
    );
  }
}

export class StorageAgentContextApplicationStore implements AgentContextApplicationStore {
  private queue = Promise.resolve();

  public constructor(private readonly storage: AgentContextApplicationStorage) {}

  public async list(candidateId?: string): Promise<readonly AgentContextApplicationRecord[]> {
    const records = await this.read();
    return records.filter(
      (record) => candidateId === undefined || record.candidateId === candidateId,
    );
  }

  public async append(record: AgentContextApplicationRecord): Promise<void> {
    await this.serialized(async () => {
      const records = await this.read();
      if (records.some((entry) => entry.applicationId === record.applicationId)) return;
      await this.storage.write({ version: 5, records: [...records, record] });
    });
  }

  public async setOutcome(
    applicationId: string,
    outcome: AgentContextOutcomeStatus,
    expectedProjectId?: string,
  ): Promise<AgentContextOutcomeUpdate | null> {
    return this.serialized(async () => {
      const records = await this.read();
      const index = records.findIndex((record) => record.applicationId === applicationId);
      if (index < 0) return null;
      const current = records[index]!;
      if (!applicationIsVisibleFromProject(current, expectedProjectId)) return null;
      if (current.outcome === outcome) return { changed: false, record: { ...current } };
      const next = {
        ...current,
        outcome,
        outcomeRevision: (current.outcomeRevision ?? 0) + 1,
        outcomeEvents: [...(current.outcomeEvents ?? []), contextOutcomeEvent(current, outcome)],
      };
      await this.storage.write({
        version: 5,
        records: records.map((record, currentIndex) => (currentIndex === index ? next : record)),
      });
      return {
        changed: true,
        ...(current.outcome === undefined ? {} : { previousOutcome: current.outcome }),
        record: { ...next },
      };
    });
  }

  public async markAppliedEventDispatched(
    applicationId: string,
    dispatchedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.serialized(async () => {
      const records = await this.read();
      const current = records.find((record) => record.applicationId === applicationId);
      if (current === undefined || current.appliedEventDispatchedAt !== undefined) return;
      await this.storage.write({
        version: 5,
        records: records.map((record) =>
          record.applicationId === applicationId
            ? { ...record, appliedEventDispatchedAt: dispatchedAt }
            : record,
        ),
      });
    });
  }

  public async markOutcomeEventDispatched(
    applicationId: string,
    revision: number,
    dispatchedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.serialized(async () => {
      const records = await this.read();
      const current = records.find((record) => record.applicationId === applicationId);
      if (
        current === undefined ||
        !(current.outcomeEvents ?? []).some(
          (event) => event.revision === revision && event.dispatchedAt === undefined,
        )
      )
        return;
      await this.storage.write({
        version: 5,
        records: records.map((record) =>
          record.applicationId === applicationId
            ? {
                ...record,
                outcomeEvents: (record.outcomeEvents ?? []).map((event) =>
                  event.revision === revision && event.dispatchedAt === undefined
                    ? { ...event, dispatchedAt }
                    : event,
                ),
              }
            : record,
        ),
      });
    });
  }

  private async read(): Promise<AgentContextApplicationRecord[]> {
    const value = await this.storage.read();
    if (value === null) return [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Context application state must be an object');
    }
    const state = value as { version?: unknown; records?: unknown };
    if (state.version !== 5 || !Array.isArray(state.records)) {
      throw new Error('Context application state is incompatible');
    }
    if (!state.records.every(isApplicationRecord)) {
      throw new Error('Context application state contains an invalid record');
    }
    return state.records.map((record) => ({ ...record }));
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const locked = () => (this.storage.withLock ? this.storage.withLock(operation) : operation());
    const result = this.queue.then(locked, locked);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export interface AgentContextSelection {
  readonly episodeId: string;
  readonly coreMemory: readonly AgentContextCandidate[];
  readonly activePolicies: readonly AgentContextCandidate[];
  readonly manifest: readonly AgentContextManifestItem[];
  readonly applications: readonly AgentContextApplicationRecord[];
  readonly text: string;
  readonly expandHint: string;
}

export interface AgentContextExpansion {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly whyApplied: string;
  readonly sources: AgentContextCandidate['sources'];
  readonly verification: AgentContextCandidate['verification'];
}

export interface ContextDirectorOptions {
  readonly applications?: AgentContextApplicationStore;
  readonly now?: () => Date;
  readonly defaultCharBudget?: number;
}

export class ContextDirector {
  private readonly applications: AgentContextApplicationStore;
  private readonly now: () => Date;
  private readonly defaultCharBudget: number;
  private readonly delivered = new Map<string, Map<string, string>>();

  public constructor(options: ContextDirectorOptions = {}) {
    this.applications = options.applications ?? new MemoryAgentContextApplicationStore();
    this.now = options.now ?? (() => new Date());
    this.defaultCharBudget = positive(options.defaultCharBudget, 6000);
  }

  public async select(
    values: readonly AgentContextCandidate[],
    request: AgentContextRequest,
  ): Promise<AgentContextSelection> {
    const candidates = values.map(validateAgentContextCandidate);
    const episodeId = `context:${randomUUID()}`;
    const sessionKey = request.sessionId ?? episodeId;
    const delivered = this.delivered.get(sessionKey) ?? new Map<string, string>();
    this.delivered.set(sessionKey, delivered);
    const persisted = await this.applications.list();
    const candidatesByKey = new Map(
      candidates.map((candidate) => [applicationKey(candidate.owner, candidate.id), candidate]),
    );
    if (request.sessionId !== undefined) {
      for (const application of persisted) {
        const candidate = candidatesByKey.get(
          applicationKey(application.owner, application.candidateId),
        );
        if (
          application.sessionId === request.sessionId &&
          candidate !== undefined &&
          applicationMatchesCandidate(application, candidate, request)
        ) {
          delivered.set(
            applicationKey(application.owner, application.candidateId),
            application.candidateDigest,
          );
        }
      }
    }
    const history = new Map<string, AgentContextApplicationRecord[]>();
    for (const application of persisted) {
      const key = applicationKey(application.owner, application.candidateId);
      history.set(key, [...(history.get(key) ?? []), application]);
    }
    const ranked: {
      candidate: AgentContextCandidate;
      whyApplied: string;
      authority: number;
      score: number;
    }[] = [];
    for (const candidate of candidates) {
      if (candidate.state === 'superseded' || !selectorsMatch(candidate.selectors, request))
        continue;
      const digest = candidate.digest ?? digestCandidate(candidate);
      if (delivered.get(applicationKey(candidate.owner, candidate.id)) === digest) continue;
      const candidateHistory = (
        history.get(applicationKey(candidate.owner, candidate.id)) ?? []
      ).filter((application) => applicationMatchesCandidate(application, candidate, request));
      const whyApplied = whyCandidateApplied(candidate, request, candidateHistory);
      ranked.push({
        candidate,
        whyApplied,
        authority: contextAuthorityRank(candidate),
        score: this.score(candidate, request, candidateHistory),
      });
    }
    ranked.sort(
      (left, right) =>
        right.authority - left.authority ||
        right.score - left.score ||
        left.candidate.title.localeCompare(right.candidate.title) ||
        left.candidate.id.localeCompare(right.candidate.id),
    );

    const coreMemory: AgentContextCandidate[] = [];
    const activePolicies: AgentContextCandidate[] = [];
    const manifest: AgentContextManifestItem[] = [];
    const applications: AgentContextApplicationRecord[] = [];
    const budget = positive(request.charBudget, this.defaultCharBudget);
    const appliedAt = this.now().toISOString();
    for (const entry of ranked) {
      const { candidate, whyApplied } = entry;
      const fullDelivery =
        candidate.memoryType === 'core-profile' ||
        ((candidate.memoryType === 'collaboration-policy' ||
          candidate.memoryType === 'project-policy') &&
          (candidate.state === 'proven' || candidate.state === 'enforced'));
      const candidateDigest = candidate.digest ?? digestCandidate(candidate);
      const attempt = (delivery: 'full' | 'manifest', summaryLimit = 320): boolean => {
        const application = contextApplication({
          candidate,
          candidateDigest,
          episodeId,
          request,
          whyApplied,
          delivery,
          appliedAt,
        });
        const nextCore = [...coreMemory];
        const nextPolicies = [...activePolicies];
        const nextManifest = [...manifest];
        if (delivery === 'full') {
          if (candidate.memoryType === 'core-profile') nextCore.push(candidate);
          else nextPolicies.push(candidate);
        } else {
          nextManifest.push(contextManifestItem(candidate, whyApplied, summaryLimit));
        }
        const text = renderAgentContext(
          nextCore,
          nextPolicies,
          nextManifest,
          'comet task --expand-context <id>',
          [...applications, application],
        );
        if (text.length > budget) return false;
        coreMemory.splice(0, coreMemory.length, ...nextCore);
        activePolicies.splice(0, activePolicies.length, ...nextPolicies);
        manifest.splice(0, manifest.length, ...nextManifest);
        applications.push(application);
        return true;
      };
      if (fullDelivery && attempt('full')) continue;
      if ([320, 160, 80, 32, 0].some((limit) => attempt('manifest', limit))) continue;
    }
    const expandHint = 'comet task --expand-context <id>';
    for (const application of applications) {
      await this.applications.append(application);
      delivered.set(
        applicationKey(application.owner, application.candidateId),
        application.candidateDigest,
      );
    }
    return {
      episodeId,
      coreMemory,
      activePolicies,
      manifest,
      applications,
      text: renderAgentContext(coreMemory, activePolicies, manifest, expandHint, applications),
      expandHint,
    };
  }

  public expand(
    values: readonly AgentContextCandidate[],
    id: string,
    request: AgentContextRequest,
  ): AgentContextExpansion | null {
    const selector = parseContextExpansionId(id);
    const matches = values
      .map(validateAgentContextCandidate)
      .filter(
        (entry) =>
          entry.id === (selector?.candidateId ?? id) &&
          (selector === null || entry.owner === selector.owner),
      );
    const candidate = matches.length === 1 ? matches[0] : undefined;
    if (
      candidate === undefined ||
      candidate.state === 'superseded' ||
      !selectorsMatch(candidate.selectors, request)
    )
      return null;
    return {
      id: contextExpansionId(candidate.owner, candidate.id),
      title: candidate.title,
      content: candidate.content ?? candidate.summary,
      whyApplied: whyCandidateApplied(candidate, request),
      sources: candidate.sources,
      verification: candidate.verification,
    };
  }

  public async recordOutcome(
    applicationId: string,
    outcome: AgentContextOutcomeStatus,
    expectedProjectId?: string,
  ): Promise<AgentContextOutcomeUpdate | null> {
    return this.applications.setOutcome(applicationId, outcome, expectedProjectId);
  }

  public async applicationHistory(
    candidateId?: string,
  ): Promise<readonly AgentContextApplicationRecord[]> {
    return this.applications.list(candidateId);
  }

  private score(
    candidate: AgentContextCandidate,
    request: AgentContextRequest,
    history: readonly AgentContextApplicationRecord[],
  ): number {
    let score = candidate.priority ?? 0;
    score += candidate.state === 'enforced' ? 500 : candidate.state === 'proven' ? 300 : 100;
    score += candidate.authority === 'explicit' || candidate.authority === 'user' ? 160 : 0;
    score += selectorSpecificity(candidate.selectors, request) * 25;
    for (const application of history) {
      score += application.outcome === 'used-successfully' ? 20 : 0;
      score -= application.outcome === 'ignored' ? 2 : 0;
      score -=
        application.outcome === 'corrected' || application.outcome === 'contributed-to-failure'
          ? 80
          : 0;
    }
    return score;
  }
}

export function renderAgentContext(
  coreMemory: readonly AgentContextCandidate[],
  activePolicies: readonly AgentContextCandidate[],
  manifest: readonly AgentContextManifestItem[],
  expandHint: string,
  applications: readonly AgentContextApplicationRecord[] = [],
): string {
  if (coreMemory.length === 0 && activePolicies.length === 0 && manifest.length === 0) return '';
  const applicationIds = new Map(
    applications.map((application) => [
      applicationKey(application.owner, application.candidateId),
      application.applicationId,
    ]),
  );
  const applicationAttribute = (candidate: AgentContextCandidate): string => {
    const applicationId = applicationIds.get(applicationKey(candidate.owner, candidate.id));
    return applicationId === undefined ? '' : ` application_id="${escapeXml(applicationId)}"`;
  };
  const sections: string[] = [];
  if (coreMemory.length > 0) {
    sections.push(
      `<core_memory>\n${coreMemory
        .map(
          (candidate) =>
            `<item id="${escapeXml(contextExpansionId(candidate.owner, candidate.id))}"${applicationAttribute(candidate)}>${escapeXml(candidate.content ?? candidate.summary)}</item>`,
        )
        .join('\n')}\n</core_memory>`,
    );
  }
  if (activePolicies.length > 0) {
    sections.push(
      `<active_policies>\n${activePolicies
        .map((candidate) => renderPolicy(candidate, applicationAttribute(candidate)))
        .join('\n')}\n</active_policies>`,
    );
  }
  if (manifest.length > 0) {
    sections.push(
      `<context_manifest>\n${manifest
        .map(
          (item) =>
            `<item id="${escapeXml(item.expansionId)}"${manifestApplicationAttribute(item, applications)} type="${escapeXml(item.memoryType)}" state="${escapeXml(item.state)}" source="${escapeXml(item.sourceType)}"><title>${escapeXml(item.title)}</title><summary>${escapeXml(item.summary)}</summary><why_applied>${escapeXml(item.whyApplied)}</why_applied></item>`,
        )
        .join('\n')}\n</context_manifest>`,
    );
  }
  sections.push(`<expand_hint>${escapeXml(expandHint)}</expand_hint>`);
  return `<agent_context>\n${sections.join('\n')}\n</agent_context>`;
}

export function whyCandidateApplied(
  candidate: AgentContextCandidate,
  request: AgentContextRequest,
  history: readonly AgentContextApplicationRecord[] = [],
): string {
  const english = request.language === 'en';
  const separator = english ? '; ' : '；';
  const reasons: string[] = [...(candidate.matchReasons ?? [])];
  if (candidate.authority === 'explicit' || candidate.authority === 'user')
    reasons.push(english ? 'Explicitly set by the user' : '用户明确设置');
  if (candidate.selectors.projectId && candidate.selectors.projectId === request.projectId) {
    reasons.push(english ? 'Current project matches' : '当前项目匹配');
  }
  if (request.path && matchesAny(candidate.selectors.paths, request.path))
    reasons.push(english ? 'Current path matches' : '当前路径匹配');
  if (request.operation && includesNormalized(candidate.selectors.operations, request.operation)) {
    reasons.push(english ? 'Current operation matches' : '当前操作匹配');
  }
  if (request.phase && includesNormalized(candidate.selectors.phases, request.phase)) {
    reasons.push(english ? 'Current phase matches' : '当前阶段匹配');
  }
  if (matchesTask(candidate.selectors.tasks, request.task))
    reasons.push(english ? 'Current task matches' : '当前任务匹配');
  const latestOutcome = [...history]
    .reverse()
    .find((entry) => entry.outcome !== undefined)?.outcome;
  if ((latestOutcome ?? candidate.application?.lastOutcome) === 'used-successfully')
    reasons.push(english ? 'Recently applied successfully' : '最近应用成功');
  if (reasons.length === 0)
    reasons.push(
      english
        ? candidate.state === 'trial'
          ? 'Relevant trial experience'
          : 'Relevant proven experience'
        : candidate.state === 'trial'
          ? '相关试用经验'
          : '相关已验证经验',
    );
  return [...new Set(reasons)].join(separator);
}

export function contextExpansionId(owner: string, candidateId: string): string {
  return `${owner}::${candidateId}`;
}

export function parseContextExpansionId(
  value: string,
): { readonly owner: string; readonly candidateId: string } | null {
  const separator = value.indexOf('::');
  if (separator <= 0 || separator >= value.length - 2) return null;
  return { owner: value.slice(0, separator), candidateId: value.slice(separator + 2) };
}

export function contextOutcomeTargetIds(
  unitIds: readonly string[] | undefined,
  owner: string,
): string[] {
  return (unitIds ?? []).flatMap((reference) => {
    const parsed = parseContextExpansionId(reference);
    return parsed?.owner === owner ? [parsed.candidateId] : [];
  });
}

function selectorsMatch(selectors: AgentContextSelectors, request: AgentContextRequest): boolean {
  if (selectors.projectId !== undefined && selectors.projectId !== request.projectId) return false;
  if (
    (selectors.paths?.length ?? 0) > 0 &&
    (request.path === undefined || !matchesAny(selectors.paths, request.path))
  )
    return false;
  if (
    (selectors.operations?.length ?? 0) > 0 &&
    (request.operation === undefined ||
      !includesNormalized(selectors.operations, request.operation))
  )
    return false;
  if (
    (selectors.phases?.length ?? 0) > 0 &&
    (request.phase === undefined || !includesNormalized(selectors.phases, request.phase))
  )
    return false;
  if ((selectors.tasks?.length ?? 0) > 0 && !matchesTask(selectors.tasks, request.task))
    return false;
  return true;
}

function selectorSpecificity(
  selectors: AgentContextSelectors,
  request: AgentContextRequest,
): number {
  return [
    selectors.projectId !== undefined && selectors.projectId === request.projectId,
    request.path !== undefined && matchesAny(selectors.paths, request.path),
    request.operation !== undefined && includesNormalized(selectors.operations, request.operation),
    request.phase !== undefined && includesNormalized(selectors.phases, request.phase),
    matchesTask(selectors.tasks, request.task),
  ].filter(Boolean).length;
}

function matchesTask(values: readonly string[] | undefined, task: string): boolean {
  if (!values || values.length === 0) return false;
  const normalized = task.toLocaleLowerCase();
  return values.some((value) => normalized.includes(value.toLocaleLowerCase()));
}

function includesNormalized(values: readonly string[] | undefined, value: string): boolean {
  if (!values || values.length === 0) return false;
  const normalized = value.toLocaleLowerCase();
  return values.some((entry) => entry.toLocaleLowerCase() === normalized);
}

function matchesAny(values: readonly string[] | undefined, value: string): boolean {
  if (!values || values.length === 0) return false;
  const normalized = value.replaceAll('\\', '/').toLocaleLowerCase();
  return values.some((entry) => {
    const pattern = entry.replaceAll('\\', '/').toLocaleLowerCase();
    const expression = `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
      .join('.*')}$`;
    return new RegExp(expression, 'u').test(normalized);
  });
}

function contextAuthorityRank(candidate: AgentContextCandidate): number {
  if (candidate.state === 'trial') return 0;
  if (candidate.memoryType === 'project-policy') return 4;
  if (candidate.memoryType === 'project-model') return 3;
  if (candidate.memoryType === 'core-profile' || candidate.memoryType === 'collaboration-policy')
    return 2;
  return 1;
}

function applicationKey(owner: string, candidateId: string): string {
  return `${owner}:${candidateId}`;
}

function contextManifestItem(
  candidate: AgentContextCandidate,
  whyApplied: string,
  summaryLimit: number,
): AgentContextManifestItem {
  return {
    id: candidate.id,
    expansionId: contextExpansionId(candidate.owner, candidate.id),
    owner: candidate.owner,
    memoryType: candidate.memoryType,
    state: candidate.state,
    title: truncate(candidate.title, summaryLimit === 0 ? 24 : 120),
    summary: truncate(candidate.summary, summaryLimit),
    sourceType: candidate.sources[0]?.type ?? 'inference',
    whyApplied: truncate(whyApplied, summaryLimit === 0 ? 24 : 160),
  };
}

function contextApplication(options: {
  candidate: AgentContextCandidate;
  candidateDigest: string;
  episodeId: string;
  request: AgentContextRequest;
  whyApplied: string;
  delivery: 'full' | 'manifest';
  appliedAt: string;
}): AgentContextApplicationRecord {
  const { candidate, request } = options;
  return {
    applicationId: `application:${randomUUID()}`,
    candidateId: candidate.id,
    candidateDigest: options.candidateDigest,
    owner: candidate.owner,
    scope: candidate.scope,
    ...(candidate.scope === 'project'
      ? { projectId: candidate.selectors.projectId ?? request.projectId }
      : {}),
    memoryType: candidate.memoryType,
    candidateState: candidate.state,
    candidateTitle: candidate.title,
    candidateSummary: candidate.summary,
    episodeId: options.episodeId,
    ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
    task: request.task,
    ...(request.path === undefined ? {} : { path: request.path }),
    ...(request.operation === undefined ? {} : { operation: request.operation }),
    ...(request.phase === undefined ? {} : { phase: request.phase }),
    whyApplied: options.whyApplied,
    delivery: options.delivery,
    appliedAt: options.appliedAt,
    outcomeRevision: 0,
  };
}

function renderPolicy(candidate: AgentContextCandidate, application: string): string {
  const verification = candidate.verification
    .map(
      (entry) =>
        `<verification command="${escapeXml(entry.command)}"${entry.expected === undefined ? '' : ` expected="${escapeXml(entry.expected)}"`} />`,
    )
    .join('');
  return `<policy id="${escapeXml(contextExpansionId(candidate.owner, candidate.id))}"${application}><content>${escapeXml(candidate.content ?? candidate.summary)}</content>${verification}</policy>`;
}

function manifestApplicationAttribute(
  item: AgentContextManifestItem,
  applications: readonly AgentContextApplicationRecord[],
): string {
  const application = applications.find(
    (entry) => entry.owner === item.owner && entry.candidateId === item.id,
  );
  return application === undefined
    ? ''
    : ` application_id="${escapeXml(application.applicationId)}"`;
}

function truncate(value: string, limit: number): string {
  if (limit <= 0) return '';
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function digestCandidate(candidate: AgentContextCandidate): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        state: candidate.state,
        title: candidate.title,
        summary: candidate.summary,
        content: candidate.content,
        scope: candidate.scope,
        memoryType: candidate.memoryType,
        kind: candidate.kind,
        authority: candidate.authority,
        selectors: candidate.selectors,
        sources: candidate.sources,
        verification: candidate.verification,
        priority: candidate.priority,
        matchReasons: candidate.matchReasons,
        application: candidate.application,
      }),
    )
    .digest('hex');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function isApplicationRecord(value: unknown): value is AgentContextApplicationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const scopedProject =
    record.scope === 'project'
      ? typeof record.projectId === 'string' && record.projectId.length > 0
      : record.projectId === undefined;
  return (
    typeof record.applicationId === 'string' &&
    typeof record.candidateId === 'string' &&
    typeof record.candidateDigest === 'string' &&
    typeof record.owner === 'string' &&
    (record.scope === 'user' || record.scope === 'project') &&
    scopedProject &&
    typeof record.memoryType === 'string' &&
    (record.candidateState === undefined || typeof record.candidateState === 'string') &&
    (record.candidateTitle === undefined || typeof record.candidateTitle === 'string') &&
    (record.candidateSummary === undefined || typeof record.candidateSummary === 'string') &&
    typeof record.episodeId === 'string' &&
    typeof record.task === 'string' &&
    typeof record.whyApplied === 'string' &&
    (record.delivery === 'full' || record.delivery === 'manifest') &&
    typeof record.appliedAt === 'string' &&
    !Number.isNaN(Date.parse(record.appliedAt)) &&
    (record.appliedEventDispatchedAt === undefined ||
      (typeof record.appliedEventDispatchedAt === 'string' &&
        !Number.isNaN(Date.parse(record.appliedEventDispatchedAt)))) &&
    (record.sessionId === undefined || typeof record.sessionId === 'string') &&
    (record.path === undefined || typeof record.path === 'string') &&
    (record.operation === undefined || typeof record.operation === 'string') &&
    (record.phase === undefined || typeof record.phase === 'string') &&
    (record.outcome === undefined ||
      [
        'used-successfully',
        'ignored',
        'overridden',
        'corrected',
        'contributed-to-failure',
      ].includes(String(record.outcome))) &&
    (record.outcomeRevision === undefined ||
      (Number.isSafeInteger(record.outcomeRevision) && Number(record.outcomeRevision) >= 0)) &&
    (record.outcomeEvents === undefined ||
      (Array.isArray(record.outcomeEvents) && record.outcomeEvents.every(isOutcomeEvent)))
  );
}

function cloneApplicationRecord(
  record: AgentContextApplicationRecord,
): AgentContextApplicationRecord {
  return {
    ...record,
    ...(record.outcomeEvents === undefined
      ? {}
      : { outcomeEvents: record.outcomeEvents.map((event) => ({ ...event })) }),
  };
}

function contextOutcomeEvent(
  current: AgentContextApplicationRecord,
  outcome: AgentContextOutcomeStatus,
): AgentContextOutcomeEvent {
  return {
    revision: (current.outcomeRevision ?? 0) + 1,
    status: outcome,
    ...(current.outcome === undefined ? {} : { previousStatus: current.outcome }),
    occurredAt: new Date().toISOString(),
  };
}

function isOutcomeEvent(value: unknown): value is AgentContextOutcomeEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(event.revision) &&
    Number(event.revision) >= 1 &&
    isOutcomeStatus(event.status) &&
    (event.previousStatus === undefined || isOutcomeStatus(event.previousStatus)) &&
    typeof event.occurredAt === 'string' &&
    !Number.isNaN(Date.parse(event.occurredAt)) &&
    (event.dispatchedAt === undefined ||
      (typeof event.dispatchedAt === 'string' && !Number.isNaN(Date.parse(event.dispatchedAt))))
  );
}

function isOutcomeStatus(value: unknown): value is AgentContextOutcomeStatus {
  return [
    'used-successfully',
    'ignored',
    'overridden',
    'corrected',
    'contributed-to-failure',
  ].includes(String(value));
}

function applicationMatchesCandidate(
  application: AgentContextApplicationRecord,
  candidate: AgentContextCandidate,
  request: AgentContextRequest,
): boolean {
  return (
    application.owner === candidate.owner &&
    application.candidateId === candidate.id &&
    application.scope === candidate.scope &&
    (candidate.scope === 'user' || application.projectId === request.projectId)
  );
}

function applicationIsVisibleFromProject(
  application: AgentContextApplicationRecord,
  expectedProjectId: string | undefined,
): boolean {
  return (
    expectedProjectId === undefined ||
    application.scope === 'user' ||
    application.projectId === expectedProjectId
  );
}
