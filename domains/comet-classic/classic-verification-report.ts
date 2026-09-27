import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { classicDocumentLanguageMismatch } from './classic-document-language.js';
import { resolveClassicLayout } from './classic-layout.js';

/** Validate and fingerprint a Classic Verify report for SDK evidence submission. */
export async function classicVerificationReportReceipt(
  projectRoot: string,
  ref: string,
  language: 'en' | 'zh-CN' | null,
): Promise<{ ref: string; contentHash: string }> {
  const layout = await resolveClassicLayout(projectRoot);
  const report = await inspectProtectedProjectPath(projectRoot, ref, {
    label: 'Classic Verify report',
    expected: 'file',
  });
  const relative = path.relative(layout.superpowersReportsDir, report.target);
  if (
    !report.exists ||
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    relative.includes(path.sep) ||
    path.extname(relative).toLowerCase() !== '.md'
  ) {
    throw new Error('Classic Verify report is outside the configured reports directory');
  }
  const normalizedRef = report.relative.replaceAll('\\', '/');
  const file = await readProtectedProjectFile(projectRoot, normalizedRef, Number.MAX_SAFE_INTEGER, {
    label: 'Classic Verify report',
  });
  const content = file.bytes.toString('utf8');
  if (!content.trim()) throw new Error('Classic Verify report is empty');
  const languageIssue = language
    ? classicDocumentLanguageMismatch(content, language, normalizedRef)
    : null;
  if (languageIssue) throw new Error(languageIssue);
  return {
    ref: normalizedRef,
    contentHash: createHash('sha256').update(file.bytes).digest('hex'),
  };
}
