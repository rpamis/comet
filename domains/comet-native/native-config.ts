import path from 'path';

import {
  DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES,
  DEFAULT_WORKFLOW_NATIVE_MAX_PARALLEL_CHILDREN,
  defaultWorkflowProjectConfig,
  mergeWorkflowProjectConfigDocument,
  renderStructuredProjectConfig,
} from '../workflow-contract/project-config.js';
import {
  readWorkflowProjectConfigDocument,
  readWorkflowProjectConfigSnapshot,
} from '../workflow-contract/project-config-reader.js';
import { assertWorkflowProjectConfigIdentity } from '../workflow-contract/project-config-writer.js';

import { atomicWriteText } from './native-atomic-file.js';
import {
  discoverNativeProject,
  nativeProjectPaths,
  normalizeArtifactRootRef,
  PROJECT_CONFIG_FILE,
} from './native-paths.js';
import type { CometProjectConfig, NativeProjectPaths } from './native-types.js';
export const DEFAULT_NATIVE_MAX_VERIFY_FAILURES = DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES;
export const DEFAULT_NATIVE_MAX_PARALLEL_CHILDREN = DEFAULT_WORKFLOW_NATIVE_MAX_PARALLEL_CHILDREN;

export function defaultProjectConfig(
  artifactRoot = 'docs',
  language: 'en' | 'zh-CN' = 'en',
): CometProjectConfig {
  return defaultWorkflowProjectConfig(artifactRoot, language);
}

export async function readProjectConfig(projectRoot: string): Promise<CometProjectConfig | null> {
  const config = (await readWorkflowProjectConfigDocument(projectRoot))?.config ?? null;
  if (!config?.native) return null;
  return config as CometProjectConfig;
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
  options: { beforeCommit?: () => void | Promise<void> } = {},
): Promise<void> {
  const snapshot = await readWorkflowProjectConfigSnapshot(projectRoot, {
    allowPartialProject: true,
  });
  const document = mergeWorkflowProjectConfigDocument(snapshot.document?.value ?? {}, config);
  const canonical = path.join(projectRoot, ...PROJECT_CONFIG_FILE.split('/'));
  await atomicWriteText(
    canonical,
    renderStructuredProjectConfig(document, config.native.language === 'zh-CN' ? 'zh-CN' : 'en'),
    {
      containedRoot: projectRoot,
      beforeCommit: async () => {
        await options.beforeCommit?.();
        await assertWorkflowProjectConfigIdentity(projectRoot, snapshot.identity);
      },
    },
  );
}

export async function resolveNativeProject(options: {
  startPath: string;
  explicitArtifactRoot?: string;
  allowMissingConfig?: boolean;
  change?: string;
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
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root, {
    change: options.change,
  });
  return { config, paths, configured: existing !== null };
}
