import path from 'node:path';

import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { resolveClassicLayout } from './classic-layout.js';

/** 读取已选验收报告；语言与结论由验收 Agent 核对。 */
export async function classicVerificationReportReceipt(
  projectRoot: string,
  ref: string,
  _language: 'en' | 'zh-CN' | null,
): Promise<{ ref: string }> {
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
  return {
    ref: normalizedRef,
  };
}
