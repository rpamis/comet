import path from 'path';

import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import { assertClassicLayoutReadable, classicProjectRelative } from './classic-layout.js';
import { assertOpenSpecChangeName } from './classic-paths.js';

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Read a historical handoff file after an OpenSpec archive was moved from the
 * legacy root into the configured docs archive. The persisted pointer remains
 * the evidence source; only its `.comet/` suffix is resolved against the
 * already-resolved archived change directory.
 */
export async function readLegacyArchivedHandoffFallback(
  projectRoot: string,
  changeDir: string,
  pointer: string,
  maxBytes: number,
): Promise<string | null> {
  const source = normalizeWorkflowRelativePath(pointer, 'Classic handoff artifact pointer');
  const original = await inspectProtectedProjectPath(projectRoot, source, {
    label: 'Classic handoff artifact',
    expected: 'file',
  });
  if (original.exists) return null;

  const match = /^openspec\/changes\/([^/]+)\/\.comet\/(.+)$/u.exec(source);
  if (!match) return null;
  const pointerChange = match[1];
  assertOpenSpecChangeName(pointerChange);

  const layout = await assertClassicLayoutReadable(projectRoot);
  const archivedChange = path.resolve(changeDir);
  if (path.dirname(archivedChange) !== path.resolve(layout.archiveDir)) return null;
  const archivedName = path.basename(archivedChange);
  const datedArchive = /^\d{4}-\d{2}-\d{2}-(.+)$/u.exec(archivedName);
  if (archivedName !== pointerChange && datedArchive?.[1] !== pointerChange) return null;
  await inspectProtectedProjectPath(
    projectRoot,
    classicProjectRelative(projectRoot, archivedChange),
    {
      label: 'Classic archived change directory',
      expected: 'directory',
    },
  );

  const mapped = path.join(archivedChange, '.comet', ...match[2].split('/'));
  const mappedRelative = classicProjectRelative(projectRoot, mapped);
  try {
    await readProtectedProjectFile(projectRoot, mappedRelative, maxBytes, {
      label: 'Historical Classic archived handoff artifact',
    });
    return mappedRelative;
  } catch (error) {
    if (isMissingPath(error)) return null;
    throw error;
  }
}
