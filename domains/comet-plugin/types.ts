export type PluginKind = 'first-party' | 'third-party';
export type PluginScope = 'user' | 'project';
export type PluginStatus = 'enabled' | 'disabled' | 'uninstalled';
export type PluginActionSource = 'user' | 'system';

export interface PluginEvent {
  readonly name: string;
  readonly scope: PluginScope;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PluginContextRequest {
  readonly task: string;
  readonly path?: string;
}

export interface PluginContextContribution {
  readonly text: string;
  readonly [key: string]: unknown;
}

export interface PluginDashboardContribution {
  readonly id: string;
  readonly label: string;
  readonly route: string;
}

export interface PluginDashboardPage extends PluginDashboardContribution {
  readonly pluginId: string;
}

export interface PluginDiagnostic {
  readonly pluginId: string;
  readonly code: 'missing' | 'incompatible' | 'execution-failed';
  readonly phase: 'load' | 'event' | 'context' | 'dashboard';
  readonly message: string;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly cometVersion: string;
  readonly scope: PluginScope;
  readonly reportDiagnostic: (diagnostic: Omit<PluginDiagnostic, 'pluginId'>) => void;
}

export interface PluginModule {
  readonly onEvent?: (event: PluginEvent) => void | Promise<void>;
  readonly provideContext?: (
    request: PluginContextRequest,
  ) => PluginContextContribution | null | Promise<PluginContextContribution | null>;
  readonly dashboard?: PluginDashboardContribution;
  readonly dispose?: () => void | Promise<void>;
}

export interface PluginDescriptor {
  readonly id: string;
  readonly kind: PluginKind;
  readonly version: string;
  readonly scopes: readonly PluginScope[];
  readonly compatible: (cometVersion: string) => boolean;
  readonly create: (context: PluginContext) => PluginModule | Promise<PluginModule>;
}

export interface PluginRecord {
  readonly id: string;
  readonly version: string;
  readonly status: PluginStatus;
  readonly explicitRemoval: boolean;
  readonly updatedAt: string;
}

export interface PluginState {
  readonly plugins: readonly PluginRecord[];
}

export interface PluginStateStore {
  read(): Promise<PluginState>;
  write(state: PluginState): Promise<void>;
}

export interface PluginStateFile {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}

export interface PluginView extends PluginRecord {
  readonly kind: PluginKind | null;
  readonly scopes: readonly PluginScope[];
}
