import { createHash } from 'node:crypto';
import type {
  AgentContextRequest,
  AgentContextApplicationStorage,
  AgentContextApplicationRecord,
} from './context-director.js';
import type { AgentContextOutcomeStatus } from './types.js';

const RETENTION_MS = 7 * 86400000;
const MAX_RECORDS = 500;
type Application = Pick<
  AgentContextApplicationRecord,
  'applicationId' | 'candidateId' | 'owner' | 'delivery' | 'appliedAt'
> &
  Partial<AgentContextApplicationRecord>;
interface UsageItem {
  readonly applicationId?: string;
  readonly candidateId: string;
  readonly title?: string;
  readonly delivery: 'manifest' | 'full';
  readonly whyApplied?: string;
}
export interface ContextQuerySample {
  readonly owner: string;
  readonly elapsedMs: number;
  readonly status: 'ok' | 'partial' | 'error';
}
interface UsageRecord {
  readonly id: string;
  readonly episodeId: string;
  readonly owner: string;
  readonly projectId: string;
  readonly requestKey: string;
  readonly task: string;
  readonly phase?: string;
  readonly occurredAt: string;
  readonly counted: boolean;
  readonly elapsedMs: number;
  readonly candidateCount: number;
  readonly limited: boolean;
  readonly itemsTruncated?: boolean;
  readonly items: readonly UsageItem[];
}
interface UsageState {
  readonly version: 1;
  readonly startedAt: string;
  readonly truncatedAt?: string;
  readonly records: readonly UsageRecord[];
}
export interface ContextUsageSnapshot {
  readonly available: boolean;
  readonly days: 7;
  readonly sampleLimit: number;
  readonly trackingStartedAt?: string;
  readonly truncated: boolean;
  readonly requests: number;
  readonly hits: number;
  readonly hitRate: number | null;
  readonly limitedRequests: number;
  readonly fullDeliveries: number;
  readonly recommendations: number;
  readonly feedbackCount: number;
  readonly feedbackRate: number | null;
  readonly successes: number;
  readonly corrections: number;
  readonly failures: number;
  readonly ignored: number;
  readonly overridden: number;
  readonly successRate: number | null;
  readonly p95Ms: number | null;
  readonly lastQueryMs: number | null;
  readonly recentTasks: readonly {
    readonly episodeId: string;
    readonly task: string;
    readonly phase?: string;
    readonly occurredAt: string;
    readonly counted: boolean;
    readonly elapsedMs: number;
    readonly candidateCount: number;
    readonly limited: boolean;
    readonly items: readonly (UsageItem & {
      readonly title: string;
      readonly whyApplied: string;
      readonly outcome?: AgentContextOutcomeStatus;
    })[];
  }[];
  readonly samples?: ContextUsageSnapshot['recentTasks'];
}

/** Bounded observations of actual task requests; Dashboard reads never create samples. */
export class ContextUsageTracker {
  private queue = Promise.resolve();
  public constructor(
    private readonly storage: AgentContextApplicationStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async record(input: {
    readonly request: AgentContextRequest;
    readonly episodeId: string;
    readonly samples: readonly ContextQuerySample[];
    readonly candidates: readonly { readonly owner: string; readonly id: string }[];
    readonly applications: readonly Application[];
  }): Promise<void> {
    if (input.samples.length === 0) return;
    await this.update((state) => {
      const additions: UsageRecord[] = [];
      for (const owner of new Set(input.samples.map((sample) => sample.owner))) {
        const samples = input.samples.filter((sample) => sample.owner === owner);
        const id = `${input.episodeId}:${owner}`;
        if (state.records.some((record) => record.id === id)) continue;
        additions.push({
          id,
          episodeId: input.episodeId,
          owner,
          projectId: input.request.projectId ?? '',
          requestKey: requestKey(input.request),
          task: input.request.task.slice(0, 160),
          ...(input.request.phase ? { phase: input.request.phase.slice(0, 40) } : {}),
          occurredAt: this.now().toISOString(),
          counted: true,
          elapsedMs: Math.max(0, ...samples.map((sample) => sample.elapsedMs)),
          candidateCount: new Set(
            input.candidates
              .filter((candidate) => candidate.owner === owner)
              .map((candidate) => candidate.id),
          ).size,
          limited: samples.some((sample) => sample.status !== 'ok'),
          itemsTruncated:
            input.applications.filter((application) => application.owner === owner).length > 24,
          items: input.applications
            .filter((application) => application.owner === owner)
            .slice(0, 24)
            .map((application) => ({
              applicationId: application.applicationId,
              candidateId: application.candidateId,
              delivery: application.delivery,
            })),
        });
      }
      return { ...state, records: [...state.records, ...additions] };
    });
  }

  public async recordExpansion(
    request: AgentContextRequest,
    owner: string,
    candidateId: string,
    title: string,
  ): Promise<void> {
    await this.update((state) => {
      const key = requestKey(request);
      const cutoff = this.now().getTime() - RETENTION_MS;
      let index = -1;
      for (let position = state.records.length - 1; position >= 0; position--) {
        if (
          state.records[position].counted &&
          Date.parse(state.records[position].occurredAt) >= cutoff &&
          state.records[position].owner === owner &&
          state.records[position].requestKey === key
        ) {
          index = position;
          break;
        }
      }
      const record = state.records[index];
      const existing = record?.items.find((item) => item.candidateId === candidateId);
      const item: UsageItem = {
        ...existing,
        candidateId,
        ...(existing?.applicationId ? {} : { title: title.slice(0, 160) }),
        delivery: 'full',
      };
      const id = `expansion:${key}:${owner}:${candidateId}:${existing?.applicationId ?? ''}`;
      return {
        ...state,
        records: [
          ...state.records.filter((entry) => entry.id !== id),
          {
            id,
            episodeId: id,
            owner,
            projectId: request.projectId ?? '',
            requestKey: key,
            task: request.task.slice(0, 160),
            ...(request.phase ? { phase: request.phase.slice(0, 40) } : {}),
            occurredAt: this.now().toISOString(),
            counted: false,
            elapsedMs: 0,
            candidateCount: 0,
            limited: false,
            items: [item],
          },
        ],
      };
    });
  }

  public async snapshot(
    owner: string,
    projectId: string,
    applications:
      readonly Application[] | ((ids: readonly string[]) => Promise<readonly Application[]>),
  ): Promise<ContextUsageSnapshot> {
    const state = await this.read();
    const cutoff = this.now().getTime() - RETENTION_MS;
    const rows = state.records.filter(
      (record) =>
        record.owner === owner &&
        record.projectId === projectId &&
        Date.parse(record.occurredAt) >= cutoff,
    );
    const resolvedApplications =
      typeof applications === 'function'
        ? await applications([
            ...new Set(
              rows.flatMap((row) =>
                row.items.flatMap((item) => (item.applicationId ? [item.applicationId] : [])),
              ),
            ),
          ])
        : applications;
    const scopedApplications = new Map(
      resolvedApplications
        .filter(
          (application) =>
            application.owner === owner &&
            (application.projectId === projectId ||
              (application.scope === 'user' &&
                application.projectId === undefined &&
                (application.contextProjectId === undefined ||
                  application.contextProjectId === projectId))),
        )
        .map((application) => [application.applicationId, application]),
    );
    const project = (item: UsageItem) => {
      const application = item.applicationId
        ? scopedApplications.get(item.applicationId)
        : undefined;
      return {
        ...item,
        title: (application?.candidateTitle ?? item.title ?? item.candidateId).slice(0, 160),
        whyApplied: (application?.whyApplied ?? item.whyApplied ?? '').slice(0, 240),
        ...(application?.outcome ? { outcome: application.outcome } : {}),
      };
    };
    const items = new Map<string, ReturnType<typeof project>>();
    for (const row of rows)
      for (const item of row.items) {
        const key = item.applicationId ?? `${row.requestKey}:${item.candidateId}`;
        const previous = items.get(key);
        items.set(key, {
          ...project(item),
          delivery: previous?.delivery === 'full' ? 'full' : item.delivery,
        });
      }
    const outcomes = [...items.values()];
    const count = (outcome: AgentContextOutcomeStatus) =>
      outcomes.filter((item) => item.outcome === outcome).length;
    const queries = rows.filter((row) => row.counted);
    const timings = queries.map((row) => row.elapsedMs).sort((left, right) => left - right);
    const hits = queries.filter((row) => row.candidateCount > 0).length;
    const feedbackCount = outcomes.filter((item) => item.outcome !== undefined).length;
    const successes = count('used-successfully');
    const corrections = count('corrected');
    const failures = count('contributed-to-failure');
    const samples = rows.map((row) => ({
      episodeId: row.episodeId,
      requestKey: row.requestKey,
      task: row.task,
      ...(row.phase ? { phase: row.phase } : {}),
      occurredAt: row.occurredAt,
      counted: row.counted,
      elapsedMs: row.elapsedMs,
      candidateCount: row.candidateCount,
      limited: row.limited,
      items: row.items.map(project),
    }));
    return {
      available: true,
      days: 7,
      sampleLimit: MAX_RECORDS,
      trackingStartedAt: state.startedAt,
      truncated:
        (state.truncatedAt !== undefined && Date.parse(state.truncatedAt) >= cutoff) ||
        rows.some((row) => row.itemsTruncated),
      requests: queries.length,
      hits,
      hitRate: queries.length ? hits / queries.length : null,
      limitedRequests: queries.filter((row) => row.limited).length,
      fullDeliveries: outcomes.filter((item) => item.delivery === 'full').length,
      recommendations: outcomes.length,
      feedbackCount,
      feedbackRate: outcomes.length ? feedbackCount / outcomes.length : null,
      successes,
      corrections,
      failures,
      ignored: count('ignored'),
      overridden: count('overridden'),
      successRate:
        successes + corrections + failures
          ? successes / (successes + corrections + failures)
          : null,
      p95Ms: timings.length ? timings[Math.ceil(timings.length * 0.95) - 1] : null,
      lastQueryMs: queries.at(-1)?.elapsedMs ?? null,
      samples,
      recentTasks: rows
        .slice(-10)
        .reverse()
        .map((row) => ({
          episodeId: row.episodeId,
          task: row.task,
          ...(row.phase ? { phase: row.phase } : {}),
          occurredAt: row.occurredAt,
          counted: row.counted,
          elapsedMs: row.elapsedMs,
          candidateCount: row.candidateCount,
          limited: row.limited,
          items: row.items.map(project),
        })),
    };
  }

  private async read(): Promise<UsageState> {
    const value = await this.storage.read();
    if (value === null) return { version: 1, startedAt: this.now().toISOString(), records: [] };
    const state = value as UsageState;
    if (
      state?.version !== 1 ||
      !Number.isFinite(Date.parse(state.startedAt)) ||
      !Array.isArray(state.records) ||
      state.records.length > MAX_RECORDS ||
      !state.records.every(validRecord)
    )
      throw new Error('Task context usage state is invalid');
    return state;
  }

  private async update(change: (state: UsageState) => UsageState): Promise<void> {
    const operation = async () => {
      const state = change(await this.read());
      const cutoff = this.now().getTime() - RETENTION_MS;
      const records = state.records.filter((record) => Date.parse(record.occurredAt) >= cutoff);
      const removed = records.slice(0, Math.max(0, records.length - MAX_RECORDS));
      await this.storage.write({
        ...state,
        ...(removed.length ? { truncatedAt: removed.at(-1)!.occurredAt } : {}),
        records: records.slice(-MAX_RECORDS),
      });
    };
    const locked = () => (this.storage.withLock ? this.storage.withLock(operation) : operation());
    const result = this.queue.then(locked, locked);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    await result;
  }
}

function requestKey(request: AgentContextRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        request.projectId,
        request.sessionId,
        request.task,
        request.path,
        request.phase,
        request.operation,
      ]),
    )
    .digest('hex');
}
function validRecord(value: UsageRecord): boolean {
  return (
    !!value &&
    typeof value.id === 'string' &&
    typeof value.episodeId === 'string' &&
    typeof value.owner === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.requestKey === 'string' &&
    typeof value.task === 'string' &&
    value.task.length <= 160 &&
    Number.isFinite(Date.parse(value.occurredAt)) &&
    typeof value.counted === 'boolean' &&
    typeof value.limited === 'boolean' &&
    Number.isFinite(value.elapsedMs) &&
    value.elapsedMs >= 0 &&
    Number.isSafeInteger(value.candidateCount) &&
    value.candidateCount >= 0 &&
    Array.isArray(value.items) &&
    value.items.length <= 24 &&
    value.items.every(
      (item) =>
        !!item &&
        typeof item.candidateId === 'string' &&
        (item.title === undefined ||
          (typeof item.title === 'string' && item.title.length <= 160)) &&
        (item.whyApplied === undefined ||
          (typeof item.whyApplied === 'string' && item.whyApplied.length <= 240)) &&
        (item.delivery === 'full' || item.delivery === 'manifest') &&
        (item.applicationId === undefined || typeof item.applicationId === 'string'),
    )
  );
}
