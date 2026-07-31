import { promises as fs } from 'fs';
import path from 'path';
import { readWorkflowProjectConfigDocument } from '../workflow-contract/project-config-reader.js';

/**
 * Resolve a dashboard project without consulting Classic layout configuration.
 *
 * Classic artifacts have two supported locations. A Git marker remains the
 * strongest project boundary when it is available.
 */
export async function discoverDashboardProjectRoot(targetPath: string): Promise<string> {
  const resolvedTarget = path.resolve(targetPath);
  let cursor = (await isDirectory(resolvedTarget)) ? resolvedTarget : path.dirname(resolvedTarget);
  const fallback = cursor;

  while (true) {
    if (await pathExists(path.join(cursor, '.git'))) {
      return cursor;
    }
    if (await hasWorkflowProjectConfig(cursor)) {
      return cursor;
    }
    if (await isDirectory(path.join(cursor, 'openspec'))) {
      return path.basename(cursor) === 'docs' ? path.dirname(cursor) : cursor;
    }
    if (await isDirectory(path.join(cursor, 'docs', 'openspec'))) {
      return cursor;
    }

    if (path.basename(cursor) === 'openspec') {
      const parent = path.dirname(cursor);
      return path.basename(parent) === 'docs' ? path.dirname(parent) : parent;
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) return fallback;
    cursor = parent;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function hasWorkflowProjectConfig(projectRoot: string): Promise<boolean> {
  try {
    const value = (await readWorkflowProjectConfigDocument(projectRoot))?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
      record.schema === 'comet.project.v1' ||
      record.default_workflow !== undefined ||
      record.native !== undefined
    );
  } catch {
    return false;
  }
}
