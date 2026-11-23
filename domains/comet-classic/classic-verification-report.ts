import path from 'node:path';

import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { resolveClassicLayout } from './classic-layout.js';
import { writeClassicProjectText } from './classic-protected-path.js';

export async function readClassicVerificationReport(
  projectRoot: string,
  ref: string,
): Promise<{ ref: string; content: string }> {
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
  return { ref: normalizedRef, content };
}

/** 读取已选验收报告；语言与结论由验收 Agent 核对。 */
export async function classicVerificationReportReceipt(
  projectRoot: string,
  ref: string,
  _language: 'en' | 'zh-CN' | null,
): Promise<{ ref: string }> {
  const report = await readClassicVerificationReport(projectRoot, ref);
  return { ref: report.ref };
}

const checksStart = '<!-- comet-check-results -->';
const checksEnd = '<!-- /comet-check-results -->';
const checksSection =
  /^<!-- comet-check-results -->\r?\n[\s\S]*?^<!-- \/comet-check-results -->(?=\r?$)/mu;

function tableCell(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\|]/gu, '\\$&')
    .replace(/\r?\n/gu, ' ');
}

export async function writeClassicVerificationChecks(
  projectRoot: string,
  report: { ref: string; content: string },
  result:
    | { checks?: readonly { name: string; result: string; note?: string }[]; checksReason?: string }
    | undefined,
  language: 'en' | 'zh-CN' | null,
): Promise<void> {
  if (!report.content.includes(checksStart)) return;
  if (!checksSection.test(report.content))
    throw new Error(`Close the generated checks section in ${report.ref} with ${checksEnd}.`);
  if (!result?.checks)
    throw new Error('The current Classic Verify Action has no recorded checks for this report.');
  const rows = result.checks.map(
    ({ name, result, note }) =>
      `| ${tableCell(name)} | ${tableCell(result)} | ${tableCell(note ?? '')} |`,
  );
  const table = rows.length
    ? [
        language === 'zh-CN' ? '| 检查 | 结果 | 说明 |' : '| Check | Result | Notes |',
        '| --- | --- | --- |',
        ...rows,
      ]
    : [];
  const eol = report.content.includes('\r\n') ? '\r\n' : '\n';
  const section = [
    checksStart,
    '',
    ...table,
    ...(result.checksReason ? [tableCell(result.checksReason)] : []),
    '',
    checksEnd,
  ].join(eol);
  const content = report.content.replace(checksSection, () => section);
  if (content !== report.content)
    await writeClassicProjectText(projectRoot, report.ref, content, {
      label: 'Classic Verify report',
    });
}
