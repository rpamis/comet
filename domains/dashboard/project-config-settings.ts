import path from 'path';

import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import {
  defaultWorkflowProjectConfig,
  mergeWorkflowProjectConfigDocument,
  parseWorkflowProjectConfigDocument,
  renderStructuredProjectConfig,
} from '../workflow-contract/project-config.js';
import {
  readWorkflowProjectConfigIdentity,
  readWorkflowProjectConfigSnapshot,
  workflowProjectConfigIdentityEquals,
  WORKFLOW_PROJECT_CONFIG_PATH,
} from '../workflow-contract/project-config-reader.js';
import type {
  CometProjectWorkflow,
  ProjectConfigLanguage,
  WorkflowClassicProjectConfig,
  WorkflowKnowledgeProjectConfig,
  WorkflowNativeProjectConfig,
  WorkflowProjectConfig,
} from '../workflow-contract/types.js';

export class DashboardProjectConfigError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DashboardProjectConfigError';
  }
}

export interface DashboardNativeConfigSettings {
  artifactRoot: string;
  language: ProjectConfigLanguage;
  clarificationMode: 'sequential' | 'batch';
  archiveConfirmation: 'automatic' | 'required';
  maxVerifyFailures: number;
}

export interface DashboardClassicConfigSettings {
  artifactLayout: 'legacy' | 'docs';
  language: ProjectConfigLanguage;
  contextCompression: 'off' | 'beta';
  reviewMode: 'off' | 'standard' | 'thorough';
  autoTransition: boolean;
}

export interface DashboardKnowledgeConfigSettings {
  provider: 'local' | 'remote';
  localInclude: string[];
}

export interface DashboardProjectConfigSettings {
  path: typeof WORKFLOW_PROJECT_CONFIG_PATH;
  revision: string;
  schema: 'comet.project.v1';
  defaultWorkflow: CometProjectWorkflow;
  workflows: CometProjectWorkflow[];
  ambientResume: boolean;
  hookAllowPaths: string[];
  knowledge: DashboardKnowledgeConfigSettings;
  native: DashboardNativeConfigSettings;
  classic: DashboardClassicConfigSettings;
}

interface DashboardProjectConfigUpdate {
  expectedRevision: string;
  config: Omit<DashboardProjectConfigSettings, 'path' | 'revision' | 'schema' | 'knowledge'> & {
    knowledge?: DashboardKnowledgeConfigSettings;
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DashboardProjectConfigError(`${label} must be an object`, 400);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DashboardProjectConfigError(`${label} must be a non-empty string`, 400);
  }
  return value.trim();
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new DashboardProjectConfigError(`${label} must be true or false`, 400);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new DashboardProjectConfigError(`${label} has an unsupported value`, 400);
  }
  return value as T;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new DashboardProjectConfigError(`${label} must be a positive integer`, 400);
  }
  return value;
}

function workflowList(value: unknown): CometProjectWorkflow[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DashboardProjectConfigError('workflows must contain native and/or classic', 400);
  }
  const workflows = value.map((item) =>
    enumValue(item, ['native', 'classic'] as const, 'workflows'),
  );
  return [...new Set(workflows)];
}

function relativePathList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new DashboardProjectConfigError('hookAllowPaths must be a string array', 400);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function knowledgeIncludeList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new DashboardProjectConfigError('knowledge.local.include must be a string array', 400);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function dashboardKnowledgeSettings(
  config: WorkflowProjectConfig,
): DashboardKnowledgeConfigSettings {
  return {
    provider: config.knowledge?.provider ?? 'local',
    localInclude: [...(config.knowledge?.local?.include ?? [])],
  };
}

function parseUpdate(value: unknown): DashboardProjectConfigUpdate {
  const body = record(value, 'Dashboard project config update');
  const config = record(body.config, 'config');
  const native = record(config.native, 'config.native');
  const classic = record(config.classic, 'config.classic');
  const knowledgeValue =
    config.knowledge === undefined ? undefined : record(config.knowledge, 'config.knowledge');
  const workflows = workflowList(config.workflows);
  const defaultWorkflow = enumValue(
    config.defaultWorkflow,
    ['native', 'classic'] as const,
    'defaultWorkflow',
  );
  if (!workflows.includes(defaultWorkflow)) {
    throw new DashboardProjectConfigError('workflows must include defaultWorkflow', 400);
  }
  return {
    expectedRevision: requiredString(body.expectedRevision, 'expectedRevision'),
    config: {
      defaultWorkflow,
      workflows,
      ambientResume: requiredBoolean(config.ambientResume, 'ambientResume'),
      hookAllowPaths: relativePathList(config.hookAllowPaths),
      ...(knowledgeValue === undefined
        ? {}
        : {
            knowledge: {
              provider: enumValue(
                knowledgeValue.provider,
                ['local', 'remote'] as const,
                'knowledge.provider',
              ),
              localInclude: knowledgeIncludeList((knowledgeValue.localInclude ?? []) as unknown),
            },
          }),
      native: {
        artifactRoot: requiredString(native.artifactRoot, 'native.artifactRoot'),
        language: enumValue(native.language, ['en', 'zh-CN'] as const, 'native.language'),
        clarificationMode: enumValue(
          native.clarificationMode,
          ['sequential', 'batch'] as const,
          'native.clarificationMode',
        ),
        archiveConfirmation: enumValue(
          native.archiveConfirmation,
          ['automatic', 'required'] as const,
          'native.archiveConfirmation',
        ),
        maxVerifyFailures: positiveInteger(native.maxVerifyFailures, 'native.maxVerifyFailures'),
      },
      classic: {
        artifactLayout: enumValue(
          classic.artifactLayout,
          ['legacy', 'docs'] as const,
          'classic.artifactLayout',
        ),
        language: enumValue(classic.language, ['en', 'zh-CN'] as const, 'classic.language'),
        contextCompression: enumValue(
          classic.contextCompression,
          ['off', 'beta'] as const,
          'classic.contextCompression',
        ),
        reviewMode: enumValue(
          classic.reviewMode,
          ['off', 'standard', 'thorough'] as const,
          'classic.reviewMode',
        ),
        autoTransition: requiredBoolean(classic.autoTransition, 'classic.autoTransition'),
      },
    },
  };
}

function nativeSettings(config: WorkflowProjectConfig): DashboardNativeConfigSettings {
  const fallbackLanguage = config.classic?.language ?? 'en';
  const native = config.native ?? defaultWorkflowProjectConfig('docs', fallbackLanguage).native;
  return {
    artifactRoot: native.artifact_root,
    language: native.language,
    clarificationMode: native.clarification_mode,
    archiveConfirmation: native.archive_confirmation,
    maxVerifyFailures: native.max_verify_failures,
  };
}

function classicSettings(config: WorkflowProjectConfig): DashboardClassicConfigSettings {
  return {
    artifactLayout: config.classic?.artifact_layout ?? 'docs',
    language: config.classic?.language ?? config.native?.language ?? 'en',
    contextCompression: config.classic?.context_compression ?? 'off',
    reviewMode: config.classic?.review_mode ?? 'standard',
    autoTransition: config.classic?.auto_transition ?? false,
  };
}

function toDashboardSettings(
  config: WorkflowProjectConfig,
  revision: string,
): DashboardProjectConfigSettings {
  return {
    path: WORKFLOW_PROJECT_CONFIG_PATH,
    revision,
    schema: config.schema,
    defaultWorkflow: config.default_workflow,
    workflows: [...(config.workflows ?? [config.default_workflow])],
    ambientResume: config.ambient_resume,
    hookAllowPaths: [...(config.hook?.allow_paths ?? [])],
    knowledge: dashboardKnowledgeSettings(config),
    native: nativeSettings(config),
    classic: classicSettings(config),
  };
}

export async function collectDashboardProjectConfigSettings(
  projectRoot: string,
): Promise<DashboardProjectConfigSettings> {
  try {
    const snapshot = await readWorkflowProjectConfigSnapshot(projectRoot);
    if (!snapshot.document?.config || !snapshot.identity.sha256) {
      throw new DashboardProjectConfigError('Current project has no .comet/config.yaml', 404);
    }
    return toDashboardSettings(snapshot.document.config, snapshot.identity.sha256);
  } catch (error) {
    if (error instanceof DashboardProjectConfigError) throw error;
    throw new DashboardProjectConfigError(
      `Cannot read .comet/config.yaml: ${(error as Error).message}`,
      422,
    );
  }
}

function nextNativeConfig(
  current: WorkflowNativeProjectConfig | undefined,
  input: DashboardNativeConfigSettings,
): WorkflowNativeProjectConfig {
  const fallback = current ?? defaultWorkflowProjectConfig('docs', input.language).native;
  return {
    ...fallback,
    artifact_root: input.artifactRoot,
    language: input.language,
    clarification_mode: input.clarificationMode,
    archive_confirmation: input.archiveConfirmation,
    max_verify_failures: input.maxVerifyFailures,
  };
}

function nextClassicConfig(
  current: WorkflowClassicProjectConfig | undefined,
  input: DashboardClassicConfigSettings,
): WorkflowClassicProjectConfig {
  return {
    ...current,
    artifact_layout: input.artifactLayout,
    language: input.language,
    context_compression: input.contextCompression,
    review_mode: input.reviewMode,
    auto_transition: input.autoTransition,
  };
}

function nextKnowledgeConfig(
  current: WorkflowKnowledgeProjectConfig | undefined,
  input: DashboardKnowledgeConfigSettings | undefined,
): WorkflowKnowledgeProjectConfig {
  const existing = current ?? { provider: 'local' as const };
  if (input === undefined) return existing;
  const withoutLocal = { ...existing };
  delete withoutLocal.local;
  return {
    ...withoutLocal,
    provider: input.provider,
    ...(input.localInclude.length > 0
      ? { local: { ...(existing.local ?? {}), include: [...input.localInclude] } }
      : {}),
  };
}

export async function updateDashboardProjectConfigSettings(
  projectRoot: string,
  value: unknown,
): Promise<DashboardProjectConfigSettings> {
  const update = parseUpdate(value);
  let snapshot;
  try {
    snapshot = await readWorkflowProjectConfigSnapshot(projectRoot);
  } catch (error) {
    throw new DashboardProjectConfigError(
      `Cannot read .comet/config.yaml: ${(error as Error).message}`,
      422,
    );
  }
  const document = snapshot.document;
  const current = document?.config;
  if (!current || !snapshot.identity.sha256) {
    throw new DashboardProjectConfigError('Current project has no .comet/config.yaml', 404);
  }
  if (snapshot.identity.sha256 !== update.expectedRevision) {
    throw new DashboardProjectConfigError(
      '.comet/config.yaml changed after the settings page was opened; reload and try again',
      409,
    );
  }

  const next: WorkflowProjectConfig = {
    ...current,
    default_workflow: update.config.defaultWorkflow,
    workflows: update.config.workflows,
    ambient_resume: update.config.ambientResume,
    hook: { allow_paths: update.config.hookAllowPaths },
    knowledge: nextKnowledgeConfig(current.knowledge, update.config.knowledge),
    native: nextNativeConfig(current.native, update.config.native),
    classic: nextClassicConfig(current.classic, update.config.classic),
  };

  let output: string;
  try {
    const merged = mergeWorkflowProjectConfigDocument(document.value, next);
    const language =
      next.native?.language === 'zh-CN' || next.classic?.language === 'zh-CN' ? 'zh-CN' : 'en';
    output = renderStructuredProjectConfig(merged, language);
    parseWorkflowProjectConfigDocument(output);
  } catch (error) {
    throw new DashboardProjectConfigError((error as Error).message, 400);
  }

  const configPath = path.join(projectRoot, WORKFLOW_PROJECT_CONFIG_PATH);
  await atomicWriteContainedText(configPath, output, {
    containedRoot: projectRoot,
    beforeCommit: async () => {
      const latest = await readWorkflowProjectConfigIdentity(projectRoot);
      if (!workflowProjectConfigIdentityEquals(latest, snapshot.identity)) {
        throw new DashboardProjectConfigError(
          '.comet/config.yaml changed while settings were being saved; reload and try again',
          409,
        );
      }
    },
  });
  return collectDashboardProjectConfigSettings(projectRoot);
}
