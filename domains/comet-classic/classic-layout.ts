import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import { fileExists } from '../../platform/fs/file-system.js';
import {
  declaresWorkflowProjectConfig,
  parseWorkflowProjectConfigDocument,
  renderStructuredProjectConfig,
  WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
} from '../workflow-contract/project-config.js';
import {
  readWorkflowProjectConfigDocument,
  readWorkflowProjectConfigSnapshot,
  type WorkflowProjectConfigIdentity,
} from '../workflow-contract/project-config-reader.js';
import { writeWorkflowProjectConfigSource } from '../workflow-contract/project-config-writer.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import type { ClassicArtifactLayout } from '../workflow-contract/types.js';

export type { ClassicArtifactLayout } from '../workflow-contract/types.js';

export interface ClassicLayoutPaths {
  projectRoot: string;
  artifactLayout: ClassicArtifactLayout;
  openSpecBase: string;
  openSpecRoot: string;
  changesDir: string;
  archiveDir: string;
  specsDir: string;
  superpowersRoot: string;
  superpowersSpecsDir: string;
  superpowersPlansDir: string;
  superpowersReportsDir: string;
}

export interface ClassicLayoutInspection {
  paths: ClassicLayoutPaths;
  configuredRootExists: boolean;
  alternateRoot: string;
  alternateRootExists: boolean;
  dualRoots: boolean;
}

export class ClassicLayoutUnavailableError extends Error {
  readonly code = 'classic-layout-unavailable';

  constructor(message = 'Classic artifact layout is unavailable from .comet/config.yaml') {
    super(message);
    this.name = 'ClassicLayoutUnavailableError';
  }
}

/** 项目发现阶段的配置校验失败，保留原诊断并与文件系统错误区分。 */
export class ClassicProjectConfigError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'ClassicProjectConfigError';
  }
}

const PROJECT_CONFIG_RELATIVE_PATH = '.comet/config.yaml';

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function assertClassicConfigPhysical(projectRoot: string): Promise<void> {
  await inspectProtectedProjectPath(projectRoot, PROJECT_CONFIG_RELATIVE_PATH, {
    label: PROJECT_CONFIG_RELATIVE_PATH,
    expected: 'file',
  });
}

export function classicLayoutPaths(
  projectRoot: string,
  artifactLayout: ClassicArtifactLayout,
): ClassicLayoutPaths {
  const root = path.resolve(projectRoot);
  const openSpecBase = artifactLayout === 'docs' ? path.join(root, 'docs') : root;
  const openSpecRoot = path.join(openSpecBase, 'openspec');
  const superpowersRoot = path.join(root, 'docs', 'superpowers');
  return {
    projectRoot: root,
    artifactLayout,
    openSpecBase,
    openSpecRoot,
    changesDir: path.join(openSpecRoot, 'changes'),
    archiveDir: path.join(openSpecRoot, 'changes', 'archive'),
    specsDir: path.join(openSpecRoot, 'specs'),
    superpowersRoot,
    superpowersSpecsDir: path.join(superpowersRoot, 'specs'),
    superpowersPlansDir: path.join(superpowersRoot, 'plans'),
    superpowersReportsDir: path.join(superpowersRoot, 'reports'),
  };
}

export async function readClassicArtifactLayout(
  projectRoot: string,
): Promise<ClassicArtifactLayout> {
  await assertClassicConfigPhysical(projectRoot);
  const document = await readWorkflowProjectConfigDocument(projectRoot, {
    allowPartialProject: true,
    allowMissingNativeFields: true,
  });
  if (!document?.config) {
    throw new ClassicLayoutUnavailableError();
  }
  const workflows = document.config.workflows ?? [document.config.default_workflow];
  if (!workflows.includes('classic')) {
    throw new ClassicLayoutUnavailableError(
      'Classic artifact layout is unavailable because Classic is not enabled',
    );
  }
  return document.classic?.artifact_layout ?? 'legacy';
}

export async function assertClassicWorkflowEnabled(projectRoot: string): Promise<void> {
  await assertClassicConfigPhysical(projectRoot);
  const config = (await readWorkflowProjectConfigDocument(projectRoot))?.config;
  if (!config) {
    throw new Error('.comet/config.yaml must use comet.project.v1 before migration');
  }
  const workflows = config.workflows ?? [config.default_workflow];
  if (!workflows.includes('classic')) {
    throw new Error('Classic root move requires the Classic workflow to be enabled');
  }
}

export async function writeClassicArtifactLayout(
  projectRoot: string,
  artifactLayout: ClassicArtifactLayout,
  options: {
    expectedIdentity?: WorkflowProjectConfigIdentity;
    beforeCommit?: () => void | Promise<void>;
  } = {},
): Promise<void> {
  await assertClassicConfigPhysical(projectRoot);
  const snapshot = await readWorkflowProjectConfigSnapshot(projectRoot, {
    allowPartialProject: true,
  });
  const parsed = snapshot.document;
  if (!parsed) throw new Error('.comet/config.yaml does not exist');
  const classic = parsed.value.classic;
  if (!classic || typeof classic !== 'object' || Array.isArray(classic)) {
    throw new Error('classic must be a mapping');
  }
  const document = {
    ...parsed.value,
    classic: {
      ...(classic as Record<string, unknown>),
      artifact_layout: artifactLayout,
    },
  };
  const output = renderStructuredProjectConfig(
    document,
    parsed.classic?.language === 'zh-CN' || parsed.native?.language === 'zh-CN' ? 'zh-CN' : 'en',
  );
  parseWorkflowProjectConfigDocument(output, { allowPartialProject: true });
  await writeWorkflowProjectConfigSource(projectRoot, output, {
    expectedIdentity: options.expectedIdentity ?? snapshot.identity,
    beforeCommit: options.beforeCommit,
  });
}

export async function resolveClassicLayout(
  projectRoot: string,
  artifactLayout?: ClassicArtifactLayout,
): Promise<ClassicLayoutPaths> {
  return classicLayoutPaths(
    projectRoot,
    artifactLayout ?? (await readClassicArtifactLayout(projectRoot)),
  );
}

async function inspectUntrustedAlternateRoot(alternateRoot: string): Promise<boolean> {
  try {
    await fs.lstat(alternateRoot);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

export async function inspectClassicLayout(
  projectRoot: string,
  artifactLayout?: ClassicArtifactLayout,
): Promise<ClassicLayoutInspection> {
  const paths = await resolveClassicLayout(projectRoot, artifactLayout);
  const alternateLayout: ClassicArtifactLayout =
    paths.artifactLayout === 'legacy' ? 'docs' : 'legacy';
  const alternateRoot = classicLayoutPaths(projectRoot, alternateLayout).openSpecRoot;
  const [configuredRoot, alternateRootExists] = await Promise.all([
    inspectProtectedProjectPath(
      paths.projectRoot,
      classicProjectRelative(paths.projectRoot, paths.openSpecRoot),
      {
        label: 'Configured Classic OpenSpec root',
        expected: 'directory',
      },
    ),
    inspectUntrustedAlternateRoot(alternateRoot),
  ]);
  const configuredRootExists = configuredRoot.exists;
  return {
    paths,
    configuredRootExists,
    alternateRoot,
    alternateRootExists,
    dualRoots: configuredRootExists && alternateRootExists,
  };
}

async function assertClassicManagedRootsPhysical(paths: ClassicLayoutPaths): Promise<void> {
  const managedRoots = [
    paths.openSpecRoot,
    paths.changesDir,
    paths.archiveDir,
    paths.specsDir,
    paths.superpowersRoot,
    paths.superpowersSpecsDir,
    paths.superpowersPlansDir,
    paths.superpowersReportsDir,
  ];
  for (const target of managedRoots) {
    const relative = classicProjectRelative(paths.projectRoot, target);
    await inspectProtectedProjectPath(paths.projectRoot, relative, {
      label: `Classic managed physical path ${relative}`,
      expected: 'directory',
    });
  }
}

export async function assertClassicLayoutReadable(
  projectRoot: string,
  artifactLayout?: ClassicArtifactLayout,
): Promise<ClassicLayoutPaths> {
  const inspection = await inspectClassicLayout(projectRoot, artifactLayout);
  await assertClassicManagedRootsPhysical(inspection.paths);
  // `artifact_layout` is the ownership boundary. The alternate OpenSpec root
  // may belong to a standalone OpenSpec workflow and must not block Comet from
  // reading or writing its configured root. Explicit root migration remains
  // responsible for handling a non-empty destination safely.
  if (!inspection.configuredRootExists) {
    const configured = classicProjectRelative(
      inspection.paths.projectRoot,
      inspection.paths.openSpecRoot,
    );
    const alternate = classicProjectRelative(
      inspection.paths.projectRoot,
      inspection.alternateRoot,
    );
    throw new ClassicLayoutUnavailableError(
      `Configured Classic OpenSpec root is missing: ${configured} (alternate ${alternate} is ${
        inspection.alternateRootExists ? 'present' : 'missing'
      })`,
    );
  }
  return inspection.paths;
}

export async function assertClassicLayoutWritable(
  projectRoot: string,
  artifactLayout?: ClassicArtifactLayout,
): Promise<ClassicLayoutPaths> {
  const pendingMove = path.join(path.resolve(projectRoot), '.comet', 'classic-root-move.json');
  if (await fileExists(pendingMove)) {
    throw new Error(
      'Classic root move transaction is incomplete; inspect it with comet doctor and recover it explicitly before writing',
    );
  }
  const paths = await assertClassicLayoutReadable(projectRoot, artifactLayout);
  if (!(await fileExists(paths.openSpecRoot))) {
    throw new Error(
      `Configured Classic OpenSpec root is missing: ${classicProjectRelative(
        paths.projectRoot,
        paths.openSpecRoot,
      )}`,
    );
  }
  return paths;
}

export async function discoverClassicProject(startPath: string): Promise<string> {
  let cursor = path.resolve(startPath);
  let openSpecFallback: string | null = null;
  try {
    if (!(await fs.lstat(cursor)).isDirectory()) cursor = path.dirname(cursor);
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }
  const invocationRoot = cursor;
  const home = path.resolve(os.homedir());
  for (;;) {
    if (path.basename(cursor) === 'openspec') {
      openSpecFallback = path.dirname(cursor);
    }
    let projectConfig = false;
    const isHomeBoundary = cursor === home && cursor !== invocationRoot;
    let source: string | null = null;
    if (!isHomeBoundary) {
      try {
        const { bytes } = await readProtectedProjectFile(
          cursor,
          PROJECT_CONFIG_RELATIVE_PATH,
          WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
          { label: PROJECT_CONFIG_RELATIVE_PATH },
        );
        source = bytes.toString('utf8');
      } catch (error) {
        if (!isMissingPath(error)) throw error;
      }
    }
    if (source !== null) {
      try {
        const value = parseWorkflowProjectConfigDocument(source, {
          allowPartialProject: true,
          allowMissingNativeFields: true,
        }).value;
        projectConfig =
          Boolean(value) &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          ((value as Record<string, unknown>).schema === 'comet.project.v1' ||
            (value as Record<string, unknown>).default_workflow !== undefined ||
            (value as Record<string, unknown>).native !== undefined);
      } catch (error) {
        // 起点配置与明确声明的项目不能因配置损坏而归到父项目。
        // 其他祖先的全局配置仍不足以声明项目边界。
        if (cursor === invocationRoot) throw new ClassicProjectConfigError(error);
        if (declaresWorkflowProjectConfig(source)) {
          throw new ClassicProjectConfigError(error);
        }
      }
    }
    if (projectConfig || (await fileExists(path.join(cursor, '.git')))) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return openSpecFallback ?? path.resolve(startPath);
    cursor = parent;
  }
}

export function classicProjectRelative(projectRoot: string, target: string): string {
  return path.relative(path.resolve(projectRoot), target).replaceAll('\\', '/');
}
