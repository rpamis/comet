import os from 'node:os';
import path from 'node:path';

import {
  createPersonalMemoryPluginDescriptor,
  FileMemoryRepository,
  GitMemorySync,
  PersonalMemoryService,
  type MemoryInput,
  type MemoryQuery,
  type MemoryRecord,
  type MemoryRetrieval,
} from '../comet-memory/index.js';
import { createProjectRulesPluginDescriptor } from '../project-rules/index.js';
import type { ProjectRulesStatus, ProjectRulesSelectionRequest } from '../project-rules/index.js';
import { getCurrentVersion } from '../../platform/version/version.js';
import { JsonFilePluginStorageStore, JsonFileTextStore } from '../../platform/fs/plugin-store.js';
import { JsonPluginStateStore, PluginRuntime } from './plugin-runtime.js';
import type { PluginContextContribution, PluginEvent, PluginScopeContext } from './types.js';

export interface CometLifecycleObservation {
  readonly name:
    | 'change.completed'
    | 'task.completed'
    | 'review.completed'
    | 'verification.completed';
  readonly workflow: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly category: string;
  readonly text: string;
  readonly candidateKey?: string;
  readonly projectKey?: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly ruleText?: string;
}

export interface CometPluginBridgeOptions {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly memoryRoot?: string;
  readonly stateRoot?: string;
  readonly cometVersion?: string;
}

export interface CometPluginContextRequest {
  readonly task: string;
  readonly path?: string;
}

export class CometPluginBridge {
  public constructor(
    private readonly runtime: PluginRuntime,
    private readonly projectId: string,
  ) {}

  public get pluginRuntime(): PluginRuntime {
    return this.runtime;
  }

  public get currentProjectId(): string {
    return this.projectId;
  }

  public async collectContext(
    request: CometPluginContextRequest,
  ): Promise<PluginContextContribution[]> {
    const target: PluginScopeContext = { scope: 'project', projectId: this.projectId };
    const [global, project] = await Promise.all([
      this.runtime.collectContext({ ...request, projectId: this.projectId }, 'user'),
      this.runtime.collectContext({ ...request, projectId: this.projectId }, target),
    ]);
    const merged = new Map<string, PluginContextContribution>();
    for (const contribution of [...global, ...project]) {
      const previous = merged.get(String(contribution.pluginId));
      if (previous === undefined) {
        merged.set(String(contribution.pluginId), contribution);
        continue;
      }
      merged.set(String(contribution.pluginId), {
        ...previous,
        text: [previous.text, contribution.text].filter(Boolean).join('\n\n'),
        ...(Array.isArray(previous.records) || Array.isArray(contribution.records)
          ? { records: [...arrayValue(previous.records), ...arrayValue(contribution.records)] }
          : {}),
        ...(Array.isArray(previous.rules) || Array.isArray(contribution.rules)
          ? { rules: [...arrayValue(previous.rules), ...arrayValue(contribution.rules)] }
          : {}),
      });
    }
    return [...merged.values()];
  }

  public async dispatchLifecycle(observation: CometLifecycleObservation): Promise<void> {
    const payload = {
      ...observation,
      projectKey: observation.projectKey ?? this.projectId,
      ...(observation.candidateKey ? { candidateKey: observation.candidateKey } : {}),
    };
    const source = {
      kind: 'workflow' as const,
      name: observation.workflow,
      change: observation.changeId,
      projectId: this.projectId,
    };
    const base: Omit<PluginEvent, 'scope' | 'projectId'> = {
      name: observation.name,
      source,
      payload,
    };
    await this.runtime.dispatch({ ...base, scope: 'user' });
    await this.runtime.dispatch({ ...base, scope: 'project', projectId: this.projectId });
    try {
      await this.syncMemory();
    } catch {
      // A remote or Git installation failure is a diagnostic, not a workflow failure.
    }
  }

  public async remember(input: MemoryInput): Promise<MemoryRecord | null> {
    const normalized =
      input.scope === 'project' && input.projectKey === undefined
        ? { ...input, projectKey: this.projectId }
        : input;
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'remember',
      normalized,
      'user',
    )) as MemoryRecord | null;
  }

  public async observe(input: CometLifecycleObservation): Promise<unknown> {
    await this.dispatchLifecycle(input);
    return this.runtime.invoke('comet.personal-memory', 'status', {}, 'user');
  }

  public async status(): Promise<unknown> {
    return this.runtime.invoke('comet.personal-memory', 'status', {}, 'user');
  }

  public async retrieve(query: Omit<MemoryQuery, 'projectKey'>): Promise<MemoryRetrieval> {
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'retrieve',
      { ...query, projectKey: this.projectId },
      'user',
    )) as MemoryRetrieval;
  }

  public async addRule(text: string, targetPath?: string): Promise<unknown> {
    return this.runtime.invoke(
      'comet.project-rules',
      'add',
      { text, ...(targetPath ? { targetPath } : {}) },
      { scope: 'project', projectId: this.projectId },
    );
  }

  public async projectRulesStatus(): Promise<ProjectRulesStatus> {
    return (await this.runtime.invoke(
      'comet.project-rules',
      'status',
      {},
      { scope: 'project', projectId: this.projectId },
    )) as ProjectRulesStatus;
  }

  public async projectRulesAction(capability: string, input: unknown = {}): Promise<unknown> {
    return this.runtime.invoke('comet.project-rules', capability, input, {
      scope: 'project',
      projectId: this.projectId,
    });
  }

  public async selectRules(
    request: Omit<ProjectRulesSelectionRequest, 'maxSections' | 'maxBytes'>,
  ): Promise<unknown> {
    return this.runtime.invoke('comet.project-rules', 'select', request, {
      scope: 'project',
      projectId: this.projectId,
    });
  }

  public async syncMemory(): Promise<unknown> {
    return this.runtime.invoke('comet.personal-memory', 'sync', {}, 'user');
  }

  public async memoryRemote(): Promise<unknown> {
    return this.runtime.invoke('comet.personal-memory', 'remote', {}, 'user');
  }

  public async configureMemoryRemote(url: string): Promise<unknown> {
    return this.runtime.invoke('comet.personal-memory', 'configure-remote', { url }, 'user');
  }

  public async pauseProjectLearning(
    paused: boolean,
    projectKey = this.projectId,
  ): Promise<unknown> {
    return this.runtime.invoke(
      'comet.personal-memory',
      'pause-project-learning',
      { projectKey, paused },
      'user',
    );
  }

  public async pauseProjectRetrieval(
    paused: boolean,
    projectKey = this.projectId,
  ): Promise<unknown> {
    return this.runtime.invoke(
      'comet.personal-memory',
      'pause-project-retrieval',
      { projectKey, paused },
      'user',
    );
  }

  public async diagnostics(): Promise<ReturnType<PluginRuntime['diagnostics']>> {
    return this.runtime.diagnostics();
  }
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export async function createDefaultCometPluginBridge(
  options: CometPluginBridgeOptions,
): Promise<CometPluginBridge> {
  const memoryRoot = path.resolve(
    options.memoryRoot ?? path.join(os.homedir(), '.comet', 'memory'),
  );
  const stateRoot = path.resolve(options.stateRoot ?? path.join(os.homedir(), '.comet', 'plugins'));
  const projectRoot = path.resolve(options.projectRoot);
  const runtime = new PluginRuntime({
    cometVersion: options.cometVersion ?? getCurrentVersion(),
    store: new JsonPluginStateStore(new JsonFileTextStore(path.join(stateRoot, 'state.json'))),
    storage: new JsonFilePluginStorageStore(path.join(stateRoot, 'storage')),
    descriptors: [
      createPersonalMemoryPluginDescriptor({
        createService: () =>
          new PersonalMemoryService({
            repository: new FileMemoryRepository(memoryRoot, {
              git: new GitMemorySync(memoryRoot),
            }),
          }),
      }),
      createProjectRulesPluginDescriptor({ projectRoot, projectId: options.projectId }),
    ],
  });
  await runtime.reconcileFirstParty();
  return new CometPluginBridge(runtime, options.projectId);
}
