import { promises as fs, type Dirent } from 'fs';
import path from 'path';

import { fileExists } from '../../platform/fs/file-system.js';
import { readProjectConfig } from '../comet-native/native-config.js';
import { normalizeArtifactRootRef } from '../comet-native/native-paths.js';
import type { CometWorkflow } from './types.js';

export type InitWorkflowSource =
  | 'project-config'
  | 'explicit-option'
  | 'legacy-project'
  | 'new-project-default';

export interface InitWorkflowDecision {
  workflow: CometWorkflow;
  source: InitWorkflowSource;
  artifactRoot: string;
  writeProjectConfig: boolean;
  legacyEvidence: string[];
}

interface ResolveInitWorkflowOptions {
  workflow?: CometWorkflow;
  artifactRoot?: string;
}

async function containsLegacyManagedResumeBlock(file: string): Promise<boolean> {
  try {
    const source = await fs.readFile(file, 'utf8');
    return source.includes('<comet-ambient-resume>') && !source.includes('comet.resume_probe.v2');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function findLegacyEvidence(projectRoot: string): Promise<string[]> {
  const evidence: string[] = [];
  const legacyConfig = '.comet/config.yaml';
  if (await fileExists(path.join(projectRoot, ...legacyConfig.split('/')))) {
    evidence.push(legacyConfig);
  }

  const changesRoot = path.join(projectRoot, 'openspec', 'changes');
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile() && entry.name === '.comet.yaml') {
        evidence.push(path.relative(projectRoot, target).replaceAll('\\', '/'));
      }
    }
  };
  await visit(changesRoot);

  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    if (await containsLegacyManagedResumeBlock(path.join(projectRoot, file))) {
      evidence.push(`${file}#comet-ambient-resume`);
    }
  }
  return evidence;
}

export async function resolveInitWorkflow(
  projectRoot: string,
  options: ResolveInitWorkflowOptions = {},
): Promise<InitWorkflowDecision> {
  if (options.workflow === 'classic' && options.artifactRoot !== undefined) {
    throw new Error('--root is only valid with the Native workflow');
  }

  const requestedArtifactRoot =
    options.artifactRoot === undefined ? undefined : normalizeArtifactRootRef(options.artifactRoot);
  const requestedWorkflow = options.workflow ?? (requestedArtifactRoot ? 'native' : undefined);
  const existing = await readProjectConfig(projectRoot);
  if (existing) {
    if (
      requestedArtifactRoot !== undefined &&
      requestedArtifactRoot !== existing.native.artifact_root
    ) {
      throw new Error(
        `The configured Native artifact root is ${existing.native.artifact_root}; refusing requested ${requestedArtifactRoot}`,
      );
    }
    const workflow = requestedWorkflow ?? existing.default_workflow;
    const explicit = requestedWorkflow !== undefined || requestedArtifactRoot !== undefined;
    return {
      workflow,
      source: explicit ? 'explicit-option' : 'project-config',
      artifactRoot: existing.native.artifact_root,
      writeProjectConfig: workflow !== existing.default_workflow,
      legacyEvidence: [],
    };
  }

  const legacyEvidence = await findLegacyEvidence(projectRoot);
  if (requestedWorkflow) {
    return {
      workflow: requestedWorkflow,
      source: 'explicit-option',
      artifactRoot: requestedArtifactRoot ?? 'docs',
      writeProjectConfig: true,
      legacyEvidence,
    };
  }
  if (legacyEvidence.length > 0) {
    return {
      workflow: 'classic',
      source: 'legacy-project',
      artifactRoot: 'docs',
      writeProjectConfig: false,
      legacyEvidence,
    };
  }
  return {
    workflow: 'native',
    source: 'new-project-default',
    artifactRoot: 'docs',
    writeProjectConfig: true,
    legacyEvidence: [],
  };
}
