import path from 'path';
import { promises as fs } from 'fs';
import { atomicWriteContainedText } from './contained-atomic-write.js';
import { readWorkflowProjectConfigDocument } from './project-config-reader.js';
import { inspectProtectedProjectPath, readProtectedProjectFile } from './protected-project-path.js';
import {
  normalizeWalkthroughDiagrams,
  renderWalkthroughDiagrams,
  type WalkthroughDiagram,
} from './change-walkthrough-diagram.js';

type Verification = {
  label: string;
  status: 'passed' | 'failed' | 'not-run' | 'unknown';
  detail: string;
};
type Change = {
  title: string;
  before: string;
  after: string;
  reason: string;
  files: Array<{ path: string; kind: 'added' | 'modified' | 'deleted' | 'renamed'; code: string }>;
};
type Walkthrough = {
  summary: string;
  scope: string;
  changes: Change[];
  verification: Verification[];
  diagrams?: WalkthroughDiagram[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('walkthrough content must be an object');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('walkthrough fields must be non-empty text');
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error('walkthrough changes, files and verification must be arrays');
  return value;
}
function verification(value: unknown): Verification[] {
  return list(value).map((value) => {
    const item = record(value);
    if (!['passed', 'failed', 'not-run', 'unknown'].includes(String(item.status)))
      throw new Error('Invalid walkthrough verification status');
    return {
      label: text(item.label),
      status: item.status as Verification['status'],
      detail: text(item.detail),
    };
  });
}
function content(value: unknown): Walkthrough {
  const data = record(value);
  const changes = list(data.changes).map((value) => {
    const item = record(value);
    const files = list(item.files).map((value) => {
      const file = record(value);
      if (!['added', 'modified', 'deleted', 'renamed'].includes(String(file.kind)))
        throw new Error('Invalid walkthrough file kind');
      return {
        path: text(file.path),
        kind: file.kind as Change['files'][number]['kind'],
        code: text(file.code),
      };
    });
    return {
      title: text(item.title),
      before: text(item.before),
      after: text(item.after),
      reason: text(item.reason),
      files,
    };
  });
  if (!changes.length) throw new Error('walkthrough needs at least one change');
  const diagrams = normalizeWalkthroughDiagrams(
    data.diagrams,
    new Set(changes.flatMap((change) => change.files.map((file) => file.path))),
  );
  return {
    summary: text(data.summary),
    scope: text(data.scope),
    changes,
    verification: verification(data.verification),
    ...(diagrams === undefined ? {} : { diagrams }),
  };
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** A fixed, offline template. All Agent-provided content is displayed as text. */
export function renderChangeWalkthrough(
  value: unknown,
  language = 'en',
  generatedAt = new Date().toISOString(),
): string {
  const data = content(value);
  const zh = language === 'zh-CN';
  const labels = zh
    ? {
        title: '变更说明',
        before: '原来',
        after: '现在',
        reason: '原因',
        files: '查看文件和关键代码',
        verification: '实际验证',
        scope: '比较范围',
        generated: '生成时间',
        more: '其余变化',
        empty: '尚未提供验证结果',
        passed: '通过',
        failed: '失败',
        'not-run': '未执行',
        unknown: '未知',
        added: '新增',
        modified: '修改',
        deleted: '删除',
        renamed: '重命名',
        diagramHint: '点击带链接的节点查看相关代码。',
      }
    : {
        title: 'Change walkthrough',
        before: 'Before',
        after: 'After',
        reason: 'Why',
        files: 'Files and key code',
        verification: 'Actual verification',
        scope: 'Comparison scope',
        generated: 'Generated',
        more: 'More changes',
        empty: 'No verification results provided',
        passed: 'Passed',
        failed: 'Failed',
        'not-run': 'Not run',
        unknown: 'Unknown',
        added: 'Added',
        modified: 'Modified',
        deleted: 'Deleted',
        renamed: 'Renamed',
        diagramHint: 'Follow linked nodes to the related code.',
      };
  const fileId = (change: number, file: number) => `walkthrough-file-${change}-${file}`;
  const files = new Map<string, string>();
  data.changes.forEach((change, index) =>
    change.files.forEach((file, fileIndex) => {
      if (!files.has(file.path)) files.set(file.path, fileId(index, fileIndex));
    }),
  );
  const card = (change: Change, index: number) =>
    `<article><header><span class="number">${String(index + 1).padStart(2, '0')}</span><h2>${escape(change.title)}</h2></header><div class="comparison"><section><h3>${labels.before}</h3><p>${escape(change.before)}</p></section><section class="after"><h3>${labels.after}</h3><p>${escape(change.after)}</p></section></div><p class="reason"><strong>${labels.reason}</strong> ${escape(change.reason)}</p><details><summary>${labels.files} <span class="count">${change.files.length}</span></summary>${change.files.map((file, fileIndex) => `<div class="file" id="${fileId(index, fileIndex)}"><div class="file-heading"><span class="tag">${labels[file.kind]}</span><code>${escape(file.path)}</code></div><pre><code>${escape(file.code)}</code></pre></div>`).join('')}</details></article>`;
  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${labels.title} · ${escape(data.summary)}</title>
<style>
:root {
  color-scheme: light dark;
  --page: #fafbfc;
  --ink: #202a35;
  --muted: #566575;
  --line: #dbe2e8;
  --accent: #245b85;
  --highlight: #edf3f7;
  --hover: #e9eef3;
  --code-bg: #edf0f4;
  --code-ink: #263443;
  --success: #236d4f;
  --failure: #a83131;
  --text: 15px;
  --small: 13px;
  --label: 12px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #181d23;
    --ink: #e4eaf0;
    --muted: #a4b1be;
    --line: #35404b;
    --accent: #94c6ec;
    --highlight: #222e39;
    --hover: #27323d;
    --code-bg: #10161d;
    --code-ink: #e0e8f0;
    --success: #8ed8b5;
    --failure: #ffb0a8;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font: var(--text)/1.65 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 1040px; margin: auto; padding: 32px 32px 48px; }
.eyebrow { color: var(--accent); font-size: var(--label); font-weight: 500; letter-spacing: .08em; }
h1 { margin: 8px 0 12px; max-width: 32em; font-size: 28px; font-weight: 500; line-height: 1.4; letter-spacing: -.02em; overflow-wrap: anywhere; }
h2 { margin: 0; font-size: 18px; font-weight: 500; line-height: 1.5; overflow-wrap: anywhere; }
h3 { margin: 0 0 4px; color: var(--muted); font-size: var(--label); font-weight: 500; }
p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
strong { font-weight: 500; }
.meta { margin-bottom: 24px; color: var(--muted); font-size: var(--small); overflow-wrap: anywhere; }
.meta p + p { margin-top: 2px; }
article { padding: 20px 0 12px; border-top: 1px solid var(--line); }
article header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.number { color: var(--muted); font: var(--label)/1.5 ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
.comparison { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.comparison section { min-width: 0; padding: 12px; }
.after { background: var(--highlight); border-radius: 4px; }
.after h3 { color: var(--accent); }
.reason { margin-top: 12px; font-size: var(--small); color: var(--muted); }
.reason strong { margin-right: 8px; color: var(--ink); }
summary { min-height: 44px; padding: 10px 4px; cursor: pointer; font-size: var(--small); font-weight: 500; border-radius: 4px; }
summary:hover { background: var(--hover); }
summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.count, .tag { color: var(--muted); font-size: var(--label); font-weight: 400; }
.count { margin-left: 4px; font-variant-numeric: tabular-nums; }
.file { min-width: 0; padding: 0 0 16px; scroll-margin-top: 20px; }
.file:target { outline: 2px solid var(--accent); outline-offset: 4px; }
.file-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.file-heading code { min-width: 0; font-size: var(--small); overflow-wrap: anywhere; }
.tag { white-space: nowrap; }
pre { margin: 8px 0 0; padding: 12px 16px; overflow: auto; background: var(--code-bg); color: var(--code-ink); border-radius: 4px; font: var(--small)/1.65 ui-monospace, Consolas, monospace; tab-size: 2; }
footer { margin-top: 12px; padding-top: 20px; border-top: 1px solid var(--line); }
footer h2 { margin-bottom: 8px; }
.check { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.status { padding-top: 2px; font-size: var(--label); font-weight: 500; }
.passed { color: var(--success); }
.failed { color: var(--failure); }
.not-run, .unknown { color: var(--muted); }
.check p { margin-top: 2px; color: var(--muted); font-size: var(--small); }
.more { border-top: 1px solid var(--line); }
.more > summary { padding-block: 12px; }
.diagram { margin: 0; padding: 20px 0; border-top: 1px solid var(--line); }
.diagram figcaption { margin-bottom: 12px; font-size: 18px; font-weight: 500; overflow-wrap: anywhere; }
.diagram-svg { display: block; max-width: 100%; height: auto; margin: auto; overflow: visible; font: 13px system-ui, -apple-system, "Segoe UI", sans-serif; }
.diagram-svg text { fill: var(--ink); }
.diagram-edge { fill: none; stroke: var(--muted); stroke-width: 1.5; }
.diagram-svg marker path { fill: var(--muted); }
.diagram-edge-label { fill: var(--page); }
.diagram-svg .diagram-edge-text { fill: var(--muted); font-size: 12px; }
.diagram-node rect { fill: var(--page); stroke: var(--line); stroke-width: 1.5; }
.diagram-node.modified rect { fill: var(--highlight); stroke: var(--accent); }
.diagram-node.added rect { stroke: var(--success); }
.diagram-node.deleted rect { stroke: var(--failure); stroke-dasharray: 4 3; }
.diagram-svg .diagram-kind { fill: var(--muted); font-size: 11px; }
.diagram-node[href] { cursor: pointer; }
.diagram-node[href]:hover rect, .diagram-node[href]:focus-visible rect { stroke: var(--accent); stroke-width: 2.5; }
.diagram-node[href]:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.diagram-hint { margin-top: 12px; color: var(--muted); font-size: var(--small); text-align: center; }
.diagram-comparison { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; }
.diagram-comparison > section { min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 4px; }
.diagram-comparison > section > h3 { margin-bottom: 12px; }
.diagram-compact { display: none; }
@media (max-width: 999px) {
  .diagram-wide { display: none; }
  .diagram-compact { display: block; }
}
@media (max-width: 640px) {
  main { padding: 24px 16px 32px; }
  h1 { font-size: 24px; }
  .meta { margin-bottom: 20px; }
  article { padding-top: 16px; }
  article header { gap: 8px; }
  .comparison { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .check { grid-template-columns: 60px minmax(0, 1fr); gap: 8px; }
  pre { padding: 12px; }
  .diagram-comparison { grid-template-columns: minmax(0,1fr); }
  .diagram-comparison > section { padding: 12px 0; border: 0; }
}
</style></head><body><main><div class="eyebrow">COMET / ${labels.title}</div><h1>${escape(data.summary)}</h1><div class="meta"><p>${labels.scope} · ${escape(data.scope)}</p><p>${labels.generated} · ${escape(generatedAt)}</p></div>${renderWalkthroughDiagrams(data.diagrams, files, labels)}${data.changes.slice(0, 3).map(card).join('')}${
    data.changes.length > 3
      ? `<details class="more"><summary>${labels.more} (${data.changes.length - 3})</summary><div>${data.changes
          .slice(3)
          .map((change, i) => card(change, i + 3))
          .join('')}</div></details>`
      : ''
  }<footer><h2>${labels.verification}</h2>${data.verification.length ? data.verification.map((item) => `<div class="check"><span class="status ${item.status}">${labels[item.status]}</span><div><strong>${escape(item.label)}</strong><p>${escape(item.detail)}</p></div></div>`).join('') : `<p>${labels.empty}</p>`}</footer></main><template id="walkthrough-data">${Buffer.from(JSON.stringify(data)).toString('base64')}</template></body></html>\n`;
}

/** Presentation only: never calls workflow advancement, checks, or model services. */
export async function writeChangeWalkthrough(
  projectRoot: string,
  workflow: 'native' | 'classic',
  change: string,
  inputFile: string,
  verificationOnly = false,
): Promise<{ enabled: boolean; path?: string }> {
  const document = await readWorkflowProjectConfigDocument(projectRoot, {
    allowPartialProject: true,
  });
  if (!document?.change_walkthrough) return { enabled: false };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(change) || change === 'archive')
    throw new Error('Invalid walkthrough change name');
  const directory =
    workflow === 'native'
      ? path.join(document.native?.artifact_root ?? 'docs', 'comet', 'changes', change)
      : path.join(
          document.classic?.artifact_layout === 'docs' ? 'docs' : '',
          'openspec',
          'changes',
          change,
        );
  if (workflow === 'native' && !document.native)
    throw new Error('Native project config is missing');
  const inspected = await inspectProtectedProjectPath(projectRoot, directory, {
    expected: 'directory',
    label: 'walkthrough change directory',
  });
  if (!inspected.exists) throw new Error('walkthrough change directory does not exist');
  const ref = path.join(directory, 'walkthrough.html');
  const input = JSON.parse(
    await fs.readFile(path.resolve(projectRoot, inputFile), 'utf8'),
  ) as unknown;
  let value = input;
  if (verificationOnly) {
    const page = await readProtectedProjectFile(projectRoot, ref, Number.MAX_SAFE_INTEGER, {
      label: 'walkthrough.html',
    });
    const saved = /<template id="walkthrough-data">([A-Za-z0-9+/=]+)<\/template>/u.exec(
      page.bytes.toString('utf8'),
    );
    if (!saved) throw new Error('walkthrough.html has no reusable content; regenerate the page');
    value = {
      ...content(JSON.parse(Buffer.from(saved[1]!, 'base64').toString('utf8'))),
      verification: verification(record(input).verification),
    };
  }
  const html = renderChangeWalkthrough(
    value,
    workflow === 'native' ? document.native?.language : document.classic?.language,
  );
  const target = path.resolve(projectRoot, ref);
  await atomicWriteContainedText(target, html, { containedRoot: projectRoot });
  return { enabled: true, path: target };
}
