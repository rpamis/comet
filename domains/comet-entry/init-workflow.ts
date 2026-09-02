import { promises as fs } from 'fs';
import path from 'path';

import { fileExists } from '../../platform/fs/file-system.js';
import type { ClassicArtifactLayout } from '../comet-classic/classic-layout.js';
import {
  hasExplicitClassicArtifactLayout,
  normalizeWorkflowArtifactRoot,
} from '../workflow-contract/project-config.js';
import {
  readWorkflowProjectConfigSnapshot,
  type WorkflowProjectConfigSnapshot,
} from '../workflow-contract/project-config-reader.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
  resolveProtectedProjectInstructionPath,
} from '../workflow-contract/protected-project-path.js';
import type { CometWorkflow } from './types.js';

export type InitWorkflowSource =
  'project-config' | 'explicit-option' | 'legacy-project' | 'new-project-default';

export interface InitWorkflowDecision {
  workflow: CometWorkflow;
  source: InitWorkflowSource;
  artifactRoot: string;
  classicArtifactLayout: ClassicArtifactLayout;
  writeProjectConfig: boolean;
  legacyEvidence: string[];
}

interface ResolveInitWorkflowOptions {
  workflow?: CometWorkflow;
  artifactRoot?: string;
}

async function containsLegacyManagedResumeBlock(
  projectRoot: string,
  relativeFile: string,
): Promise<boolean> {
  try {
    const instruction = await resolveProtectedProjectInstructionPath(projectRoot, relativeFile);
    if (!instruction.exists) return false;
    const source = (
      await readProtectedProjectFile(projectRoot, instruction.relative, 4 * 1024 * 1024, {
        label: `${instruction.relative} legacy resume evidence`,
      })
    ).bytes.toString('utf8');
    return source.includes('<comet-ambient-resume>') && !source.includes('comet.resume_probe.v2');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

async function findLegacyEvidence(
  projectRoot: string,
  projectConfigExists?: boolean,
): Promise<string[]> {
  const evidence: string[] = [];
  const legacyConfig = '.comet/config.yaml';
  if (
    projectConfigExists ??
    (await fileExists(path.join(projectRoot, ...legacyConfig.split('/'))))
  ) {
    evidence.push(legacyConfig);
  }

  const visit = async (relativeDirectory: string): Promise<void> => {
    const inspection = await inspectProtectedProjectPath(projectRoot, relativeDirectory, {
      label: 'legacy Classic change evidence',
      expected: 'directory',
    });
    if (!inspection.exists) return;
    const entries = await fs.readdir(inspection.target, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const relativeTarget = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(relativeTarget);
      } else if (entry.isFile() && entry.name === '.comet.yaml') {
        evidence.push(relativeTarget);
      }
    }
  };
  await visit('openspec/changes');

  const inspectedResumeTargets = new Set<string>();
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const instruction = await resolveProtectedProjectInstructionPath(projectRoot, file);
    if (!instruction.exists || inspectedResumeTargets.has(instruction.relative)) continue;
    inspectedResumeTargets.add(instruction.relative);
    if (await containsLegacyManagedResumeBlock(projectRoot, instruction.relative)) {
      evidence.push(`${instruction.relative}#comet-ambient-resume`);
    }
  }
  return evidence;
}

export async function resolveInitWorkflow(
  projectRoot: string,
  options: ResolveInitWorkflowOptions = {},
  projectConfigSnapshot?: WorkflowProjectConfigSnapshot,
): Promise<InitWorkflowDecision> {
  if (options.workflow === 'classic' && options.artifactRoot !== undefined) {
    throw new Error('--root is only valid with the Native workflow');
  }

  const requestedArtifactRoot =
    options.artifactRoot === undefined
      ? undefined
      : normalizeWorkflowArtifactRoot(options.artifactRoot);
  const requestedWorkflow = options.workflow ?? (requestedArtifactRoot ? 'native' : undefined);
  const snapshot =
    projectConfigSnapshot ??
    (await readWorkflowProjectConfigSnapshot(projectRoot, {
      allowPartialProject: true,
      allowMissingNativeFields: true,
    }));
  const existing = snapshot.document?.config ?? null;
  if (existing) {
    if (
      requestedArtifactRoot !== undefined &&
      existing.native !== undefined &&
      requestedArtifactRoot !== existing.native.artifact_root
    ) {
      throw new Error(
        `The configured Native artifact root is ${existing.native.artifact_root}; refusing requested ${requestedArtifactRoot}`,
      );
    }
    const workflow = requestedWorkflow ?? existing.default_workflow;
    const explicit = requestedWorkflow !== undefined || requestedArtifactRoot !== undefined;
    const rawClassic = snapshot.document?.value.classic;
    const hasExplicitClassicLayout = hasExplicitClassicArtifactLayout(rawClassic);
    const inferredClassicLayout: ClassicArtifactLayout = hasExplicitClassicLayout
      ? (existing.classic?.artifact_layout ?? 'docs')
      : (await fileExists(path.join(projectRoot, 'openspec')))
        ? 'legacy'
        : 'docs';
    return {
      workflow,
      source: explicit ? 'explicit-option' : 'project-config',
      artifactRoot: requestedArtifactRoot ?? existing.native?.artifact_root ?? 'docs',
      classicArtifactLayout: inferredClassicLayout,
      writeProjectConfig:
        workflow !== existing.default_workflow || (workflow === 'native' && !existing.native),
      legacyEvidence: [],
    };
  }

  const legacyEvidence = await findLegacyEvidence(projectRoot, snapshot.identity.exists);
  const [legacyOpenSpecRootExists, docsOpenSpecRootExists] = await Promise.all([
    fileExists(path.join(projectRoot, 'openspec')),
    fileExists(path.join(projectRoot, 'docs', 'openspec')),
  ]);
  const legacyArtifactLayout =
    legacyEvidence.some((item) => item.startsWith('openspec/')) ||
    (legacyOpenSpecRootExists && !docsOpenSpecRootExists);
  if (requestedWorkflow) {
    return {
      workflow: requestedWorkflow,
      source: 'explicit-option',
      artifactRoot: requestedArtifactRoot ?? 'docs',
      classicArtifactLayout: legacyArtifactLayout ? 'legacy' : 'docs',
      writeProjectConfig: true,
      legacyEvidence,
    };
  }
  if (legacyEvidence.length > 0) {
    return {
      workflow: 'classic',
      source: 'legacy-project',
      artifactRoot: 'docs',
      classicArtifactLayout: legacyArtifactLayout ? 'legacy' : 'docs',
      writeProjectConfig: false,
      legacyEvidence,
    };
  }
  return {
    workflow: 'native',
    source: 'new-project-default',
    artifactRoot: 'docs',
    classicArtifactLayout: 'docs',
    writeProjectConfig: true,
    legacyEvidence: [],
  };
}
