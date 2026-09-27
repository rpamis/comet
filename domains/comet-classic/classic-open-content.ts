import path from 'node:path';

import { classicDocumentLanguageMismatch } from './classic-document-language.js';
import { classicProjectTargetExists, readClassicProjectFile } from './classic-protected-path.js';
import { parseClassicTasks } from './classic-tasks.js';

/** Validate content rules shared by Guard and direct SDK evidence. */
export async function classicOpenContentProblem(
  projectRoot: string,
  changeDirRef: string,
  language: string | null,
): Promise<string | null> {
  if (language !== 'en' && language !== 'zh-CN') return 'Classic change language is not set';
  const changeRef = changeDirRef.replaceAll('\\', '/');
  for (const filename of ['proposal.md', 'tasks.md', 'design.md']) {
    const file = path.posix.join(changeRef, filename);
    if (
      filename === 'design.md' &&
      !(await classicProjectTargetExists(projectRoot, file, { label: 'Classic Open design' }))
    )
      continue;
    const source = await readClassicProjectFile(projectRoot, file, {
      label: `Classic Open ${filename}`,
    });
    const languageIssue = classicDocumentLanguageMismatch(source, language, file);
    if (languageIssue) return languageIssue;
    if (filename === 'tasks.md' && parseClassicTasks(source).length === 0) {
      return 'tasks.md has no task';
    }
  }
  return null;
}
