import { createHash } from 'node:crypto';

import type {
  AgentContextOutcomeStatus,
  AgentExperienceEvent,
  AgentLearningDelta,
} from './types.js';
import { AGENT_EXPERIENCE_SCHEMA } from './types.js';
import type { AgentExperienceCaptureResult } from './experience-journal.js';
import { AgentExperienceJournal } from './experience-journal.js';

export interface AgentReflectionRequest {
  readonly episodeId: string;
  readonly events: readonly AgentExperienceEvent[];
  readonly evidenceOffset: number;
  readonly evidenceCount: number;
}

export interface AgentLearningAdapter {
  readonly owner: string;
  supports(event: AgentExperienceEvent): boolean;
  reflect(request: AgentReflectionRequest): Promise<AgentReflectionOutput>;
  /** Domain Providers consolidate one Reflection batch behind stable semantic keys. */
  consolidate(request: AgentLearningConsolidationRequest): Promise<void>;
}

export interface AgentReflectionResult {
  readonly deltas: readonly AgentLearningDelta[];
  /** Deterministic deltas may be consolidated while semantic work remains replayable. */
  readonly deferred: boolean;
}

export type AgentReflectionOutput = readonly AgentLearningDelta[] | AgentReflectionResult;

export interface AgentLearningConsolidationDelta {
  readonly delta: AgentLearningDelta;
  readonly idempotencyKey: string;
}

export interface AgentLearningConsolidationRequest {
  readonly episodeId: string;
  readonly eventIds: readonly string[];
  readonly deltas: readonly AgentLearningConsolidationDelta[];
}

export interface AgentLearningCoordinatorOptions {
  readonly journal: AgentExperienceJournal;
  readonly learners:
    | readonly AgentLearningAdapter[]
    | ((
        event: AgentExperienceEvent,
      ) => readonly AgentLearningAdapter[] | Promise<readonly AgentLearningAdapter[]>);
  readonly schedule?: (task: () => Promise<void>) => void | Promise<void>;
  readonly maxEventsPerReflection?: number;
  readonly maxEvidencePerReflection?: number;
  readonly onDiagnostic?: (message: string) => void;
}

export interface AgentLearningCaptureResult extends AgentExperienceCaptureResult {
  readonly reflectedSynchronously: boolean;
  readonly deltas: readonly AgentLearningDelta[];
}

export class AgentLearningCoordinator {
  private readonly journal: AgentExperienceJournal;
  private readonly learners: AgentLearningCoordinatorOptions['learners'];
  private readonly schedule: (task: () => Promise<void>) => void | Promise<void>;
  private readonly maxEvents: number;
  private readonly maxEvidence: number;
  private readonly onDiagnostic?: (message: string) => void;
  private readonly episodeQueues = new Map<string, Promise<readonly AgentLearningDelta[]>>();
  private readonly scheduledEventIds = new Set<string>();

  public constructor(options: AgentLearningCoordinatorOptions) {
    this.journal = options.journal;
    this.learners = options.learners;
    this.schedule = options.schedule ?? ((task) => void task());
    this.maxEvents = positive(options.maxEventsPerReflection, 8);
    this.maxEvidence = positive(options.maxEvidencePerReflection, 16);
    this.onDiagnostic = options.onDiagnostic;
  }

  public async capture(event: AgentExperienceEvent): Promise<AgentLearningCaptureResult> {
    const captured = await this.journal.capture(event);
    if (!captured.pending) return { ...captured, reflectedSynchronously: false, deltas: [] };
    const synchronous =
      event.type === 'user.signal' && event.signal?.explicit === true && event.signal.longTerm;
    let deltas: readonly AgentLearningDelta[] = [];
    const work = async (): Promise<void> => {
      try {
        deltas = await this.processAndRecord(captured.event);
      } finally {
        this.scheduledEventIds.delete(captured.event.eventId);
      }
    };
    if (this.scheduledEventIds.has(captured.event.eventId)) {
      return { ...captured, reflectedSynchronously: false, deltas: [] };
    }
    this.scheduledEventIds.add(captured.event.eventId);
    if (synchronous) await work();
    else {
      try {
        await this.schedule(async () => {
          try {
            await work();
          } catch (error) {
            this.onDiagnostic?.(`Agent Reflection failed: ${errorMessage(error)}`);
          }
        });
      } catch (error) {
        this.scheduledEventIds.delete(captured.event.eventId);
        this.onDiagnostic?.(`Agent Reflection scheduling failed: ${errorMessage(error)}`);
      }
    }
    return { ...captured, reflectedSynchronously: synchronous, deltas };
  }

  public async replayPending(limit = 50): Promise<void> {
    const pending = await this.journal.pending(limit);
    for (const event of pending) {
      if (this.scheduledEventIds.has(event.eventId)) continue;
      this.scheduledEventIds.add(event.eventId);
      try {
        await this.schedule(async () => {
          try {
            await this.processAndRecord(event);
          } catch (error) {
            this.onDiagnostic?.(`Agent Reflection replay failed: ${errorMessage(error)}`);
          } finally {
            this.scheduledEventIds.delete(event.eventId);
          }
        });
      } catch (error) {
        this.scheduledEventIds.delete(event.eventId);
        this.onDiagnostic?.(`Agent Reflection replay scheduling failed: ${errorMessage(error)}`);
      }
    }
  }

  public async feedback(options: {
    readonly episodeId: string;
    readonly projectId?: string;
    readonly applicationId: string;
    readonly unitIds: readonly string[];
    readonly status: AgentContextOutcomeStatus;
    readonly summary?: string;
    readonly occurredAt?: string;
  }): Promise<AgentLearningCaptureResult> {
    const eventId = createHash('sha256')
      .update(
        JSON.stringify({
          applicationId: options.applicationId,
          status: options.status,
          summary: options.summary ?? '',
        }),
      )
      .digest('hex')
      .slice(0, 24);
    return this.capture({
      schema: AGENT_EXPERIENCE_SCHEMA,
      eventId: `context-outcome:${eventId}`,
      episodeId: options.episodeId,
      occurredAt: options.occurredAt ?? new Date().toISOString(),
      type: 'context.outcome',
      actor: 'agent',
      scope: options.projectId === undefined ? 'user' : 'project',
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      source: { kind: 'system', name: 'context-director' },
      context: {},
      evidence: [],
      outcome: {
        status: options.status,
        applicationId: options.applicationId,
        unitIds: options.unitIds,
        ...(options.summary === undefined ? {} : { summary: options.summary }),
      },
    });
  }

  private async processEpisode(
    claim: import('./experience-journal.js').AgentExperienceReflectionClaim,
  ): Promise<readonly AgentLearningDelta[]> {
    const { episodeId, events } = claim;
    const byOwner = new Map<
      string,
      { learner: AgentLearningAdapter; events: AgentExperienceEvent[] }
    >();
    for (const current of events) {
      const learners =
        typeof this.learners === 'function' ? await this.learners(current) : this.learners;
      for (const learner of learners) {
        if (!learner.supports(current)) continue;
        if ((claim.completedOwners[current.eventId] ?? []).includes(learner.owner)) continue;
        const collected = byOwner.get(learner.owner) ?? { learner, events: [] };
        if (!collected.events.some((candidate) => candidate.eventId === current.eventId)) {
          collected.events.push(current);
        }
        byOwner.set(learner.owner, collected);
      }
    }

    const failures: string[] = [];
    const deltas: AgentLearningDelta[] = [];
    for (const { learner, events: learnerEvents } of byOwner.values()) {
      try {
        const requests = chunkReflectionRequests(
          episodeId,
          learnerEvents,
          this.maxEvents,
          this.maxEvidence,
        );
        const reflectedDeltas: AgentLearningDelta[] = [];
        let reflectionDeferred = false;
        for (const request of requests) {
          await this.journal.renewClaim(claim);
          const reflected = normalizeReflectionResult(await learner.reflect(request));
          reflectionDeferred ||= reflected.deferred;
          for (const delta of reflected.deltas) {
            if (delta.owner !== learner.owner) {
              throw new Error(`${learner.owner} returned a Learning Delta owned by ${delta.owner}`);
            }
            reflectedDeltas.push(delta);
          }
        }
        const eventIds = [...new Set(learnerEvents.map((entry) => entry.eventId))].sort();
        const consolidationDeltas = uniqueConsolidationDeltas(
          learner.owner,
          episodeId,
          eventIds,
          reflectedDeltas,
        );
        if (consolidationDeltas.length > 0) {
          await this.journal.renewClaim(claim);
          await learner.consolidate({ episodeId, eventIds, deltas: consolidationDeltas });
          deltas.push(...consolidationDeltas.map((entry) => entry.delta));
        }
        if (reflectionDeferred) {
          throw new Error(`${learner.owner} semantic Reflection deferred`);
        }
        await this.journal.markLearnerCompleted(
          claim,
          learner.owner,
          learnerEvents.map((entry) => entry.eventId),
        );
      } catch (error) {
        const message = `${learner.owner} reflection failed: ${errorMessage(error)}`;
        failures.push(message);
        this.onDiagnostic?.(message);
      }
    }
    if (failures.length > 0) throw new Error(failures.join('; '));
    return deltas;
  }

  private async processAndRecord(
    event: AgentExperienceEvent,
  ): Promise<readonly AgentLearningDelta[]> {
    const previous = this.episodeQueues.get(event.episodeId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const deltas: AgentLearningDelta[] = [];
        while (true) {
          const claim = await this.journal.claimEpisode(event.episodeId);
          if (claim === null) return deltas;
          try {
            deltas.push(...(await this.processEpisode(claim)));
            await this.journal.completeClaim(claim);
          } catch (error) {
            await this.journal.failClaim(claim, errorMessage(error));
            throw error;
          }
        }
      });
    this.episodeQueues.set(event.episodeId, operation);
    try {
      return await operation;
    } finally {
      if (this.episodeQueues.get(event.episodeId) === operation) {
        this.episodeQueues.delete(event.episodeId);
      }
    }
  }
}

function normalizeReflectionResult(output: AgentReflectionOutput): AgentReflectionResult {
  if (Array.isArray(output)) return { deltas: output, deferred: false };
  return output as AgentReflectionResult;
}

export function chunkReflectionRequests(
  episodeId: string,
  events: readonly AgentExperienceEvent[],
  maxEvents = 8,
  maxEvidence = 16,
): AgentReflectionRequest[] {
  const requests: AgentReflectionRequest[] = [];
  const eventLimit = positive(maxEvents, 8);
  const evidenceLimit = positive(maxEvidence, 16);
  for (let eventOffset = 0; eventOffset < events.length; eventOffset += eventLimit) {
    const eventChunk = events.slice(eventOffset, eventOffset + eventLimit);
    const evidenceCount = eventChunk.reduce((total, event) => total + event.evidence.length, 0);
    if (evidenceCount === 0) {
      requests.push({ episodeId, events: eventChunk, evidenceOffset: 0, evidenceCount: 0 });
      continue;
    }
    for (let evidenceOffset = 0; evidenceOffset < evidenceCount; evidenceOffset += evidenceLimit) {
      requests.push({
        episodeId,
        events: eventChunk,
        evidenceOffset,
        evidenceCount: Math.min(evidenceLimit, evidenceCount - evidenceOffset),
      });
    }
  }
  return requests;
}

/** Return the evidence slice represented by one Reflection request. */
export function reflectionEvents(request: AgentReflectionRequest): AgentExperienceEvent[] {
  if (request.evidenceCount === 0) {
    return request.events.map((event) => ({ ...event, evidence: [] }));
  }
  const end = request.evidenceOffset + request.evidenceCount;
  let cursor = 0;
  const events: AgentExperienceEvent[] = [];
  for (const event of request.events) {
    if (event.evidence.length === 0) {
      if (request.evidenceOffset === 0) events.push({ ...event, evidence: [] });
      continue;
    }
    const eventStart = cursor;
    const eventEnd = cursor + event.evidence.length;
    cursor = eventEnd;
    const start = Math.max(request.evidenceOffset, eventStart);
    const stop = Math.min(end, eventEnd);
    if (start >= stop) continue;
    events.push({
      ...event,
      evidence: event.evidence.slice(start - eventStart, stop - eventStart),
    });
  }
  return events;
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function consolidationKey(
  owner: string,
  episodeId: string,
  eventIds: readonly string[],
  delta: AgentLearningDelta,
): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        owner,
        episodeId,
        eventIds: [...eventIds].sort(),
        delta: canonicalLearningDelta(delta),
      }),
    )
    .digest('hex');
  return `learning-delta:${digest}`;
}

function uniqueConsolidationDeltas(
  owner: string,
  episodeId: string,
  eventIds: readonly string[],
  deltas: readonly AgentLearningDelta[],
): AgentLearningConsolidationDelta[] {
  const byKey = new Map<string, AgentLearningDelta>();
  for (const delta of deltas) {
    const idempotencyKey = consolidationKey(owner, episodeId, eventIds, delta);
    if (!byKey.has(idempotencyKey)) byKey.set(idempotencyKey, delta);
  }
  return [...byKey]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([idempotencyKey, delta]) => ({ delta, idempotencyKey }));
}

function canonicalLearningDelta(delta: AgentLearningDelta): unknown {
  const sorted = (values: readonly string[] | undefined): readonly string[] | undefined =>
    values === undefined ? undefined : [...values].sort();
  return {
    action: delta.action,
    owner: delta.owner,
    targetId: delta.targetId,
    memoryType: delta.memoryType,
    kind: delta.kind,
    title: delta.title,
    statement: delta.statement,
    applicability: {
      projectId: delta.applicability.projectId,
      paths: sorted(delta.applicability.paths),
      operations: sorted(delta.applicability.operations),
      phases: sorted(delta.applicability.phases),
      tasks: sorted(delta.applicability.tasks),
    },
    evidence: delta.evidence
      .map((entry) => canonicalValue(entry))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    authority: delta.authority,
    verification:
      delta.verification === undefined
        ? undefined
        : [...delta.verification].sort((left, right) =>
            `${left.command}\u0000${left.expected ?? ''}`.localeCompare(
              `${right.command}\u0000${right.expected ?? ''}`,
            ),
          ),
    feedback: delta.feedback,
    payload: canonicalValue(delta.payload),
    recommendedState: delta.recommendedState,
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}
