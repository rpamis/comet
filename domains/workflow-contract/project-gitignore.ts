import { promises as fs } from 'node:fs';
import path from 'node:path';

import { atomicWriteContainedText } from './contained-atomic-write.js';
import { inspectProtectedProjectPath, readProtectedProjectFile } from './protected-project-path.js';

const PROJECT_GITIGNORE_PATH = '.gitignore';
const PROJECT_GITIGNORE_MAX_BYTES = 4 * 1024 * 1024;
const MANAGED_BLOCK_START = '# >>> Comet managed project state >>>';
const MANAGED_BLOCK_END = '# <<< Comet managed project state <<<';

function lineEnding(source: string): '\n' | '\r\n' {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function linesWithEndings(source: string): string[] {
  return source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)?.filter(Boolean) ?? [];
}

function lineText(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/u, '');
}

function withoutManagedBlocks(source: string): string {
  const output: string[] = [];
  let insideManagedBlock = false;
  for (const line of linesWithEndings(source)) {
    const text = lineText(line);
    if (text === MANAGED_BLOCK_START) {
      if (insideManagedBlock) throw new Error('Comet .gitignore managed block is malformed');
      insideManagedBlock = true;
      continue;
    }
    if (text === MANAGED_BLOCK_END) {
      if (!insideManagedBlock) throw new Error('Comet .gitignore managed block is malformed');
      insideManagedBlock = false;
      continue;
    }
    if (!insideManagedBlock) output.push(line);
  }
  if (insideManagedBlock) throw new Error('Comet .gitignore managed block is incomplete');
  return output.join('');
}

function hasLegacyCometRuntimeCoverage(source: string): boolean {
  const lines = withoutManagedBlocks(source)
    .split(/\r?\n/u)
    .map((line) => line.trim());
  return lines.includes('.comet/runtime/') && lines.includes('.comet/current-change.json');
}

export function renderCometProjectGitignore(source: string): string {
  const newline = lineEnding(source);
  let preserved = withoutManagedBlocks(source);
  if (preserved.length > 0 && !/(?:\r\n|\n|\r)$/u.test(preserved)) preserved += newline;
  return (
    preserved +
    [
      MANAGED_BLOCK_START,
      '!/.comet/',
      '/.comet/*',
      '!/.comet/config.yaml',
      MANAGED_BLOCK_END,
      '',
    ].join(newline)
  );
}

/**
 * Keep project-level Comet configuration portable without exposing local
 * Runtime, selections, caches, drafts, or installed Skills.
 *
 * This only updates `.gitignore`; it never stages files or invokes Git.
 */
export async function ensureCometProjectGitignore(projectRoot: string): Promise<void> {
  const root = path.resolve(projectRoot);
  const inspection = await inspectProtectedProjectPath(root, PROJECT_GITIGNORE_PATH, {
    label: 'project .gitignore',
    expected: 'file',
  });
  let source = '';
  let sourceBytes: Uint8Array = new Uint8Array();
  if (inspection.exists) {
    sourceBytes = (
      await readProtectedProjectFile(root, PROJECT_GITIGNORE_PATH, PROJECT_GITIGNORE_MAX_BYTES, {
        label: 'project .gitignore',
      })
    ).bytes;
    source = Buffer.from(sourceBytes).toString('utf8');
  }
  // Existing projects may already carry the two legacy rules that isolate all
  // Runtime state used by the workflow. Preserve that user-authored setup so a
  // Native `new` does not create an unrelated dirty .gitignore in the middle
  // of a change; the managed block remains the migration path for broader
  // `.comet/` rules.
  if (
    inspection.exists &&
    !source.includes(MANAGED_BLOCK_START) &&
    hasLegacyCometRuntimeCoverage(source)
  ) {
    return;
  }
  const output = renderCometProjectGitignore(source);
  if (output === source) return;

  try {
    await atomicWriteContainedText(inspection.target, output, {
      containedRoot: root,
      exclusive: !inspection.exists,
      beforeCommit: inspection.exists
        ? async () => {
            const current = await readProtectedProjectFile(
              root,
              PROJECT_GITIGNORE_PATH,
              PROJECT_GITIGNORE_MAX_BYTES,
              { label: 'project .gitignore' },
            );
            if (!current.bytes.equals(sourceBytes)) {
              throw new Error('Project .gitignore changed before commit; rerun initialization');
            }
          }
        : async () => {
            const current = await inspectProtectedProjectPath(root, PROJECT_GITIGNORE_PATH, {
              label: 'project .gitignore',
              expected: 'file',
            });
            if (current.exists) {
              throw new Error('Project .gitignore was created before commit; rerun initialization');
            }
          },
    });
  } catch (error) {
    const concurrentCreation =
      error instanceof Error &&
      error.message === 'Project .gitignore was created before commit; rerun initialization';
    if (
      inspection.exists ||
      ((error as NodeJS.ErrnoException).code !== 'EEXIST' && !concurrentCreation)
    )
      throw error;
    const current = await readProtectedProjectFile(
      root,
      PROJECT_GITIGNORE_PATH,
      PROJECT_GITIGNORE_MAX_BYTES,
      { label: 'project .gitignore' },
    );
    const currentSource = Buffer.from(current.bytes).toString('utf8');
    if (
      renderCometProjectGitignore(currentSource) !== currentSource &&
      !hasLegacyCometRuntimeCoverage(currentSource)
    ) {
      throw error;
    }
  }

  // Re-resolve the final path so a replacement symlink or special file never
  // counts as a successful update.
  await inspectProtectedProjectPath(root, PROJECT_GITIGNORE_PATH, {
    label: 'project .gitignore',
    expected: 'file',
  });
  await fs.access(inspection.target);
}
