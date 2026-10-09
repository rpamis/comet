import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { hashRuntimeValue, RuntimeProtocolError, type RuntimeValue } from '../engine/runtime.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import type { AdaptedSkill, ApplicationSkillDependency, InspectedSkill } from './types.js';

export function applicationError(message: string): never {
  throw new RuntimeProtocolError(
    'INVALID_WORKFLOW',
    `${message}；请修正适配契约或恢复已固定的依赖后继续`,
  );
}

/** 读取整个依赖目录，固定所有脚本和资源；不改写第三方文件。 */
export async function readApplicationFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (relative: string) => {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const ref = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) applicationError(`依赖不允许符号链接：${ref}`);
      if (entry.isDirectory()) await walk(ref);
      else if (entry.isFile()) {
        const bytes = await readProtectedProjectFile(root, ref, 16 * 1024 * 1024, {
          label: `应用依赖 ${ref}`,
        });
        files[ref] = bytes.bytes.toString('base64');
      } else applicationError(`依赖包含非常规文件：${ref}`);
    }
  };
  await walk('');
  if (Object.keys(files).length === 0) applicationError('依赖目录为空');
  return files;
}

export function applicationFilesHash(files: Readonly<Record<string, string>>): string {
  return hashRuntimeValue(
    Object.fromEntries(
      Object.entries(files).map(([ref, bytes]) => [
        ref,
        createHash('sha256').update(Buffer.from(bytes, 'base64')).digest('hex'),
      ]),
    ),
  );
}

function textFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([ref, bytes]) => [
      ref,
      Buffer.from(bytes, 'base64').toString('utf8'),
    ]),
  );
}

/** 代码块中的路径属于示例；完整原文仍参与依赖摘要。 */
function markdownOutsideCodeBlocks(content: string): string {
  let fence: { marker: string; length: number } | undefined;
  return content
    .split(/\r?\n/u)
    .map((line) => {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (fence) {
        if (
          match &&
          match[1][0] === fence.marker &&
          match[1].length >= fence.length &&
          !match[2].trim()
        )
          fence = undefined;
        return '';
      }
      if (match && (match[1][0] !== '`' || !match[2].includes('`'))) {
        fence = { marker: match[1][0], length: match[1].length };
        return '';
      }
      return line;
    })
    .join('\n');
}

/** 能力判定交给有内容证据的审查；文件发现不根据 Skill 名称猜能力。 */
export async function inspectApplicationSkill(root: string): Promise<InspectedSkill> {
  const realRoot = await fs.realpath(root);
  const bytes = await readApplicationFiles(realRoot);
  const files = textFiles(bytes);
  if (!files['SKILL.md']?.trim()) applicationError(`Skill 缺少真实 SKILL.md：${root}`);
  for (const [ref, content] of Object.entries(files)) {
    if (!ref.endsWith('.md')) continue;
    // 本地 Markdown 引用必须可读取；完整目录摘要同时固定未直接链接的脚本和资源。
    const links = [
      ...markdownOutsideCodeBlocks(content).matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/gu),
    ].map((match) => match[1]);
    for (const link of links) {
      if (/^(?:[a-z][a-z\d+.-]*:|#)/iu.test(link)) continue;
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(ref), decodeURIComponent(link.split('#')[0])),
      );
      if (target.startsWith('../') || path.posix.isAbsolute(target))
        applicationError(`Skill 引用越过依赖目录：${ref} -> ${link}`);
      if (
        !Object.hasOwn(files, target) &&
        !Object.keys(files).some((file) => file.startsWith(`${target}/`))
      )
        applicationError(`Skill 引用资源缺失：${ref} -> ${link}`);
    }
  }
  return { root: realRoot, files, contentHash: applicationFilesHash(bytes) };
}

export async function adaptApplicationSkill(
  dependency: ApplicationSkillDependency,
  packageRoot: string,
): Promise<AdaptedSkill> {
  if (
    !dependency ||
    typeof dependency.id !== 'string' ||
    !dependency.id.trim() ||
    typeof dependency.root !== 'string'
  )
    applicationError('Skill 依赖缺少身份或目录');
  const inspected = await inspectApplicationSkill(path.resolve(packageRoot, dependency.root));
  if (dependency.contentHash !== inspected.contentHash)
    applicationError(`Skill 内容发生漂移：${dependency.id}`);
  const adapter = dependency.adapter;
  if (
    !adapter ||
    !['guidance', 'action', 'check', 'subworkflow'].includes(adapter.kind) ||
    !['read', 'write', 'external'].includes(adapter.sideEffect) ||
    !['none', 'user'].includes(adapter.interaction) ||
    !['self-report', 'machine-check', 'independent-review'].includes(adapter.completion) ||
    !['stop', 'repair', 'retry'].includes(adapter.failure) ||
    !['manual', 'reconcile'].includes(adapter.recovery) ||
    typeof adapter.controlsApproval !== 'boolean'
  )
    applicationError(`Skill 适配契约不完整：${dependency.id}`);
  if (
    !Array.isArray(adapter.scope) ||
    !adapter.scope.length ||
    adapter.scope.some((scope) => typeof scope !== 'string' || !scope.trim()) ||
    !Array.isArray(adapter.requiredCapabilities) ||
    adapter.requiredCapabilities.some(
      (capability) => typeof capability !== 'string' || !capability.trim(),
    )
  )
    applicationError(`Skill 缺少范围或宿主能力：${dependency.id}`);
  if (
    adapter.kind === 'guidance' &&
    (adapter.sideEffect !== 'read' || adapter.controlsApproval || adapter.interaction !== 'none')
  )
    applicationError(`有副作用或审批逻辑的 Skill 不能作为普通指导：${dependency.id}`);
  if (adapter.sideEffect === 'external' && adapter.recovery !== 'reconcile')
    applicationError(`外部操作缺少未知结果核对契约：${dependency.id}`);
  const review = adapter.review;
  if (
    !review ||
    review.status !== 'accepted' ||
    !review.reviewedBy?.trim() ||
    review.contentHash !== inspected.contentHash ||
    !Array.isArray(review.capabilities) ||
    !review.capabilities.length ||
    !Array.isArray(review.effects) ||
    !review.effects.length
  )
    applicationError(`Skill 必需能力尚未完成内容适配审查：${dependency.id}`);
  for (const evidence of [...review.capabilities, ...review.effects]) {
    if (
      !evidence ||
      !evidence.excerpt?.trim() ||
      !inspected.files[evidence.file]?.includes(evidence.excerpt)
    )
      applicationError(`Skill 审查证据与真实文件不匹配：${dependency.id}`);
  }
  if (
    review.capabilities.some(
      (capability) => typeof capability.id !== 'string' || !capability.id.trim(),
    )
  )
    applicationError(`Skill 能力证据缺少身份：${dependency.id}`);
  const ajv = new Ajv({ strict: true, allErrors: true });
  const compile = (schema: RuntimeValue, label: string) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema))
      applicationError(`${label} 必须提供可检查的 JSON Schema`);
    if (schema.$async === true)
      applicationError(`${label} 不支持异步 Schema，请注册实际 SDK 验证器`);
    const validate = ajv.compile(schema);
    return (value: RuntimeValue) => {
      if (!validate(value))
        applicationError(`${dependency.id} ${label} 不匹配：${ajv.errorsText(validate.errors)}`);
    };
  };
  return {
    ...inspected,
    id: dependency.id,
    adapter,
    validateInput: compile(adapter.inputSchema, '输入'),
    validateOutput: compile(adapter.outputSchema, '输出'),
  };
}
