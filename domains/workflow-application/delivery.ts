import path from 'node:path';
import { promises as fs } from 'node:fs';
import { hashRuntimeValue } from '../engine/runtime.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { workflowApplicationStorageRoot } from '../../platform/paths/workflow-application-storage.js';
import {
  workflowApplicationSkillsRoot,
  workflowApplicationPlatforms,
  workflowApplicationPlatformInfo,
} from '../../platform/paths/workflow-application-skills.js';

import { ensureApplicationRuntimeDependency } from '../../platform/install/application-runtime.js';
import { loadWorkflowApplication, parseWorkflowApplicationManifest } from './application.js';
import {
  adaptApplicationSkill,
  applicationError,
  applicationFilesHash,
  readApplicationFiles,
} from './skill-adapter.js';
import {
  readInstalled,
  safeId,
  inspectStorage,
  ensureStorage,
  type InstalledApplication,
} from './installed-application.js';
import { applicationInstallSkills, validateApplicationInstallEntries } from './install-record.js';
import { getCurrentVersion } from '../../platform/version/version.js';

export interface ApplicationDeliveryOptions {
  projectRoot: string;
  scope: 'project' | 'user';
  /** 隔离安装或非默认用户目录；不改变当前用户配置。 */
  userRoot?: string;
  host?: 'codex' | 'claude-code';
  /** 使用 Comet 平台身份；all 表示全部已注册平台。 */
  platforms?: string[];
}

export interface ApplicationInstallPreview {
  schema: 'comet.workflow.application.preview.v1';
  id: string;
  version: string;
  scope: 'project' | 'user';
  target: string;
  source: string;
  contentHash: string;
  previous: InstalledApplication | null;
  files: string[];
  dependencies: Array<{ id: string; contentHash: string }>;
  operation: 'install' | 'upgrade' | 'unchanged';
  retainedVersions: true;
  noFilesWritten: true;
  hostSkills: Array<{
    name: string;
    root: string;
    contentHash: string;
    kind: 'entry' | 'dependency';
    operation: 'create' | 'replace' | 'unchanged';
    platforms: string[];
  }>;
  platforms: Array<{
    id: string;
    name: string;
    skillsRoot: string;
    rulesSupported: boolean;
    hooksSupported: boolean;
  }>;
  requiredCapabilities: string[];
  confirmationHash: string;
}

async function completePackage(file: string, projectRoot: string) {
  if (path.basename(file) !== 'application.json')
    applicationError('应用入口文件必须命名为 application.json');
  const packageRoot = await fs.realpath(path.dirname(path.resolve(file)));
  if (packageRoot === (await fs.realpath(projectRoot))) applicationError('应用包需要独立目录');
  const files = await readApplicationFiles(packageRoot);
  const manifest = parseWorkflowApplicationManifest(
    JSON.parse(Buffer.from(files['application.json'] ?? '', 'base64').toString('utf8')),
  );
  if (manifest.runtimeVersion !== getCurrentVersion())
    applicationError(`应用要求 Runtime ${manifest.runtimeVersion}，当前是 ${getCurrentVersion()}`);
  if (!files[manifest.entrySkill] || !files[manifest.module])
    applicationError('应用入口 Skill 或执行模块缺失');
  for (const dependency of manifest.skills) {
    if (
      path.isAbsolute(dependency.root) ||
      dependency.root.includes('\\') ||
      dependency.root.split('/').includes('..')
    )
      applicationError('完整导出包的 Skill 依赖必须保存在包内；重新编译固定依赖');
    if (!Object.keys(files).some((ref) => ref.startsWith(`${dependency.root}/`)))
      applicationError(`导出包缺少依赖：${dependency.id}`);
    await adaptApplicationSkill(dependency, packageRoot);
  }
  return { manifest, packageRoot, files, contentHash: applicationFilesHash(files) };
}

/** 预览只读取内容，不写目标；同版本内容变化和未选择的同名覆盖均拒绝。 */
export async function previewWorkflowApplicationInstall(
  options: ApplicationDeliveryOptions & { file: string; upgrade?: boolean },
): Promise<ApplicationInstallPreview> {
  if (options.host && options.platforms?.length)
    applicationError('host 与 platforms 不能同时使用；请选择 Comet 平台身份');
  const { manifest, packageRoot, files, contentHash } = await completePackage(
    options.file,
    options.projectRoot,
  );
  const root = workflowApplicationStorageRoot(options.projectRoot, options.scope, options.userRoot);
  const previous = await readInstalled(root, manifest.id);
  if (
    previous &&
    previous.contentHash !== contentHash &&
    (!options.upgrade || previous.version === manifest.version)
  )
    applicationError(
      previous.version === manifest.version
        ? '相同版本内容冲突；使用新版本，原 Run 不迁移'
        : '同名应用已安装；明确选择 upgrade 后重新预览',
    );
  const legacy = await inspectStorage(root, `${manifest.id}/application.json`, 'file');
  if (legacy.exists) applicationError('目标存在非托管应用；选择其他位置并保留用户文件');
  const previousEntries = await validateApplicationInstallEntries(root, previous, options.scope);
  if (previousEntries.length && !options.host && !options.platforms?.length)
    applicationError('升级需保留原平台入口；指定 platform 后重新预览');
  const requested =
    options.platforms ??
    (options.host ? [options.host === 'claude-code' ? 'claude' : options.host] : []);
  const ids = workflowApplicationPlatforms([
    ...requested,
    ...previousEntries.flatMap((entry) => entry.platforms),
  ]);
  const platforms = ids.map((id) => ({
    ...workflowApplicationPlatformInfo(id),
    skillsRoot: workflowApplicationSkillsRoot({ ...options, platform: id }),
  }));
  const hostSkills: ApplicationInstallPreview['hostSkills'] = [];
  for (const platform of platforms) {
    const skillsRoot = platform.skillsRoot;
    for (const skill of applicationInstallSkills(
      manifest,
      files,
      path.join(root, manifest.id, 'versions', contentHash),
    )) {
      const skillRoot = path.join(skillsRoot, skill.name);
      const expected = applicationFilesHash(skill.files);
      const shared = hostSkills.find((entry) => entry.root === skillRoot);
      if (shared) {
        if (shared.contentHash !== expected)
          applicationError(`共享平台目录内容冲突：${skill.name}`);
        shared.platforms.push(platform.id);
        continue;
      }
      const previousEntry = previousEntries.find((entry) => entry.root === skillRoot);
      let operation: 'create' | 'replace' | 'unchanged' = 'create';
      if ((await inspectStorage(skillsRoot, skill.name, 'directory')).exists) {
        const actual = applicationFilesHash(await readApplicationFiles(skillRoot));
        if (skill.kind === 'entry' && !previousEntry)
          applicationError(`宿主入口已存在且不属于此安装：${skill.name}；保留用户文件`);
        if (actual === expected) operation = 'unchanged';
        else if (skill.kind === 'entry' && previousEntry?.contentHash === actual)
          operation = 'replace';
        else applicationError(`宿主 Skill 同名内容冲突：${skill.name}；保留原文件和版本`);
      }
      hostSkills.push({
        name: skill.name,
        kind: skill.kind,
        root: skillRoot,
        contentHash: expected,
        operation,
        platforms: [platform.id],
      });
    }
  }
  if (
    previousEntries.some(
      (old) => !hostSkills.some((entry) => entry.kind === 'entry' && entry.root === old.root),
    )
  )
    applicationError('升级不能变更原平台目录；核对作用域和平台配置');
  const preview = {
    schema: 'comet.workflow.application.preview.v1' as const,
    id: manifest.id,
    version: manifest.version,
    scope: options.scope,
    target: root,
    source: packageRoot,
    contentHash,
    previous,
    files: Object.keys(files),
    dependencies: manifest.skills.map(({ id, contentHash }) => ({ id, contentHash })),
    operation: previous
      ? previous.contentHash === contentHash
        ? ('unchanged' as const)
        : ('upgrade' as const)
      : ('install' as const),
    retainedVersions: true as const,
    noFilesWritten: true as const,
    hostSkills,
    platforms,
    requiredCapabilities: [
      ...new Set(manifest.skills.flatMap(({ adapter }) => adapter.requiredCapabilities)),
    ].sort(),
  };
  return { ...preview, confirmationHash: hashRuntimeValue(preview) };
}

async function copyPackage(files: Record<string, string>, destination: string) {
  await ensureStorage(destination, '.');
  for (const [ref, bytes] of Object.entries(files)) {
    if (path.posix.dirname(ref) !== '.') await ensureStorage(destination, path.posix.dirname(ref));
    await fs.writeFile(path.join(destination, ref), Buffer.from(bytes, 'base64'), { flag: 'wx' });
  }
}

async function withInstallLock<T>(
  root: string,
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  await ensureStorage(root, safeId(id));
  const file = path.join(root, id, 'operation.lock');
  let handle;
  try {
    handle = await fs.open(file, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      applicationError('安装或卸载正在执行，或上次操作中断；核对原现场后继续');
    throw error;
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await fs.unlink(file);
  }
}

/** 只接受当前预览。发布默认入口前固定完整版本；升级不写任何 Run。 */
export async function installWorkflowApplication(
  options: ApplicationDeliveryOptions & {
    file: string;
    upgrade?: boolean;
    confirmationHash: string;
  },
) {
  const preview = await previewWorkflowApplicationInstall(options);
  if (options.confirmationHash !== preview.confirmationHash)
    applicationError('安装预览已变化；重新预览并确认');
  return withInstallLock(preview.target, preview.id, async () => {
    const latest = await previewWorkflowApplicationInstall(options);
    if (latest.confirmationHash !== preview.confirmationHash)
      applicationError('安装预览已变化；重新预览并确认');
    const packageRef = `${preview.id}/versions/${preview.contentHash}`;
    const destination = path.join(preview.target, packageRef);
    await ensureStorage(preview.target, `${preview.id}/versions`);
    if ((await inspectStorage(preview.target, packageRef, 'directory')).exists) {
      if (applicationFilesHash(await readApplicationFiles(destination)) !== preview.contentHash)
        applicationError('原安装现场不完整或发生变化；保留现场后修复，不覆盖');
    } else {
      await copyPackage(await readApplicationFiles(preview.source), destination);
    }
    if (applicationFilesHash(await readApplicationFiles(destination)) !== preview.contentHash)
      applicationError('安装期间源包发生变化；保留现场并重新核对');
    await ensureApplicationRuntimeDependency(preview.target);
    await loadWorkflowApplication({
      file: path.join(destination, 'application.json'),
      projectRoot: options.projectRoot,
    });
    if (preview.platforms.length) {
      const pkg = await completePackage(
        path.join(destination, 'application.json'),
        options.projectRoot,
      );
      const skills = applicationInstallSkills(pkg.manifest, pkg.files, destination);
      for (const entry of preview.hostSkills) {
        const skill = skills.find((skill) => skill.name === entry.name)!;
        if (entry.operation === 'create') await copyPackage(skill.files, entry.root);
        else if (entry.operation === 'replace')
          await atomicWriteContainedText(
            path.join(entry.root, 'SKILL.md'),
            Buffer.from(skill.files['SKILL.md'], 'base64').toString('utf8'),
            { containedRoot: entry.root },
          );
        if (applicationFilesHash(await readApplicationFiles(entry.root)) !== entry.contentHash)
          applicationError('宿主入口或依赖在安装时发生变化；保留现场');
      }
      for (const skillsRoot of new Set(preview.platforms.map(({ skillsRoot }) => skillsRoot)))
        await ensureApplicationRuntimeDependency(skillsRoot);
    }
    const record: InstalledApplication = {
      schema: 'comet.workflow.application.install.v1',
      id: preview.id,
      version: preview.version,
      contentHash: preview.contentHash,
      packageRef,
      scope: options.scope,
      entries: preview.hostSkills
        .filter(({ kind }) => kind === 'entry')
        .map(({ root, contentHash, platforms }) => ({ root, contentHash, platforms })),
    };
    await atomicWriteContainedText(
      path.join(preview.target, preview.id, 'current.json'),
      JSON.stringify(record, null, 2) + '\n',
      { containedRoot: preview.target },
    );
    return { ...record, file: path.join(destination, 'application.json'), retainedVersions: true };
  });
}

/** 完整目录导出；包含入口、固定 Skills/资源、定义及执行/验证模块，不导出 Run。 */
export async function exportWorkflowApplication(options: {
  file: string;
  projectRoot: string;
  destination: string;
}) {
  const { files, contentHash } = await completePackage(options.file, options.projectRoot);
  const destination = path.resolve(options.destination);
  try {
    await fs.lstat(destination);
    applicationError('导出目标已存在；保留文件并选择空目标');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await copyPackage(files, destination);
  if (applicationFilesHash(await readApplicationFiles(destination)) !== contentHash)
    applicationError('导出内容校验失败；保留现场');
  return {
    file: path.join(destination, 'application.json'),
    contentHash,
    files: Object.keys(files),
  };
}

/** 卸载取消新 Run 的默认入口，明确保留版本；任意项目的在途 Run 可继续读取原包。 */
export async function uninstallWorkflowApplication(
  options: ApplicationDeliveryOptions & { id: string; confirmationHash?: string },
) {
  const root = workflowApplicationStorageRoot(options.projectRoot, options.scope, options.userRoot);
  const previous = await readInstalled(root, options.id);
  const entries = await validateApplicationInstallEntries(root, previous, options.scope);
  const requested = options.platforms?.length
    ? workflowApplicationPlatforms(options.platforms)
    : null;
  const remaining = entries
    .map((entry) => ({
      ...entry,
      platforms: requested ? entry.platforms.filter((id) => !requested.includes(id)) : [],
    }))
    .filter(({ platforms }) => platforms.length);
  const removed = entries.filter((entry) => !remaining.some((keep) => keep.root === entry.root));
  for (const entry of entries)
    if (applicationFilesHash(await readApplicationFiles(entry.root)) !== entry.contentHash)
      applicationError('宿主入口被修改；保留用户文件，不能取消该入口');
  const preview = {
    id: options.id,
    scope: options.scope,
    target: root,
    previous,
    retainedVersions: true,
    retainedDependencies: true,
    removesDefaultEntryOnly: true,
    removedEntries: removed,
    retainedEntries: remaining,
  };
  const confirmationHash = hashRuntimeValue(preview);
  if (!options.confirmationHash) return { ...preview, confirmationHash, noFilesWritten: true };
  if (options.confirmationHash !== confirmationHash)
    applicationError('卸载预览已变化；重新预览并确认');
  return withInstallLock(root, options.id, async () => {
    if (hashRuntimeValue(await readInstalled(root, options.id)) !== hashRuntimeValue(previous))
      applicationError('卸载预览已变化；重新预览并确认');
    // 删除前重验全部入口，避免后面的冲突导致只卸载一部分平台。
    for (const entry of entries) {
      if (applicationFilesHash(await readApplicationFiles(entry.root)) !== entry.contentHash)
        applicationError('宿主入口已变化；保留文件');
    }
    for (const entry of removed) {
      await fs.unlink(path.join(entry.root, 'SKILL.md'));
      await fs.rmdir(entry.root);
    }
    if (previous && remaining.length)
      await atomicWriteContainedText(
        path.join(root, options.id, 'current.json'),
        JSON.stringify(
          { ...previous, entry: undefined, scope: options.scope, entries: remaining },
          null,
          2,
        ) + '\n',
        { containedRoot: root },
      );
    else if (previous) await fs.unlink(path.join(root, options.id, 'current.json'));
    return { ...preview, uninstalled: true, noFilesWritten: false };
  });
}
