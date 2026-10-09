import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { promises as fs, type Stats } from 'node:fs';
import { sameFileObject } from '../fs/file-identity.js';
import { linkWithRetry, renameWithRetry, unlinkWithRetry } from '../fs/transient-retry.js';
import { PLATFORMS, getPlatformConfigDir, getPlatformRuleBaseDirs } from './platforms.js';

export interface ApplicationHostIntegrationOptions {
  platformId: string;
  projectRoot: string;
  scope: 'project' | 'user';
  userRoot?: string;
  skillsRoot: string;
  ruleSource: string;
  routerSource: string;
}

export interface ApplicationHostIntegrationFile {
  role: 'rule' | 'router' | 'hook-config';
  path: string;
  beforeHash: string | null;
  contentHash: string;
  operation: 'create' | 'update' | 'unchanged' | 'conflict';
}

export interface ApplicationHostIntegrationState {
  status: 'available' | 'unsupported' | 'conflict';
  path?: string;
  reason?: string;
  activationRequired?: string[];
  executionVerified?: false;
}

export interface ApplicationHostIntegrationPreview {
  platformId: string;
  scope: 'project' | 'user';
  files: ApplicationHostIntegrationFile[];
  rule: ApplicationHostIntegrationState;
  hook: ApplicationHostIntegrationState;
  conflicts: string[];
  digest: string;
  noFilesWritten: true;
}

export interface ApplicationHostIntegrationResult {
  preview: ApplicationHostIntegrationPreview;
  writtenFiles: string[];
  rule: { status: 'installed' | 'unsupported'; path?: string; reason?: string };
  hook: {
    status: 'installed' | 'unsupported';
    path?: string;
    reason?: string;
    activationRequired?: string[];
    executionVerified: false;
  };
}

const RULE_MARKER = '<!-- Managed by Comet: SDK application host integration -->';
const ROUTER_MARKER = '// Managed by Comet: SDK application host integration';
const BLOCK_START = '<!-- comet-sdk-workflow-guard:start -->';
const BLOCK_END = '<!-- comet-sdk-workflow-guard:end -->';
type PlannedFile = ApplicationHostIntegrationFile & { content: string };

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function sameObject(left: Stats, right: Stats): boolean {
  return sameFileObject(
    { dev: left.dev, ino: left.ino, birthtime: left.birthtimeMs },
    { dev: right.dev, ino: right.ino, birthtime: right.birthtimeMs },
  );
}

type DirectorySnapshot = { path: string; realPath: string; stat: Stats };
async function verifyDirectories(chain: DirectorySnapshot[]): Promise<void> {
  for (const directory of chain) {
    const stat = await fs.lstat(directory.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameObject(directory.stat, stat) ||
      (await fs.realpath(directory.path)) !== directory.realPath
    )
      throw new Error(`Application host integration directory changed: ${directory.path}`);
  }
}

async function prepareDirectories(root: string, directory: string): Promise<DirectorySnapshot[]> {
  if (!contained(root, directory))
    throw new Error('Application host integration directory escapes its root');
  let cursor = path.parse(directory).root;
  const chain: DirectorySnapshot[] = [];
  for (const segment of ['', ...directory.slice(cursor.length).split(path.sep).filter(Boolean)]) {
    await verifyDirectories(chain);
    if (segment) {
      cursor = path.join(cursor, segment);
      try {
        await mkdir(cursor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`Application host integration requires a real directory: ${cursor}`);
    chain.push({ path: cursor, stat, realPath: await fs.realpath(cursor) });
  }
  return chain;
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (
      !['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    )
      throw error;
  } finally {
    await handle?.close();
  }
}

async function writeIntegrationFile(root: string, file: PlannedFile): Promise<void> {
  const directory = path.dirname(file.path);
  const chain = await prepareDirectories(root, directory);
  const before = await readTarget(root, file.path);
  if ((before === null ? null : hash(before)) !== file.beforeHash)
    throw new Error(`Application host integration drift: ${file.path}`);
  const targetStat = before === null ? undefined : await fs.lstat(file.path);
  const temporary = path.join(directory, `.${path.basename(file.path)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let writtenStat: Stats | undefined;
  try {
    handle = await fs.open(temporary, 'wx', targetStat ? targetStat.mode & 0o777 : 0o666);
    const openedStat = await handle.stat();
    await verifyDirectories(chain);
    const openedPathStat = await fs.lstat(temporary);
    if (
      !openedPathStat.isFile() ||
      openedPathStat.isSymbolicLink() ||
      !sameObject(openedStat, openedPathStat) ||
      !contained(await fs.realpath(root), await fs.realpath(temporary))
    )
      throw new Error('Application host integration temporary file changed before writing');
    await handle.writeFile(file.content, 'utf8');
    await handle.sync();
    writtenStat = await handle.stat();
    await handle.close();
    handle = undefined;
    await verifyDirectories(chain);
    const temporaryStat = await fs.lstat(temporary);
    if (
      !temporaryStat.isFile() ||
      temporaryStat.isSymbolicLink() ||
      !sameObject(writtenStat, temporaryStat) ||
      writtenStat.size !== temporaryStat.size ||
      writtenStat.mtimeMs !== temporaryStat.mtimeMs ||
      hash(await fs.readFile(temporary, 'utf8')) !== file.contentHash
    )
      throw new Error('Application host integration temporary file changed before commit');
    const current = await readTarget(root, file.path);
    if (
      (current === null ? null : hash(current)) !== file.beforeHash ||
      (targetStat && !sameObject(targetStat, await fs.lstat(file.path)))
    )
      throw new Error(`Application host integration drift before commit: ${file.path}`);
    await verifyDirectories(chain);
    if (before === null) {
      // 硬链接发布保证目标已出现时拒绝覆盖；不回退到非原子的复制。
      await linkWithRetry(temporary, file.path);
      await unlinkWithRetry(temporary);
    } else await renameWithRetry(temporary, file.path);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close();
    try {
      await verifyDirectories(chain);
      const temporaryStat = await fs.lstat(temporary);
      if (
        temporaryStat.isFile() &&
        !temporaryStat.isSymbolicLink() &&
        (!writtenStat || sameObject(writtenStat, temporaryStat))
      )
        await unlinkWithRetry(temporary);
    } catch {
      /* 目录被替换时保留原临时文件，避免清理用户路径。 */
    }
    throw error;
  }
}

async function readTarget(root: string, target: string): Promise<string | null> {
  if (!contained(root, target)) throw new Error(`Target escapes integration root: ${target}`);
  let current = path.parse(target).root;
  for (const segment of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`Refusing linked integration path: ${current}`);
      if (current !== target && !stat.isDirectory())
        throw new Error(`Integration parent is not a directory: ${current}`);
      if (current === target && !stat.isFile())
        throw new Error(`Integration target is not a regular file: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  return readFile(target, 'utf8');
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

function managedBlock(existing: string | null, content: string): string {
  const source = existing ?? '';
  const start = source.indexOf(BLOCK_START);
  const end = source.indexOf(BLOCK_END);
  const block = `${BLOCK_START}\n${content.trim()}\n${BLOCK_END}`;
  if (start === -1 && end === -1)
    return `${source}${source && !source.endsWith('\n') ? '\n' : ''}${source ? '\n' : ''}${block}\n`;
  if (
    start === -1 ||
    end < start ||
    source.indexOf(BLOCK_START, start + 1) !== -1 ||
    source.indexOf(BLOCK_END, end + 1) !== -1
  )
    throw new Error('Malformed or duplicate Comet SDK instruction block');
  return source.slice(0, start) + block + source.slice(end + BLOCK_END.length);
}

function markedRouter(content: string): string {
  if (content.startsWith('#!')) {
    const lineEnd = content.indexOf('\n');
    if (lineEnd !== -1)
      return content.slice(0, lineEnd + 1) + ROUTER_MARKER + '\n' + content.slice(lineEnd + 1);
  }
  return `${ROUTER_MARKER}\n${content}`;
}

function isManagedRouter(content: string): boolean {
  return (
    content.startsWith(ROUTER_MARKER) ||
    (content.startsWith('#!') && content.split(/\r?\n/u)[1] === ROUTER_MARKER)
  );
}

function encodedHookArguments(command: unknown): unknown[] {
  if (
    typeof command !== 'string' ||
    !command.startsWith(
      "node -e \"const r=require('node:child_process').spawnSync(process.execPath,",
    )
  )
    return [];
  const encoded = /Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\)/u.exec(command)?.[1];
  if (!encoded) return [];
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64').toString());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function planIntegration(
  options: ApplicationHostIntegrationOptions,
): Promise<{ preview: ApplicationHostIntegrationPreview; files: PlannedFile[]; root: string }> {
  const platformId = options.platformId === 'claude-code' ? 'claude' : options.platformId;
  const platform = PLATFORMS.find((candidate) => candidate.id === platformId);
  if (!platform) throw new Error(`Unknown platform: ${options.platformId}`);
  if (options.scope === 'user' && !options.userRoot)
    throw new Error('userRoot is required for user-scope integration');
  const root = path.resolve(options.scope === 'project' ? options.projectRoot : options.userRoot!);
  const skillsRoot = path.resolve(options.projectRoot, options.skillsRoot);
  if (!contained(root, skillsRoot) || root === skillsRoot)
    throw new Error('skillsRoot must be within the selected integration root');
  const installScope = options.scope === 'project' ? 'project' : 'global';
  const configRoot = path.resolve(root, getPlatformConfigDir(platform, installScope));
  const ruleContent = await readFile(path.resolve(options.projectRoot, options.ruleSource), 'utf8');
  const routerContent = await readFile(
    path.resolve(options.projectRoot, options.routerSource),
    'utf8',
  );
  const files: PlannedFile[] = [];
  const conflicts: string[] = [];
  let rule: ApplicationHostIntegrationState = {
    status: 'unsupported',
    reason: `${platform.name} has no supported behavior-rule format`,
  };
  let hook: ApplicationHostIntegrationState = {
    status: 'unsupported',
    reason: `${platform.name} Hook format is not supported by this installer`,
  };

  async function add(
    role: ApplicationHostIntegrationFile['role'],
    target: string,
    render: (existing: string | null) => string,
    ownership?: (existing: string) => boolean,
  ): Promise<boolean> {
    let existing: string | null = null;
    let content = '';
    let conflict = false;
    try {
      existing = await readTarget(root, target);
      content = render(existing);
      if (existing !== null && existing !== content && ownership && !ownership(existing))
        throw new Error(`Refusing to overwrite user-owned ${role}: ${target}`);
    } catch (error) {
      conflicts.push(`${role} conflict: ${(error as Error).message}`);
      conflict = true;
    }
    files.push({
      role,
      path: target,
      beforeHash: existing === null ? null : hash(existing),
      contentHash: hash(content),
      operation: conflict
        ? 'conflict'
        : existing === content
          ? 'unchanged'
          : existing === null
            ? 'create'
            : 'update',
      content,
    });
    return !conflict;
  }

  if (platformId === 'codex') {
    const target = path.join(root, options.scope === 'user' ? '.codex/AGENTS.md' : 'AGENTS.md');
    let overrideReason: string | undefined;
    try {
      if ((await readTarget(root, path.join(path.dirname(target), 'AGENTS.override.md'))) !== null)
        overrideReason =
          'AGENTS.override.md takes precedence; reconcile the shared Rule before installing';
    } catch (error) {
      overrideReason = (error as Error).message;
    }
    rule = {
      status: (await add('rule', target, (existing) => {
        if (overrideReason) throw new Error(overrideReason);
        return managedBlock(existing, ruleContent);
      }))
        ? 'available'
        : 'conflict',
      path: target,
    };
  } else if (platform.rulesDir && platform.rulesFormat !== 'dsh') {
    const format = platform.rulesFormat ?? 'md';
    const extension = format === 'mdc' ? '.mdc' : format === 'copilot' ? '.instructions.md' : '.md';
    const target = path.resolve(
      root,
      getPlatformRuleBaseDirs(platform, installScope)[0]!,
      platform.rulesDir,
      `comet-workflow-guard${extension}`,
    );
    let bareContent = ruleContent;
    if (format === 'mdc')
      bareContent = `---\ndescription: comet workflow guard\nglobs:\nalwaysApply: true\n---\n\n${ruleContent}`;
    if (format === 'copilot') bareContent = `---\napplyTo: "**"\n---\n\n${ruleContent}`;
    const content =
      format === 'md'
        ? `${RULE_MARKER}\n${bareContent}`
        : bareContent.replace('\n---\n\n', `\n---\n\n${RULE_MARKER}\n`);
    rule = {
      status: (await add(
        'rule',
        target,
        () => content,
        (existing) => existing.includes(RULE_MARKER) || existing === bareContent,
      ))
        ? 'available'
        : 'conflict',
      path: target,
    };
  } else if (platformId === 'gemini') {
    const target = path.join(configRoot, 'GEMINI.md');
    rule = {
      status: (await add('rule', target, (existing) => managedBlock(existing, ruleContent)))
        ? 'available'
        : 'conflict',
      path: target,
    };
  }

  const supportedHookFormats = ['claude-code', 'qwen', 'qoder', 'codebuddy', 'gemini'];
  const hookSupported =
    platform.supportsHooks &&
    supportedHookFormats.includes(platform.hookFormat ?? '') &&
    (options.scope === 'project' ||
      platformId === 'claude' ||
      platformId === 'codex' ||
      platform.supportsGlobalHooks);
  if (hookSupported) {
    const routerPath = path.join(skillsRoot, 'comet/scripts/comet-hook-router.mjs');
    const routerReady = await add(
      'router',
      routerPath,
      () => markedRouter(routerContent),
      (existing) => isManagedRouter(existing) || existing === routerContent,
    );
    const fileName =
      platform.hookConfigFile ??
      (platform.hookFormat === 'claude-code' && options.scope === 'project'
        ? 'settings.local.json'
        : 'settings.json');
    const target = path.join(configRoot, fileName);
    const event = platform.hookFormat === 'gemini' ? 'BeforeTool' : 'PreToolUse';
    const matcher =
      platformId === 'codex'
        ? '^(apply_patch|Write|Edit)$'
        : (platform.hookMatcher ??
          (event === 'BeforeTool' ? 'write_file|edit_file' : 'Write|Edit'));
    const invocationArgs = [routerPath, '--platform', platformId];
    if (options.scope === 'project')
      invocationArgs.push('--project-root', path.resolve(options.projectRoot));
    // 使用编码后的参数，避免宿主的 shell 把路径中的字符当作命令执行。
    const encodedArgs = Buffer.from(JSON.stringify(invocationArgs)).toString('base64');
    const command =
      platformId === 'claude'
        ? 'node'
        : `node -e "const r=require('node:child_process').spawnSync(process.execPath,JSON.parse(Buffer.from('${encodedArgs}','base64').toString()),{stdio:'inherit'});process.exit(r.status??1)"`;
    const handler: Record<string, unknown> =
      platformId === 'claude'
        ? { type: 'command', command, args: invocationArgs }
        : { type: 'command', command };
    const legacyQuote = (value: string): string =>
      `"${value.replaceAll('\\', '/').replaceAll('"', '\\"')}"`;
    const legacyCommand = `node ${legacyQuote(routerPath)} --platform ${legacyQuote(platformId)}${options.scope === 'project' ? ` --project-root ${legacyQuote(path.resolve(options.projectRoot))}` : ''}`;
    const configReady = await add('hook-config', target, (existing) => {
      let parsed: unknown = {};
      if (existing !== null) {
        try {
          parsed = JSON.parse(existing);
        } catch {
          throw new Error('Invalid Hook configuration JSON');
        }
      }
      const settings = object(parsed, 'Hook configuration');
      const hooks = settings.hooks === undefined ? {} : object(settings.hooks, 'hooks');
      const groups = hooks[event] === undefined ? [] : hooks[event];
      if (!Array.isArray(groups)) throw new Error(`${event} must be an array`);
      const matches: { group: Record<string, unknown>; index: number }[] = [];
      let legacyMatches = 0;
      const preservedGroups: Record<string, unknown>[] = [];
      groups.forEach((value, index) => {
        const group = object(value, `${event} group`);
        if (!Array.isArray(group.hooks)) throw new Error(`${event} group hooks must be an array`);
        const preservedHandlers: unknown[] = [];
        for (const entry of group.hooks) {
          const entryObject = object(entry, 'Hook handler');
          if (platformId !== 'claude' && entryObject.command === legacyCommand) {
            if (group.matcher !== matcher && group.matcher !== 'Write|Edit')
              throw new Error('Legacy shared Comet Hook matcher differs from preview');
            legacyMatches++;
            continue;
          }
          preservedHandlers.push(entry);
          const argumentsList = Array.isArray(entryObject.args) ? entryObject.args : [];
          const encodedArguments = encodedHookArguments(entryObject.command);
          if (
            entryObject.command === command &&
            (platformId !== 'claude' ||
              JSON.stringify(argumentsList) === JSON.stringify(invocationArgs))
          )
            matches.push({ group, index });
          else if (
            String(entryObject.command).includes('comet-hook-router.mjs') ||
            [...argumentsList, ...encodedArguments].some((arg) =>
              String(arg).includes('comet-hook-router.mjs'),
            )
          )
            throw new Error(
              'Existing shared Comet Hook differs from the proposed router; reconcile it before installing',
            );
        }
        if (preservedHandlers.length || group.hooks.length === 0)
          preservedGroups.push({ ...group, hooks: preservedHandlers });
      });
      if (matches.length + legacyMatches > 1)
        throw new Error('Duplicate shared Comet Hook entries');
      if (matches.length === 1) {
        if (matches[0]!.group.matcher !== matcher)
          throw new Error('Shared Comet Hook matcher differs from preview');
        return existing!;
      }
      settings.hooks = { ...hooks, [event]: [...preservedGroups, { matcher, hooks: [handler] }] };
      return JSON.stringify(settings, null, 2) + '\n';
    });
    hook = {
      status: routerReady && configReady ? 'available' : 'conflict',
      path: target,
      executionVerified: false,
      activationRequired:
        platformId === 'codex'
          ? [
              'Use a Codex version with features.hooks enabled',
              'Review and trust the current Hook in Codex /hooks',
            ]
          : ['Reload the host and approve the project Hook configuration'],
    };
  } else if (platform.supportsHooks && options.scope === 'user' && platformId !== 'codex') {
    hook.reason = `${platform.name} user-scope Hook routing is not supported`;
  }

  const previewFiles = files.map(({ content: _content, ...file }) => file);
  const identity = {
    platformId,
    scope: options.scope,
    projectRoot: path.resolve(options.projectRoot),
    root,
    skillsRoot,
    ruleSourceHash: hash(ruleContent),
    routerSourceHash: hash(routerContent),
    files: previewFiles,
    rule,
    hook,
    conflicts,
  };
  return {
    root,
    files,
    preview: {
      platformId,
      scope: options.scope,
      files: previewFiles,
      rule,
      hook,
      conflicts,
      digest: hash(JSON.stringify(identity)),
      noFilesWritten: true,
    },
  };
}

export async function previewApplicationHostIntegration(
  options: ApplicationHostIntegrationOptions,
): Promise<ApplicationHostIntegrationPreview> {
  return (await planIntegration(options)).preview;
}

export async function installApplicationHostIntegration(
  options: ApplicationHostIntegrationOptions & { preview: ApplicationHostIntegrationPreview },
): Promise<ApplicationHostIntegrationResult> {
  const planned = await planIntegration(options);
  if (
    planned.preview.digest !== options.preview.digest ||
    JSON.stringify(planned.preview) !== JSON.stringify(options.preview)
  )
    throw new Error(
      'Application host integration changed after preview; review the current preview',
    );
  if (planned.preview.conflicts.length)
    throw new Error(
      `Application host integration conflicts: ${planned.preview.conflicts.join('; ')}`,
    );
  const writtenFiles: string[] = [];
  for (const file of planned.files) {
    if (file.operation === 'unchanged') continue;
    await writeIntegrationFile(planned.root, file);
    writtenFiles.push(file.path);
  }
  return {
    preview: planned.preview,
    writtenFiles,
    rule: {
      ...planned.preview.rule,
      status: planned.preview.rule.status === 'available' ? 'installed' : 'unsupported',
    },
    hook: {
      ...planned.preview.hook,
      status: planned.preview.hook.status === 'available' ? 'installed' : 'unsupported',
      executionVerified: false,
    },
  };
}
