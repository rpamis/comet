import { promises as fs } from 'fs';
import path from 'path';
import { parseDocument } from 'yaml';

import { renderStructuredProjectConfig } from '../workflow-contract/project-config.js';

import { atomicWriteText } from './native-atomic-file.js';
import { readNativeProtectedTextFile } from './native-protected-file.js';
import {
  discoverNativeProject,
  nativeProjectPaths,
  normalizeArtifactRootRef,
  PROJECT_CONFIG_FILE,
} from './native-paths.js';
import type {
  CometProjectConfig,
  NativePendingRootMove,
  NativeProjectPaths,
} from './native-types.js';

const NATIVE_KEYS = new Set([
  'artifact_root',
  'language',
  'clarification_mode',
  'pending_root_move',
]);
const PENDING_KEYS = new Set(['id', 'from_artifact_root', 'to_artifact_root', 'stage', 'cleanup']);
const NATIVE_PROJECT_CONFIG_MAX_BYTES = 64 * 1024;
const CLEANUP_KEYS = new Set(['kind', 'state', 'manifest_hash']);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, known: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
}

function parsePending(value: unknown): NativePendingRootMove | undefined {
  if (value === undefined) return undefined;
  const pending = record(value, 'native.pending_root_move');
  rejectUnknown(pending, PENDING_KEYS, 'native.pending_root_move');
  const id = pending.id;
  const from = pending.from_artifact_root;
  const to = pending.to_artifact_root;
  const stage = pending.stage;
  if (typeof id !== 'string' || !/^[a-f0-9-]{8,}$/u.test(id)) {
    throw new Error('native.pending_root_move.id is invalid');
  }
  if (typeof from !== 'string' || typeof to !== 'string') {
    throw new Error('native.pending_root_move roots must be strings');
  }
  if (stage !== 'copying' && stage !== 'ready' && stage !== 'switched') {
    throw new Error('native.pending_root_move.stage is invalid');
  }
  let cleanup: NativePendingRootMove['cleanup'];
  if (pending.cleanup !== undefined) {
    const value = record(pending.cleanup, 'native.pending_root_move.cleanup');
    rejectUnknown(value, CLEANUP_KEYS, 'native.pending_root_move.cleanup');
    const kind = value.kind;
    const state = value.state;
    const manifestHash = value.manifest_hash;
    if (
      kind !== 'forward-source' &&
      kind !== 'restart-staging' &&
      kind !== 'rollback-destination' &&
      kind !== 'rollback-staging'
    ) {
      throw new Error('native.pending_root_move.cleanup.kind is invalid');
    }
    if (state !== 'prepared' && state !== 'quarantined' && state !== 'deleting') {
      throw new Error('native.pending_root_move.cleanup.state is invalid');
    }
    if (typeof manifestHash !== 'string' || !/^[a-f0-9]{64}$/u.test(manifestHash)) {
      throw new Error('native.pending_root_move.cleanup.manifest_hash is invalid');
    }
    cleanup = { kind, state, manifestHash };
  }
  return {
    id,
    fromArtifactRoot: normalizeArtifactRootRef(from),
    toArtifactRoot: normalizeArtifactRootRef(to),
    stage,
    ...(cleanup ? { cleanup } : {}),
  };
}

function parseConfig(value: unknown): CometProjectConfig {
  const root = record(value, PROJECT_CONFIG_FILE);
  if (root.schema !== 'comet.project.v1') throw new Error('Unsupported Comet project schema');
  if (root.default_workflow !== 'native' && root.default_workflow !== 'classic') {
    throw new Error('default_workflow must be native or classic');
  }
  const configuredWorkflows = root.workflows ?? [root.default_workflow];
  if (
    !Array.isArray(configuredWorkflows) ||
    configuredWorkflows.length === 0 ||
    configuredWorkflows.some((workflow) => workflow !== 'native' && workflow !== 'classic')
  ) {
    throw new Error('workflows must contain native and/or classic');
  }
  const workflows = [...new Set(configuredWorkflows)] as Array<'native' | 'classic'>;
  if (!workflows.includes(root.default_workflow)) {
    throw new Error('workflows must include default_workflow');
  }
  const ambientResume = root.ambient_resume ?? true;
  if (typeof ambientResume !== 'boolean') {
    throw new Error('ambient_resume must be true or false');
  }
  const native = record(root.native, 'native');
  rejectUnknown(native, NATIVE_KEYS, 'native');
  if (typeof native.artifact_root !== 'string') {
    throw new Error('native.artifact_root must be a string');
  }
  const language = native.language ?? 'en';
  if (language !== 'en' && language !== 'zh-CN') {
    throw new Error('native.language must be en or zh-CN');
  }
  const clarificationMode = native.clarification_mode ?? 'sequential';
  if (clarificationMode !== 'sequential' && clarificationMode !== 'batch') {
    throw new Error('native.clarification_mode must be sequential or batch');
  }
  const pending = parsePending(native.pending_root_move);
  return {
    schema: 'comet.project.v1',
    default_workflow: root.default_workflow,
    workflows,
    ambient_resume: ambientResume,
    native: {
      artifact_root: normalizeArtifactRootRef(native.artifact_root),
      language,
      clarification_mode: clarificationMode,
      ...(pending ? { pending_root_move: pending } : {}),
    },
  };
}

export function defaultProjectConfig(
  artifactRoot = 'docs',
  language: 'en' | 'zh-CN' = 'en',
): CometProjectConfig {
  return {
    schema: 'comet.project.v1',
    default_workflow: 'native',
    ambient_resume: true,
    native: {
      artifact_root: normalizeArtifactRootRef(artifactRoot),
      language,
      clarification_mode: 'sequential',
    },
  };
}

export async function readProjectConfig(projectRoot: string): Promise<CometProjectConfig | null> {
  const canonical = path.join(projectRoot, ...PROJECT_CONFIG_FILE.split('/'));
  const file = canonical;
  try {
    await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const source = (
    await readNativeProtectedTextFile({
      root: projectRoot,
      file,
      maxBytes: NATIVE_PROJECT_CONFIG_MAX_BYTES,
      label: PROJECT_CONFIG_FILE,
    })
  ).text;
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid ${PROJECT_CONFIG_FILE}: ${document.errors[0].message}`);
  }
  const value = document.toJS();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  if (
    root.schema === undefined &&
    root.native === undefined &&
    root.default_workflow === undefined
  ) {
    return null;
  }
  return parseConfig(value);
}

async function existingConfigDocument(projectRoot: string): Promise<Record<string, unknown>> {
  const file = path.join(projectRoot, ...PROJECT_CONFIG_FILE.split('/'));
  try {
    const source = (
      await readNativeProtectedTextFile({
        root: projectRoot,
        file,
        maxBytes: NATIVE_PROJECT_CONFIG_MAX_BYTES,
        label: PROJECT_CONFIG_FILE,
      })
    ).text;
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length > 0) throw new Error(document.errors[0].message);
    const value = document.toJS();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {};
}

export async function assertNoPendingNativeRootMove(projectRoot: string): Promise<void> {
  const config = await readProjectConfig(projectRoot);
  if (config?.native.pending_root_move) {
    throw new Error(
      `Native root move ${config.native.pending_root_move.id} is incomplete; use comet native doctor --repair`,
    );
  }
}

export async function writeProjectConfig(
  projectRoot: string,
  config: CometProjectConfig,
): Promise<void> {
  const validated = parseConfig({
    schema: config.schema,
    default_workflow: config.default_workflow,
    workflows: config.workflows ?? [config.default_workflow],
    ambient_resume: config.ambient_resume,
    native: {
      artifact_root: config.native.artifact_root,
      language: config.native.language,
      clarification_mode: config.native.clarification_mode,
      ...(config.native.pending_root_move
        ? {
            pending_root_move: {
              id: config.native.pending_root_move.id,
              from_artifact_root: config.native.pending_root_move.fromArtifactRoot,
              to_artifact_root: config.native.pending_root_move.toArtifactRoot,
              stage: config.native.pending_root_move.stage,
              ...(config.native.pending_root_move.cleanup
                ? {
                    cleanup: {
                      kind: config.native.pending_root_move.cleanup.kind,
                      state: config.native.pending_root_move.cleanup.state,
                      manifest_hash: config.native.pending_root_move.cleanup.manifestHash,
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
  });
  const document = {
    ...(await existingConfigDocument(projectRoot)),
    schema: validated.schema,
    default_workflow: validated.default_workflow,
    workflows: validated.workflows,
    ambient_resume: validated.ambient_resume,
    native: {
      artifact_root: validated.native.artifact_root,
      language: validated.native.language,
      clarification_mode: validated.native.clarification_mode,
      ...(validated.native.pending_root_move
        ? {
            pending_root_move: {
              id: validated.native.pending_root_move.id,
              from_artifact_root: validated.native.pending_root_move.fromArtifactRoot,
              to_artifact_root: validated.native.pending_root_move.toArtifactRoot,
              stage: validated.native.pending_root_move.stage,
              ...(validated.native.pending_root_move.cleanup
                ? {
                    cleanup: {
                      kind: validated.native.pending_root_move.cleanup.kind,
                      state: validated.native.pending_root_move.cleanup.state,
                      manifest_hash: validated.native.pending_root_move.cleanup.manifestHash,
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
  };
  const canonical = path.join(projectRoot, ...PROJECT_CONFIG_FILE.split('/'));
  await fs.mkdir(path.dirname(canonical), { recursive: true });
  await atomicWriteText(
    canonical,
    renderStructuredProjectConfig(document, validated.native.language === 'zh-CN' ? 'zh-CN' : 'en'),
  );
}

export async function resolveNativeProject(options: {
  startPath: string;
  explicitArtifactRoot?: string;
  allowMissingConfig?: boolean;
}): Promise<{ config: CometProjectConfig; paths: NativeProjectPaths; configured: boolean }> {
  const projectRoot = await discoverNativeProject(options.startPath);
  const existing = await readProjectConfig(projectRoot);
  if (!existing && options.allowMissingConfig === false) {
    throw new Error(`${PROJECT_CONFIG_FILE} was not found`);
  }
  if (existing?.native.pending_root_move) {
    throw new Error(
      `Native root move ${existing.native.pending_root_move.id} is incomplete; use comet native doctor --repair`,
    );
  }
  const explicit = options.explicitArtifactRoot
    ? normalizeArtifactRootRef(options.explicitArtifactRoot)
    : undefined;
  if (existing && explicit && explicit !== existing.native.artifact_root) {
    throw new Error(
      `Configured Native artifact root is ${existing.native.artifact_root}; refusing conflicting root ${explicit}`,
    );
  }
  const config = existing ?? defaultProjectConfig(explicit ?? 'docs');
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  return { config, paths, configured: existing !== null };
}
