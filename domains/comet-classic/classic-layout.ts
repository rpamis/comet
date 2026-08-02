import { promises as fs } from 'fs';
import path from 'path';

import { fileExists } from '../../platform/fs/file-system.js';
import {
  parseWorkflowProjectConfigDocument,
  renderStructuredProjectConfig,
} from '../workflow-contract/project-config.js';
import {
  readWorkflowProjectConfigDocument,
  readWorkflowProjectConfigSnapshot,
  type WorkflowProjectConfigIdentity,
} from '../workflow-contract/project-config-reader.js';
import { writeWorkflowProjectConfigSource } from '../workflow-contract/project-config-writer.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
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

interface ClassicLayoutAccessOptions {
  allowAlternateRoot?: boolean;
}

export class ClassicLayoutUnavailableError extends Error {
  readonly code = 'classic-layout-unavailable';

  constructor(message = 'Classic artifact layout is unavailable from .comet/config.yaml') {
    super(message);
    this.name = 'ClassicLayoutUnavailableError';
  }
}

export class ClassicLayoutConflictError extends Error {
  readonly code = 'classic-layout-conflict';

  constructor(
    readonly configuredRoot: string,
    readonly alternateRoot: string,
    projectRoot: string,
  ) {
    const configured = classicProjectRelative(projectRoot, configuredRoot);
    const alternate = classicProjectRelative(projectRoot, alternateRoot);
    super(
      `Classic layout conflict: both ${configured}/ and ${alternate}/ exist; run comet doctor and resolve the conflict before writing`,
    );
    this.name = 'ClassicLayoutConflictError';
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

export async function inspectClassicLayout(
  projectRoot: string,
  artifactLayout?: ClassicArtifactLayout,
): Promise<ClassicLayoutInspection> {
  const paths = await resolveClassicLayout(projectRoot, artifactLayout);
  const alternateLayout: ClassicArtifactLayout =
    paths.artifactLayout === 'legacy' ? 'docs' : 'legacy';
  const alternateRoot = classicLayoutPaths(projectRoot, alternateLayout).openSpecRoot;
  const [configuredRoot, alternate] = await Promise.all([
    inspectProtectedProjectPath(
      paths.projectRoot,
      classicProjectRelative(paths.projectRoot, paths.openSpecRoot),
      {
        label: 'Configured Classic OpenSpec root',
        expected: 'directory',
      },
    ),
    inspectProtectedProjectPath(
      paths.projectRoot,
      classicProjectRelative(paths.projectRoot, alternateRoot),
      {
        label: 'Alternate Classic OpenSpec root',
        expected: 'directory',
      },
    ),
  ]);
  const configuredRootExists = configuredRoot.exists;
  const alternateRootExists = alternate.exists;
  return {
    paths,
    configuredRootExists,
    alternateRoot,
    alternateRootExists,
    dualRoots: configuredRootExists && alternateRootExists,
  };
}

async function assertClassicManagedRootsPhysical(
  paths: ClassicLayoutPaths,
  alternateRoot: string,
): Promise<void> {
  const managedRoots = [
    paths.openSpecRoot,
    paths.changesDir,
    paths.archiveDir,
    paths.specsDir,
    alternateRoot,
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
  options: ClassicLayoutAccessOptions = {},
): Promise<ClassicLayoutPaths> {
  const inspection = await inspectClassicLayout(projectRoot, artifactLayout);
  await assertClassicManagedRootsPhysical(inspection.paths, inspection.alternateRoot);
  if (inspection.dualRoots && !options.allowAlternateRoot) {
    throw new ClassicLayoutConflictError(
      inspection.paths.openSpecRoot,
      inspection.alternateRoot,
      inspection.paths.projectRoot,
    );
  }
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
  options: ClassicLayoutAccessOptions = {},
): Promise<ClassicLayoutPaths> {
  const pendingMove = path.join(path.resolve(projectRoot), '.comet', 'classic-root-move.json');
  if (await fileExists(pendingMove)) {
    throw new Error(
      'Classic root move transaction is incomplete; inspect it with comet doctor and recover it explicitly before writing',
    );
  }
  const paths = await assertClassicLayoutReadable(projectRoot, artifactLayout, options);
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
  for (;;) {
    if (path.basename(cursor) === 'openspec') {
      openSpecFallback = path.dirname(cursor);
    }
    const configFile = path.join(cursor, '.comet', 'config.yaml');
    let projectConfig = false;
    if (await fileExists(configFile)) {
      try {
        await assertClassicConfigPhysical(cursor);
        const value = (await readWorkflowProjectConfigDocument(cursor))?.value;
        projectConfig =
          Boolean(value) &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          ((value as Record<string, unknown>).schema === 'comet.project.v1' ||
            (value as Record<string, unknown>).default_workflow !== undefined ||
            (value as Record<string, unknown>).native !== undefined);
      } catch {
        // A malformed config next to a repository marker is still handled by
        // the caller. It is not enough by itself to turn a global ~/.comet
        // directory into a project root.
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
