import type {
  PluginDashboardPage,
  PluginRuntime,
  PluginScopeContext,
} from '../comet-plugin/index.js';
import { PluginRuntimeError } from '../comet-plugin/index.js';

export interface DashboardPluginPageRegistration {
  readonly pluginId: string;
  readonly label: string;
  readonly route: string;
  readonly load?: (context: DashboardPluginPageContext) => Promise<unknown>;
}

export interface DashboardPluginPageContext {
  readonly projectId: string;
  readonly invoke: (capability: string, input?: unknown) => Promise<unknown>;
}

export interface DashboardPluginPageSummary {
  readonly pluginId: string;
  readonly label: string;
  readonly route: string;
  readonly status: 'enabled' | 'disabled';
  readonly globallyDisabled: boolean;
  readonly projectPaused: boolean;
  readonly diagnostics: readonly string[];
}

export interface DashboardPluginPageSnapshot extends DashboardPluginPageSummary {
  readonly data: unknown | null;
}

export type DashboardPluginLifecycleAction = 'enable' | 'disable' | 'uninstall';

export interface DashboardPluginHostOptions {
  readonly runtime: PluginRuntime;
  readonly projectId: string;
  readonly pages?: readonly DashboardPluginPageRegistration[];
}

export type DashboardPluginHostFactory = (
  projectId: string,
  projectPath: string,
) => DashboardPluginHost | Promise<DashboardPluginHost>;

export class DashboardPluginHost {
  private readonly runtime: PluginRuntime;
  private readonly projectId: string;
  private readonly pages: readonly DashboardPluginPageRegistration[];

  public constructor(options: DashboardPluginHostOptions) {
    this.runtime = options.runtime;
    this.projectId = options.projectId;
    this.pages = options.pages ?? [];
  }

  public async list(): Promise<readonly DashboardPluginPageSummary[]> {
    const views = await this.runtime.list('project');
    const activePages = await this.runtime.dashboardPages(this.scope());
    const catalog = mergePages(this.pages, activePages);
    const diagnostics = this.runtime.diagnostics();
    return catalog
      .map((page) => {
        const view = views.find((entry) => entry.id === page.pluginId);
        if (view === undefined || view.status === 'uninstalled') return null;
        const globallyDisabled = view.status === 'disabled';
        const projectPaused = view.disabledProjects.includes(this.projectId);
        const disabled = globallyDisabled || projectPaused;
        return {
          pluginId: page.pluginId,
          label: page.label,
          route: page.route,
          status: disabled ? ('disabled' as const) : ('enabled' as const),
          globallyDisabled,
          projectPaused,
          diagnostics: diagnosticsFor(diagnostics, page.pluginId),
        };
      })
      .filter((page): page is DashboardPluginPageSummary => page !== null)
      .sort((left, right) => left.route.localeCompare(right.route));
  }

  public async get(pluginId: string): Promise<DashboardPluginPageSnapshot> {
    const page = await this.requirePage(pluginId);
    const summary = (await this.list()).find((entry) => entry.pluginId === pluginId);
    if (summary === undefined) throw new DashboardPluginHostError('插件页面不存在', 404);
    if (summary.status === 'disabled') return { ...summary, data: null };

    let data: unknown = null;
    try {
      if (page.load !== undefined) {
        data = await page.load({
          projectId: this.projectId,
          invoke: (capability, input) => this.invoke(pluginId, capability, input),
        });
      }
    } catch (error) {
      throw this.asHostError(pluginId, error);
    }
    return { ...summary, data };
  }

  public async invoke(pluginId: string, capability: string, input?: unknown): Promise<unknown> {
    await this.requirePage(pluginId);
    if (capability.trim().length === 0) {
      throw new DashboardPluginHostError('能力名称不能为空', 400, pluginId);
    }
    const summary = (await this.list()).find((entry) => entry.pluginId === pluginId);
    if (summary === undefined) throw new DashboardPluginHostError('插件页面不存在', 404, pluginId);
    if (summary.status === 'disabled') {
      throw new DashboardPluginHostError('插件已停用，请先重新启用', 409, pluginId);
    }
    try {
      const diagnosticsBefore = this.runtime.diagnostics().length;
      const result = await this.runtime.invoke(pluginId, capability, input, this.scope());
      const invokeFailure = this.runtime
        .diagnostics()
        .slice(diagnosticsBefore)
        .find(
          (diagnostic) =>
            diagnostic.pluginId === pluginId &&
            diagnostic.phase === 'invoke' &&
            diagnostic.code === 'execution-failed',
        );
      if (invokeFailure !== undefined) {
        throw new DashboardPluginHostError(invokeFailure.message, 400, pluginId);
      }
      return result;
    } catch (error) {
      throw this.asHostError(pluginId, error);
    }
  }

  public async lifecycle(pluginId: string, action: DashboardPluginLifecycleAction): Promise<void> {
    await this.requirePage(pluginId);
    try {
      if (action === 'enable') {
        const view = await this.runtime.get(pluginId);
        if (view?.status === 'disabled') {
          await this.runtime.enable(pluginId);
          await this.runtime.enable(pluginId, this.scope());
        } else {
          await this.runtime.enable(pluginId, this.scope());
        }
      } else if (action === 'disable') {
        await this.runtime.disable(pluginId, this.scope());
      } else if (action === 'uninstall') {
        await this.runtime.uninstall(pluginId);
      } else {
        throw new DashboardPluginHostError('不支持的插件生命周期操作', 400, pluginId);
      }
    } catch (error) {
      throw this.asHostError(pluginId, error);
    }
  }

  private async requirePage(pluginId: string): Promise<DashboardPluginPageRegistration> {
    const page = this.pages.find((entry) => entry.pluginId === pluginId);
    if (page !== undefined) return page;
    const activePage = (await this.runtime.dashboardPages(this.scope())).find(
      (entry) => entry.pluginId === pluginId,
    );
    if (activePage !== undefined) return activePage;
    throw new DashboardPluginHostError('插件页面不存在', 404, pluginId);
  }

  private scope(): PluginScopeContext {
    return { scope: 'project', projectId: this.projectId };
  }

  private asHostError(pluginId: string, error: unknown): DashboardPluginHostError {
    if (error instanceof DashboardPluginHostError) return error;
    if (error instanceof PluginRuntimeError) {
      const status = error.code === 'missing' ? 409 : 400;
      return new DashboardPluginHostError(error.message, status, pluginId);
    }
    return new DashboardPluginHostError(
      error instanceof Error ? error.message : String(error),
      500,
      pluginId,
    );
  }
}

export class DashboardPluginHostError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    public readonly pluginId?: string,
  ) {
    super(message);
    this.name = 'DashboardPluginHostError';
  }
}

function mergePages(
  registrations: readonly DashboardPluginPageRegistration[],
  activePages: readonly PluginDashboardPage[],
): DashboardPluginPageRegistration[] {
  const pages = new Map<string, DashboardPluginPageRegistration>();
  for (const page of registrations) pages.set(page.pluginId, page);
  for (const page of activePages) {
    if (!pages.has(page.pluginId)) {
      pages.set(page.pluginId, {
        pluginId: page.pluginId,
        label: page.label,
        route: page.route,
        ...(page.load ? { load: page.load } : {}),
      });
    }
  }
  return [...pages.values()];
}

function diagnosticsFor(
  diagnostics: ReturnType<PluginRuntime['diagnostics']>,
  pluginId: string,
): readonly string[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.pluginId === pluginId)
    .slice(-3)
    .map((diagnostic) => diagnostic.message);
}
