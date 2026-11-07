import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { pluginMigrationAreas } from '../../platform/install/plugin-migration-paths.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import {
  atomicWriteContainedBytes,
  atomicWriteContainedText,
  removeContainedFile,
} from '../workflow-contract/contained-atomic-write.js';
import { isManagedHookCommand } from './platform-install.js';

interface MigrationAssets {
  schema: string;
  skills: Record<string, string[]>;
  rules: string[];
}
export interface PluginMigrationResult {
  changed: string[];
  backups: string[];
  preserved: Array<{ path: string; reason: string }>;
  reportPath?: string;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const contentHash = (value: Buffer) => hash(value.toString('utf8').replaceAll('\r\n', '\n'));
const pathKey = (value: string) =>
  process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const hookScripts = [
  'comet/scripts/comet-hook-router.mjs',
  'comet/scripts/comet-hook-guard.mjs',
  'comet-native/scripts/comet-native-hook-guard.mjs',
];

/** 不跟随平台目录或文件链接；共享的 Skill 资源始终保留。 */
async function readRegular(file: string): Promise<Buffer | null> {
  const absolute = path.resolve(file);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return null;
    if (stat.isSymbolicLink()) throw new Error('目录或文件为链接，已保留');
    if (cursor !== absolute && !stat.isDirectory()) throw new Error('父路径不是目录');
    if (cursor === absolute && !stat.isFile()) throw new Error('路径不是普通文件');
  }
  return fs.readFile(absolute);
}

export async function migratePluginInstallation(options: {
  platform: 'codex' | 'dsh';
  pluginRoot: string;
  configRoot: string;
  homeDir?: string;
  projectPath?: string;
  hookExecuted?: boolean;
}): Promise<PluginMigrationResult> {
  const result: PluginMigrationResult = { changed: [], backups: [], preserved: [] };
  const configRoot = path.resolve(options.configRoot);
  const catalogFile = path.join(
    await fs.realpath(options.pluginRoot),
    'rules/migration-assets.json',
  );
  const catalogBytes = await readRegular(catalogFile);
  if (!catalogBytes) return result;
  const catalog = JSON.parse(catalogBytes.toString()) as MigrationAssets;
  if (
    catalog.schema !== 'comet.plugin-migration-assets.v1' ||
    !catalog.skills ||
    !Array.isArray(catalog.rules)
  )
    throw new Error('Comet 迁移资源清单无效');
  for (const [name, hashes] of Object.entries(catalog.skills))
    if (
      !/^comet(?:-[a-z]+)*$/.test(name) ||
      !Array.isArray(hashes) ||
      hashes.some((h) => !/^\w{64}$/.test(h))
    )
      throw new Error('Comet 迁移 Skill 清单无效');
  await fs.mkdir(configRoot, { recursive: true });
  const areas = await pluginMigrationAreas({
    ...options,
    configRoot,
    homeDir: options.homeDir ?? os.homedir(),
  });
  const preserve = (file: string, error: unknown) =>
    result.preserved.push({
      path: file,
      reason: error instanceof Error ? error.message : String(error),
    });
  await withRecoverableFileLock(
    path.join(configRoot, 'comet-plugin-setup.lock'),
    async () => {
      async function change(
        file: string,
        before: Buffer | null,
        after: string | null,
        containedRoot: string,
      ) {
        const relative = path.relative(configRoot, file);
        if (
          relative !== '..' &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative)
        )
          containedRoot = configRoot;
        const key = hash(
          path.resolve(file) + '\0' + (before ? hash(before) : 'missing') + '\0' + after,
        );
        const backup = path.join(configRoot, 'comet-plugin/migration-backups', key + '.bin');
        const receipt = path.join(configRoot, 'comet-plugin/migration-backups', key + '.json');
        const original = before ?? Buffer.alloc(0);
        const previousBackup = await readRegular(backup);
        if (!previousBackup)
          await atomicWriteContainedBytes(backup, original, {
            containedRoot: configRoot,
            exclusive: true,
          });
        else if (!previousBackup.equals(original)) throw new Error('已有迁移备份不匹配');
        if (!(await readRegular(backup))?.equals(original)) throw new Error('迁移备份校验失败');
        await atomicWriteContainedText(
          receipt,
          JSON.stringify(
            {
              schema: 'comet.plugin-migration-backup.v1',
              source: file,
              backup,
              beforeHash: before ? hash(before) : null,
              afterHash: after === null ? null : hash(after),
              platform: options.platform,
            },
            null,
            2,
          ) + '\n',
          { containedRoot: configRoot },
        );
        const verify = async () => {
          const current = await readRegular(file);
          if (current === null ? before !== null : before === null || !current.equals(before))
            throw new Error('迁移期间文件已改变，已保留');
        };
        await verify();
        if (after === null)
          await removeContainedFile(file, { containedRoot, beforeRemove: verify });
        else await atomicWriteContainedText(file, after, { containedRoot, beforeCommit: verify });
        result.changed.push(file);
        result.backups.push(backup);
      }
      const codexSkills = new Set<string>();
      for (const area of areas) {
        for (const skillsRoot of area.skills)
          for (const [name, hashes] of Object.entries(catalog.skills)) {
            const file = path.join(skillsRoot, name, 'SKILL.md');
            try {
              const bytes = await readRegular(file);
              if (!bytes) continue;
              if (!hashes.includes(contentHash(bytes))) {
                preserve(file, 'Skill 内容与已知 Comet 版本不同，已保留');
                continue;
              }
              if (options.platform === 'codex') codexSkills.add(file);
              else if (options.hookExecuted) await change(file, bytes, null, area.root);
            } catch (error) {
              preserve(file, error);
            }
          }
        if (!options.hookExecuted) continue;
        for (const file of area.rules) {
          try {
            const bytes = await readRegular(file);
            if (!bytes) continue;
            if (catalog.rules.includes(contentHash(bytes)))
              await change(file, bytes, null, area.root);
            else preserve(file, 'Rule 内容与已知 Comet 版本不同，已保留');
          } catch (error) {
            preserve(file, error);
          }
        }
        if (area.instruction) {
          const file = area.instruction;
          try {
            const bytes = await readRegular(file);
            if (bytes) {
              const text = bytes.toString();
              const matches = [
                ...text.matchAll(
                  /<!-- COMET:DSH:START -->\r?\n([\s\S]*?)\r?\n<!-- COMET:DSH:END -->/g,
                ),
              ];
              if (
                matches.length === 1 &&
                catalog.rules.includes(contentHash(Buffer.from(matches[0][1] + '\n')))
              )
                await change(
                  file,
                  bytes,
                  text.slice(0, matches[0].index) +
                    text.slice(matches[0].index! + matches[0][0].length),
                  area.root,
                );
              else if (text.includes('<!-- COMET:DSH:'))
                preserve(file, 'DSH Rule 已修改或标记不完整，已保留');
            }
          } catch (error) {
            preserve(file, error);
          }
        }
        for (const file of area.hooks) {
          try {
            const bytes = await readRegular(file);
            if (!bytes) continue;
            const config = JSON.parse(bytes.toString());
            if (!config || typeof config !== 'object' || Array.isArray(config))
              throw new Error('Hook 配置无效');
            const groups = config.hooks?.PreToolUse;
            if (groups === undefined) continue;
            if (!Array.isArray(groups)) throw new Error('PreToolUse 必须是数组');
            let removed = 0;
            config.hooks.PreToolUse = groups.map((group) => {
              if (!group || !Array.isArray(group.hooks)) return group;
              const hooks = group.hooks.filter((hook: { command?: unknown; args?: unknown }) => {
                if (isManagedHookCommand(hook?.command, hookScripts, hook?.args)) {
                  removed++;
                  return false;
                }
                return true;
              });
              return { ...group, hooks };
            });
            if (removed)
              await change(file, bytes, JSON.stringify(config, null, 2) + '\n', area.root);
          } catch (error) {
            preserve(file, error);
          }
        }
      }
      if (options.platform === 'codex' && codexSkills.size) {
        const file = path.join(configRoot, 'config.toml');
        try {
          const before = await readRegular(file);
          let next = before?.toString() ?? '';
          const config = parseToml(next) as {
            skills?: { config?: Array<{ path?: string; name?: string; enabled?: boolean }> };
          };
          if (config.skills?.config !== undefined && !Array.isArray(config.skills.config))
            throw new Error('skills.config 必须是数组');
          const entries = config.skills?.config ?? [];
          for (const skill of codexSkills) {
            const name = path.basename(path.dirname(skill));
            const matched = entries
              .filter(
                (entry) =>
                  entry.name === name || (entry.path && pathKey(entry.path) === pathKey(skill)),
              )
              .at(-1);
            if (matched) {
              if (matched.enabled !== false) preserve(skill, '已有用户 Skill 启用设置，已保留');
              continue;
            }
            const marker = hash(skill);
            next += `\n# comet-plugin-migration:${marker}\n[[skills.config]]\npath = ${JSON.stringify(skill)}\nenabled = false\n`;
          }
          if (next !== (before?.toString() ?? '')) {
            parseToml(next);
            await change(file, before, next, configRoot);
            // 对外按停用的 Skill 路径报告；配置文件原文在备份中。
            result.changed.pop();
            result.changed.push(
              ...[...codexSkills].filter(
                (skill) =>
                  !entries.some(
                    (entry) =>
                      entry.name === path.basename(path.dirname(skill)) ||
                      (entry.path && pathKey(entry.path) === pathKey(skill)),
                  ),
              ),
            );
          }
        } catch (error) {
          preserve(file, error);
        }
      }
      const reportPath = path.join(
        configRoot,
        'comet-plugin/migration-reports',
        hash(options.platform + '\0' + (options.projectPath ?? 'user')) + '.json',
      );
      if (result.changed.length || result.preserved.length) {
        result.reportPath = reportPath;
        await atomicWriteContainedText(reportPath, JSON.stringify(result, null, 2) + '\n', {
          containedRoot: configRoot,
        });
      } else if (await readRegular(reportPath)) result.reportPath = reportPath;
    },
    { timeoutMs: 30_000, retryMs: 50 },
  );
  return result;
}
