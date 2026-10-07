import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { WorkflowApplicationManifest } from './types.js';
import { applicationError, applicationFilesHash, readApplicationFiles } from './skill-adapter.js';
import {
  safeId,
  installedApplicationEntries,
  type InstalledApplication,
} from './installed-application.js';
import {
  workflowApplicationSkillsRoot,
  workflowApplicationPlatforms,
} from '../../platform/paths/workflow-application-skills.js';

/** 平台入口只由安装生命周期读取；普通 Run 查询不加载平台注册表。 */
export async function validateApplicationInstallEntries(
  root: string,
  value: InstalledApplication | null,
  scope: 'project' | 'user',
) {
  if (!value) return [];
  if (value.scope && value.scope !== scope) applicationError('安装记录作用域不匹配；核对原安装');
  if (value.entries && (!Array.isArray(value.entries) || !value.scope))
    applicationError('平台安装记录无效；保留文件并核对原安装');
  const entries = installedApplicationEntries(value);
  if (!entries.length) return entries;
  const base = path.dirname(path.dirname(root));
  const packageRoot = path.join(root, value.packageRef);
  const files = await readApplicationFiles(packageRoot);
  if (applicationFilesHash(files) !== value.contentHash)
    applicationError('安装记录与固定包不匹配；保留现场');
  const manifest = JSON.parse(
    Buffer.from(files['application.json'], 'base64').toString('utf8'),
  ) as WorkflowApplicationManifest;
  const expectedEntry = applicationInstallSkills(manifest, files, packageRoot)[0];
  const expectedHash = applicationFilesHash(expectedEntry.files);
  const roots = new Set<string>();
  const platforms = new Set<string>();
  for (const entry of entries) {
    if (
      !Array.isArray(entry.platforms) ||
      !entry.platforms.length ||
      !path.isAbsolute(entry.root ?? '') ||
      roots.has(entry.root) ||
      entry.contentHash !== expectedHash ||
      path.basename(entry.root) !== expectedEntry.name
    )
      applicationError('平台入口安装记录与固定包不匹配；保留用户文件');
    roots.add(entry.root);
    const ids = workflowApplicationPlatforms(entry.platforms);
    if (ids.length !== entry.platforms.length || entry.platforms.includes('all'))
      applicationError('平台入口安装记录无效');
    for (const id of ids) {
      const expected = path.join(
        workflowApplicationSkillsRoot({
          projectRoot: base,
          userRoot: base,
          scope,
          platform: id,
        }),
        expectedEntry.name,
      );
      if (entry.root !== expected || platforms.has(id)) applicationError('平台入口安装记录无效');
      platforms.add(id);
    }
  }
  return entries;
}

function skillName(markdown: string, fallback: string) {
  const frontmatter = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  const metadata = frontmatter ? parseYaml(frontmatter[1]) : null;
  return safeId(metadata?.name ?? fallback);
}
export function applicationInstallSkills(
  manifest: WorkflowApplicationManifest,
  files: Record<string, string>,
  packageRoot: string,
) {
  const entry = Buffer.from(files[manifest.entrySkill], 'base64').toString('utf8');
  const entryText =
    entry.replaceAll('<本目录>', packageRoot).replace(/\]\(([^\s)]+)\)/gu, (match, ref: string) => {
      if (/^(?:[a-z][a-z\d+.-]*:|#)/iu.test(ref)) return match;
      return `](${path.resolve(packageRoot, path.dirname(manifest.entrySkill), ref.split('#')[0]).replaceAll('\\', '/')}${ref.includes('#') ? '#' + ref.split('#').slice(1).join('#') : ''})`;
    }) +
    `\n固定应用资源目录：${packageRoot}。application.json、installation.json 与包内资源从该目录读取；查询和恢复仍使用当前应用身份与原 Run ID。\n`;
  const result: Array<{
    name: string;
    kind: 'entry' | 'dependency';
    files: Record<string, string>;
  }> = [
    {
      name: skillName(entry, manifest.id),
      kind: 'entry',
      files: {
        'SKILL.md': Buffer.from(entryText).toString('base64'),
      },
    },
  ];
  for (const dependency of manifest.skills) {
    const closure = Object.fromEntries(
      Object.entries(files)
        .filter(([ref]) => ref.startsWith(dependency.root + '/'))
        .map(([ref, bytes]) => [ref.slice(dependency.root.length + 1), bytes]),
    );
    const markdown = Buffer.from(closure['SKILL.md'], 'base64').toString('utf8');
    const name = skillName(markdown, path.basename(dependency.root));
    if (result.some((skill) => skill.name === name))
      applicationError(`宿主 Skill 名称冲突：${name}`);
    result.push({ name, kind: 'dependency', files: closure });
  }
  return result;
}
