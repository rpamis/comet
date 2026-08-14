import type { PluginContext, PluginDescriptor, PluginModule } from '../comet-plugin/index.js';
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
    dashboard: {
      id: 'project-rules',
      label: '项目规则',
      route: '/plugins/project-rules',
    },
    provideContext: async (request) => {
      const selected = await service.select({ task: request.task, path: request.path });
      if (selected.length === 0) return null;
      return {
        text: selected.map((section) => `## ${section.title}\n${section.text}`).join('\n\n'),
        rules: selected.map(({ score: _score, ...section }) => section),
      };
    },
    invoke: async (capability, input) => invokeCapability(service, capability, input),
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
