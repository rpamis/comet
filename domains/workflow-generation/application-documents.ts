import path from 'node:path';
import { parseDocument } from 'yaml';
import { rewriteMarkdownResourceLinks } from '../workflow-application/index.js';
import { applicationError } from '../workflow-application/skill-adapter.js';

const ENTRY = 'SKILL.md';
const RULE = 'rules/workflow-guard.md';

/** Agent 文档与 Runtime 共用一个固定包，内容不被通用模板替换。 */
export function validateApplicationDocuments(
  documents: Readonly<Record<string, string>> | undefined,
  applicationId: string,
  reservedFiles: readonly string[],
): void {
  if (documents === undefined) return;
  if (!documents[ENTRY]?.trim() || !documents[RULE]?.trim())
    applicationError('应用文档必须包含非空 SKILL.md 和业务 Rule rules/workflow-guard.md');
  const seen: string[] = [];
  for (const [ref, content] of Object.entries(documents)) {
    if (
      !ref.endsWith('.md') ||
      ref.includes('\\') ||
      ref.includes(':') ||
      ref.includes('\0') ||
      path.posix.isAbsolute(ref) ||
      ref
        .split('/')
        .some(
          (part) =>
            !part || part === '.' || part === '..' || part.endsWith(' ') || part.endsWith('.'),
        )
    )
      applicationError(`应用文档路径无效：${ref}`);
    const normalized = ref.toLowerCase();
    if (normalized.startsWith('skills/')) applicationError(`应用文档路径与固定依赖冲突：${ref}`);
    for (const existing of [...seen, ...reservedFiles.map((file) => file.toLowerCase())]) {
      if (existing === normalized && (ref === ENTRY || ref === RULE) && !seen.includes(normalized))
        continue;
      if (
        existing === normalized ||
        existing.startsWith(normalized + '/') ||
        normalized.startsWith(existing + '/')
      )
        applicationError(`应用文档路径与包内文件冲突：${ref}`);
    }
    seen.push(normalized);
    if (content.includes('\0')) applicationError(`应用文档包含 NUL 空字符：${ref}`);
    if (!content.trim()) applicationError(`应用文档不能为空：${ref}`);
  }
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(documents[ENTRY]);
  if (!match) applicationError('应用 Skill 需要完整 frontmatter 元数据和正文');
  const metadata = parseDocument(match[1]);
  if (metadata.errors.length)
    applicationError('应用 Skill frontmatter 元数据必须是有效且没有重复键的 YAML');
  const value: unknown = metadata.toJS();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    applicationError('应用 Skill frontmatter 元数据必须是对象');
  const frontmatter = value as Record<string, unknown>;
  if (frontmatter.name !== applicationId)
    applicationError('应用 Skill name 必须与应用 manifest.id 一致');
  if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim())
    applicationError('应用 Skill description 描述不能为空');
  if (!match[2].trim()) applicationError('应用 Skill 正文不能为空');
}

/** 只核对固定包内资源，不读取宿主路径或访问外部网站。 */
export function validateApplicationDocumentLinks(
  documents: Readonly<Record<string, string>> | undefined,
  files: Readonly<Record<string, string>>,
): void {
  if (!documents) return;
  for (const [ref, original] of Object.entries(documents)) {
    rewriteMarkdownResourceLinks(original, (link) => {
      if (/^(?:[a-z][a-z\d+.-]*:|#)/iu.test(link)) {
        if (/^file:/iu.test(link)) applicationError(`应用文档资源链接不能指向宿主文件：${ref}`);
        return link;
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(link.split(/[?#]/u)[0]);
      } catch {
        applicationError(`应用文档资源链接编码无效：${ref}`);
      }
      if (!decoded) return link;
      if (
        decoded.includes('\\') ||
        decoded.includes('\0') ||
        path.posix.isAbsolute(decoded) ||
        path.win32.isAbsolute(decoded)
      )
        applicationError(`应用文档资源链接越过固定包：${ref} -> ${link}`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(ref), decoded));
      if (target === '..' || target.startsWith('../'))
        applicationError(`应用文档资源链接越过固定包：${ref} -> ${link}`);
      if (
        !Object.hasOwn(files, target) &&
        !Object.keys(files).some((file) => file.startsWith(target.replace(/\/$/u, '') + '/'))
      )
        applicationError(`应用文档引用资源缺失：${ref} -> ${link}`);
      return link;
    });
  }
}
