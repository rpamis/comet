import { createHash, randomUUID } from 'node:crypto';

import type {
  MemoryConflict,
  MemoryCorrection,
  MemoryInput,
  MemoryObservation,
  MemoryObservationResult,
  MemoryQuery,
  MemoryRecord,
  MemoryRepository,
  MemoryRetrieval,
  MemoryRuntimeState,
  MemorySettings,
  MemorySource,
  MemoryStoredObservation,
  PersonalMemoryOptions,
  PersonalMemoryServiceLike,
  PersonalMemoryStatus,
} from './types.js';
import { hashMemoryText, memoryFilePath } from './repository.js';

const DEFAULT_MAX_ENTRIES = 12;
const DEFAULT_MAX_BYTES = 8 * 1024;
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

  public constructor(options: PersonalMemoryOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
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
        await this.persist(state);
        return cloneRecord(refreshed);
      }

      const record = createRecord(input, 'explicit', source, this.timestamp(), identity);
      clearInferredCandidates(state, identity);
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
      if (current === undefined || !current.active) throw new Error(`Memory is not active: ${id}`);
      pushHistory(state, current);
      clearInferredCandidates(state, current.identity);
      const next = this.updateRecordValue(
        current,
        { ...current, ...correction, source: { kind: 'user' } },
        'explicit',
      );
      state.records = replaceRecord(state.records, next);
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
        pushHistory(state, current);
        const path = memoryFilePath(current.scope, current.projectKey);
        const content = await this.repository.readText(path);
        if (content !== null) {
          const nextContent = removeMarkdownBullet(content, current.text, current.category);
          if (nextContent !== content) await this.repository.writeText(path, nextContent);
          state.files[path] = fileState(nextContent, this.timestamp());
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
    return this.repository.withLock(async () => {
      const state = await this.loadAndReconcile(observation.scope, observation.projectKey);
      const key = observationKey(observation);
      const previous = state.observations.find((entry) => entry.key === key);
      if (previous !== undefined) {
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
        scope: observation.scope,
        projectKey: observation.projectKey,
        identity: memoryIdentity(observation),
        text: observation.text,
        normalizedText: normalizeText(observation.text),
        success: observation.success,
        source,
        observedAt: this.timestamp(),
      };
      state.observations = [...state.observations, stored];
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
      const candidate = state.records.find(
        (entry) =>
          !entry.active &&
          entry.kind === 'inferred' &&
          entry.identity === identity &&
          normalizeText(entry.text) === normalized,
      ) as StoredRecord | undefined;
      const record =
        candidate ??
        (createRecord(
          { ...observation, source },
          'inferred',
          source,
          this.timestamp(),
          identity,
        ) as StoredRecord);
      state.records = candidate ? state.records : [...state.records, record];
      const evidence = new Set(state.evidence[record.id] ?? []);
      evidence.add(key);
      state.evidence[record.id] = [...evidence];
      const conflicting = state.records.some(
        (entry) =>
          entry.id !== record.id &&
          !entry.active &&
          entry.identity === identity &&
          normalizeText(entry.text) !== normalized &&
          (state.evidence[entry.id]?.length ?? 0) > 0,
      );
      if (conflicting) {
        state.conflicts = addConflict(state.conflicts, identity, state.records, this.timestamp());
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: false,
          candidate: true,
          activated: false,
          record: null,
        };
      }
      if (evidence.size < 2) {
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: false,
          candidate: true,
          activated: false,
          record: null,
        };
      }

      const active = state.records.find((entry) => entry.active && entry.identity === identity) as
        | StoredRecord
        | undefined;
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
      if (active !== undefined && active.id !== record.id) {
        pushHistory(state, active);
        const next = this.updateRecordValue(
          active,
          {
            scope: record.scope,
            projectKey: record.projectKey,
            category: record.category,
            text: record.text,
            source: record.source,
            tags: record.tags,
            pathPatterns: record.pathPatterns,
            taskTypes: record.taskTypes,
            operations: record.operations,
          },
          'inferred',
        );
        state.records = replaceRecord(state.records, next);
        state.records = state.records.filter((entry) => entry.id !== record.id);
        delete state.evidence[record.id];
        await this.writeRecordMarkdown(state, next, active.text, active.category);
        await this.persist(state);
        return {
          deduplicated: false,
          ignored: false,
          candidate: true,
          activated: true,
          record: cloneRecord(next),
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

  public async status(): Promise<PersonalMemoryStatus> {
    return this.repository.withLock(async () => {
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
        sync: null,
      };
    });
  }

  public async sync() {
    return this.repository.sync();
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
    const targets =
      scope === undefined
        ? [
            { scope: 'global' as const },
            ...(projectKey ? [{ scope: 'project' as const, projectKey }] : []),
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
    const existing = await this.repository.readText(file);
    const next = previousText
      ? replaceMarkdownBullet(
          existing ?? '',
          previousText,
          record.text,
          record.category,
          previousCategory,
          record.scope,
        )
      : appendMarkdownBullet(existing ?? '', record.category, record.text, record.scope);
    if (next !== existing) await this.repository.writeText(file, next);
    state.files[file] = fileState(next, this.timestamp());
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
      category: input.category ?? current.category,
      text: input.text ?? current.text,
      tags: input.tags ?? current.tags,
      pathPatterns: input.pathPatterns ?? current.pathPatterns,
      taskTypes: input.taskTypes ?? current.taskTypes,
      operations: input.operations ?? current.operations,
      source,
    };
    return {
      ...current,
      identity: memoryIdentity(nextInput),
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
  'records' | 'history' | 'observations' | 'conflicts' | 'settings' | 'files'
> {
  records: StoredRecord[];
  history: Record<string, StoredRecord[]>;
  observations: MemoryStoredObservation[];
  conflicts: MemoryConflict[];
  settings: MemorySettings;
  files: Record<string, { hash: string; observedAt: string }>;
  evidence: Record<string, string[]>;
}

function mutableState(raw: MemoryRuntimeState): MutableMemoryState {
  return {
    version: 1,
    records: raw.records.map((entry) => ({
      ...entry,
      identity: (entry as StoredRecord).identity ?? memoryIdentity(entry),
    })),
    history: Object.fromEntries(
      Object.entries(raw.history).map(([id, entries]) => [
        id,
        entries.map((entry) => ({
          ...entry,
          identity: (entry as StoredRecord).identity ?? memoryIdentity(entry),
        })),
      ]),
    ),
    observations: [...raw.observations],
    conflicts: [...raw.conflicts],
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
    category: input.category.trim(),
    text: input.text.trim(),
    tags: normalizeArray(input.tags),
    pathPatterns: normalizeArray(input.pathPatterns),
    taskTypes: normalizeArray(input.taskTypes),
    operations: normalizeArray(input.operations),
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
    input.projectKey ?? '',
    normalizeText(input.category),
    normalizeArray(input.tags),
    normalizeArray(input.pathPatterns),
    normalizeArray(input.taskTypes),
    normalizeArray(input.operations),
  ]);
}

function observationKey(observation: MemoryObservation): string {
  return JSON.stringify([
    observation.projectKey ?? '',
    observation.workflow.trim().toLocaleLowerCase(),
    observation.changeId.trim(),
  ]);
}

function fileState(content: string, timestamp: string): { hash: string; observedAt: string } {
  return { hash: hashMemoryText(content), observedAt: timestamp };
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
    }
  }
  const seen = new Set<string>();
  for (const bullet of bullets) {
    const normalized = normalizeText(bullet.text);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
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
      }
      continue;
    }
    const input: MemoryInput = {
      scope,
      ...(projectKey ? { projectKey } : {}),
      category: bullet.category,
      text: bullet.text,
    };
    state.records.push(
      createRecord(input, 'explicit', { kind: 'user' }, timestamp, memoryIdentity(input)),
    );
  }
  state.files[file] = { hash, observedAt: timestamp };
}

function appendMarkdownBullet(
  content: string,
  category: string,
  text: string,
  scope: 'global' | 'project',
): string {
  const heading = `## ${category.trim()}`;
  if (content.trim().length === 0) {
    return `${scope === 'global' ? '# 个人画像' : '# 项目记忆'}\n\n${heading}\n\n- ${text.trim()}\n`;
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
      );
    }
    const marker = /^\s*([-*+])\s+/u.exec(lines[index] ?? '')?.[1] ?? '-';
    lines[index] = `${marker} ${nextText.trim()}`;
    return `${lines.join('\n').replace(/\n*$/u, '')}\n`;
  }
  return appendMarkdownBullet(content, category, nextText, scope);
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
  const next = { identity, texts, updatedAt: timestamp };
  return [...conflicts.filter((conflict) => conflict.identity !== identity), next];
}

function validateInput(input: MemoryInput): void {
  if (input.scope === 'project' && input.projectKey === undefined)
    throw new Error('Project memory requires a project key');
  if (input.scope === 'project' && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.projectKey ?? ''))
    throw new Error('Project key is invalid');
  if (input.category.trim().length === 0 || input.text.trim().length === 0)
    throw new Error('Memory category and text are required');
}

function validateObservation(observation: MemoryObservation): void {
  validateInput(observation);
  if (observation.workflow.trim().length === 0 || observation.changeId.trim().length === 0)
    throw new Error('Observation workflow and change ID are required');
}
