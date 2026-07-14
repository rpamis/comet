import { promises as fs } from 'fs';
import path from 'path';
import { parseDocument, stringify } from 'yaml';

import { atomicWriteText } from './native-atomic-file.js';
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

const ROOT_KEYS = new Set(['schema', 'default_workflow', 'native']);
const NATIVE_KEYS = new Set(['artifact_root', 'pending_root_move']);
const PENDING_KEYS = new Set(['id', 'from_artifact_root', 'to_artifact_root', 'stage']);

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
  return {
    id,
    fromArtifactRoot: normalizeArtifactRootRef(from),
    toArtifactRoot: normalizeArtifactRootRef(to),
    stage,
  };
}

function parseConfig(value: unknown): CometProjectConfig {
  const root = record(value, PROJECT_CONFIG_FILE);
  rejectUnknown(root, ROOT_KEYS, PROJECT_CONFIG_FILE);
  if (root.schema !== 'comet.project.v1') throw new Error('Unsupported Comet project schema');
  if (root.default_workflow !== 'native' && root.default_workflow !== 'classic') {
    throw new Error('default_workflow must be native or classic');
  }
  const native = record(root.native, 'native');
  rejectUnknown(native, NATIVE_KEYS, 'native');
  if (typeof native.artifact_root !== 'string') {
    throw new Error('native.artifact_root must be a string');
  }
  const pending = parsePending(native.pending_root_move);
  return {
    schema: 'comet.project.v1',
    default_workflow: root.default_workflow,
    native: {
      artifact_root: normalizeArtifactRootRef(native.artifact_root),
      ...(pending ? { pending_root_move: pending } : {}),
    },
  };
}

export function defaultProjectConfig(artifactRoot = '.'): CometProjectConfig {
  return {
    schema: 'comet.project.v1',
    default_workflow: 'native',
    native: { artifact_root: normalizeArtifactRootRef(artifactRoot) },
  };
}

export async function readProjectConfig(projectRoot: string): Promise<CometProjectConfig | null> {
  const file = path.join(projectRoot, PROJECT_CONFIG_FILE);
  let source: string;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid ${PROJECT_CONFIG_FILE}: ${document.errors[0].message}`);
  }
  return parseConfig(document.toJS());
}

export async function writeProjectConfig(
  projectRoot: string,
  config: CometProjectConfig,
): Promise<void> {
  const validated = parseConfig({
    schema: config.schema,
    default_workflow: config.default_workflow,
    native: {
      artifact_root: config.native.artifact_root,
      ...(config.native.pending_root_move
        ? {
            pending_root_move: {
              id: config.native.pending_root_move.id,
              from_artifact_root: config.native.pending_root_move.fromArtifactRoot,
              to_artifact_root: config.native.pending_root_move.toArtifactRoot,
              stage: config.native.pending_root_move.stage,
            },
          }
        : {}),
    },
  });
  const document = {
    schema: validated.schema,
    default_workflow: validated.default_workflow,
    native: {
      artifact_root: validated.native.artifact_root,
      ...(validated.native.pending_root_move
        ? {
            pending_root_move: {
              id: validated.native.pending_root_move.id,
              from_artifact_root: validated.native.pending_root_move.fromArtifactRoot,
              to_artifact_root: validated.native.pending_root_move.toArtifactRoot,
              stage: validated.native.pending_root_move.stage,
            },
          }
        : {}),
    },
  };
  await atomicWriteText(path.join(projectRoot, PROJECT_CONFIG_FILE), stringify(document));
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
  const explicit = options.explicitArtifactRoot
    ? normalizeArtifactRootRef(options.explicitArtifactRoot)
    : undefined;
  if (existing && explicit && explicit !== existing.native.artifact_root) {
    throw new Error(
      `Configured Native artifact root is ${existing.native.artifact_root}; refusing conflicting root ${explicit}`,
    );
  }
  const config = existing ?? defaultProjectConfig(explicit ?? '.');
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  return { config, paths, configured: existing !== null };
}
