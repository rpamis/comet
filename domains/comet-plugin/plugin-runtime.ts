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
  PluginState,
  PluginStateFile,
  PluginStateStore,
  PluginStatus,
  PluginView,
} from './types.js';

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
  readonly descriptors: readonly PluginDescriptor[];
  readonly now?: () => Date;
}

interface ActivePlugin {
  readonly descriptor: PluginDescriptor;
  readonly module: PluginModule;
  readonly scope: PluginScope;
}

export class PluginRuntime {
  private readonly cometVersion: string;
  private readonly store: PluginStateStore;
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

  public async enable(id: string): Promise<void> {
    const descriptor = this.requireDescriptor(id);
    this.assertCompatible(descriptor);
    await this.setRecord(descriptor, 'enabled', false);
  }

  public async disable(id: string): Promise<void> {
    const descriptor = this.requireDescriptor(id);
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
  }

  public async dispatch(event: PluginEvent): Promise<void> {
    const eventCopy = freezeEvent(event);
    await this.loadScope(event.scope);
    for (const active of this.active.values()) {
      if (active.scope !== event.scope || active.module.onEvent === undefined) continue;
      try {
        await active.module.onEvent(eventCopy);
      } catch (error) {
        this.recordExecutionFailure(active.descriptor.id, 'event', error);
      }
    }
  }

  public async collectContext(
    request: PluginContextRequest,
    scope: PluginScope,
  ): Promise<PluginContextContribution[]> {
    await this.loadScope(scope);
    const contributions: PluginContextContribution[] = [];
    for (const active of this.active.values()) {
      if (active.scope !== scope || active.module.provideContext === undefined) continue;
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

  public async dashboardPages(scope: PluginScope): Promise<PluginDashboardPage[]> {
    await this.loadScope(scope);
    const pages: PluginDashboardPage[] = [];
    for (const active of this.active.values()) {
      if (active.scope !== scope || active.module.dashboard === undefined) continue;
      try {
        pages.push({ pluginId: active.descriptor.id, ...active.module.dashboard });
      } catch (error) {
        this.recordExecutionFailure(active.descriptor.id, 'dashboard', error);
      }
    }
    return pages;
  }

  public diagnostics(): PluginDiagnostic[] {
    return this.diagnosticEntries.map((diagnostic) => ({ ...diagnostic }));
  }

  private async loadScope(scope: PluginScope): Promise<void> {
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
      if (!descriptor.scopes.includes(scope)) continue;
      const key = `${record.id}:${scope}`;
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
          scope,
          reportDiagnostic: (diagnostic) =>
            this.diagnosticEntries.push({ pluginId: descriptor.id, ...diagnostic }),
        });
        this.active.set(key, { descriptor, module, scope });
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
    const next = this.record(descriptor.id, descriptor.version, status, explicitRemoval);
    const found = state.plugins.some((record) => record.id === descriptor.id);
    await this.persist({
      plugins: found
        ? state.plugins.map((record) => (record.id === descriptor.id ? next : record))
        : [...state.plugins, next],
    });
  }

  private record(id: string, version: string, status: PluginStatus, explicitRemoval = false) {
    return { id, version, status, explicitRemoval, updatedAt: this.timestamp() };
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

  private async disposeActive(id: string): Promise<void> {
    const entries = [...this.active.entries()].filter(([key]) => key.startsWith(`${id}:`));
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
  return { plugins: state.plugins.map((record) => ({ ...record })) };
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
        updatedAt: record.updatedAt,
      };
    }),
  };
}

function freezeEvent(event: PluginEvent): PluginEvent {
  const payload = cloneAndFreeze(event.payload) as Readonly<Record<string, unknown>>;
  return Object.freeze({ name: event.name, scope: event.scope, payload });
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
