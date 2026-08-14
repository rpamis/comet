import type {
  PluginContextContribution,
  PluginContextRequest,
  PluginDashboardPage,
  PluginDescriptor,
  PluginDiagnostic,
  PluginEvent,
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
      Object.entries(options.config ?? {}).map(([id, value]) => [id, { ...value }]),
    );
    this.descriptors = descriptors;
    this.now = options.now ?? (() => new Date());
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
    if (target?.scope === 'project' && target.projectId !== undefined) {
      await this.setProjectPause(descriptor, target.projectId, false);
      return;
    }
    await this.setRecord(descriptor, 'enabled', false);
  }

  public async disable(id: string, target?: PluginScopeContext): Promise<void> {
    const descriptor = this.requireDescriptor(id);
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
    return Object.freeze({ ...(this.config[id] ?? {}) });
  }

  public async configure(id: string, config: Readonly<Record<string, unknown>>): Promise<void> {
    this.requireDescriptor(id);
    this.config[id] = { ...config };
    await this.disposeActive(id);
  }

  public async invoke(
    id: string,
    capability: string,
    input: unknown,
    scope: PluginScopeTarget = 'user',
  ): Promise<unknown> {
    const descriptor = this.requireDescriptor(id);
    const target = normalizeScopeTarget(scope);
    await this.loadScope(target);
    const active = this.active.get(this.activeKey(id, target));
    if (active === undefined || active.module.invoke === undefined) {
      throw new PluginRuntimeError(
        `Plugin capability is unavailable: ${id}/${capability}`,
        'missing',
      );
    }
    try {
      return await active.module.invoke(capability, cloneValue(input));
    } catch (error) {
      this.recordExecutionFailure(descriptor.id, 'invoke', error);
      return null;
    }
  }

  public async dispatch(event: PluginEvent): Promise<void> {
    const eventCopy = freezeEvent(event);
    const target = { scope: event.scope, projectId: event.projectId };
    await this.loadScope(target);
    for (const active of this.active.values()) {
      if (
        active.scope !== event.scope ||
        active.projectId !== event.projectId ||
        active.module.onEvent === undefined ||
        (active.module.events !== undefined && !active.module.events.includes(event.name))
      )
        continue;
      try {
        await active.module.onEvent(eventCopy);
      } catch (error) {
        this.recordExecutionFailure(active.descriptor.id, 'event', error);
      }
    }
  }

  public async collectContext(
    request: PluginContextRequest,
    scope: PluginScopeTarget,
  ): Promise<PluginContextContribution[]> {
    const target = normalizeScopeTarget(scope);
    await this.loadScope(target);
    const contributions: PluginContextContribution[] = [];
    for (const active of this.active.values()) {
      if (
        active.scope !== target.scope ||
        active.projectId !== target.projectId ||
        active.module.provideContext === undefined
      )
        continue;
      try {
        const contribution = await active.module.provideContext({ ...request });
        if (contribution !== null)
          contributions.push({ pluginId: active.descriptor.id, ...contribution });
      } catch (error) {
        this.recordExecutionFailure(active.descriptor.id, 'context', error);
      }
    }
    return contributions;
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
          config: this.config[descriptor.id] ?? {},
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
    const current = existing ?? this.record(descriptor.id, descriptor.version, 'enabled');
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

function freezeEvent(event: PluginEvent): PluginEvent {
  const payload = cloneAndFreeze(event.payload) as Readonly<Record<string, unknown>>;
  const source = cloneAndFreeze(event.source) as PluginEvent['source'];
  return Object.freeze({
    name: event.name,
    scope: event.scope,
    projectId: event.projectId,
    source,
    payload,
  });
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
