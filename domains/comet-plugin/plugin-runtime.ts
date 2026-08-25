import {
  AgentExperienceJournal,
  AgentLearningCoordinator,
  MemoryAgentExperienceJournalStore,
  validateAgentContextCandidate,
  validateAgentExperienceEvent,
  type AgentContextCandidate,
  type AgentExperienceEvent,
} from '../agent-learning/index.js';
import type {
  PluginContextRequest,
  PluginDashboardPage,
  PluginDescriptor,
  PluginDiagnostic,
  PluginModule,
  PluginActionSource,
  PluginScope,
  PluginScopeContext,
  PluginState,
  PluginStateFile,
  PluginStateStore,
  PluginStorage,
  PluginStorageStore,
  PluginStatus,
  PluginView,
} from './types.js';

type PluginScopeTarget = PluginScope | PluginScopeContext;

function normalizeScopeTarget(target: PluginScopeTarget): PluginScopeContext {
  return typeof target === 'string' ? { scope: target } : target;
}

function storageKey(pluginId: string, scope: PluginScope, projectId?: string): string {
  return `${pluginId}:${scope}:${projectId ?? ''}`;
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryPluginStorageStore implements PluginStorageStore {
  private readonly values = new Map<string, unknown>();

  public async open(
    pluginId: string,
    scope: PluginScope,
    projectId?: string,
  ): Promise<PluginStorage> {
    const key = storageKey(pluginId, scope, projectId);
    return {
      read: async () => (this.values.has(key) ? cloneValue(this.values.get(key)) : null),
      write: async (value) => {
        this.values.set(key, cloneValue(value));
      },
    };
  }
}

export class MemoryPluginStateStore implements PluginStateStore {
  private state: PluginState;

  public constructor(initial: PluginState = { plugins: [] }) {
    this.state = cloneState(initial);
  }

  public async read(): Promise<PluginState> {
    return cloneState(this.state);
  }

  public async write(state: PluginState): Promise<void> {
    this.state = cloneState(state);
  }
}

export class JsonPluginStateStore implements PluginStateStore {
  private readonly file: PluginStateFile;

  public constructor(file: PluginStateFile) {
    this.file = file;
  }

  public async read(): Promise<PluginState> {
    const content = await this.file.read();
    if (content === null || content.trim().length === 0) return { plugins: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (error) {
      throw new Error(`Plugin state is invalid JSON: ${(error as Error).message}`, {
        cause: error,
      });
    }
    return validateState(parsed);
  }

  public async write(state: PluginState): Promise<void> {
    await this.file.write(`${JSON.stringify(cloneState(state), null, 2)}\n`);
  }
}

export interface PluginRuntimeOptions {
  readonly cometVersion: string;
  readonly store: PluginStateStore;
  readonly storage?: PluginStorageStore;
  readonly config?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly descriptors: readonly PluginDescriptor[];
  readonly journal?: AgentExperienceJournal;
  /** Scope-specific journals keep user learning recoverable across projects. */
  readonly journals?: {
    readonly user: AgentExperienceJournal;
    readonly project: AgentExperienceJournal;
  };
  readonly scheduleLearning?: (task: () => Promise<void>) => void | Promise<void>;
  readonly now?: () => Date;
}

interface ActivePlugin {
  readonly descriptor: PluginDescriptor;
  readonly module: PluginModule;
  readonly scope: PluginScope;
  readonly projectId?: string;
}

export class PluginRuntime {
  private readonly cometVersion: string;
  private readonly store: PluginStateStore;
  private readonly storage: PluginStorageStore;
  private readonly config: Record<string, Record<string, unknown>>;
  private readonly descriptors: ReadonlyMap<string, PluginDescriptor>;
  private readonly now: () => Date;
  private readonly learningByScope: Readonly<Record<'user' | 'project', AgentLearningCoordinator>>;
  private readonly learningCoordinators: readonly AgentLearningCoordinator[];
  private readonly active = new Map<string, ActivePlugin>();
  private readonly diagnosticEntries: PluginDiagnostic[] = [];
  private state: PluginState | null = null;

  public constructor(options: PluginRuntimeOptions) {
    const descriptors = new Map<string, PluginDescriptor>();
    for (const descriptor of options.descriptors) {
      if (descriptors.has(descriptor.id)) {
        throw new Error(`Duplicate plugin descriptor: ${descriptor.id}`);
      }
      descriptors.set(descriptor.id, descriptor);
    }
    this.cometVersion = options.cometVersion;
    this.store = options.store;
    this.storage = options.storage ?? new MemoryPluginStorageStore();
    this.config = Object.fromEntries(
      Object.entries(options.config ?? {}).map(([id, value]) => [id, cloneValue(value)]),
    );
    this.descriptors = descriptors;
    this.now = options.now ?? (() => new Date());
    const fallbackJournal =
      options.journal ?? new AgentExperienceJournal(new MemoryAgentExperienceJournalStore());
    const userJournal = options.journals?.user ?? fallbackJournal;
    const projectJournal = options.journals?.project ?? fallbackJournal;
    const coordinatorFor = (journal: AgentExperienceJournal) =>
      new AgentLearningCoordinator({
        journal,
        learners: (event) => this.learningAdapters(event),
        // Capture is durable before scheduling. Hosts may provide a scheduler, while
        // short-lived CLI processes return immediately and replay unfinished work later.
        schedule: options.scheduleLearning ?? ((task) => void task()),
        onDiagnostic: (message) => {
          const pluginId = message.split(' reflection', 1)[0] || 'comet.agent-learning';
          this.recordExecutionFailure(pluginId, 'event', new Error(message));
        },
      });
    const userLearning = coordinatorFor(userJournal);
    const projectLearning =
      userJournal === projectJournal ? userLearning : coordinatorFor(projectJournal);
    this.learningByScope = { user: userLearning, project: projectLearning };
    this.learningCoordinators =
      userLearning === projectLearning ? [userLearning] : [userLearning, projectLearning];
  }

  public async reconcileFirstParty(): Promise<void> {
    const state = await this.ensureState();
    const records = new Map(state.plugins.map((record) => [record.id, record]));
    let changed = false;
    for (const descriptor of this.descriptors.values()) {
      if (descriptor.kind !== 'first-party') continue;
      const existing = records.get(descriptor.id);
      if (existing === undefined) {
        records.set(descriptor.id, this.record(descriptor.id, descriptor.version, 'enabled'));
        changed = true;
        continue;
      }
      if (existing.version !== descriptor.version) {
        records.set(descriptor.id, {
          ...existing,
          version: descriptor.version,
          updatedAt: this.timestamp(),
        });
        changed = true;
      }
      if (existing.status === 'uninstalled' && !existing.explicitRemoval) {
        records.set(descriptor.id, { ...existing, status: 'enabled', updatedAt: this.timestamp() });
        changed = true;
      }
    }
    if (changed) await this.persist({ plugins: [...records.values()] });
  }

  public async list(scope?: PluginScope): Promise<PluginView[]> {
    const state = await this.ensureState();
    const ids = new Set([...this.descriptors.keys(), ...state.plugins.map((record) => record.id)]);
    return [...ids]
      .map((id) =>
        this.view(
          id,
          state.plugins.find((record) => record.id === id),
          scope,
        ),
      )
      .filter((view): view is PluginView => view !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public async get(id: string): Promise<PluginView | null> {
    const state = await this.ensureState();
    return this.view(
      id,
      state.plugins.find((record) => record.id === id),
    );
  }

  public async install(id: string, source: PluginActionSource = 'user'): Promise<void> {
    const descriptor = this.requireDescriptor(id);
    this.assertUserInitiatedThirdParty(descriptor, source);
    this.assertCompatible(descriptor);
    await this.setRecord(descriptor, 'enabled', false);
  }

  public async enable(id: string, target?: PluginScopeContext): Promise<void> {
    const descriptor = this.requireDescriptor(id);
    this.assertCompatible(descriptor);
    await this.requireInstalled(descriptor);
    if (target?.scope === 'project' && target.projectId !== undefined) {
      await this.setProjectPause(descriptor, target.projectId, false);
      return;
    }
    await this.setRecord(descriptor, 'enabled', false);
  }

  public async disable(id: string, target?: PluginScopeContext): Promise<void> {
    const descriptor = this.requireDescriptor(id);
    await this.requireInstalled(descriptor);
    if (target?.scope === 'project' && target.projectId !== undefined) {
      await this.setProjectPause(descriptor, target.projectId, true);
      await this.disposeActive(id, target.projectId);
      return;
    }
    await this.setRecord(descriptor, 'disabled', false);
    await this.disposeActive(id);
  }

  public async uninstall(id: string): Promise<void> {
    const descriptor = this.requireDescriptor(id);
    await this.setRecord(descriptor, 'uninstalled', true);
    await this.disposeActive(id);
  }

  public async update(id: string, source: PluginActionSource = 'user'): Promise<void> {
    const descriptor = this.requireDescriptor(id);
    this.assertUserInitiatedThirdParty(descriptor, source);
    this.assertCompatible(descriptor);
    const state = await this.ensureState();
    const existing = state.plugins.find((record) => record.id === id);
    if (existing === undefined || existing.status === 'uninstalled') {
      throw new PluginRuntimeError(`Plugin is not installed: ${id}`, 'missing');
    }
    await this.persist({
      plugins: state.plugins.map((record) =>
        record.id === id
          ? { ...record, version: descriptor.version, updatedAt: this.timestamp() }
          : record,
      ),
    });
    await this.disposeActive(id);
  }

  public getConfig(id: string): Readonly<Record<string, unknown>> {
    this.requireDescriptor(id);
    return cloneAndFreeze(this.config[id] ?? {}) as Readonly<Record<string, unknown>>;
  }

  public async configure(id: string, config: Readonly<Record<string, unknown>>): Promise<void> {
    this.requireDescriptor(id);
    this.config[id] = cloneValue(config);
    await this.disposeActive(id);
  }

  public async invoke(
    id: string,
    capability: string,
    input: unknown,
    scope: PluginScopeTarget = 'user',
    options: { readonly throwOnError?: boolean } = {},
  ): Promise<unknown> {
    const descriptor = this.requireDescriptor(id);
    const target = normalizeScopeTarget(scope);
    await this.loadScope(target);
    const active = this.active.get(this.activeKey(id, target));
    if (active === undefined || active.module.invoke === undefined) {
      this.diagnosticEntries.push({
        pluginId: descriptor.id,
        code: 'missing',
        phase: 'invoke',
        message: `Plugin capability is unavailable: ${id}/${capability}`,
      });
      throw new PluginRuntimeError(
        `Plugin capability is unavailable: ${id}/${capability}`,
        'missing',
      );
    }
    try {
      return await active.module.invoke(capability, cloneValue(input));
    } catch (error) {
      this.recordExecutionFailure(descriptor.id, 'invoke', error);
      if (options.throwOnError === true) throw error;
      return null;
    }
  }

  public async dispatch(value: AgentExperienceEvent): Promise<void> {
    let event: AgentExperienceEvent;
    try {
      event = validateAgentExperienceEvent(value);
    } catch (error) {
      const source = experienceSourceName(value);
      const message = error instanceof Error ? error.message : String(error);
      this.diagnosticEntries.push({
        pluginId: 'comet.agent-learning',
        code: 'execution-failed',
        phase: 'event',
        source,
        message: `Invalid Agent Experience Event from ${source}: ${message}`,
      });
      throw error;
    }
    await this.replayPendingLearning();
    await this.learningByScope[event.scope].capture(event);
  }

  private async learningAdapters(event: AgentExperienceEvent) {
    const target = { scope: event.scope, projectId: event.projectId };
    await this.loadScope(target);
    return [...this.active.values()]
      .filter(
        (active) =>
          active.scope === event.scope &&
          active.projectId === event.projectId &&
          (active.module.reflect !== undefined || active.module.onEvent !== undefined) &&
          (active.module.events === undefined || active.module.events.includes(event.type)),
      )
      .map((active) => ({
        owner: active.descriptor.id,
        supports: () => true,
        reflect: async (request: import('../agent-learning/index.js').AgentReflectionRequest) => {
          if (active.module.reflect !== undefined) {
            return active.module.reflect(request);
          }
          // Generic subscribers receive every event in the merged episode once.
          // Learning plugins use onReflection so evidence remains chunked.
          if (request.evidenceOffset === 0) {
            for (const current of request.events) {
              await active.module.onEvent?.(freezeEvent(current));
            }
          }
          return [];
        },
        consolidate: async (
          request: import('../agent-learning/index.js').AgentLearningConsolidationRequest,
        ) => {
          if (active.module.consolidate === undefined) {
            throw new Error(`Plugin ${active.descriptor.id} cannot consolidate Learning Deltas`);
          }
          await active.module.consolidate(request);
        },
      }));
  }

  public async collectContext(
    request: PluginContextRequest,
    scope: PluginScopeTarget,
  ): Promise<AgentContextCandidate[]> {
    await this.replayPendingLearning();
    const target = normalizeScopeTarget(scope);
    await this.loadScope(target);
    const candidates: AgentContextCandidate[] = [];
    for (const active of this.active.values()) {
      if (
        active.scope !== target.scope ||
        active.projectId !== target.projectId ||
        active.module.provideContext === undefined
      )
        continue;
      try {
        const contribution = await active.module.provideContext({ ...request });
        if (contribution === null) continue;
        for (const value of Array.isArray(contribution) ? contribution : [contribution]) {
          candidates.push(
            validateAgentContextCandidate({
              ...value,
              owner: active.descriptor.id,
            }),
          );
        }
      } catch (error) {
        this.recordExecutionFailure(active.descriptor.id, 'context', error);
      }
    }
    return candidates;
  }

  private async replayPendingLearning(): Promise<void> {
    for (const coordinator of this.learningCoordinators) await coordinator.replayPending();
  }

  public async resolveContext(
    id: string,
    request: PluginContextRequest,
    scope: PluginScopeTarget,
    owner?: string,
  ): Promise<AgentContextCandidate[]> {
    const target = normalizeScopeTarget(scope);
    await this.loadScope(target);
    const candidates: AgentContextCandidate[] = [];
    for (const active of this.active.values()) {
      if (
        active.scope !== target.scope ||
        active.projectId !== target.projectId ||
        (owner !== undefined && active.descriptor.id !== owner) ||
        active.module.resolveContext === undefined
      )
        continue;
      try {
        const value = await active.module.resolveContext(id, { ...request });
        if (value === null) continue;
        candidates.push(validateAgentContextCandidate({ ...value, owner: active.descriptor.id }));
      } catch (error) {
        this.recordExecutionFailure(active.descriptor.id, 'context', error);
      }
    }
    return candidates;
  }

  public async dashboardPages(scope: PluginScopeTarget): Promise<PluginDashboardPage[]> {
    const target = normalizeScopeTarget(scope);
    await this.loadScope(target);
    const pages: PluginDashboardPage[] = [];
    for (const active of this.active.values()) {
      if (active.scope !== target.scope || active.projectId !== target.projectId) continue;
      try {
        const dashboard = active.module.dashboard;
        if (dashboard === undefined) continue;
        pages.push({ pluginId: active.descriptor.id, ...dashboard });
      } catch (error) {
        this.recordExecutionFailure(active.descriptor.id, 'dashboard', error);
      }
    }
    return pages;
  }

  public diagnostics(): PluginDiagnostic[] {
    return this.diagnosticEntries.map((diagnostic) => ({ ...diagnostic }));
  }

  private async loadScope(target: PluginScopeContext): Promise<void> {
    const state = await this.ensureState();
    for (const record of state.plugins) {
      if (record.status !== 'enabled') continue;
      const descriptor = this.descriptors.get(record.id);
      if (descriptor === undefined) {
        this.diagnosticEntries.push({
          pluginId: record.id,
          code: 'missing',
          phase: 'load',
          message: `Plugin ${record.id} is no longer available`,
        });
        continue;
      }
      if (!descriptor.scopes.includes(target.scope)) continue;
      if (target.projectId !== undefined && record.disabledProjects.includes(target.projectId))
        continue;
      const key = this.activeKey(record.id, target);
      if (this.active.has(key)) continue;
      if (!this.isCompatible(descriptor)) {
        this.diagnosticEntries.push({
          pluginId: descriptor.id,
          code: 'incompatible',
          phase: 'load',
          message: `Plugin ${descriptor.id} is incompatible with Comet ${this.cometVersion}`,
        });
        continue;
      }
      try {
        const module = await descriptor.create({
          pluginId: descriptor.id,
          cometVersion: this.cometVersion,
          scope: target.scope,
          projectId: target.projectId,
          config: cloneAndFreeze(this.config[descriptor.id] ?? {}) as Readonly<
            Record<string, unknown>
          >,
          storage: await this.storage.open(descriptor.id, target.scope, target.projectId),
          reportDiagnostic: (diagnostic) =>
            this.diagnosticEntries.push({ pluginId: descriptor.id, ...diagnostic }),
        });
        this.active.set(key, {
          descriptor,
          module,
          scope: target.scope,
          projectId: target.projectId,
        });
      } catch (error) {
        this.recordExecutionFailure(descriptor.id, 'load', error);
      }
    }
  }

  private async setRecord(
    descriptor: PluginDescriptor,
    status: PluginStatus,
    explicitRemoval: boolean,
  ): Promise<void> {
    const state = await this.ensureState();
    const existing = state.plugins.find((record) => record.id === descriptor.id);
    const next = this.record(
      descriptor.id,
      descriptor.version,
      status,
      explicitRemoval,
      existing?.disabledProjects,
    );
    const found = existing !== undefined;
    await this.persist({
      plugins: found
        ? state.plugins.map((record) => (record.id === descriptor.id ? next : record))
        : [...state.plugins, next],
    });
  }

  private async setProjectPause(
    descriptor: PluginDescriptor,
    projectId: string,
    paused: boolean,
  ): Promise<void> {
    const state = await this.ensureState();
    const existing = state.plugins.find((record) => record.id === descriptor.id);
    if (existing === undefined || existing.status === 'uninstalled') {
      throw new PluginRuntimeError(`Plugin is not installed: ${descriptor.id}`, 'missing');
    }
    const current = existing;
    const disabledProjects = new Set(current.disabledProjects);
    if (paused) disabledProjects.add(projectId);
    else disabledProjects.delete(projectId);
    const next = {
      ...current,
      version: descriptor.version,
      disabledProjects: [...disabledProjects].sort(),
      updatedAt: this.timestamp(),
    };
    await this.persist({
      plugins: existing
        ? state.plugins.map((record) => (record.id === descriptor.id ? next : record))
        : [...state.plugins, next],
    });
  }

  private record(
    id: string,
    version: string,
    status: PluginStatus,
    explicitRemoval = false,
    disabledProjects: readonly string[] = [],
  ) {
    return {
      id,
      version,
      status,
      explicitRemoval,
      disabledProjects: [...disabledProjects],
      updatedAt: this.timestamp(),
    };
  }

  private view(
    id: string,
    record?: PluginState['plugins'][number],
    scope?: PluginScope,
  ): PluginView | null {
    const descriptor = this.descriptors.get(id);
    if (descriptor === undefined && record === undefined) return null;
    if (scope !== undefined && descriptor !== undefined && !descriptor.scopes.includes(scope))
      return null;
    const effective =
      record ?? this.record(id, descriptor?.version ?? 'unknown', 'uninstalled', false);
    return {
      ...effective,
      kind: descriptor?.kind ?? null,
      scopes: descriptor?.scopes ?? [],
    };
  }

  private requireDescriptor(id: string): PluginDescriptor {
    const descriptor = this.descriptors.get(id);
    if (descriptor === undefined) throw new PluginRuntimeError(`Unknown plugin: ${id}`, 'missing');
    return descriptor;
  }

  private async requireInstalled(
    descriptor: PluginDescriptor,
  ): Promise<PluginState['plugins'][number]> {
    const state = await this.ensureState();
    const record = state.plugins.find((entry) => entry.id === descriptor.id);
    if (record === undefined || record.status === 'uninstalled') {
      throw new PluginRuntimeError(`Plugin is not installed: ${descriptor.id}`, 'missing');
    }
    return record;
  }

  private assertCompatible(descriptor: PluginDescriptor): void {
    if (!this.isCompatible(descriptor)) {
      this.diagnosticEntries.push({
        pluginId: descriptor.id,
        code: 'incompatible',
        phase: 'load',
        message: `Plugin ${descriptor.id} is incompatible with Comet ${this.cometVersion}`,
      });
      throw new PluginRuntimeError(`Plugin is incompatible: ${descriptor.id}`, 'incompatible');
    }
  }

  private assertUserInitiatedThirdParty(
    descriptor: PluginDescriptor,
    source: PluginActionSource,
  ): void {
    if (descriptor.kind === 'third-party' && source !== 'user') {
      throw new PluginRuntimeError(
        `Installing or updating third-party plugin ${descriptor.id} requires a user action`,
        'user-action-required',
      );
    }
  }

  private isCompatible(descriptor: PluginDescriptor): boolean {
    try {
      return descriptor.compatible(this.cometVersion);
    } catch {
      return false;
    }
  }

  private activeKey(id: string, target: PluginScopeContext): string {
    return `${id}:${target.scope}:${target.projectId ?? ''}`;
  }

  private async disposeActive(id: string, projectId?: string): Promise<void> {
    const entries = [...this.active.entries()].filter(
      ([key, active]) =>
        key.startsWith(`${id}:`) && (projectId === undefined || active.projectId === projectId),
    );
    for (const [key, active] of entries) {
      this.active.delete(key);
      try {
        await active.module.dispose?.();
      } catch (error) {
        this.recordExecutionFailure(id, 'load', error);
      }
    }
  }

  private recordExecutionFailure(
    pluginId: string,
    phase: PluginDiagnostic['phase'],
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.diagnosticEntries.push({ pluginId, code: 'execution-failed', phase, message });
  }

  private async ensureState(): Promise<PluginState> {
    if (this.state === null) this.state = cloneState(await this.store.read());
    return this.state;
  }

  private async persist(state: PluginState): Promise<void> {
    this.state = cloneState(state);
    await this.store.write(this.state);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export class PluginRuntimeError extends Error {
  public constructor(
    message: string,
    public readonly code: 'missing' | 'incompatible' | 'user-action-required',
  ) {
    super(message);
    this.name = 'PluginRuntimeError';
  }
}

function experienceSourceName(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const source = (value as { readonly source?: unknown }).source;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return 'unknown';
  const name = (source as { readonly name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 128) : 'unknown';
}

function cloneState(state: PluginState): PluginState {
  return {
    plugins: state.plugins.map((record) => ({
      ...record,
      disabledProjects: [...(record.disabledProjects ?? [])],
    })),
  };
}

function validateState(value: unknown): PluginState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Plugin state must be an object');
  }
  const plugins = (value as { plugins?: unknown }).plugins;
  if (!Array.isArray(plugins)) throw new Error('Plugin state plugins must be an array');
  return {
    plugins: plugins.map((entry, index) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Plugin state entry ${index} must be an object`);
      }
      const record = entry as Record<string, unknown>;
      if (
        typeof record.id !== 'string' ||
        typeof record.version !== 'string' ||
        (record.status !== 'enabled' &&
          record.status !== 'disabled' &&
          record.status !== 'uninstalled') ||
        typeof record.explicitRemoval !== 'boolean' ||
        typeof record.updatedAt !== 'string'
      ) {
        throw new Error(`Plugin state entry ${index} is invalid`);
      }
      return {
        id: record.id,
        version: record.version,
        status: record.status,
        explicitRemoval: record.explicitRemoval,
        disabledProjects: Array.isArray(record.disabledProjects)
          ? record.disabledProjects.filter(
              (projectId): projectId is string => typeof projectId === 'string',
            )
          : [],
        updatedAt: record.updatedAt,
      };
    }),
  };
}

function freezeEvent(event: AgentExperienceEvent): AgentExperienceEvent {
  return cloneAndFreeze(event) as AgentExperienceEvent;
}

function cloneAndFreeze(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => cloneAndFreeze(item)));
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = cloneAndFreeze(item);
    return Object.freeze(copy);
  }
  return value;
}
