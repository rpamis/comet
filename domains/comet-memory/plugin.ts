import type {
  PluginContext,
  PluginDescriptor,
  PluginEvent,
  PluginModule,
} from '../comet-plugin/index.js';
import type {
  MemoryInput,
  MemoryObservation,
  PersonalMemoryPluginOptions,
  PersonalMemoryServiceLike,
} from './types.js';

export const PERSONAL_MEMORY_PLUGIN_ID = 'comet.personal-memory';

export function createPersonalMemoryPluginDescriptor(
  options: PersonalMemoryPluginOptions,
): PluginDescriptor {
  return {
    id: PERSONAL_MEMORY_PLUGIN_ID,
    kind: 'first-party',
    version: options.version ?? '1.0.0',
    scopes: ['user', 'project'],
    compatible: options.cometVersionRange ?? (() => true),
    create: async (context) => createModule(context, options),
  };
}

async function createModule(
  context: PluginContext,
  options: PersonalMemoryPluginOptions,
): Promise<PluginModule> {
  const service = options.createService(context);
  return {
    events: ['change.completed', 'task.completed', 'memory.observe'],
    onEvent: async (event) => {
      const observation = observationFromEvent(event);
      if (observation !== null) await service.observe(observation);
    },
    provideContext: async (request) => {
      const retrieval = await service.retrieve({
        projectKey: request.projectId ?? context.projectId,
        task: request.task,
        path: request.path,
      });
      if (retrieval.disabled || retrieval.records.length === 0) return null;
      return { text: retrieval.text, records: retrieval.records };
    },
    invoke: async (capability, input) => invokeCapability(service, capability, input),
  };
}

async function invokeCapability(
  service: PersonalMemoryServiceLike,
  capability: string,
  input: unknown,
): Promise<unknown> {
  switch (capability) {
    case 'remember':
      return service.remember(asRecord<MemoryInput>(input, 'remember'));
    case 'correct': {
      const value = asObject(input, 'correct');
      return service.correct(asString(value.id, 'correct.id'), value.correction as never);
    }
    case 'remove': {
      const value = asObject(input, 'remove');
      return service.remove(asString(value.id, 'remove.id'), {
        permanent: value.permanent === true,
      });
    }
    case 'rollback': {
      const value = asObject(input, 'rollback');
      return service.rollback(asString(value.id, 'rollback.id'));
    }
    case 'observe':
      return service.observe(asRecord<MemoryObservation>(input, 'observe'));
    case 'retrieve':
      return service.retrieve(asRecord(input, 'retrieve') as never);
    case 'status':
      return service.status();
    case 'sync':
      return service.sync();
    default:
      throw new Error(`Unknown personal memory capability: ${capability}`);
  }
}

function observationFromEvent(event: PluginEvent): MemoryObservation | null {
  const payload = event.payload;
  if (typeof payload.text !== 'string' || typeof payload.category !== 'string') return null;
  const workflow =
    typeof payload.workflow === 'string' ? payload.workflow : event.source.name || 'unknown';
  const changeId =
    typeof payload.changeId === 'string'
      ? payload.changeId
      : (event.source.change ?? `${event.name}:${event.source.name}`);
  if (changeId.trim().length === 0) return null;
  return {
    scope: event.scope === 'project' ? 'project' : 'global',
    projectKey:
      event.projectId ??
      event.source.projectId ??
      (typeof payload.projectKey === 'string' ? payload.projectKey : undefined),
    category: payload.category,
    text: payload.text,
    tags: strings(payload.tags),
    pathPatterns: strings(payload.pathPatterns),
    taskTypes: strings(payload.taskTypes),
    operations: strings(payload.operations),
    workflow,
    changeId,
    success: payload.success !== false,
    source: {
      kind: 'workflow',
      label: event.name,
      workflow,
      changeId,
      projectKey:
        event.projectId ??
        event.source.projectId ??
        (typeof payload.projectKey === 'string' ? payload.projectKey : undefined),
    },
  };
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} input must be an object`);
  return value as Record<string, unknown>;
}

function asRecord<T>(value: unknown, name: string): T {
  return asObject(value, name) as T;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string`);
  return value;
}
