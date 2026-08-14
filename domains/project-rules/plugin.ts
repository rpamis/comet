import type {
  PluginContext,
  PluginDescriptor,
  PluginEvent,
  PluginModule,
} from '../comet-plugin/index.js';
import { ProjectRulesService } from './project-rules.js';
import type { ProjectRulesServiceOptions } from './types.js';

export const PROJECT_RULES_PLUGIN_ID = 'comet.project-rules';

export interface ProjectRulesPluginOptions {
  readonly projectRoot: string;
  readonly projectId?: string;
  readonly version?: string;
  readonly cometVersionRange?: (cometVersion: string) => boolean;
  readonly createService?: (context: PluginContext) => ProjectRulesService;
  readonly serviceOptions?: Omit<ProjectRulesServiceOptions, 'projectRoot' | 'projectId'>;
}

export function createProjectRulesPluginDescriptor(
  options: ProjectRulesPluginOptions,
): PluginDescriptor {
  return {
    id: PROJECT_RULES_PLUGIN_ID,
    kind: 'first-party',
    version: options.version ?? '1.0.0',
    scopes: ['project'],
    compatible: options.cometVersionRange ?? (() => true),
    create: async (context) => createModule(context, options),
  };
}

async function createModule(
  context: PluginContext,
  options: ProjectRulesPluginOptions,
): Promise<PluginModule> {
  const service =
    options.createService?.(context) ??
    new ProjectRulesService({
      projectRoot: options.projectRoot,
      projectId: options.projectId ?? context.projectId,
      ...options.serviceOptions,
    });
  return {
    events: ['change.completed', 'task.completed', 'review.completed', 'verification.completed'],
    dashboard: {
      id: 'project-rules',
      label: '项目规则',
      route: '/plugins/project-rules',
      load: async ({ invoke }) => {
        const status = (await invoke('status')) as Record<string, unknown>;
        return {
          ...status,
          operations: [
            'init',
            'scan',
            'add',
            'observe',
            'propose',
            'verify',
            'candidates',
            'adopt',
            'ignore',
            'snooze',
            'restore',
          ],
        };
      },
    },
    provideContext: async (request) => {
      const selected = await service.select({
        task: request.task,
        path: request.path,
        stage: request.phase,
      });
      if (selected.length === 0) return null;
      return {
        text: selected.map((section) => `## ${section.title}\n${section.text}`).join('\n\n'),
        rules: selected.map(({ score: _score, ...section }) => section),
      };
    },
    onEvent: async (event) => {
      const observation = observationFromEvent(event);
      if (observation !== null) await service.recordObservation(observation);
    },
    invoke: async (capability, input) => invokeCapability(service, capability, input),
  };
}

function observationFromEvent(
  event: PluginEvent,
): Parameters<ProjectRulesService['recordObservation']>[0] | null {
  const payload = event.payload;
  const text = payload.ruleText;
  const workflow = typeof payload.workflow === 'string' ? payload.workflow : event.source.name;
  const changeId = typeof payload.changeId === 'string' ? payload.changeId : event.source.change;
  const candidateKey = typeof payload.candidateKey === 'string' ? payload.candidateKey : undefined;
  if (
    typeof text !== 'string' ||
    typeof workflow !== 'string' ||
    typeof changeId !== 'string' ||
    candidateKey === undefined
  )
    return null;
  return {
    candidateKey,
    text,
    workflow,
    changeId,
    success: payload.success !== false,
    ...(typeof payload.source === 'string' ? { source: payload.source } : {}),
  };
}

async function invokeCapability(
  service: ProjectRulesService,
  capability: string,
  input: unknown,
): Promise<unknown> {
  switch (capability) {
    case 'status':
      return service.status();
    case 'init':
      return service.init();
    case 'scan':
      return service.scan();
    case 'details':
      return service.candidateDetails();
    case 'candidates':
      return service.candidateEnvelope();
    case 'select': {
      const value = asObject(input, 'select');
      return service.select({
        task: asString(value.task, 'select.task'),
        ...(typeof value.path === 'string' ? { path: value.path } : {}),
        ...(typeof value.stage === 'string' ? { stage: value.stage } : {}),
      });
    }
    case 'propose':
      return service.proposeCarrier();
    case 'observe': {
      const value = asObject(input, 'observe');
      return service.recordObservation({
        candidateKey: asString(value.candidateKey, 'observe.candidateKey'),
        text: asString(value.text, 'observe.text'),
        workflow: asString(value.workflow, 'observe.workflow'),
        changeId: asString(value.changeId, 'observe.changeId'),
        success: value.success !== false,
        ...(typeof value.source === 'string' ? { source: value.source } : {}),
      });
    }
    case 'verify': {
      const value = input === undefined ? {} : asObject(input, 'verify');
      return service.verify({
        ...(typeof value.maxAttempts === 'number' ? { maxAttempts: value.maxAttempts } : {}),
      });
    }
    case 'adopt':
      return service.adoptCandidate(
        await resolveCandidateId(service, input),
        readTargetPath(input),
      );
    case 'ignore':
      return service.ignoreCandidate(await resolveCandidateId(service, input));
    case 'snooze':
      return service.snoozeCandidate(await resolveCandidateId(service, input));
    case 'restore':
      return service.restoreCandidate(await resolveCandidateId(service, input));
    case 'add': {
      const value = asObject(input, 'add');
      return service.addRule(asString(value.text, 'add.text'), readTargetPath(value));
    }
    default:
      throw new Error(`Unknown project rules capability: ${capability}`);
  }
}

async function resolveCandidateId(service: ProjectRulesService, input: unknown): Promise<string> {
  const value = asObject(input, 'candidate');
  if (typeof value.id === 'string' && value.id.trim()) return value.id;
  const text = asString(value.text, 'candidate.text').trim();
  const matches = (await service.candidateDetails()).filter((candidate) => candidate.text === text);
  if (matches.length !== 1) throw new Error('Project rule candidate text is not unique');
  return matches[0].id;
}

function readTargetPath(input: unknown): string | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const targetPath = (input as Record<string, unknown>).targetPath;
  return typeof targetPath === 'string' && targetPath.trim() ? targetPath : undefined;
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} input must be an object`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string`);
  return value;
}
