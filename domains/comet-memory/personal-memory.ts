import { createHash, randomUUID } from 'node:crypto';

import type {
  MemoryConflict,
  MemoryCorrection,
  MemoryInput,
  MemoryLanguage,
  MemoryManagementConflict,
  MemoryManagementRecord,
  MemoryManagementView,
  MemoryObservation,
  MemoryObservationResult,
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
  PersonalMemoryOptions,
  PersonalMemoryServiceLike,
  PersonalMemoryStatus,
} from './types.js';
import { hashMemoryText, memoryFilePath } from './repository.js';
import {
  validateMemoryLanguageText,
  validateMemoryReviewActions,
  validateMemoryReviewPacket,
  validateSafeMemoryText,
} from './review-contract.js';

const DEFAULT_MAX_ENTRIES = 12;
const DEFAULT_MAX_BYTES = 8 * 1024;
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

export class PersonalMemoryService implements PersonalMemoryServiceLike {
  private readonly repository: MemoryRepository;
  private readonly now: () => Date;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly language: MemoryLanguage;

  public constructor(options: PersonalMemoryOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
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
      const identity = memoryIdentity(input);
      const normalized = normalizeText(input.text);
      const existing = state.records.find(
        (entry) =>
          entry.active && entry.identity === identity && normalizeText(entry.text) === normalized,
      ) as StoredRecord | undefined;
      if (existing !== undefined) {
        const refreshed = {
          ...addSource(existing, source, this.timestamp()),
          kind: 'explicit' as const,
          active: true,
          source,
        };
        state.records = replaceRecord(state.records, refreshed);
        clearInferredCandidates(state, identity);
        clearTombstone(state, identity);
        await this.persist(state);
        return cloneRecord(refreshed);
      }

      const record = createRecord(input, 'explicit', source, this.timestamp(), identity);
      clearInferredCandidates(state, identity);
      clearTombstone(state, identity);
      state.records = replaceRecord(state.records, record);
      await this.writeRecordMarkdown(state, record);
      await this.persist(state);
      return cloneRecord(record);
    });
  }

  public async correct(id: string, correction: MemoryCorrection): Promise<MemoryRecord> {
    if (correction.text !== undefined && normalizeText(correction.text).length === 0) {
      throw new Error('Memory correction text must not be empty');
    }
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      const current = state.records.find((entry) => entry.id === id) as StoredRecord | undefined;
      const userRemoved =
        current !== undefined &&
        state.tombstones.some(
          (entry) => entry.identity === current.identity && entry.reason === 'user-remove',
        );
      if (current === undefined || (!current.active && !userRemoved)) {
        throw new Error(`Memory is not active: ${id}`);
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
      await this.writeRecordMarkdown(state, next, current.text, current.category);
      await this.persist(state);
      return cloneRecord(next);
    });
  }

  public async remove(id: string, options: { readonly permanent?: boolean } = {}): Promise<void> {
    await this.repository.withLock(async () => {
      const state = await this.loadAndReconcile();
      const current = state.records.find((entry) => entry.id === id) as StoredRecord | undefined;
      if (current === undefined) throw new Error(`Unknown memory: ${id}`);
      if (current.active) {
        const path = memoryFilePath(current.scope, current.projectKey);
        const content = await this.readStableFile(state, path, current.scope, current.projectKey);
        const refreshed = state.records.find((entry) => entry.id === id) as
          | StoredRecord
          | undefined;
        if (refreshed?.active) {
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
              await this.repository.writeText(path, nextContent);
            }
            state.files[path] = fileState(nextContent, this.timestamp());
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
          active: false,
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
        removedAt: this.timestamp(),
      });
      await this.persist(state);
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
      const next = { ...previous, id, active: true, updatedAt: this.timestamp() } as StoredRecord;
      state.records = replaceRecord(state.records, next);
      clearTombstone(state, next.identity);
      await this.writeRecordMarkdown(
        state,
        next,
        current.active ? current.text : undefined,
        current.active ? current.category : undefined,
      );
      await this.persist(state);
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
        activated: false,
        record: null,
      };
    }
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile(observation.scope, observation.projectKey);
      const projectIdentity = observation.projectIdentity ?? observation.projectKey;
      const candidateKey = observation.candidateKey ?? memoryIdentity(observation);
      const key = observationKey(observation, projectIdentity, candidateKey);
      const previous = state.observations.find((entry) => entry.key === key);
      if (previous !== undefined && (previous.success || !observation.success)) {
        return {
          deduplicated: true,
          ignored: false,
          candidate: false,
          activated: false,
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
        identity: memoryIdentity(observation),
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
          activated: false,
          record: null,
        };
      }

      const identity = stored.identity;
      const normalized = stored.normalizedText;
      const tombstone = state.tombstones.find((entry) => entry.identity === identity);
      if (tombstone !== undefined && stored.observedAt <= tombstone.removedAt) {
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: true,
          candidate: false,
          activated: false,
          record: null,
        };
      }
      const candidate = state.records.find(
        (entry) =>
          (tombstone === undefined || entry.createdAt > tombstone.removedAt) &&
          !entry.active &&
          entry.kind === 'inferred' &&
          entry.identity === identity &&
          normalizeText(entry.text) === normalized,
      ) as StoredRecord | undefined;
      const record =
        candidate ??
        (createRecord(
          observationInput(observation, source),
          'inferred',
          source,
          stored.observedAt,
          identity,
        ) as StoredRecord);
      state.records = candidate ? state.records : [...state.records, record];
      const evidence = new Set(state.evidence[record.id] ?? []);
      evidence.add(key);
      state.evidence[record.id] = [...evidence];
      const active = state.records.find((entry) => entry.active && entry.identity === identity) as
        | StoredRecord
        | undefined;
      const conflicting = state.records.filter(
        (entry) =>
          entry.id !== record.id &&
          entry.identity === identity &&
          normalizeText(entry.text) !== normalized &&
          (entry.active || (state.evidence[entry.id]?.length ?? 0) > 0),
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
          activated: false,
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
          activated: false,
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
          activated: false,
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
          activated: false,
          record: null,
        };
      }

      const candidateSources = state.observations
        .filter((entry) => evidence.has(entry.key))
        .map((entry) => entry.source);
      const activated = {
        ...record,
        active: true,
        source: candidateSources[0] ?? record.source,
        sources: mergeSources(record.sources, candidateSources),
        updatedAt: this.timestamp(),
      } as StoredRecord;
      state.records = replaceRecord(state.records, activated);
      clearTombstone(state, identity);
      await this.writeRecordMarkdown(state, activated);
      await this.persist(state);
      return {
        deduplicated: false,
        ignored: false,
        candidate: true,
        activated: true,
        record: cloneRecord(activated),
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
      const observation = await this.observe({
        scope: action.scope,
        ...(action.projectKey === undefined ? {} : { projectKey: action.projectKey }),
        category: action.category,
        text: action.text,
        title: action.title,
        reason: action.reason,
        tags: action.tags,
        pathPatterns: action.pathPatterns,
        taskTypes: action.taskTypes,
        operations: action.operations,
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
          (observation.deduplicated || observation.candidate || observation.activated),
        ...(observation.activated
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
        ...(action.title === undefined ? {} : { title: action.title }),
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      });
      return {
        action: 'update',
        persisted: true,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
        observation: undefined,
      };
    }

    await this.remove(action.targetId);
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
      const maxEntries = boundedPositive(query.maxEntries ?? this.maxEntries, this.maxEntries);
      const maxBytes = boundedPositive(query.maxBytes ?? this.maxBytes, this.maxBytes);
      const candidates = state.records
        .filter((entry) => entry.active)
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
      };
    });
    return {
      ...status,
      remote: redactRemote((await this.repository.remote?.()) ?? null),
      sync: await this.repository.sync(),
    };
  }

  public async sync() {
    return this.repository.sync();
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
    const knownProjectKeys = new Set<string>();
    for (const record of state.records) {
      if (record.scope === 'project' && record.projectKey !== undefined)
        knownProjectKeys.add(record.projectKey);
    }
    for (const file of Object.keys(state.files)) {
      const match = /^projects\/([A-Za-z0-9][A-Za-z0-9._-]*)\.md$/u.exec(file);
      if (match?.[1] !== undefined) knownProjectKeys.add(match[1]);
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
      const file = memoryFilePath(target.scope, target.projectKey);
      const content = await this.repository.readText(file);
      reconcileMarkdown(state, file, target.scope, target.projectKey, content, this.timestamp());
    }
    return state;
  }

  private async persist(state: MutableMemoryState): Promise<void> {
    await this.repository.writeState(state as MemoryRuntimeState);
  }

  private async writeRecordMarkdown(
    state: MutableMemoryState,
    record: StoredRecord,
    previousText?: string,
    previousCategory?: string,
  ): Promise<void> {
    const file = memoryFilePath(record.scope, record.projectKey);
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
      await this.repository.writeText(file, next);
    }
    state.files[file] = fileState(next, this.timestamp());
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
      title: input.title ?? current.title,
      reason: input.reason ?? current.reason,
      category: input.category ?? current.category,
      text: input.text ?? current.text,
      tags: input.tags ?? current.tags,
      pathPatterns: input.pathPatterns ?? current.pathPatterns,
      taskTypes: input.taskTypes ?? current.taskTypes,
      operations: input.operations ?? current.operations,
      language: input.language ?? current.language,
      source,
    };
    return {
      ...current,
      identity: memoryIdentity(nextInput),
      ...(nextInput.title === undefined ? {} : { title: nextInput.title }),
      ...(nextInput.reason === undefined ? {} : { reason: nextInput.reason }),
      category: nextInput.category,
      text: nextInput.text,
      tags: normalizeArray(nextInput.tags),
      pathPatterns: normalizeArray(nextInput.pathPatterns),
      taskTypes: normalizeArray(nextInput.taskTypes),
      operations: normalizeArray(nextInput.operations),
      kind,
      active: true,
      source,
      sources: mergeSources(current.sources, [source]),
      updatedAt: this.timestamp(),
    };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

interface MutableMemoryState extends Omit<
  MemoryRuntimeState,
  'records' | 'history' | 'observations' | 'conflicts' | 'tombstones' | 'settings' | 'files'
> {
  records: StoredRecord[];
  history: Record<string, StoredRecord[]>;
  observations: MemoryStoredObservation[];
  conflicts: MemoryConflict[];
  tombstones: MemoryTombstone[];
  settings: MemorySettings;
  files: Record<string, { hash: string; observedAt: string }>;
  evidence: Record<string, string[]>;
}

function mutableState(raw: MemoryRuntimeState): MutableMemoryState {
  return {
    version: 1,
    records: raw.records.map((entry) => ({
      ...entry,
      identity: memoryIdentity(entry),
    })),
    history: Object.fromEntries(
      Object.entries(raw.history).map(([id, entries]) => [
        id,
        entries.map((entry) => ({
          ...entry,
          identity: memoryIdentity(entry),
        })),
      ]),
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
    evidence: (raw as MemoryRuntimeState & { evidence?: Record<string, string[]> }).evidence ?? {},
  };
}

function cloneRecord(record: MemoryRecord): MemoryRecord {
  return {
    ...record,
    tags: [...record.tags],
    pathPatterns: [...record.pathPatterns],
    taskTypes: [...record.taskTypes],
    operations: [...record.operations],
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
      : record.active
        ? ('active' as const)
        : ('inactive' as const);
  return {
    id: record.id,
    scope: record.scope,
    ...(record.projectKey === undefined ? {} : { projectKey: record.projectKey }),
    ...(record.title === undefined ? {} : { title: record.title }),
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    category: record.category,
    text: record.text,
    tags: [...record.tags],
    pathPatterns: [...record.pathPatterns],
    taskTypes: [...record.taskTypes],
    operations: [...record.operations],
    ...(record.language === undefined ? {} : { language: record.language }),
    kind: record.kind,
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
  return {
    id: createHash('sha256')
      .update(`${identity}\n${normalizeText(input.text)}\n${randomUUID()}`)
      .digest('hex')
      .slice(0, 24),
    identity,
    scope: input.scope,
    ...(input.projectKey === undefined ? {} : { projectKey: input.projectKey }),
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(input.reason === undefined ? {} : { reason: input.reason.trim() }),
    category: input.category.trim(),
    text: input.text.trim(),
    tags: normalizeArray(input.tags),
    pathPatterns: normalizeArray(input.pathPatterns),
    taskTypes: normalizeArray(input.taskTypes),
    operations: normalizeArray(input.operations),
    ...(input.language === undefined ? {} : { language: input.language }),
    kind,
    active: kind === 'explicit',
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
    (entry) => entry.identity === identity && entry.kind === 'inferred' && !entry.active,
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
    'scope' | 'projectKey' | 'category' | 'tags' | 'pathPatterns' | 'taskTypes' | 'operations'
  >,
): string {
  return JSON.stringify([
    input.scope,
    input.scope === 'project' ? (input.projectKey ?? '') : '',
    normalizeText(input.category),
    normalizeArray(input.tags),
    normalizeArray(input.pathPatterns),
    normalizeArray(input.taskTypes),
    normalizeArray(input.operations),
  ]);
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
    ...(observation.language === undefined ? {} : { language: observation.language }),
    ...(observation.title === undefined ? {} : { title: observation.title }),
    ...(observation.reason === undefined ? {} : { reason: observation.reason }),
    category: observation.category,
    text: observation.text,
    tags: observation.tags,
    pathPatterns: observation.pathPatterns,
    taskTypes: observation.taskTypes,
    operations: observation.operations,
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
    if (!record.active) continue;
    const stillPresent = bullets.some(
      (bullet) => normalizeText(bullet.text) === normalizeText(record.text),
    );
    if (!stillPresent) {
      pushHistory(state, record);
      state.records = replaceRecord(state.records, {
        ...record,
        active: false,
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
      (record) => record.active && normalizeText(record.text) === normalized,
    ) as StoredRecord | undefined;
    if (matched !== undefined) {
      if (normalizeText(matched.category) !== normalizeText(bullet.category)) {
        pushHistory(state, matched);
        const input: MemoryInput = {
          scope,
          ...(projectKey ? { projectKey } : {}),
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
      category: bullet.category,
      text: bullet.text,
    };
    const identity = memoryIdentity(input);
    clearTombstone(state, identity);
    state.records.push(createRecord(input, 'explicit', { kind: 'user' }, timestamp, identity));
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
  if (record.scope === 'project') score += 50;
  if (query.task !== undefined && matchesAny(record.taskTypes, query.task)) score += 25;
  if (query.path !== undefined && matchesAny(record.pathPatterns, query.path)) score += 25;
  if (query.operation !== undefined && matchesAny(record.operations, query.operation)) score += 25;
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
      (entry.textHash === undefined || entry.textHash === textHash || entry.textHash === rawHash),
  );
}

function normalizedMemoryTextHash(text: string): string {
  return hashMemoryText(normalizeText(text).replace(/\s+/gu, ''));
}

function validateInput(input: MemoryInput): void {
  if (input.scope === 'project' && input.projectKey === undefined)
    throw new Error('Project memory requires a project key');
  if (input.scope === 'project' && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.projectKey ?? ''))
    throw new Error('Project key is invalid');
  if (input.category.trim().length === 0 || input.text.trim().length === 0)
    throw new Error('Memory category and text are required');
  for (const [field, value] of [
    ['title', input.title],
    ['reason', input.reason],
  ] as const) {
    if (value === undefined) continue;
    if (value.trim().length === 0) throw new Error(`Memory ${field} must not be empty`);
    validateSafeMemoryText(value);
    if (input.language !== undefined) validateMemoryLanguageText(value, input.language, field);
  }
}

function validateObservation(observation: MemoryObservation): void {
  validateInput(observation);
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
