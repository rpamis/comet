import { createHash, randomUUID } from 'node:crypto';

import type { AgentExperienceEvidence } from '../agent-learning/index.js';

import type {
  MemoryConflict,
  MemoryClass,
  MemoryCorrection,
  MemoryFileProjection,
  MemoryInput,
  MemoryLanguage,
  MemoryManagementConflict,
  MemoryManagementRecord,
  MemoryManagementView,
  MemoryObservation,
  MemoryObservationResult,
  MemoryProviderMutation,
  MemoryProviderQuery,
  MemoryQuery,
  MemoryReviewActionSet,
  MemoryReviewPacket,
  MemoryReviewResult,
  MemoryRecord,
  MemoryRepository,
  MemoryRetrieval,
  MemoryRuntimeState,
  MemoryScope,
  MemorySettings,
  MemorySource,
  MemoryStoredObservation,
  MemoryTombstone,
  PersonalEpisodeDetails,
  PersonalMemoryOptions,
  PersonalMemoryProvider,
  PersonalMemoryServiceLike,
  PersonalMemoryStatus,
} from './types.js';
import { isMemoryClass } from './types.js';
import { hashMemoryText, memoryFilePath } from './repository.js';
import {
  validateMemoryLanguageText,
  validateMemoryReviewActions,
  validateMemoryReviewPacket,
  validateSafeMemoryText,
} from './review-contract.js';

const DEFAULT_MAX_ENTRIES = 12;
const DEFAULT_MAX_BYTES = 8 * 1024;
const DEFAULT_PROFILE_MAX_CHARS = 2000;
const DEFAULT_TASK_MAX_CHARS = 6000;
const DEFAULT_MANAGEMENT_MAX_ENTRIES = 100;
const DEFAULT_MANAGEMENT_MAX_BYTES = 32 * 1024;
const MAX_SOURCES = 8;

interface MarkdownBullet {
  readonly category: string;
  readonly text: string;
  readonly line: number;
}

interface StoredRecord extends MemoryRecord {
  readonly identity: string;
}

export class PersonalMemoryService implements PersonalMemoryServiceLike, PersonalMemoryProvider {
  private readonly repository: MemoryRepository;
  private readonly now: () => Date;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly profileMaxChars: number;
  private readonly taskMaxChars: number;
  private readonly language: MemoryLanguage;

  public constructor(options: PersonalMemoryOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.profileMaxChars = options.profileMaxChars ?? DEFAULT_PROFILE_MAX_CHARS;
    this.taskMaxChars = options.taskMaxChars ?? DEFAULT_TASK_MAX_CHARS;
    this.language = options.language ?? 'zh-CN';
  }

  public async get(id: string): Promise<MemoryRecord | null> {
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      await this.persist(state);
      const record = state.records.find((entry) => entry.id === id);
      return record === undefined ? null : cloneRecord(record);
    });
  }

  public async remember(input: MemoryInput): Promise<MemoryRecord> {
    validateInput(input);
    const source = input.source ?? { kind: 'user' };
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile(input.scope, input.projectKey);
      const normalizedInput: MemoryInput = {
        ...input,
        memoryType: input.memoryType ?? inferPersonalMemoryType(input, 'explicit'),
      };
      const identity = memoryIdentity(normalizedInput);
      const normalized = normalizeText(input.text);
      const existing = state.records.find(
        (entry) =>
          entry.state !== 'superseded' &&
          entry.identity === identity &&
          normalizeText(entry.text) === normalized,
      ) as StoredRecord | undefined;
      if (existing !== undefined) {
        const refreshed = {
          ...addSource(existing, source, this.timestamp()),
          kind: 'explicit' as const,
          authority: 'explicit' as const,
          memoryType: normalizedInput.memoryType!,
          ...(normalizedInput.memoryType === 'personal-episode'
            ? { episode: normalizePersonalEpisode(normalizedInput.episode, normalizedInput) }
            : { episode: undefined }),
          state: 'proven' as const,
          source,
        };
        state.records = replaceRecord(state.records, refreshed);
        clearInferredCandidates(state, identity);
        clearTombstone(state, identity);
        await this.persist(state);
        return cloneRecord(refreshed);
      }

      const record = createRecord(normalizedInput, 'explicit', source, this.timestamp(), identity);
      clearInferredCandidates(state, identity);
      clearTombstone(state, identity);
      state.records = replaceRecord(state.records, record);
      await this.writeRecordMarkdown(state, record);
      return cloneRecord(record);
    });
  }

  public async correct(
    id: string,
    correction: MemoryCorrection,
    options: { readonly idempotencyKey?: string } = {},
  ): Promise<MemoryRecord> {
    validateCorrection(correction);
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      const current = state.records.find((entry) => entry.id === id) as StoredRecord | undefined;
      const userRemoved =
        current !== undefined &&
        state.tombstones.some(
          (entry) => entry.identity === current.identity && entry.reason === 'user-remove',
        );
      if (current === undefined || (current.state === 'superseded' && !userRemoved)) {
        throw new Error(`Memory is not available: ${id}`);
      }
      if (
        options.idempotencyKey !== undefined &&
        state.appliedMutationIds.includes(options.idempotencyKey)
      ) {
        return cloneRecord(current);
      }
      validateCorrection(correction);
      if (memoryCorrectionIsUnchanged(current, correction)) {
        if (options.idempotencyKey !== undefined) {
          state.appliedMutationIds = appendBoundedMutationId(
            state.appliedMutationIds,
            options.idempotencyKey,
          );
          await this.persist(state);
        }
        return cloneRecord(current);
      }
      pushHistory(state, current);
      clearInferredCandidates(state, current.identity);
      const next = this.updateRecordValue(
        current,
        { ...current, ...correction, source: { kind: 'user' } },
        'explicit',
      );
      state.records = replaceRecord(state.records, next);
      clearTombstone(state, current.identity);
      if (options.idempotencyKey !== undefined) {
        state.appliedMutationIds = appendBoundedMutationId(
          state.appliedMutationIds,
          options.idempotencyKey,
        );
      }
      await this.writeRecordMarkdown(state, next, current.text, current.category);
      return cloneRecord(next);
    });
  }

  public async remove(
    id: string,
    options: { readonly permanent?: boolean; readonly idempotencyKey?: string } = {},
  ): Promise<void> {
    await this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      if (
        options.idempotencyKey !== undefined &&
        state.appliedMutationIds.includes(options.idempotencyKey)
      )
        return;
      const current = state.records.find((entry) => entry.id === id) as StoredRecord | undefined;
      if (current === undefined) throw new Error(`Unknown memory: ${id}`);
      let removalProjection:
        | { readonly file: string; readonly projection: MemoryFileProjection }
        | undefined;
      if (current.state !== 'superseded') {
        const path = this.resolveMemoryFilePath(state, current.scope, current.projectKey);
        const content = await this.readStableFile(state, path, current.scope, current.projectKey);
        const refreshed = state.records.find((entry) => entry.id === id) as
          | StoredRecord
          | undefined;
        if (refreshed !== undefined && refreshed.state !== 'superseded') {
          pushHistory(state, refreshed);
          if (content !== null) {
            const nextContent = removeMarkdownBullet(content, current.text, current.category);
            if (nextContent !== content) {
              const confirmed = await this.readStableFile(
                state,
                path,
                refreshed.scope,
                refreshed.projectKey,
              );
              if (confirmed !== content) {
                throw new Error(`Memory file changed during update: ${path}`);
              }
            }
            removalProjection = {
              file: path,
              projection: {
                content: nextContent,
                baseHash: memoryFileHash(content),
                scope: refreshed.scope,
                ...(refreshed.projectKey === undefined ? {} : { projectKey: refreshed.projectKey }),
                queuedAt: this.timestamp(),
              },
            };
          }
        }
      }
      if (options.permanent) {
        state.records = state.records.filter((entry) => entry.id !== id);
        delete state.history[id];
        delete state.evidence[id];
      } else {
        state.records = replaceRecord(state.records, {
          ...current,
          state: 'superseded',
          updatedAt: this.timestamp(),
        });
        delete state.evidence[id];
      }
      state.tombstones = upsertTombstone(state.tombstones, {
        identity: current.identity,
        scope: current.scope,
        ...(current.projectKey === undefined ? {} : { projectKey: current.projectKey }),
        recordId: current.id,
        textHash: normalizedMemoryTextHash(current.text),
        reason: 'user-remove',
        ...(options.permanent === true ? { permanent: true } : {}),
        removedAt: this.timestamp(),
      });
      if (options.idempotencyKey !== undefined) {
        state.appliedMutationIds = appendBoundedMutationId(
          state.appliedMutationIds,
          options.idempotencyKey,
        );
      }
      if (removalProjection === undefined) {
        await this.persist(state);
      } else {
        await this.persistWithFileProjection(
          state,
          removalProjection.file,
          removalProjection.projection,
        );
      }
    });
  }

  public async rollback(id: string): Promise<MemoryRecord> {
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      const current = state.records.find((entry) => entry.id === id) as StoredRecord | undefined;
      const history = state.history[id] ?? [];
      const previous = history.at(-1) as StoredRecord | undefined;
      if (current === undefined || previous === undefined)
        throw new Error(`No rollback available: ${id}`);
      state.history[id] = history.slice(0, -1);
      const next = {
        ...previous,
        id,
        state: 'proven',
        updatedAt: this.timestamp(),
      } as StoredRecord;
      state.records = replaceRecord(state.records, next);
      clearTombstone(state, next.identity);
      await this.writeRecordMarkdown(
        state,
        next,
        current.state !== 'superseded' ? current.text : undefined,
        current.state !== 'superseded' ? current.category : undefined,
      );
      return cloneRecord(next);
    });
  }

  public async recordApplicationOutcome(
    id: string,
    outcome: import('../agent-learning/index.js').AgentContextOutcomeStatus,
    options: Omit<import('./types.js').MemoryApplicationFeedback, 'id' | 'outcome'> = {},
  ): Promise<MemoryRecord | null> {
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      const current = state.records.find((entry) => entry.id === id) as StoredRecord | undefined;
      if (current === undefined) return null;
      if (
        options.idempotencyKey !== undefined &&
        state.appliedMutationIds.includes(options.idempotencyKey)
      ) {
        return cloneRecord(current);
      }
      const applicationId = options.applicationId;
      const storedOutcome =
        applicationId === undefined ? undefined : state.applicationOutcomes[applicationId];
      if (storedOutcome !== undefined && storedOutcome.recordId !== id) {
        throw new Error(`Context application ${applicationId} belongs to another memory record`);
      }
      const revision = options.revision ?? (storedOutcome?.revision ?? 0) + 1;
      if (storedOutcome !== undefined && revision <= storedOutcome.revision) {
        if (options.idempotencyKey !== undefined) {
          state.appliedMutationIds = appendBoundedMutationId(
            state.appliedMutationIds,
            options.idempotencyKey,
          );
          await this.persist(state);
        }
        return cloneRecord(current);
      }
      const feedbackState = state.feedbackState[id];
      if (current.state === 'superseded' && feedbackState === undefined) return null;
      const successful = outcome === 'used-successfully';
      const failed = negativeContextOutcome(outcome);
      const previousSuccessful = storedOutcome?.status === 'used-successfully';
      const previousFailed = negativeContextOutcome(storedOutcome?.status);
      if (applicationId !== undefined) {
        state.applicationOutcomes[applicationId] = { recordId: id, status: outcome, revision };
      }
      const hasOtherNegativeOutcome = Object.entries(state.applicationOutcomes).some(
        ([candidateApplicationId, value]) =>
          candidateApplicationId !== applicationId &&
          value.recordId === id &&
          negativeContextOutcome(value.status),
      );
      const shouldRestore =
        current.kind === 'inferred' &&
        !failed &&
        feedbackState !== undefined &&
        !hasOtherNegativeOutcome;
      const updatedAt = this.timestamp();
      const next = {
        ...current,
        state:
          current.kind === 'inferred' && failed
            ? ('superseded' as const)
            : shouldRestore
              ? successful && feedbackState.baseState === 'trial'
                ? ('proven' as const)
                : feedbackState.baseState
              : current.state === 'trial' && successful
                ? ('proven' as const)
                : current.state,
        applicationCount: current.applicationCount + Number(storedOutcome === undefined),
        successCount: Math.max(
          0,
          current.successCount + Number(successful) - Number(previousSuccessful),
        ),
        failureCount: Math.max(0, current.failureCount + Number(failed) - Number(previousFailed)),
        lastAppliedAt: updatedAt,
        updatedAt,
      } as StoredRecord;
      state.records = replaceRecord(state.records, next);
      if (options.idempotencyKey !== undefined) {
        state.appliedMutationIds = appendBoundedMutationId(
          state.appliedMutationIds,
          options.idempotencyKey,
        );
      }
      let removalProjection:
        | { readonly file: string; readonly projection: MemoryFileProjection }
        | undefined;
      if (current.kind === 'inferred' && failed && feedbackState === undefined) {
        state.feedbackState[id] = {
          baseState: current.state === 'trial' ? 'trial' : 'proven',
        };
        const file = this.resolveMemoryFilePath(state, current.scope, current.projectKey);
        const content = await this.readStableFile(state, file, current.scope, current.projectKey);
        if (content !== null) {
          const nextContent = removeMarkdownBullet(content, current.text, current.category);
          if (nextContent !== content) {
            const confirmed = await this.readStableFile(
              state,
              file,
              current.scope,
              current.projectKey,
            );
            if (confirmed !== content) {
              throw new Error(`Memory file changed during update: ${file}`);
            }
          }
          removalProjection = {
            file,
            projection: {
              content: nextContent,
              baseHash: memoryFileHash(content),
              scope: current.scope,
              ...(current.projectKey === undefined ? {} : { projectKey: current.projectKey }),
              queuedAt: this.timestamp(),
            },
          };
        }
        state.tombstones = upsertTombstone(state.tombstones, {
          identity: current.identity,
          scope: current.scope,
          ...(current.projectKey === undefined ? {} : { projectKey: current.projectKey }),
          recordId: current.id,
          textHash: normalizedMemoryTextHash(current.text),
          reason: 'negative-feedback',
          removedAt: this.timestamp(),
        });
      }
      if (shouldRestore) {
        delete state.feedbackState[id];
        state.tombstones = state.tombstones.filter(
          (entry) => !(entry.recordId === id && entry.reason === 'negative-feedback'),
        );
        await this.writeRecordMarkdown(state, next);
      } else if (current.state === 'trial' && next.state === 'proven') {
        await this.writeRecordMarkdown(state, next);
      } else if (removalProjection !== undefined) {
        await this.persistWithFileProjection(
          state,
          removalProjection.file,
          removalProjection.projection,
        );
      } else {
        await this.persist(state);
      }
      return cloneRecord(next);
    });
  }

  public async observe(observation: MemoryObservation): Promise<MemoryObservationResult> {
    validateObservation(observation);
    if (observation.source?.kind !== 'user' && !isUsefulAutomaticObservation(observation)) {
      return {
        deduplicated: false,
        ignored: true,
        candidate: false,
        promoted: false,
        record: null,
      };
    }
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile(observation.scope, observation.projectKey);
      const projectIdentity = observation.projectIdentity ?? observation.projectKey;
      const normalizedObservation: MemoryObservation = {
        ...observation,
        memoryType: observation.memoryType ?? inferPersonalMemoryType(observation, 'inferred'),
      };
      const candidateKey = observation.candidateKey ?? memoryIdentity(normalizedObservation);
      const key = observationKey(normalizedObservation, projectIdentity, candidateKey);
      const previous = state.observations.find((entry) => entry.key === key);
      if (previous !== undefined && (previous.success || !observation.success)) {
        return {
          deduplicated: true,
          ignored: false,
          candidate: false,
          promoted: false,
          record: null,
        };
      }
      const source = observation.source ?? {
        kind: 'workflow',
        workflow: observation.workflow,
        changeId: observation.changeId,
        projectKey: observation.projectKey,
      };
      const stored: MemoryStoredObservation = {
        key,
        changeId: observation.changeId.trim(),
        scope: observation.scope,
        projectKey: observation.projectKey,
        ...(projectIdentity === undefined ? {} : { projectIdentity }),
        candidateKey,
        identity: memoryIdentity(normalizedObservation),
        text: observation.text,
        normalizedText: normalizeText(observation.text),
        success: observation.success,
        source,
        observedAt: observation.observedAt ?? this.timestamp(),
      };
      state.observations =
        previous === undefined
          ? [...state.observations, stored]
          : state.observations.map((entry) => (entry.key === key ? stored : entry));
      const paused =
        observation.scope === 'project' &&
        observation.projectKey !== undefined &&
        state.settings.pausedLearningProjects.includes(observation.projectKey);
      if (!state.settings.learningEnabled || paused || !observation.success) {
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: !state.settings.learningEnabled || paused,
          candidate: false,
          promoted: false,
          record: null,
        };
      }

      const identity = stored.identity;
      const normalized = stored.normalizedText;
      const normalizedTextHash = normalizedMemoryTextHash(stored.text);
      const rawTextHash = hashMemoryText(stored.text);
      const tombstone = state.tombstones.find(
        (entry) =>
          entry.identity === identity ||
          (entry.scope === stored.scope &&
            entry.projectKey === stored.projectKey &&
            entry.textHash !== undefined &&
            (entry.textHash === normalizedTextHash || entry.textHash === rawTextHash)),
      );
      if (
        tombstone?.permanent === true ||
        (tombstone !== undefined && stored.observedAt <= tombstone.removedAt)
      ) {
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: true,
          candidate: false,
          promoted: false,
          record: null,
        };
      }
      const candidate = state.records.find(
        (entry) =>
          (tombstone === undefined || entry.createdAt > tombstone.removedAt) &&
          entry.state === 'trial' &&
          entry.kind === 'inferred' &&
          entry.identity === identity &&
          normalizeText(entry.text) === normalized,
      ) as StoredRecord | undefined;
      const record =
        candidate ??
        (createRecord(
          observationInput(normalizedObservation, source),
          'inferred',
          source,
          stored.observedAt,
          identity,
        ) as StoredRecord);
      state.records = candidate ? state.records : [...state.records, record];
      const evidence = new Set(state.evidence[record.id] ?? []);
      evidence.add(key);
      state.evidence[record.id] = [...evidence];
      const active = state.records.find(
        (entry) => entry.state === 'proven' && entry.identity === identity,
      ) as StoredRecord | undefined;
      const explicit = state.records.find(
        (entry) =>
          entry.state !== 'superseded' &&
          entry.kind === 'explicit' &&
          memoryShapeIdentity(entry) === memoryShapeIdentity(normalizedObservation),
      ) as StoredRecord | undefined;
      if (explicit !== undefined) {
        if (normalizeText(explicit.text) !== normalized) {
          state.conflicts = addConflict(
            state.conflicts,
            identity,
            [explicit, record],
            this.timestamp(),
          );
          await this.persist(state);
          return {
            deduplicated: false,
            ignored: false,
            candidate: true,
            promoted: false,
            record: null,
          };
        }
        const refreshed = addSource(explicit, source, this.timestamp());
        state.records = replaceRecord(
          state.records.filter((entry) => entry.id !== record.id),
          refreshed,
        );
        delete state.evidence[record.id];
        state.conflicts = state.conflicts.filter((entry) => entry.identity !== identity);
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: false,
          candidate: false,
          promoted: false,
          record: cloneRecord(refreshed),
        };
      }
      const conflicting = state.records.filter(
        (entry) =>
          entry.id !== record.id &&
          entry.identity === identity &&
          normalizeText(entry.text) !== normalized &&
          (entry.state !== 'superseded' || (state.evidence[entry.id]?.length ?? 0) > 0),
      );
      if (conflicting.length > 0) {
        state.conflicts = addConflict(
          state.conflicts,
          identity,
          [...conflicting, record],
          this.timestamp(),
        );
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: false,
          candidate: true,
          promoted: false,
          record: null,
        };
      }
      if (active !== undefined && normalizeText(active.text) === normalized) {
        const refreshed = addSource(active, source, this.timestamp());
        state.records = replaceRecord(state.records, refreshed);
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: false,
          candidate: false,
          promoted: false,
          record: cloneRecord(refreshed),
        };
      }
      const independentEvidence = independentEvidenceCount(
        observation.scope,
        state.observations.filter((entry) => evidence.has(entry.key)),
      );
      const requiredEvidence = observation.scope === 'global' ? 2 : 2;
      if (independentEvidence < requiredEvidence) {
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: false,
          candidate: true,
          promoted: false,
          record: null,
        };
      }
      if (active !== undefined && active.id !== record.id) {
        state.conflicts = addConflict(
          state.conflicts,
          identity,
          [active, record],
          this.timestamp(),
        );
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: false,
          candidate: true,
          promoted: false,
          record: null,
        };
      }

      const candidateSources = state.observations
        .filter((entry) => evidence.has(entry.key))
        .map((entry) => entry.source);
      const promoted = {
        ...record,
        state: 'proven',
        source: candidateSources[0] ?? record.source,
        sources: mergeSources(record.sources, candidateSources),
        updatedAt: this.timestamp(),
      } as StoredRecord;
      state.records = replaceRecord(state.records, promoted);
      clearTombstone(state, identity);
      await this.writeRecordMarkdown(state, promoted);
      return {
        deduplicated: false,
        ignored: false,
        candidate: true,
        promoted: true,
        record: cloneRecord(promoted),
      };
    });
  }

  public async reviewAndApply(
    packet: MemoryReviewPacket,
    actions: MemoryReviewActionSet,
  ): Promise<MemoryReviewResult> {
    // Validate the complete packet and action envelope before touching the repository.
    const validatedPacket = validateMemoryReviewPacket(packet);
    const validatedActions = validateMemoryReviewActions(validatedPacket, actions);
    const results: MemoryReviewResult[] = [];
    for (const action of validatedActions.actions) {
      results.push(await this.applyReviewAction(validatedPacket, action));
    }
    const first = results[0];
    if (first === undefined) {
      return { action: 'skip', persisted: false };
    }
    if (results.length === 1) return first;
    return {
      action: first.action,
      persisted: results.some((result) => result.persisted),
      ...(results.find((result) => result.reason !== undefined)?.reason === undefined
        ? {}
        : { reason: results.find((result) => result.reason !== undefined)?.reason }),
      ...(results.find((result) => result.notification !== undefined)?.notification === undefined
        ? {}
        : {
            notification: results.find((result) => result.notification !== undefined)?.notification,
          }),
      results,
    };
  }

  public async query(
    request: MemoryProviderQuery,
  ): Promise<import('./types.js').MemoryProviderQueryResult> {
    if (request.view === 'manage') return this.manage(request.query);
    if (request.view === 'expand') {
      if (!request.query.id) throw new Error('Memory expand requires an id');
      const record = await this.get(request.query.id);
      const available =
        record !== null &&
        (record.scope === 'global' ||
          (request.query.projectKey !== undefined &&
            record.projectKey === request.query.projectKey));
      return { kind: 'expand', record: available ? record : null };
    }
    if (request.view === 'manifest') {
      const retrieval = await this.retrieve({ ...request.query, view: 'task' });
      return {
        kind: 'manifest',
        truncated: retrieval.truncated,
        items: retrieval.records.map((record) => ({
          id: record.id,
          memoryType: record.memoryType,
          state: record.state,
          authority: record.authority,
          title: record.title ?? record.category,
          summary: record.text,
          scope: record.scope,
          ...(record.projectKey === undefined ? {} : { projectKey: record.projectKey }),
          pathPatterns: [...record.pathPatterns],
          taskTypes: [...record.taskTypes],
          operations: [...record.operations],
          phases: [...record.phases],
          evidence: record.evidence.map(cloneExperienceEvidence),
        })),
      };
    }
    return this.retrieve({ ...request.query, view: request.view });
  }

  public async apply(mutation: MemoryProviderMutation): Promise<unknown> {
    switch (mutation.operation) {
      case 'remember':
        return this.remember(mutation.input as MemoryInput);
      case 'correct': {
        const input = mutation.input as {
          readonly id: string;
          readonly correction: MemoryCorrection;
        };
        return this.correct(input.id, input.correction);
      }
      case 'forget': {
        const input = mutation.input as { readonly id: string; readonly permanent?: boolean };
        return this.remove(input.id, { permanent: input.permanent });
      }
      case 'rollback':
        return this.rollback((mutation.input as { readonly id: string }).id);
      case 'observe':
        return this.observe(mutation.input as MemoryObservation);
      case 'review': {
        const input = mutation.input as {
          readonly packet: MemoryReviewPacket;
          readonly actions: MemoryReviewActionSet;
        };
        return this.reviewAndApply(input.packet, input.actions);
      }
      case 'feedback': {
        const input = mutation.input as import('./types.js').MemoryApplicationFeedback;
        return this.recordApplicationOutcome(input.id, input.outcome, {
          ...(input.previousOutcome === undefined
            ? {}
            : { previousOutcome: input.previousOutcome }),
          ...(input.applicationId === undefined ? {} : { applicationId: input.applicationId }),
          ...(input.revision === undefined ? {} : { revision: input.revision }),
          ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        });
      }
      case 'experience-delta':
        return this.applyExperienceDelta(mutation.input.delta, mutation.input.idempotencyKey);
    }
  }

  private async applyExperienceDelta(
    delta: import('../agent-learning/index.js').AgentLearningDelta,
    idempotencyKey: string,
  ): Promise<unknown> {
    if (delta.owner !== 'personal-memory' && delta.owner !== 'comet.personal-memory') {
      throw new Error('Learning Delta owner does not match Personal Memory');
    }
    if (await this.mutationWasApplied(idempotencyKey)) return { changed: false };
    if (delta.feedback !== undefined) {
      if (!delta.targetId) throw new Error('Learning Delta feedback target is required');
      const record = await this.recordApplicationOutcome(delta.targetId, delta.feedback.status, {
        previousOutcome: delta.feedback.previousStatus,
        applicationId: delta.feedback.applicationId,
        revision: delta.feedback.revision,
        idempotencyKey,
      });
      return { changed: record !== null, record };
    }
    if (delta.action === 'noop') {
      await this.markMutationApplied(idempotencyKey);
      return { changed: false };
    }
    if (delta.action === 'forget' || delta.action === 'supersede') {
      if (!delta.targetId) throw new Error('Learning Delta target is required');
      await this.remove(delta.targetId, {
        permanent: delta.action === 'forget',
        idempotencyKey,
      });
      return { changed: true, record: null };
    }
    if (delta.action === 'update') {
      if (!delta.targetId) throw new Error('Learning Delta target is required');
      const record = await this.correct(
        delta.targetId,
        {
          ...(delta.title === undefined ? {} : { title: delta.title }),
          text: delta.statement,
          category: delta.kind,
          pathPatterns: delta.applicability.paths,
          taskTypes: delta.applicability.tasks,
          operations: delta.applicability.operations,
          phases: delta.applicability.phases,
        },
        { idempotencyKey },
      );
      return { changed: true, record };
    }
    const scope = delta.applicability.projectId === undefined ? 'global' : 'project';
    const actionPayload = delta.payload?.kind === 'memory-action' ? delta.payload : undefined;
    const candidateKey =
      typeof actionPayload?.candidateKey === 'string' ? actionPayload.candidateKey : idempotencyKey;
    const language =
      actionPayload?.language === 'en' || actionPayload?.language === 'zh-CN'
        ? actionPayload.language
        : undefined;
    const memoryClass = isMemoryClass(actionPayload?.memoryClass)
      ? actionPayload.memoryClass
      : undefined;
    const memoryType = isPersonalMemoryType(delta.memoryType) ? delta.memoryType : undefined;
    const reason = typeof actionPayload?.reason === 'string' ? actionPayload.reason : undefined;
    const episode = personalEpisodeFromPayload(actionPayload?.episode);
    const record =
      delta.authority === 'explicit' || delta.authority === 'user'
        ? await this.remember({
            scope,
            ...(delta.applicability.projectId === undefined
              ? {}
              : { projectKey: delta.applicability.projectId }),
            category: delta.kind,
            ...(delta.title === undefined ? {} : { title: delta.title }),
            text: delta.statement,
            pathPatterns: delta.applicability.paths,
            taskTypes: delta.applicability.tasks,
            operations: delta.applicability.operations,
            phases: delta.applicability.phases,
            evidence: delta.evidence,
            candidateKey,
            ...(language === undefined ? {} : { language }),
            ...(memoryClass === undefined ? {} : { memoryClass }),
            ...(memoryType === undefined ? {} : { memoryType }),
            ...(episode === undefined ? {} : { episode }),
            ...(reason === undefined ? {} : { reason }),
            source: { kind: 'user' },
          })
        : (
            await this.observe({
              scope,
              ...(delta.applicability.projectId === undefined
                ? {}
                : { projectKey: delta.applicability.projectId }),
              category: delta.kind,
              ...(delta.title === undefined ? {} : { title: delta.title }),
              text: delta.statement,
              pathPatterns: delta.applicability.paths,
              taskTypes: delta.applicability.tasks,
              operations: delta.applicability.operations,
              phases: delta.applicability.phases,
              evidence: delta.evidence,
              candidateKey,
              ...(language === undefined ? {} : { language }),
              ...(memoryClass === undefined ? {} : { memoryClass }),
              ...(memoryType === undefined ? {} : { memoryType }),
              ...(episode === undefined ? {} : { episode }),
              ...(reason === undefined ? {} : { reason }),
              workflow: 'agent-learning',
              changeId: idempotencyKey,
              success: delta.recommendedState !== 'superseded',
              source: { kind: delta.authority === 'repository' ? 'repository' : 'workflow' },
            })
          ).record;
    await this.markMutationApplied(idempotencyKey);
    return { changed: record !== null, record };
  }

  private async mutationWasApplied(idempotencyKey: string): Promise<boolean> {
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      return state.appliedMutationIds.includes(idempotencyKey);
    });
  }

  private async markMutationApplied(idempotencyKey: string): Promise<void> {
    await this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      if (state.appliedMutationIds.includes(idempotencyKey)) return;
      state.appliedMutationIds = appendBoundedMutationId(state.appliedMutationIds, idempotencyKey);
      await this.persist(state);
    });
  }

  private async applyReviewAction(
    packet: MemoryReviewPacket,
    action: MemoryReviewActionSet['actions'][number],
  ): Promise<MemoryReviewResult> {
    if (action.action === 'skip') {
      return {
        action: 'skip',
        persisted: false,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      };
    }
    if (action.action === 'create') {
      if (packet.explicitRequest?.action === 'remember') {
        const record = await this.remember({
          scope: action.scope,
          ...(action.projectKey === undefined ? {} : { projectKey: action.projectKey }),
          category: action.category,
          text: action.text,
          memoryClass: action.memoryClass,
          title: action.title,
          reason: action.reason,
          tags: action.tags,
          pathPatterns: action.pathPatterns,
          taskTypes: action.taskTypes,
          operations: action.operations,
          phases: action.phases,
          language: action.language,
          source: { kind: 'user' },
        });
        return {
          action: 'create',
          persisted: true,
          observation: {
            deduplicated: false,
            ignored: false,
            candidate: false,
            promoted: true,
            record,
          },
        };
      }
      const observation = await this.observe({
        scope: action.scope,
        ...(action.projectKey === undefined ? {} : { projectKey: action.projectKey }),
        category: action.category,
        text: action.text,
        memoryClass: action.memoryClass,
        title: action.title,
        reason: action.reason,
        tags: action.tags,
        pathPatterns: action.pathPatterns,
        taskTypes: action.taskTypes,
        operations: action.operations,
        phases: action.phases,
        language: action.language,
        projectIdentity: packet.projectIdentity,
        candidateKey: action.candidateKey,
        observedAt: packet.createdAt,
        workflow: packet.workflow,
        changeId: packet.changeId,
        success: true,
        source: {
          kind: 'review',
          label: packet.checkpoint,
          workflow: packet.workflow,
          changeId: packet.changeId,
          projectKey: action.projectKey,
        },
      });
      return {
        action: 'create',
        persisted:
          !observation.ignored &&
          (observation.deduplicated || observation.candidate || observation.promoted),
        ...(observation.promoted
          ? {
              notification:
                action.language === 'en'
                  ? 'A reusable workflow preference is now available.'
                  : '已形成一条可复用的协作偏好。',
            }
          : {}),
        observation,
      };
    }

    if (action.action === 'update') {
      await this.correct(action.targetId, {
        ...(action.text === undefined ? {} : { text: action.text }),
        ...(action.category === undefined ? {} : { category: action.category }),
        ...(action.tags === undefined ? {} : { tags: action.tags }),
        ...(action.pathPatterns === undefined ? {} : { pathPatterns: action.pathPatterns }),
        ...(action.taskTypes === undefined ? {} : { taskTypes: action.taskTypes }),
        ...(action.operations === undefined ? {} : { operations: action.operations }),
        ...(action.phases === undefined ? {} : { phases: action.phases }),
        ...(action.title === undefined ? {} : { title: action.title }),
        ...(action.reason === undefined ? {} : { reason: action.reason }),
        ...(action.memoryClass === undefined ? {} : { memoryClass: action.memoryClass }),
      });
      return {
        action: 'update',
        persisted: true,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
        observation: undefined,
      };
    }

    await this.remove(action.targetId, {
      permanent: action.permanent === true,
    });
    return {
      action: 'forget',
      persisted: true,
      ...(action.reason === undefined ? {} : { reason: action.reason }),
    };
  }

  public async retrieve(query: MemoryQuery): Promise<MemoryRetrieval> {
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile(
        query.scope === 'global' ? 'global' : query.scope === 'project' ? 'project' : undefined,
        query.projectKey,
      );
      await this.persist(state);
      if (
        !state.settings.retrievalEnabled ||
        isProjectRetrievalPaused(state.settings, query.projectKey)
      ) {
        return { records: [], text: '', truncated: false, disabled: true };
      }
      if (query.view === 'combined' || query.view === 'profile' || query.view === 'task') {
        return buildContextRetrieval(
          state,
          query,
          query.profileMaxChars ?? this.profileMaxChars,
          query.taskMaxChars ?? query.maxChars ?? this.taskMaxChars,
        );
      }
      const maxEntries = boundedPositive(query.maxEntries ?? this.maxEntries, this.maxEntries);
      const maxBytes = boundedPositive(query.maxBytes ?? this.maxBytes, this.maxBytes);
      const candidates = state.records
        .filter(
          (entry) =>
            entry.state !== 'superseded' &&
            (entry.state !== 'trial' || trialIsEligibleForRetrieval(state, entry)),
        )
        .filter((entry) => !isConflictedInferred(state.conflicts, entry))
        .filter((entry) => scopeMatches(entry, query))
        .filter((entry) => attributesMatch(entry, query))
        .map((entry, index) => ({ record: entry, score: scoreRecord(entry, query), index }))
        .filter(({ score }) => score > 0 || query.query === undefined)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.record.updatedAt.localeCompare(left.record.updatedAt) ||
            left.index - right.index ||
            left.record.id.localeCompare(right.record.id),
        );
      const records: MemoryRecord[] = [];
      let text = '';
      let truncated = false;
      for (const candidate of candidates) {
        if (records.length >= maxEntries) {
          truncated = true;
          break;
        }
        const nextRecord = [...records, candidate.record];
        const nextText = renderRetrieval(nextRecord);
        if (Buffer.byteLength(nextText, 'utf8') > maxBytes) {
          truncated = true;
          break;
        }
        records.push(candidate.record);
        text = nextText;
      }
      return { records: records.map(cloneRecord), text, truncated, disabled: false };
    });
  }

  public async manage(query: MemoryQuery = {}): Promise<MemoryManagementView> {
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile(
        query.scope === 'global' ? 'global' : query.scope === 'project' ? 'project' : undefined,
        query.projectKey,
      );
      await this.persist(state);

      const candidates = state.records
        .filter((entry) => scopeMatches(entry, query))
        .filter((entry) => attributesMatch(entry, query))
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
        );
      const maxEntries = boundedPositive(
        query.maxEntries ?? DEFAULT_MANAGEMENT_MAX_ENTRIES,
        DEFAULT_MANAGEMENT_MAX_ENTRIES,
      );
      const maxBytes = boundedPositive(
        query.maxBytes ?? DEFAULT_MANAGEMENT_MAX_BYTES,
        DEFAULT_MANAGEMENT_MAX_BYTES,
      );
      const candidateIds = new Set(candidates.map((record) => record.id));
      const records: MemoryManagementRecord[] = [];
      let bytes = 0;
      let entryCount = 0;
      let truncated = false;
      for (const record of candidates) {
        if (entryCount >= maxEntries) {
          truncated = true;
          break;
        }
        const next = projectManagementRecord(state, record);
        const nextBytes = Buffer.byteLength(JSON.stringify(next), 'utf8');
        if (bytes + nextBytes > maxBytes) {
          truncated = true;
          break;
        }
        records.push(next);
        bytes += nextBytes;
        entryCount += 1;
      }

      const conflicts: MemoryManagementConflict[] = [];
      for (const conflict of state.conflicts) {
        const next = projectManagementConflict(conflict, candidateIds);
        if (next === null) continue;
        if (entryCount >= maxEntries) {
          truncated = true;
          break;
        }
        const nextBytes = Buffer.byteLength(JSON.stringify(next), 'utf8');
        if (bytes + nextBytes > maxBytes) {
          truncated = true;
          break;
        }
        conflicts.push(next);
        bytes += nextBytes;
        entryCount += 1;
      }
      return { records, conflicts, truncated };
    });
  }

  public async status(): Promise<PersonalMemoryStatus> {
    const status = await this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      await this.persist(state);
      return {
        learningEnabled: state.settings.learningEnabled,
        retrievalEnabled: state.settings.retrievalEnabled,
        pausedProjects: [...state.settings.pausedProjects],
        pausedLearningProjects: [...state.settings.pausedLearningProjects],
        pausedRetrievalProjects: [...state.settings.pausedRetrievalProjects],
        files: Object.keys(state.files)
          .filter((file) => state.files[file]?.hash !== '')
          .sort(),
        provider: { provider: 'local' as const, configured: true },
        profile: { usedChars: profileUsedChars(state), maxChars: this.profileMaxChars },
      };
    });
    return {
      ...status,
      remote: redactRemote((await this.repository.remote?.()) ?? null),
      sync: null,
    };
  }

  public async sync() {
    return this.repository.sync();
  }

  public async testProvider(): Promise<{ readonly ok: boolean; readonly message: string }> {
    return { ok: true, message: 'Local Provider is ready.' };
  }

  public async remote(): Promise<string | null> {
    return redactRemote((await this.repository.remote?.()) ?? null);
  }

  public async configureRemote(url: string): Promise<void> {
    if (this.repository.configureRemote === undefined)
      throw new Error('Memory Git sync is unavailable');
    await this.repository.configureRemote(url);
  }

  public async setLearningEnabled(enabled: boolean): Promise<void> {
    await this.updateSettings((settings) => ({ ...settings, learningEnabled: enabled }));
  }

  public async setRetrievalEnabled(enabled: boolean): Promise<void> {
    await this.updateSettings((settings) => ({ ...settings, retrievalEnabled: enabled }));
  }

  public async pauseProject(projectKey: string, paused: boolean): Promise<void> {
    await this.pauseProjectLearning(projectKey, paused);
    await this.pauseProjectRetrieval(projectKey, paused);
  }

  public async pauseProjectLearning(projectKey: string, paused: boolean): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(projectKey))
      throw new Error('Project key is invalid');
    await this.updateSettings((settings) => {
      const projects = new Set(settings.pausedLearningProjects);
      if (paused) projects.add(projectKey);
      else projects.delete(projectKey);
      return {
        ...settings,
        pausedLearningProjects: [...projects].sort(),
        pausedProjects: mergePausedProjects(projects, new Set(settings.pausedRetrievalProjects)),
      };
    });
  }

  public async pauseProjectRetrieval(projectKey: string, paused: boolean): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(projectKey))
      throw new Error('Project key is invalid');
    await this.updateSettings((settings) => {
      const projects = new Set(settings.pausedRetrievalProjects);
      if (paused) projects.add(projectKey);
      else projects.delete(projectKey);
      return {
        ...settings,
        pausedRetrievalProjects: [...projects].sort(),
        pausedProjects: mergePausedProjects(new Set(settings.pausedLearningProjects), projects),
      };
    });
  }

  private async updateSettings(
    update: (settings: MemorySettings) => MemorySettings,
  ): Promise<void> {
    await this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      state.settings = update(state.settings);
      await this.persist(state);
    });
  }

  private async loadAndReconcile(
    scope?: 'global' | 'project',
    projectKey?: string,
  ): Promise<MutableMemoryState> {
    const raw = await this.repository.readState();
    const state = mutableState(raw);
    await this.flushPendingFileProjections(state);
    await this.prepareProjectFileBinding(state);
    const knownProjectKeys = new Set<string>();
    for (const knownProjectKey of Object.keys(state.projectFiles)) {
      knownProjectKeys.add(knownProjectKey);
    }
    const binding = this.repository.projectFileBinding?.();
    if (binding !== undefined) knownProjectKeys.add(binding.projectKey);
    for (const record of state.records) {
      if (record.scope === 'project' && record.projectKey !== undefined)
        knownProjectKeys.add(record.projectKey);
    }
    for (const file of Object.keys(state.files)) {
      const match = /^projects\/([A-Za-z0-9][A-Za-z0-9._-]*)\.md$/u.exec(file);
      if (match?.[1] !== undefined && !Object.values(state.projectFiles).includes(file)) {
        knownProjectKeys.add(match[1]);
      }
    }
    const targets =
      scope === undefined
        ? [
            { scope: 'global' as const },
            ...[...knownProjectKeys].map((knownProjectKey) => ({
              scope: 'project' as const,
              projectKey: knownProjectKey,
            })),
            ...(projectKey !== undefined && !knownProjectKeys.has(projectKey)
              ? [{ scope: 'project' as const, projectKey }]
              : []),
          ]
        : [{ scope, ...(scope === 'project' ? { projectKey } : {}) }];
    for (const target of targets) {
      if (target.scope === 'project' && target.projectKey === undefined) continue;
      const file = this.resolveMemoryFilePath(state, target.scope, target.projectKey);
      const content = await this.repository.readText(file);
      reconcileMarkdown(state, file, target.scope, target.projectKey, content, this.timestamp());
    }
    return state;
  }

  private async persist(state: MutableMemoryState): Promise<void> {
    await this.repository.writeState(state as MemoryRuntimeState);
  }

  private resolveMemoryFilePath(
    state: MutableMemoryState,
    scope: 'global' | 'project',
    projectKey: string | undefined,
  ): string {
    if (scope === 'global') return memoryFilePath(scope);
    if (projectKey === undefined) throw new Error('Project memory requires a project key');
    const binding = this.repository.projectFileBinding?.();
    return (
      state.projectFiles[projectKey] ??
      (binding?.projectKey === projectKey ? binding.path : undefined) ??
      memoryFilePath(scope, projectKey)
    );
  }

  private async prepareProjectFileBinding(state: MutableMemoryState): Promise<void> {
    const binding = this.repository.projectFileBinding?.();
    if (binding === undefined) return;
    const occupiedByAnotherProject = Object.entries(state.projectFiles).some(
      ([projectKey, file]) => projectKey !== binding.projectKey && file === binding.path,
    );
    const projectPath = occupiedByAnotherProject
      ? `projects/${binding.projectName}-${binding.projectKey.slice(-8)}.md`
      : binding.path;
    if (state.projectFiles[binding.projectKey] === undefined) {
      state.projectFiles[binding.projectKey] = projectPath;
    }
  }

  private async writeRecordMarkdown(
    state: MutableMemoryState,
    record: StoredRecord,
    previousText?: string,
    previousCategory?: string,
  ): Promise<void> {
    const file = this.resolveMemoryFilePath(state, record.scope, record.projectKey);
    const existing = await this.readStableFile(state, file, record.scope, record.projectKey);
    const next = previousText
      ? replaceMarkdownBullet(
          existing ?? '',
          previousText,
          record.text,
          record.category,
          previousCategory,
          record.scope,
          this.language,
        )
      : appendMarkdownBullet(
          existing ?? '',
          record.category,
          record.text,
          record.scope,
          this.language,
        );
    if (next !== existing) {
      const confirmed = await this.readStableFile(state, file, record.scope, record.projectKey);
      if (confirmed !== existing) throw new Error(`Memory file changed during update: ${file}`);
    }
    await this.persistWithFileProjection(state, file, {
      content: next,
      baseHash: memoryFileHash(existing),
      scope: record.scope,
      ...(record.projectKey === undefined ? {} : { projectKey: record.projectKey }),
      queuedAt: this.timestamp(),
    });
  }

  private async persistWithFileProjection(
    state: MutableMemoryState,
    file: string,
    projection: MemoryFileProjection,
  ): Promise<void> {
    state.pendingFileProjections[file] = projection;
    state.files[file] = fileState(projection.content, projection.queuedAt);
    if (projection.scope === 'project' && projection.projectKey !== undefined) {
      state.projectFiles[projection.projectKey] = file;
    }
    await this.persist(state);
    try {
      await this.flushPendingFileProjections(state);
    } catch {
      // The mutation and its idempotency key are already authoritative. The durable
      // projection remains pending on disk and is replayed before the next reconcile.
    }
  }

  private async flushPendingFileProjections(state: MutableMemoryState): Promise<void> {
    const pending = Object.entries(state.pendingFileProjections);
    if (pending.length === 0) return;
    for (const [file, projection] of pending) {
      const current = await this.repository.readText(file);
      const currentHash = memoryFileHash(current);
      const targetHash = hashMemoryText(projection.content);
      if (currentHash !== targetHash && currentHash === projection.baseHash) {
        await this.repository.writeText(file, projection.content);
      }
    }
    for (const [file] of pending) delete state.pendingFileProjections[file];
    await this.persist(state);
  }

  private async readStableFile(
    state: MutableMemoryState,
    file: string,
    scope: 'global' | 'project',
    projectKey: string | undefined,
  ): Promise<string | null> {
    const content = await this.repository.readText(file);
    const expectedHash = state.files[file]?.hash;
    if (expectedHash !== undefined && memoryFileHash(content) !== expectedHash) {
      reconcileMarkdown(state, file, scope, projectKey, content, this.timestamp());
      await this.persist(state);
      throw new Error(`Memory file changed during update: ${file}`);
    }
    return content;
  }

  private updateRecordValue(
    current: StoredRecord,
    input: MemoryInput,
    kind: 'explicit' | 'inferred',
  ): StoredRecord {
    const source = input.source ?? current.source;
    const nextInput: MemoryInput = {
      scope: input.scope,
      projectKey: input.projectKey,
      memoryClass: input.memoryClass ?? current.memoryClass,
      title: input.title ?? current.title,
      reason: input.reason ?? current.reason,
      category: input.category ?? current.category,
      text: input.text ?? current.text,
      memoryType: input.memoryType ?? current.memoryType,
      tags: input.tags ?? current.tags,
      pathPatterns: input.pathPatterns ?? current.pathPatterns,
      taskTypes: input.taskTypes ?? current.taskTypes,
      operations: input.operations ?? current.operations,
      phases: input.phases ?? current.phases,
      episode: input.episode ?? current.episode,
      candidateKey: input.candidateKey ?? current.candidateKey,
      language: input.language ?? current.language,
      source,
    };
    return {
      ...current,
      identity: memoryIdentity(nextInput),
      memoryClass: nextInput.memoryClass,
      ...(nextInput.title === undefined ? {} : { title: nextInput.title }),
      ...(nextInput.reason === undefined ? {} : { reason: nextInput.reason }),
      category: nextInput.category,
      text: nextInput.text,
      tags: normalizeArray(nextInput.tags),
      pathPatterns: normalizeArray(nextInput.pathPatterns),
      taskTypes: normalizeArray(nextInput.taskTypes),
      operations: normalizeArray(nextInput.operations),
      phases: normalizeArray(nextInput.phases),
      kind,
      authority: kind,
      state: 'proven',
      source,
      sources: mergeSources(current.sources, [source]),
      evidence: mergeMemoryEvidence(
        current.evidence,
        normalizeMemoryEvidence(nextInput.evidence, source, nextInput.text, this.timestamp()),
      ),
      memoryType: nextInput.memoryType ?? current.memoryType,
      ...((nextInput.memoryType ?? current.memoryType) === 'personal-episode'
        ? { episode: normalizePersonalEpisode(nextInput.episode, nextInput) }
        : { episode: undefined }),
      updatedAt: this.timestamp(),
    };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

interface MutableMemoryState extends Omit<
  MemoryRuntimeState,
  | 'records'
  | 'history'
  | 'observations'
  | 'conflicts'
  | 'tombstones'
  | 'settings'
  | 'files'
  | 'projectFiles'
  | 'appliedMutationIds'
  | 'applicationOutcomes'
  | 'feedbackState'
  | 'pendingFileProjections'
> {
  records: StoredRecord[];
  history: Record<string, StoredRecord[]>;
  observations: MemoryStoredObservation[];
  conflicts: MemoryConflict[];
  tombstones: MemoryTombstone[];
  settings: MemorySettings;
  files: Record<string, { hash: string; observedAt: string }>;
  projectFiles: Record<string, string>;
  evidence: Record<string, string[]>;
  appliedMutationIds: string[];
  applicationOutcomes: Record<
    string,
    {
      recordId: string;
      status: import('../agent-learning/index.js').AgentContextOutcomeStatus;
      revision: number;
    }
  >;
  feedbackState: Record<
    string,
    { baseState: Exclude<import('./types.js').MemoryLifecycleState, 'superseded'> }
  >;
  pendingFileProjections: Record<string, MemoryFileProjection>;
}

function mutableState(raw: MemoryRuntimeState): MutableMemoryState {
  const normalizeRecord = (entry: MemoryRecord): StoredRecord => {
    const memoryType = entry.memoryType ?? inferPersonalMemoryType(entry, entry.kind);
    const normalized = {
      ...entry,
      phases: [...(entry.phases ?? [])],
      authority: entry.authority ?? entry.kind,
      evidence: (entry.evidence ?? []).map(cloneExperienceEvidence),
      memoryType,
      ...(memoryType === 'personal-episode'
        ? { episode: normalizePersonalEpisode(entry.episode, entry) }
        : {}),
    };
    if (entry.scope === 'global' && entry.projectKey !== undefined) {
      const { projectKey, ...withoutProjectKey } = normalized;
      void projectKey;
      return { ...withoutProjectKey, identity: memoryIdentity(withoutProjectKey) };
    }
    return { ...normalized, identity: memoryIdentity(normalized) };
  };
  return {
    version: 3,
    records: raw.records.map(normalizeRecord),
    history: Object.fromEntries(
      Object.entries(raw.history).map(([id, entries]) => [id, entries.map(normalizeRecord)]),
    ),
    observations: raw.observations.map((entry) => ({
      ...entry,
      changeId: entry.changeId ?? entry.source.changeId ?? entry.key,
      candidateKey: entry.candidateKey ?? entry.identity,
      ...(entry.projectIdentity === undefined && entry.projectKey === undefined
        ? {}
        : { projectIdentity: entry.projectIdentity ?? entry.projectKey }),
    })),
    conflicts: [...raw.conflicts],
    tombstones: normalizeTombstones(raw),
    settings: {
      learningEnabled: raw.settings.learningEnabled,
      retrievalEnabled: raw.settings.retrievalEnabled,
      pausedProjects: [...raw.settings.pausedProjects],
      pausedLearningProjects: [
        ...(raw.settings.pausedLearningProjects ?? raw.settings.pausedProjects ?? []),
      ],
      pausedRetrievalProjects: [
        ...(raw.settings.pausedRetrievalProjects ?? raw.settings.pausedProjects ?? []),
      ],
    },
    files: { ...raw.files },
    projectFiles: { ...(raw.projectFiles ?? {}) },
    evidence: (raw as MemoryRuntimeState & { evidence?: Record<string, string[]> }).evidence ?? {},
    appliedMutationIds: [...(raw.appliedMutationIds ?? [])],
    applicationOutcomes: { ...(raw.applicationOutcomes ?? {}) },
    feedbackState: { ...(raw.feedbackState ?? {}) },
    pendingFileProjections: { ...(raw.pendingFileProjections ?? {}) },
  };
}

function negativeContextOutcome(
  outcome: import('../agent-learning/index.js').AgentContextOutcomeStatus | undefined,
): boolean {
  return outcome === 'corrected' || outcome === 'contributed-to-failure';
}

function appendBoundedMutationId(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return [...ids];
  return [...ids, id].slice(-10_000);
}

function cloneRecord(record: MemoryRecord): MemoryRecord {
  return {
    ...record,
    tags: [...record.tags],
    pathPatterns: [...record.pathPatterns],
    taskTypes: [...record.taskTypes],
    operations: [...record.operations],
    phases: [...record.phases],
    evidence: record.evidence.map(cloneExperienceEvidence),
    ...(record.episode === undefined ? {} : { episode: { ...record.episode } }),
    source: { ...record.source },
    sources: record.sources.map((source) => ({ ...source })),
  };
}

function projectManagementRecord(
  state: MutableMemoryState,
  record: StoredRecord,
): MemoryManagementRecord {
  const evidenceKeys = state.evidence[record.id] ?? [];
  const evidenceDates = state.observations
    .filter((entry) => evidenceKeys.includes(entry.key))
    .map((entry) => entry.observedAt);
  const tombstoned = state.tombstones.some(
    (entry) => entry.recordId === record.id || entry.identity === record.identity,
  );
  const conflicted = isConflictedInferred(state.conflicts, record);
  const status = tombstoned
    ? ('tombstoned' as const)
    : conflicted
      ? ('conflict' as const)
      : record.state;
  return {
    id: record.id,
    scope: record.scope,
    ...(record.projectKey === undefined ? {} : { projectKey: record.projectKey }),
    memoryClass: record.memoryClass ?? inferMemoryClass(record),
    ...(record.title === undefined ? {} : { title: record.title }),
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    category: record.category,
    text: record.text,
    tags: [...record.tags],
    pathPatterns: [...record.pathPatterns],
    taskTypes: [...record.taskTypes],
    operations: [...record.operations],
    phases: [...record.phases],
    ...(record.language === undefined ? {} : { language: record.language }),
    kind: record.kind,
    authority: record.authority,
    evidence: record.evidence.map(cloneExperienceEvidence),
    ...(record.episode === undefined ? {} : { episode: { ...record.episode } }),
    memoryType: record.memoryType,
    applicationCount: record.applicationCount,
    successCount: record.successCount,
    failureCount: record.failureCount,
    ...(record.lastAppliedAt === undefined ? {} : { lastAppliedAt: record.lastAppliedAt }),
    status,
    evidenceCount: evidenceKeys.length,
    sourceKind: record.source.kind,
    lastConfirmedAt: [...evidenceDates, record.updatedAt].sort().at(-1) ?? record.updatedAt,
    updatedAt: record.updatedAt,
    canRollback: (state.history[record.id]?.length ?? 0) > 0,
  };
}

function projectManagementConflict(
  conflict: MemoryConflict,
  candidateIds: ReadonlySet<string>,
): MemoryManagementConflict | null {
  const recordIds = [...(conflict.recordIds ?? [])].sort();
  if (recordIds.length === 0 || !recordIds.some((id) => candidateIds.has(id))) return null;
  return {
    texts: [...conflict.texts],
    updatedAt: conflict.updatedAt,
  };
}

function createRecord(
  input: MemoryInput,
  kind: 'explicit' | 'inferred',
  source: MemorySource,
  timestamp: string,
  identity: string,
): StoredRecord {
  const memoryType = input.memoryType ?? inferPersonalMemoryType(input, kind);
  return {
    id: createHash('sha256')
      .update(`${identity}\n${normalizeText(input.text)}\n${randomUUID()}`)
      .digest('hex')
      .slice(0, 24),
    identity,
    scope: input.scope,
    ...(input.projectKey === undefined ? {} : { projectKey: input.projectKey }),
    memoryClass: input.memoryClass ?? inferMemoryClass(input),
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(input.reason === undefined ? {} : { reason: input.reason.trim() }),
    category: input.category.trim(),
    text: input.text.trim(),
    tags: normalizeArray(input.tags),
    pathPatterns: normalizeArray(input.pathPatterns),
    taskTypes: normalizeArray(input.taskTypes),
    operations: normalizeArray(input.operations),
    phases: normalizeArray(input.phases),
    ...(input.candidateKey === undefined ? {} : { candidateKey: input.candidateKey }),
    ...(input.language === undefined ? {} : { language: input.language }),
    kind,
    authority: kind,
    evidence: normalizeMemoryEvidence(input.evidence, source, input.text, timestamp),
    memoryType,
    ...(memoryType === 'personal-episode'
      ? { episode: normalizePersonalEpisode(input.episode, input) }
      : {}),
    state: kind === 'explicit' ? 'proven' : 'trial',
    applicationCount: 0,
    successCount: 0,
    failureCount: 0,
    source,
    sources: [source],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function addSource(record: StoredRecord, source: MemorySource, timestamp: string): StoredRecord {
  return {
    ...record,
    source: record.source,
    sources: mergeSources(record.sources, [source]),
    evidence: mergeMemoryEvidence(
      record.evidence,
      normalizeMemoryEvidence(undefined, source, record.text, timestamp),
    ),
    updatedAt: timestamp,
  };
}

function mergeSources(
  current: readonly MemorySource[],
  additions: readonly MemorySource[],
): MemorySource[] {
  const result = [...current];
  for (const source of additions) {
    if (result.some((entry) => JSON.stringify(entry) === JSON.stringify(source))) continue;
    result.push(source);
  }
  return result.slice(-MAX_SOURCES);
}

function normalizeMemoryEvidence(
  values: readonly AgentExperienceEvidence[] | undefined,
  source: MemorySource,
  text: string,
  _timestamp: string,
): AgentExperienceEvidence[] {
  const sourceLabel = source.label ?? source.changeId ?? source.workflow ?? source.projectKey;
  const digest = createHash('sha256')
    .update(JSON.stringify({ source, text: normalizeText(text) }))
    .digest('hex');
  const inferred: AgentExperienceEvidence = {
    id: `memory-evidence:${digest.slice(0, 20)}`,
    kind:
      source.kind === 'user'
        ? 'user'
        : source.kind === 'repository'
          ? 'source'
          : source.kind === 'review'
            ? 'review'
            : 'outcome',
    summary: text.slice(0, 500),
    ...(sourceLabel === undefined ? {} : { source: sourceLabel }),
    digest,
    success: true,
  };
  return mergeMemoryEvidence(values ?? [], [inferred]);
}

function mergeMemoryEvidence(
  current: readonly AgentExperienceEvidence[],
  additions: readonly AgentExperienceEvidence[],
): AgentExperienceEvidence[] {
  const merged = new Map<string, AgentExperienceEvidence>();
  for (const evidence of [...current, ...additions]) {
    const clone = cloneExperienceEvidence(evidence);
    merged.set(clone.digest ?? clone.id, clone);
  }
  return [...merged.values()].slice(-32);
}

function cloneExperienceEvidence(evidence: AgentExperienceEvidence): AgentExperienceEvidence {
  return { ...evidence };
}

function replaceRecord(records: readonly StoredRecord[], next: StoredRecord): StoredRecord[] {
  let found = false;
  const updated = records.map((entry) => {
    if (entry.id !== next.id) return entry;
    found = true;
    return next;
  });
  return found ? updated : [...updated, next];
}

function pushHistory(state: MutableMemoryState, record: StoredRecord): void {
  state.history[record.id] = [...(state.history[record.id] ?? []), { ...record }].slice(-10);
}

function clearInferredCandidates(state: MutableMemoryState, identity: string): void {
  const candidates = state.records.filter(
    (entry) => entry.identity === identity && entry.kind === 'inferred' && entry.state === 'trial',
  );
  for (const candidate of candidates) {
    state.records = state.records.filter((entry) => entry.id !== candidate.id);
    delete state.evidence[candidate.id];
  }
  state.conflicts = state.conflicts.filter((conflict) => conflict.identity !== identity);
}

function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function normalizeArray(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

function memoryIdentity(
  input: Pick<
    MemoryInput,
    | 'scope'
    | 'projectKey'
    | 'memoryType'
    | 'memoryClass'
    | 'category'
    | 'tags'
    | 'pathPatterns'
    | 'taskTypes'
    | 'operations'
    | 'phases'
    | 'candidateKey'
  >,
): string {
  const semanticIdentity =
    input.candidateKey === undefined
      ? ['category', normalizeText(input.category)]
      : ['candidate', input.candidateKey];
  return JSON.stringify([
    input.scope,
    input.scope === 'project' ? (input.projectKey ?? '') : '',
    input.memoryType ?? '',
    input.memoryClass ?? inferMemoryClass(input),
    semanticIdentity,
    normalizeArray(input.tags),
    normalizeArray(input.pathPatterns),
    normalizeArray(input.taskTypes),
    normalizeArray(input.operations),
    normalizeArray(input.phases),
  ]);
}

function memoryShapeIdentity(
  input: Pick<
    MemoryInput,
    | 'scope'
    | 'projectKey'
    | 'memoryType'
    | 'memoryClass'
    | 'category'
    | 'tags'
    | 'pathPatterns'
    | 'taskTypes'
    | 'operations'
    | 'phases'
  >,
): string {
  return memoryIdentity({ ...input, candidateKey: undefined });
}

function observationKey(
  observation: MemoryObservation,
  projectIdentity: string | undefined,
  candidateKey: string,
): string {
  // Comet keeps a stable change id while a change is resumed or upgraded
  // between presets (for example hotfix/tweak -> full).  The workflow label
  // is retained as source metadata, but must not turn one change into two
  // independent observations.
  return JSON.stringify([projectIdentity ?? '', observation.changeId.trim(), candidateKey]);
}

function observationInput(observation: MemoryObservation, source: MemorySource): MemoryInput {
  return {
    scope: observation.scope,
    ...(observation.scope === 'project' && observation.projectKey !== undefined
      ? { projectKey: observation.projectKey }
      : {}),
    ...(observation.memoryType === undefined ? {} : { memoryType: observation.memoryType }),
    memoryClass: observation.memoryClass ?? inferMemoryClass(observation),
    ...(observation.language === undefined ? {} : { language: observation.language }),
    ...(observation.title === undefined ? {} : { title: observation.title }),
    ...(observation.reason === undefined ? {} : { reason: observation.reason }),
    category: observation.category,
    text: observation.text,
    tags: observation.tags,
    pathPatterns: observation.pathPatterns,
    taskTypes: observation.taskTypes,
    operations: observation.operations,
    phases: observation.phases,
    evidence: observation.evidence,
    episode: observation.episode,
    candidateKey: observation.candidateKey,
    source,
  };
}

function fileState(content: string, timestamp: string): { hash: string; observedAt: string } {
  return { hash: hashMemoryText(content), observedAt: timestamp };
}

function memoryFileHash(content: string | null): string {
  return content === null ? '' : hashMemoryText(content);
}

function parseMarkdown(content: string): MarkdownBullet[] {
  const lines = content.replace(/\r\n?/gu, '\n').split('\n');
  let category = '其他';
  const bullets: MarkdownBullet[] = [];
  lines.forEach((line, index) => {
    const heading = /^(?:#{2,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) category = heading[1].trim();
    const bullet = /^\s*[-*+]\s+(.+?)\s*$/u.exec(line);
    if (bullet && bullet[1].trim().length > 0)
      bullets.push({ category, text: bullet[1].trim(), line: index });
  });
  return bullets;
}

function reconcileMarkdown(
  state: MutableMemoryState,
  file: string,
  scope: 'global' | 'project',
  projectKey: string | undefined,
  content: string | null,
  timestamp: string,
): void {
  const hash = content === null ? '' : hashMemoryText(content);
  const previous = state.files[file]?.hash;
  if (previous === hash) return;
  const bullets = content === null ? [] : parseMarkdown(content);
  const known = state.records.filter(
    (entry) => entry.scope === scope && entry.projectKey === projectKey,
  );
  for (const record of known) {
    if (record.state === 'superseded') continue;
    const stillPresent = bullets.some(
      (bullet) => normalizeText(bullet.text) === normalizeText(record.text),
    );
    if (!stillPresent) {
      pushHistory(state, record);
      state.records = replaceRecord(state.records, {
        ...record,
        state: 'superseded',
        updatedAt: timestamp,
      });
      delete state.evidence[record.id];
      state.tombstones = upsertTombstone(state.tombstones, {
        identity: record.identity,
        scope: record.scope,
        ...(record.projectKey === undefined ? {} : { projectKey: record.projectKey }),
        recordId: record.id,
        textHash: normalizedMemoryTextHash(record.text),
        reason: 'markdown-delete',
        removedAt: timestamp,
      });
    }
  }
  const seen = new Set<string>();
  for (const bullet of bullets) {
    const normalized = normalizeText(bullet.text);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (isTombstonedMarkdownText(state.tombstones, scope, projectKey, bullet.text)) continue;
    const matched = known.find(
      (record) => record.state !== 'superseded' && normalizeText(record.text) === normalized,
    ) as StoredRecord | undefined;
    if (matched !== undefined) {
      if (normalizeText(matched.category) !== normalizeText(bullet.category)) {
        pushHistory(state, matched);
        const input: MemoryInput = {
          scope,
          ...(projectKey ? { projectKey } : {}),
          memoryType: matched.memoryType,
          memoryClass: matched.memoryClass,
          category: bullet.category,
          text: bullet.text,
          tags: matched.tags,
          pathPatterns: matched.pathPatterns,
          taskTypes: matched.taskTypes,
          operations: matched.operations,
          source: { kind: 'user' },
        };
        state.records = replaceRecord(state.records, {
          ...matched,
          identity: memoryIdentity(input),
          category: bullet.category,
          kind: 'explicit',
          source: { kind: 'user' },
          sources: mergeSources(matched.sources, [{ kind: 'user' }]),
          updatedAt: timestamp,
        });
        clearTombstone(state, matched.identity);
      }
      continue;
    }
    const input: MemoryInput = {
      scope,
      ...(projectKey ? { projectKey } : {}),
      memoryType: inferPersonalMemoryType({ scope, category: bullet.category }, 'explicit'),
      category: bullet.category,
      text: bullet.text,
    };
    const identity = memoryIdentity(input);
    clearTombstone(state, identity);
    const record = createRecord(
      input,
      'explicit',
      input.source ?? { kind: 'user' },
      timestamp,
      identity,
    );
    state.records.push(record);
  }
  state.files[file] = { hash, observedAt: timestamp };
}

function appendMarkdownBullet(
  content: string,
  category: string,
  text: string,
  scope: 'global' | 'project',
  language: MemoryLanguage,
): string {
  const heading = `## ${category.trim()}`;
  if (content.trim().length === 0) {
    const title =
      scope === 'global'
        ? language === 'en'
          ? '# Personal Profile'
          : '# 个人画像'
        : language === 'en'
          ? '# Project Memory'
          : '# 项目记忆';
    return `${title}\n\n${heading}\n\n- ${text.trim()}\n`;
  }
  const lines = content.replace(/\r\n?/gu, '\n').split('\n');
  const headingIndex = lines.findIndex(
    (line) =>
      normalizeText(line.replace(/^#{2,6}\s+/u, '')) === normalizeText(category) &&
      /^#{2,6}\s+/u.test(line),
  );
  if (headingIndex === -1) {
    const prefix = content.endsWith('\n') ? content : `${content}\n`;
    return `${prefix}\n${heading}\n\n- ${text.trim()}\n`;
  }
  let insertAt = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^#{1,6}\s+/u.test(lines[index] ?? '')) {
      insertAt = index;
      break;
    }
  }
  lines.splice(insertAt, 0, `- ${text.trim()}`);
  return `${lines.join('\n').replace(/\n*$/u, '')}\n`;
}

function replaceMarkdownBullet(
  content: string,
  previousText: string,
  nextText: string,
  category: string,
  previousCategory: string | undefined,
  scope: 'global' | 'project',
  language: MemoryLanguage,
): string {
  const lines = content.replace(/\r\n?/gu, '\n').split('\n');
  const index = lines.findIndex((line) => {
    const bullet = /^\s*([-*+])\s+(.+?)\s*$/u.exec(line);
    return bullet !== null && normalizeText(bullet[2]) === normalizeText(previousText);
  });
  if (index >= 0) {
    if (
      previousCategory !== undefined &&
      normalizeText(previousCategory) !== normalizeText(category)
    ) {
      lines.splice(index, 1);
      return appendMarkdownBullet(
        `${lines.join('\n').replace(/\n*$/u, '')}\n`,
        category,
        nextText,
        scope,
        language,
      );
    }
    const marker = /^\s*([-*+])\s+/u.exec(lines[index] ?? '')?.[1] ?? '-';
    lines[index] = `${marker} ${nextText.trim()}`;
    return `${lines.join('\n').replace(/\n*$/u, '')}\n`;
  }
  return appendMarkdownBullet(content, category, nextText, scope, language);
}

function removeMarkdownBullet(content: string, text: string, category?: string): string {
  const lines = content.replace(/\r\n?/gu, '\n').split('\n');
  let currentCategory = '其他';
  const index = lines.findIndex((line) => {
    const heading = /^(?:#{2,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) {
      currentCategory = heading[1].trim();
      return false;
    }
    const bullet = /^\s*[-*+]\s+(.+?)\s*$/u.exec(line);
    return (
      bullet !== null &&
      normalizeText(bullet[1]) === normalizeText(text) &&
      (category === undefined || normalizeText(currentCategory) === normalizeText(category))
    );
  });
  if (index < 0) return content;
  lines.splice(index, 1);
  return `${lines.join('\n').replace(/\n*$/u, '')}\n`;
}

function buildContextRetrieval(
  state: MutableMemoryState,
  query: MemoryQuery,
  profileMaxChars: number,
  taskMaxChars: number,
): MemoryRetrieval {
  const active = state.records
    .filter(
      (entry) =>
        entry.state !== 'superseded' &&
        (entry.state !== 'trial' || trialIsEligibleForRetrieval(state, entry)),
    )
    .filter((entry) => !isConflictedInferred(state.conflicts, entry));
  const profileCandidates = active
    .filter(isUserProfileRecord)
    .sort(
      (left, right) =>
        profilePriority(left) - profilePriority(right) || compareRecords(left, right, query),
    );
  const profileSelection = selectWithinChars(profileCandidates, profileMaxChars);
  const profileIds = new Set(profileSelection.records.map((entry) => entry.id));

  const taskSelection =
    query.view === 'profile'
      ? { records: [] as StoredRecord[], truncated: false }
      : selectWithinChars(
          active
            .filter((entry) => !profileIds.has(entry.id))
            .filter((entry) => scopeMatches(entry, query))
            .filter((entry) => attributesMatch(entry, query))
            .map((entry) => ({ record: entry, score: scoreRecord(entry, query) }))
            .filter(({ score }) => score > 0 || query.query === undefined)
            .sort(
              (left, right) =>
                right.score - left.score || compareRecords(left.record, right.record, query),
            )
            .map(({ record }) => record),
          taskMaxChars,
        );

  const profileText = renderRetrieval(profileSelection.records);
  const taskText = renderRetrieval(taskSelection.records);
  const sections = [
    profileText ? `## User Profile\n${profileText}` : '',
    taskText ? `## Relevant personal memory\n${taskText}` : '',
  ].filter(Boolean);
  return {
    records: [...profileSelection.records, ...taskSelection.records].map(cloneRecord),
    text: sections.join('\n\n'),
    truncated: profileSelection.truncated || taskSelection.truncated,
    disabled: false,
    profileRecords: profileSelection.records.map(cloneRecord),
    profileText,
    taskRecords: taskSelection.records.map(cloneRecord),
    taskText,
    profileTruncated: profileSelection.truncated,
    taskTruncated: taskSelection.truncated,
  };
}

function trialIsEligibleForRetrieval(state: MutableMemoryState, record: StoredRecord): boolean {
  const evidenceKeys = state.evidence[record.id] ?? [];
  return evidenceKeys.length > 0;
}

function profileUsedChars(state: MutableMemoryState): number {
  const records = state.records
    .filter((entry) => entry.state !== 'superseded')
    .filter((entry) => !isConflictedInferred(state.conflicts, entry))
    .filter(isUserProfileRecord)
    .sort(
      (left, right) =>
        profilePriority(left) - profilePriority(right) ||
        compareRecords(left, right, { view: 'profile' }),
    );
  return unicodeLength(renderRetrieval(records));
}

function isUserProfileRecord(record: StoredRecord): boolean {
  if (record.scope !== 'global' || record.memoryType !== 'core-profile') return false;
  if (
    record.pathPatterns.length > 0 ||
    record.taskTypes.length > 0 ||
    record.operations.length > 0 ||
    record.phases.length > 0
  )
    return false;
  const memoryClass = record.memoryClass ?? inferMemoryClass(record);
  return (
    memoryClass === 'user-fact' ||
    memoryClass === 'user-preference' ||
    memoryClass === 'collaboration-habit'
  );
}

function profilePriority(record: StoredRecord): number {
  switch (record.memoryClass ?? inferMemoryClass(record)) {
    case 'user-fact':
      return 0;
    case 'user-preference':
      return 1;
    case 'collaboration-habit':
      return 2;
    default:
      return 3;
  }
}

function inferMemoryClass(
  value: Pick<MemoryInput, 'scope' | 'category' | 'memoryClass'>,
): MemoryClass {
  if (value.memoryClass !== undefined) return value.memoryClass;
  if (value.scope === 'project') return 'project-convention';
  if (/(?:用户事实|身份|姓名|角色|时区|user\s*fact|identity|timezone)/iu.test(value.category))
    return 'user-fact';
  if (/(?:协作|习惯|workflow|collaboration|habit)/iu.test(value.category))
    return 'collaboration-habit';
  return 'user-preference';
}

function inferPersonalMemoryType(
  value: Pick<MemoryInput, 'scope' | 'category' | 'memoryClass'>,
  kind: 'explicit' | 'inferred',
): MemoryRecord['memoryType'] {
  const memoryClass = value.memoryClass ?? inferMemoryClass(value);
  if (kind === 'inferred') {
    return memoryClass === 'collaboration-habit' || memoryClass === 'project-convention'
      ? 'collaboration-policy'
      : 'personal-episode';
  }
  return memoryClass === 'user-fact' || memoryClass === 'user-preference'
    ? 'core-profile'
    : 'collaboration-policy';
}

function isPersonalMemoryType(value: unknown): value is MemoryRecord['memoryType'] {
  return (
    value === 'core-profile' || value === 'collaboration-policy' || value === 'personal-episode'
  );
}

function personalEpisodeFromPayload(value: unknown): PersonalEpisodeDetails | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<Record<keyof PersonalEpisodeDetails, unknown>>;
  if (
    typeof candidate.situation !== 'string' ||
    typeof candidate.actionSummary !== 'string' ||
    typeof candidate.outcome !== 'string' ||
    typeof candidate.lesson !== 'string'
  ) {
    return undefined;
  }
  return {
    situation: candidate.situation,
    actionSummary: candidate.actionSummary,
    outcome: candidate.outcome,
    lesson: candidate.lesson,
  };
}

function selectWithinChars(
  candidates: readonly StoredRecord[],
  maxChars: number,
): { records: StoredRecord[]; truncated: boolean } {
  const records: StoredRecord[] = [];
  let truncated = false;
  for (const candidate of candidates) {
    const next = [...records, candidate];
    if (unicodeLength(renderRetrieval(next)) > boundedPositive(maxChars, DEFAULT_TASK_MAX_CHARS)) {
      truncated = true;
      continue;
    }
    records.push(candidate);
  }
  return { records, truncated };
}

function compareRecords(left: StoredRecord, right: StoredRecord, _query: MemoryQuery): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function scopeMatches(record: StoredRecord, query: MemoryQuery): boolean {
  if (query.scope !== undefined && record.scope !== query.scope) return false;
  if (record.scope === 'project' && record.projectKey !== query.projectKey) return false;
  if (record.scope === 'global' && query.scope === 'project') return false;
  return true;
}

function attributesMatch(record: StoredRecord, query: MemoryQuery): boolean {
  if (
    query.task !== undefined &&
    record.taskTypes.length > 0 &&
    !matchesAny(record.taskTypes, query.task)
  )
    return false;
  if (
    query.path !== undefined &&
    record.pathPatterns.length > 0 &&
    !matchesAny(record.pathPatterns, query.path)
  )
    return false;
  if (
    query.operation !== undefined &&
    record.operations.length > 0 &&
    !matchesAny(record.operations, query.operation)
  )
    return false;
  if (
    record.phases.length > 0 &&
    (query.phase === undefined || !matchesAny(record.phases, query.phase))
  )
    return false;
  if (query.category !== undefined && !matchesAny([record.category], query.category)) return false;
  if (query.tags !== undefined && !query.tags.every((tag) => matchesAny(record.tags, tag)))
    return false;
  if (query.query !== undefined) {
    const terms = query.query.split(/\s+/u).map(normalizeText).filter(Boolean);
    if (terms.length > 0) {
      const haystack = normalizeText([record.category, record.text, ...record.tags].join(' '));
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
  }
  return true;
}

function matchesAny(values: readonly string[], value: string): boolean {
  const normalized = normalizeText(value);
  return values.some((entry) => {
    const candidate = normalizeText(entry);
    if (candidate === normalized || candidate.includes(normalized)) return true;
    if (!candidate.includes('*')) return false;
    const pattern = `^${candidate.split('*').map(escapeRegExp).join('.*')}$`;
    return new RegExp(pattern, 'u').test(normalized);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function scoreRecord(record: StoredRecord, query: MemoryQuery): number {
  let score = record.kind === 'explicit' ? 100 : 60;
  score += record.state === 'proven' ? 200 : 0;
  score += Math.min(record.successCount, 5) * 20;
  score -= Math.min(record.failureCount, 5) * 40;
  if (record.scope === 'project') score += 50;
  if (query.task !== undefined && matchesAny(record.taskTypes, query.task)) score += 25;
  if (query.path !== undefined && matchesAny(record.pathPatterns, query.path)) score += 25;
  if (query.operation !== undefined && matchesAny(record.operations, query.operation)) score += 25;
  if (query.phase !== undefined && matchesAny(record.phases, query.phase)) score += 25;
  if (query.category !== undefined && matchesAny([record.category], query.category)) score += 20;
  if (query.tags !== undefined) {
    score += query.tags.filter((tag) => matchesAny(record.tags, tag)).length * 15;
  }
  if (query.query !== undefined) {
    const terms = query.query.split(/\s+/u).map(normalizeText).filter(Boolean);
    const haystack = normalizeText([record.category, record.text, ...record.tags].join(' '));
    for (const term of terms) if (haystack.includes(term)) score += 10;
  }
  return score;
}

function normalizePersonalEpisode(
  episode: PersonalEpisodeDetails | undefined,
  record: Pick<MemoryInput, 'title' | 'category' | 'text' | 'reason' | 'language' | 'evidence'>,
): PersonalEpisodeDetails {
  const evidence = record.evidence ?? [];
  const evidenceSummary = evidence
    .map((entry) => entry.summary.trim())
    .filter(Boolean)
    .join('；');
  const successful = evidence.some((entry) => entry.success === true);
  const failed = evidence.some((entry) => entry.success === false);
  const english = record.language === 'en';
  return {
    situation: episode?.situation.trim() || record.title?.trim() || record.category.trim(),
    actionSummary: episode?.actionSummary.trim() || evidenceSummary || record.text.trim(),
    outcome:
      episode?.outcome.trim() ||
      (failed
        ? english
          ? 'Unsuccessful'
          : '未成功'
        : successful
          ? english
            ? 'Successful'
            : '成功'
          : record.reason?.trim() || (english ? 'Observed' : '已记录')),
    lesson: episode?.lesson.trim() || record.text.trim(),
  };
}

function renderRetrieval(records: readonly MemoryRecord[]): string {
  const groups = new Map<string, MemoryRecord[]>();
  for (const record of records)
    groups.set(record.category, [...(groups.get(record.category) ?? []), record]);
  return [...groups.entries()]
    .map(
      ([category, entries]) =>
        `## ${category}\n${entries.map((entry) => `- ${entry.text}`).join('\n')}`,
    )
    .join('\n\n');
}

function isProjectRetrievalPaused(
  settings: MemorySettings,
  projectKey: string | undefined,
): boolean {
  return projectKey !== undefined && settings.pausedRetrievalProjects.includes(projectKey);
}

function mergePausedProjects(
  learning: ReadonlySet<string>,
  retrieval: ReadonlySet<string>,
): string[] {
  return [...new Set([...learning, ...retrieval])].sort();
}

function redactRemote(remote: string | null): string | null {
  if (remote === null) return null;
  try {
    const parsed = new URL(remote);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? '***' : '';
      parsed.password = parsed.password ? '***' : '';
    }
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return remote.replace(/(\/\/)[^/@]+@/u, '$1***@');
  }
}

function boundedPositive(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function addConflict(
  conflicts: readonly MemoryConflict[],
  identity: string,
  records: readonly StoredRecord[],
  timestamp: string,
): MemoryConflict[] {
  const texts = [
    ...new Set(
      records.filter((record) => record.identity === identity).map((record) => record.text),
    ),
  ].sort();
  const recordIds = [...new Set(records.map((record) => record.id))].sort();
  const next = { identity, texts, recordIds, updatedAt: timestamp };
  return [...conflicts.filter((conflict) => conflict.identity !== identity), next];
}

function isConflictedInferred(conflicts: readonly MemoryConflict[], record: StoredRecord): boolean {
  if (record.kind !== 'inferred') return false;
  return conflicts.some(
    (conflict) =>
      conflict.identity === record.identity &&
      (conflict.recordIds === undefined || conflict.recordIds.includes(record.id)),
  );
}

function independentEvidenceCount(
  scope: MemoryScope,
  observations: readonly MemoryStoredObservation[],
): number {
  if (scope === 'project') return new Set(observations.map((entry) => entry.changeId)).size;
  return new Set(
    observations
      .map((entry) => entry.projectIdentity ?? entry.projectKey)
      .filter((identity): identity is string => identity !== undefined && identity.length > 0),
  ).size;
}

function upsertTombstone(
  tombstones: readonly MemoryTombstone[],
  next: MemoryTombstone,
): MemoryTombstone[] {
  return [...tombstones.filter((entry) => entry.identity !== next.identity), next];
}

function clearTombstone(state: MutableMemoryState, identity: string): void {
  state.tombstones = state.tombstones.filter((entry) => entry.identity !== identity);
}

function isTombstonedMarkdownText(
  tombstones: readonly MemoryTombstone[],
  scope: MemoryScope,
  projectKey: string | undefined,
  text: string,
): boolean {
  const textHash = normalizedMemoryTextHash(text);
  const rawHash = hashMemoryText(text);
  return tombstones.some(
    (entry) =>
      entry.scope === scope &&
      entry.projectKey === projectKey &&
      entry.textHash !== undefined &&
      (entry.textHash === textHash || entry.textHash === rawHash),
  );
}

function normalizedMemoryTextHash(text: string): string {
  return hashMemoryText(normalizeText(text).replace(/\s+/gu, ''));
}

function validateInput(input: MemoryInput, configuredLanguage?: MemoryLanguage): void {
  if (input.scope === 'project' && input.projectKey === undefined)
    throw new Error('Project memory requires a project key');
  if (input.scope === 'project' && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.projectKey ?? ''))
    throw new Error('Project key is invalid');
  if (input.category.trim().length === 0 || input.text.trim().length === 0)
    throw new Error('Memory category and text are required');
  if (
    input.candidateKey !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(input.candidateKey)
  ) {
    throw new Error('Memory candidate key is invalid');
  }
  validateSafeMemoryText(input.category);
  validateSafeMemoryText(input.text);
  for (const [field, value] of [
    ['title', input.title],
    ['reason', input.reason],
  ] as const) {
    if (value === undefined) continue;
    if (value.trim().length === 0) throw new Error(`Memory ${field} must not be empty`);
    validateSafeMemoryText(value);
    if (configuredLanguage !== undefined) {
      validateMemoryLanguageText(value, configuredLanguage, field);
    }
  }
  validateMemoryArrays(input);
  validatePersonalEpisode(input.episode, configuredLanguage);
}

function validateCorrection(correction: MemoryCorrection, language?: MemoryLanguage): void {
  for (const [field, value] of [
    ['title', correction.title],
    ['reason', correction.reason],
    ['text', correction.text],
    ['category', correction.category],
  ] as const) {
    if (value === undefined) continue;
    if (normalizeText(value).length === 0)
      throw new Error(`Memory correction ${field} must not be empty`);
    validateSafeMemoryText(value);
    if (language !== undefined && field !== 'text') {
      validateMemoryLanguageText(value, language, `correction.${field}`);
    }
  }
  validateMemoryArrays(correction);
  validatePersonalEpisode(correction.episode, language);
}

function memoryCorrectionIsUnchanged(record: MemoryRecord, correction: MemoryCorrection): boolean {
  return (
    (correction.title === undefined || correction.title === record.title) &&
    (correction.reason === undefined || correction.reason === record.reason) &&
    (correction.text === undefined || correction.text === record.text) &&
    (correction.category === undefined || correction.category === record.category) &&
    (correction.memoryType === undefined || correction.memoryType === record.memoryType) &&
    (correction.memoryClass === undefined || correction.memoryClass === record.memoryClass) &&
    (correction.tags === undefined || equalStrings(correction.tags, record.tags)) &&
    (correction.pathPatterns === undefined ||
      equalStrings(correction.pathPatterns, record.pathPatterns)) &&
    (correction.taskTypes === undefined || equalStrings(correction.taskTypes, record.taskTypes)) &&
    (correction.operations === undefined ||
      equalStrings(correction.operations, record.operations)) &&
    (correction.phases === undefined || equalStrings(correction.phases, record.phases))
  );
}

function validatePersonalEpisode(
  episode: PersonalEpisodeDetails | undefined,
  language?: MemoryLanguage,
): void {
  if (episode === undefined) return;
  for (const [field, value] of Object.entries(episode)) {
    if (value.trim().length === 0) throw new Error(`Memory episode ${field} must not be empty`);
    validateSafeMemoryText(value);
    if (language !== undefined) validateMemoryLanguageText(value, language, `episode.${field}`);
  }
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateMemoryArrays(
  input: Pick<MemoryInput, 'tags' | 'pathPatterns' | 'taskTypes' | 'operations' | 'phases'>,
): void {
  for (const [field, values] of [
    ['tags', input.tags],
    ['pathPatterns', input.pathPatterns],
    ['taskTypes', input.taskTypes],
    ['operations', input.operations],
    ['phases', input.phases],
  ] as const) {
    if (values === undefined) continue;
    if (values.length > 32) throw new Error(`Memory ${field} exceeds the collection limit`);
    values.forEach((value) => {
      validateSafeMemoryText(value);
    });
  }
}

function validateObservation(observation: MemoryObservation): void {
  validateInput(observation, observation.language);
  if (observation.workflow.trim().length === 0 || observation.changeId.trim().length === 0)
    throw new Error('Observation workflow and change ID are required');
  if (
    observation.candidateKey !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(observation.candidateKey)
  ) {
    throw new Error('Observation candidate key is invalid');
  }
  if (
    observation.projectIdentity !== undefined &&
    observation.projectIdentity.trim().length === 0
  ) {
    throw new Error('Observation project identity is invalid');
  }
}

function isUsefulAutomaticObservation(observation: MemoryObservation): boolean {
  if (observation.language === undefined) return false;
  try {
    [
      observation.category,
      observation.text,
      ...(observation.tags ?? []),
      ...(observation.pathPatterns ?? []),
      ...(observation.taskTypes ?? []),
      ...(observation.operations ?? []),
      ...(observation.phases ?? []),
    ].forEach((value) => validateSafeMemoryText(value));
    validateMemoryLanguageText(observation.category, observation.language, 'observation.category');
    validateMemoryLanguageText(observation.text, observation.language, 'observation.text');
    (observation.tags ?? []).forEach((tag, index) =>
      validateMemoryLanguageText(tag, observation.language!, `observation.tags[${index}]`),
    );
  } catch {
    return false;
  }
  const normalized = normalizeText(
    [observation.category, observation.text, ...(observation.tags ?? [])].join(' '),
  );
  if (Buffer.byteLength(normalized, 'utf8') < 8) return false;
  if (
    /(?:diff --git|@@\s+-\d|\+\+\+\s+[ab]\/|---\s+[ab]\/|stack trace|traceback|stderr|stdout|debug log|npm warn)/iu.test(
      normalized,
    )
  ) {
    return false;
  }
  if (
    /^(?:运行|执行|完成|通过|失败|已完成)?\s*(?:测试|test|命令|command|commit|提交|pull request|pr|issue)(?:\s|$)/iu.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/^(?:change|任务)\s*[:#-]?\s*\S+\s+(?:completed|完成|done)$/iu.test(normalized)) {
    return false;
  }
  return true;
}

function normalizeTombstones(raw: MemoryRuntimeState): MemoryTombstone[] {
  const records = [...raw.records, ...Object.values(raw.history).flat()];
  return (raw.tombstones ?? []).map((entry) => {
    if (entry.textHash !== undefined) return { ...entry };
    const record = records.find((candidate) => candidate.id === entry.recordId);
    return record === undefined
      ? { ...entry }
      : {
          ...entry,
          textHash: normalizedMemoryTextHash(record.text),
        };
  });
}
