import { createHash } from 'crypto';

import {
  parseWorkflowProjectConfigDocument,
  WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
} from './project-config.js';
import { readProtectedProjectFile } from './protected-project-path.js';
import type { ParsedWorkflowProjectConfigDocument, WorkflowProjectConfig } from './types.js';

export const WORKFLOW_PROJECT_CONFIG_PATH = '.comet/config.yaml';

export interface WorkflowProjectConfigIdentity {
  exists: boolean;
  sha256: string | null;
}

export interface WorkflowProjectConfigSnapshot {
  document: ParsedWorkflowProjectConfigDocument | null;
  identity: WorkflowProjectConfigIdentity;
}

export function workflowProjectConfigIdentityEquals(
  left: WorkflowProjectConfigIdentity,
  right: WorkflowProjectConfigIdentity,
): boolean {
  return left.exists === right.exists && left.sha256 === right.sha256;
}

function isMissingProjectConfig(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export async function readWorkflowProjectConfigDocument(
  projectRoot: string,
  options: { allowPartialProject?: boolean } = {},
): Promise<ParsedWorkflowProjectConfigDocument | null> {
  return (await readWorkflowProjectConfigSnapshot(projectRoot, options)).document;
}

async function readWorkflowProjectConfigBytes(projectRoot: string): Promise<Buffer | null> {
  try {
    return (
      await readProtectedProjectFile(
        projectRoot,
        WORKFLOW_PROJECT_CONFIG_PATH,
        WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
        { label: WORKFLOW_PROJECT_CONFIG_PATH },
      )
    ).bytes;
  } catch (error) {
    if (isMissingProjectConfig(error)) return null;
    throw error;
  }
}

function projectConfigIdentity(bytes: Buffer | null): WorkflowProjectConfigIdentity {
  return bytes
    ? {
        exists: true,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }
    : { exists: false, sha256: null };
}

export async function readWorkflowProjectConfigIdentity(
  projectRoot: string,
): Promise<WorkflowProjectConfigIdentity> {
  return projectConfigIdentity(await readWorkflowProjectConfigBytes(projectRoot));
}

export async function readWorkflowProjectConfigSnapshot(
  projectRoot: string,
  options: { allowPartialProject?: boolean } = {},
): Promise<WorkflowProjectConfigSnapshot> {
  const bytes = await readWorkflowProjectConfigBytes(projectRoot);
  return {
    document: bytes ? parseWorkflowProjectConfigDocument(bytes.toString('utf8'), options) : null,
    identity: projectConfigIdentity(bytes),
  };
}

export async function readWorkflowProjectConfig(
  projectRoot: string,
): Promise<WorkflowProjectConfig | null> {
  return (await readWorkflowProjectConfigDocument(projectRoot))?.config ?? null;
}

export async function assertProjectConfigDocumentValid(projectRoot: string): Promise<void> {
  await readWorkflowProjectConfigDocument(projectRoot);
}

export async function readWorkflowAmbientResumeEnabled(projectRoot: string): Promise<boolean> {
  return (await readWorkflowProjectConfigDocument(projectRoot))?.ambient_resume ?? true;
}

/** @deprecated Prefer readWorkflowAmbientResumeEnabled. */
export const readAmbientResumeEnabled = readWorkflowAmbientResumeEnabled;
