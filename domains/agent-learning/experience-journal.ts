import { randomUUID } from 'node:crypto';

import type { AgentExperienceEvent, AgentExperienceEvidence } from './types.js';
import { validateAgentExperienceEvent } from './types.js';

export interface AgentExperienceJournalState {
  readonly version: 2;
  readonly events: readonly AgentExperienceEvent[];
  readonly reflections: Readonly<
    Record<
      string,
      {
        readonly status: 'pending' | 'processing' | 'processed';
        readonly attempts: number;
        readonly updatedAt: string;
        readonly lastError?: string;
        readonly claimId?: string;
        readonly leaseExpiresAt?: string;
        readonly completedOwners?: readonly string[];
      }
    >
  >;
}

export interface AgentExperienceJournalStore {
  read(): Promise<AgentExperienceJournalState>;
  write(state: AgentExperienceJournalState): Promise<void>;
  withLock?<T>(operation: () => Promise<T>): Promise<T>;
}

export interface AgentExperienceJournalStorage {
  read(): Promise<unknown | null>;
  write(value: unknown): Promise<void>;
  withLock?<T>(operation: () => Promise<T>): Promise<T>;
}

export interface AgentExperienceCaptureResult {
  readonly deduplicated: boolean;
  readonly pending: boolean;
  readonly event: AgentExperienceEvent;
  readonly episodeEventCount: number;
  readonly episodeEvidenceCount: number;
}

export interface AgentExperienceEpisode {
  readonly id: string;
  readonly events: readonly AgentExperienceEvent[];
  readonly evidence: readonly AgentExperienceEvidence[];
}

export interface AgentExperienceReflectionClaim {
  readonly claimId: string;
  readonly episodeId: string;
  readonly eventIds: readonly string[];
  readonly events: readonly AgentExperienceEvent[];
  readonly completedOwners: Readonly<Record<string, readonly string[]>>;
}

export class MemoryAgentExperienceJournalStore implements AgentExperienceJournalStore {
  private state: AgentExperienceJournalState;

  public constructor(
    initial: AgentExperienceJournalState = { version: 2, events: [], reflections: {} },
  ) {
    this.state = cloneState(initial);
  }

  public async read(): Promise<AgentExperienceJournalState> {
    return cloneState(this.state);
  }

  public async write(state: AgentExperienceJournalState): Promise<void> {
    this.state = cloneState(state);
  }
}

export class StorageAgentExperienceJournalStore implements AgentExperienceJournalStore {
  public constructor(private readonly storage: AgentExperienceJournalStorage) {}

  public async read(): Promise<AgentExperienceJournalState> {
    const value = await this.storage.read();
    if (value === null) return { version: 2, events: [], reflections: {} };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Agent Experience Journal state must be an object');
    }
    const state = value as { version?: unknown; events?: unknown; reflections?: unknown };
    if (
      state.version !== 2 ||
      !Array.isArray(state.events) ||
      !isReflectionState(state.reflections)
    ) {
      throw new Error('Agent Experience Journal state is incompatible');
    }
    return {
      version: 2,
      events: state.events.map(validateAgentExperienceEvent),
      reflections: cloneReflections(state.reflections),
    };
  }

  public async write(state: AgentExperienceJournalState): Promise<void> {
    await this.storage.write(cloneState(state));
  }

  public async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.storage.withLock ? this.storage.withLock(operation) : operation();
  }
}

export class AgentExperienceJournal {
  private queue = Promise.resolve();

  public constructor(private readonly store: AgentExperienceJournalStore) {}

  public async capture(value: AgentExperienceEvent): Promise<AgentExperienceCaptureResult> {
    const event = validateAgentExperienceEvent(value);
    return this.serialized(async () => {
      const state = await this.store.read();
      const existing = state.events.find((entry) => entry.eventId === event.eventId);
      if (existing !== undefined) {
        const episode = episodeFrom(state.events, existing.episodeId);
        return {
          deduplicated: true,
          pending: state.reflections[existing.eventId]?.status !== 'processed',
          event: existing,
          episodeEventCount: episode.events.length,
          episodeEvidenceCount: episode.evidence.length,
        };
      }
      const events = [...state.events, event];
      await this.store.write({
        version: 2,
        events,
        reflections: {
          ...state.reflections,
          [event.eventId]: {
            status: 'pending',
            attempts: 0,
            updatedAt: event.occurredAt,
          },
        },
      });
      const episode = episodeFrom(events, event.episodeId);
      return {
        deduplicated: false,
        pending: true,
        event,
        episodeEventCount: episode.events.length,
        episodeEvidenceCount: episode.evidence.length,
      };
    });
  }

  public async pending(limit = 100): Promise<readonly AgentExperienceEvent[]> {
    const state = await this.store.read();
    return state.events
      .filter((event) => state.reflections[event.eventId]?.status !== 'processed')
      .slice(0, Math.max(1, Math.min(1000, limit)));
  }

  public async isPending(eventId: string): Promise<boolean> {
    const state = await this.store.read();
    return (
      state.events.some((event) => event.eventId === eventId) &&
      state.reflections[eventId]?.status !== 'processed'
    );
  }

  /** Atomically lease one episode so independent CLI/Hook processes cannot reflect it twice. */
  public async claimEpisode(
    episodeId: string,
    options: { readonly now?: string; readonly leaseMs?: number } = {},
  ): Promise<AgentExperienceReflectionClaim | null> {
    return this.serialized(async () => {
      const state = await this.store.read();
      const now = options.now ?? new Date().toISOString();
      const nowMs = Date.parse(now);
      const episodeEvents = state.events.filter((event) => event.episodeId === episodeId);
      const active = episodeEvents.some((event) => {
        const reflection = state.reflections[event.eventId];
        return (
          reflection?.status === 'processing' && Date.parse(reflection.leaseExpiresAt ?? '') > nowMs
        );
      });
      if (active) return null;
      const pending = episodeEvents.filter((event) => {
        const reflection = state.reflections[event.eventId];
        return (
          reflection?.status === 'pending' ||
          (reflection?.status === 'processing' &&
            Date.parse(reflection.leaseExpiresAt ?? '') <= nowMs)
        );
      });
      if (pending.length === 0) return null;
      const claimId = `reflection:${randomUUID()}`;
      const leaseMs = Math.max(1_000, Math.min(30 * 60_000, options.leaseMs ?? 5 * 60_000));
      const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
      const reflections = { ...state.reflections };
      for (const event of pending) {
        const current = reflections[event.eventId];
        reflections[event.eventId] = {
          status: 'processing',
          attempts: current?.attempts ?? 0,
          updatedAt: now,
          claimId,
          leaseExpiresAt,
          completedOwners: [...(current?.completedOwners ?? [])],
          ...(current?.lastError === undefined ? {} : { lastError: current.lastError }),
        };
      }
      await this.store.write({ ...state, reflections });
      return {
        claimId,
        episodeId,
        eventIds: pending.map((event) => event.eventId),
        events: pending,
        completedOwners: Object.fromEntries(
          pending.map((event) => [
            event.eventId,
            [...(state.reflections[event.eventId]?.completedOwners ?? [])],
          ]),
        ),
      };
    });
  }

  public async renewClaim(
    claim: AgentExperienceReflectionClaim,
    options: { readonly now?: string; readonly leaseMs?: number } = {},
  ): Promise<void> {
    await this.serialized(async () => {
      const state = await this.store.read();
      const now = options.now ?? new Date().toISOString();
      const nowMs = Date.parse(now);
      const leaseMs = Math.max(1_000, Math.min(30 * 60_000, options.leaseMs ?? 5 * 60_000));
      const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
      const ids = new Set(claim.eventIds);
      const reflections = { ...state.reflections };
      let renewed = 0;
      for (const event of state.events) {
        if (!ids.has(event.eventId)) continue;
        const current = reflections[event.eventId];
        if (current?.status !== 'processing' || current.claimId !== claim.claimId) continue;
        reflections[event.eventId] = { ...current, updatedAt: now, leaseExpiresAt };
        renewed += 1;
      }
      if (renewed !== claim.eventIds.length) {
        throw new Error(`Agent Reflection claim was lost: ${claim.claimId}`);
      }
      await this.store.write({ ...state, reflections });
    });
  }

  public async markLearnerCompleted(
    claim: AgentExperienceReflectionClaim,
    owner: string,
    eventIds: readonly string[],
    updatedAt = new Date().toISOString(),
  ): Promise<void> {
    const ids = new Set(eventIds);
    if (ids.size === 0) return;
    await this.serialized(async () => {
      const state = await this.store.read();
      const reflections = { ...state.reflections };
      let updated = 0;
      for (const event of state.events) {
        if (!ids.has(event.eventId)) continue;
        const current = reflections[event.eventId];
        if (current?.status !== 'processing' || current.claimId !== claim.claimId) continue;
        reflections[event.eventId] = {
          ...current,
          updatedAt,
          completedOwners: [...new Set([...(current.completedOwners ?? []), owner])].sort(),
        };
        updated += 1;
      }
      if (updated !== ids.size)
        throw new Error(`Agent Reflection claim was lost: ${claim.claimId}`);
      await this.store.write({ ...state, reflections });
    });
  }

  public async completeClaim(
    claim: AgentExperienceReflectionClaim,
    updatedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.finishClaim(claim, 'processed', undefined, updatedAt);
  }

  public async failClaim(
    claim: AgentExperienceReflectionClaim,
    error: string,
    updatedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.finishClaim(claim, 'pending', error, updatedAt);
  }

  public async markProcessed(eventId: string, updatedAt = new Date().toISOString()): Promise<void> {
    await this.markProcessedMany([eventId], updatedAt);
  }

  public async markProcessedMany(
    eventIds: readonly string[],
    updatedAt = new Date().toISOString(),
  ): Promise<void> {
    const ids = new Set(eventIds);
    if (ids.size === 0) return;
    await this.serialized(async () => {
      const state = await this.store.read();
      const known = state.events.filter((event) => ids.has(event.eventId));
      if (known.length === 0) return;
      const reflections = { ...state.reflections };
      for (const event of known) {
        const current = reflections[event.eventId];
        reflections[event.eventId] = {
          status: 'processed',
          attempts: current?.attempts ?? 0,
          updatedAt,
          completedOwners: [...(current?.completedOwners ?? [])],
        };
      }
      await this.store.write({ ...state, reflections });
    });
  }

  public async markFailed(
    eventId: string,
    error: string,
    updatedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.updateReflection(eventId, (current) => ({
      status: 'pending',
      attempts: (current?.attempts ?? 0) + 1,
      updatedAt,
      lastError: error.slice(0, 2000),
    }));
  }

  public async episode(episodeId: string): Promise<AgentExperienceEpisode | null> {
    const state = await this.store.read();
    const episode = episodeFrom(state.events, episodeId);
    return episode.events.length === 0 ? null : episode;
  }

  public async list(
    options: {
      readonly projectId?: string;
      readonly type?: AgentExperienceEvent['type'];
    } = {},
  ): Promise<readonly AgentExperienceEvent[]> {
    const state = await this.store.read();
    return state.events.filter(
      (event) =>
        (options.projectId === undefined || event.projectId === options.projectId) &&
        (options.type === undefined || event.type === options.type),
    );
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const locked = () => (this.store.withLock ? this.store.withLock(operation) : operation());
    const result = this.queue.then(locked, locked);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async updateReflection(
    eventId: string,
    update: (
      current: AgentExperienceJournalState['reflections'][string] | undefined,
    ) => AgentExperienceJournalState['reflections'][string],
  ): Promise<void> {
    await this.serialized(async () => {
      const state = await this.store.read();
      if (!state.events.some((event) => event.eventId === eventId)) return;
      await this.store.write({
        ...state,
        reflections: { ...state.reflections, [eventId]: update(state.reflections[eventId]) },
      });
    });
  }

  private async finishClaim(
    claim: AgentExperienceReflectionClaim,
    status: 'pending' | 'processed',
    error: string | undefined,
    updatedAt: string,
  ): Promise<void> {
    const ids = new Set(claim.eventIds);
    await this.serialized(async () => {
      const state = await this.store.read();
      const reflections = { ...state.reflections };
      for (const event of state.events) {
        if (!ids.has(event.eventId)) continue;
        const current = reflections[event.eventId];
        if (current?.status !== 'processing' || current.claimId !== claim.claimId) continue;
        reflections[event.eventId] = {
          status,
          attempts: current.attempts + Number(status === 'pending'),
          updatedAt,
          completedOwners: [...(current.completedOwners ?? [])],
          ...(error === undefined ? {} : { lastError: error.slice(0, 2000) }),
        };
      }
      await this.store.write({ ...state, reflections });
    });
  }
}

function episodeFrom(
  events: readonly AgentExperienceEvent[],
  episodeId: string,
): AgentExperienceEpisode {
  const matches = events.filter((event) => event.episodeId === episodeId);
  const evidence = new Map<string, AgentExperienceEvidence>();
  for (const event of matches) {
    for (const item of event.evidence) {
      const key = item.digest ?? item.id;
      if (!evidence.has(key)) evidence.set(key, item);
    }
  }
  return { id: episodeId, events: matches, evidence: [...evidence.values()] };
}

function cloneState(state: AgentExperienceJournalState): AgentExperienceJournalState {
  return JSON.parse(JSON.stringify(state)) as AgentExperienceJournalState;
}

function isReflectionState(value: unknown): value is AgentExperienceJournalState['reflections'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return (
      (record.status === 'pending' ||
        record.status === 'processing' ||
        record.status === 'processed') &&
      Number.isSafeInteger(record.attempts) &&
      Number(record.attempts) >= 0 &&
      typeof record.updatedAt === 'string' &&
      (record.lastError === undefined || typeof record.lastError === 'string') &&
      (record.claimId === undefined || typeof record.claimId === 'string') &&
      (record.leaseExpiresAt === undefined || typeof record.leaseExpiresAt === 'string') &&
      (record.completedOwners === undefined ||
        (Array.isArray(record.completedOwners) &&
          record.completedOwners.every((owner) => typeof owner === 'string')))
    );
  });
}

function cloneReflections(
  value: AgentExperienceJournalState['reflections'],
): AgentExperienceJournalState['reflections'] {
  return JSON.parse(JSON.stringify(value)) as AgentExperienceJournalState['reflections'];
}
