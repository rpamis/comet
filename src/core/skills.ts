import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';

import { fileExists, readJson, copyFile, ensureDir } from '../utils/file-system.js';
import { getPlatformSkillsDir, type Platform } from './platforms.js';
import type { InstallScope } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type LanguageConfig = {
  id: string;
  name: string;
  skillsDir: string;
};

type Manifest = {
  version: string;
  skills: string[];
  languages?: LanguageConfig[];
};

const OPENCODE_COMMAND_HEADER = `---
description: Run the {skillName} Comet workflow
---
`;

function getAssetsDir(): string {
  return path.resolve(__dirname, '..', '..', 'assets');
}

async function copyCometSkillsForPlatform(
  baseDir: string,
  platform: Platform,
  overwrite: boolean,
  languageSkillsDir: string = 'skills',
  scope: InstallScope = 'project',
): Promise<{ copied: number; skipped: number }> {
  const assetsDir = getAssetsDir();
  const manifestPath = path.join(assetsDir, 'manifest.json');

  if (!(await fileExists(manifestPath))) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest = await readJson<Manifest>(manifestPath);
  if (!manifest || !Array.isArray(manifest.skills)) {
    throw new Error(`Invalid manifest at ${manifestPath}: "skills" must be an array`);
  }
  let copied = 0;
  let skippedCount = 0;

  for (const skillRelPath of manifest.skills) {
    const isScript = skillRelPath.includes('/scripts/');
    const sourceDir = isScript ? 'skills' : languageSkillsDir;

    const src = path.join(assetsDir, sourceDir, skillRelPath);
    const dest = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills', skillRelPath);

    if (!overwrite && (await fileExists(dest))) {
      skippedCount++;
      continue;
    }

    try {
      await copyFile(src, dest);
      copied++;
    } catch (err) {
      console.error(`    Failed to copy ${skillRelPath}: ${(err as Error).message}`);
    }
  }

  if (platform.id === 'opencode') {
    const result = await createOpenCodeCommands(
      baseDir,
      platform,
      manifest.skills,
      overwrite,
      scope,
      languageSkillsDir,
    );
    copied += result.copied;
    skippedCount += result.skipped;
  }

  return { copied, skipped: skippedCount };
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return content.trimStart();
  }

  const normalized = content.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return content.trimStart();

  return normalized.slice(end + '\n---\n'.length).trimStart();
}

async function createOpenCodeCommands(
  baseDir: string,
  platform: Platform,
  skillPaths: string[],
  overwrite: boolean,
  scope: InstallScope,
  languageSkillsDir: string,
): Promise<{ copied: number; skipped: number }> {
  let copied = 0;
  let skipped = 0;
  const assetsDir = getAssetsDir();
  const commandsDir = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'commands');

  for (const skillPath of skillPaths) {
    const parts = skillPath.split('/');
    if (parts.length !== 2 || parts[1] !== 'SKILL.md') continue;

    const skillName = parts[0];
    const dest = path.join(commandsDir, `${skillName}.md`);

    if (!overwrite && (await fileExists(dest))) {
      skipped++;
      continue;
    }

    await ensureDir(path.dirname(dest));
    let skillSourcePath = path.join(assetsDir, languageSkillsDir, skillPath);
    if (!(await fileExists(skillSourcePath))) {
      skillSourcePath = path.join(assetsDir, 'skills', skillPath);
    }
    const skillBody = stripFrontmatter(await readFile(skillSourcePath, 'utf-8'));
    const content = `${OPENCODE_COMMAND_HEADER.replace('{skillName}', skillName)}
Equivalent Comet skill: \`${skillName}\`
Command name: \`/${skillName}\`

Use the invocation arguments below as the user input for this workflow:

\`\`\`text
$ARGUMENTS
\`\`\`

${skillBody}
`;
    await writeFile(dest, content, 'utf-8');
    copied++;
  }

  return { copied, skipped };
}

async function readManifest(): Promise<Manifest> {
  const assetsDir = getAssetsDir();
  const manifestPath = path.join(assetsDir, 'manifest.json');
  return readJson<Manifest>(manifestPath);
}

async function getManifestSkills(): Promise<string[]> {
  const manifest = await readManifest();
  return manifest.skills;
}

async function createWorkingDirs(projectPath: string): Promise<void> {
  const dirs = [
    path.join(projectPath, 'docs', 'superpowers', 'specs'),
    path.join(projectPath, 'docs', 'superpowers', 'plans'),
    path.join(projectPath, '.comet'),
  ];

  for (const dir of dirs) {
    await ensureDir(dir);
  }

  const configPath = path.join(projectPath, '.comet', 'config.yaml');
  if (!(await fileExists(configPath))) {
    await writeFile(configPath, 'context_compression: off\n', 'utf-8');
  }
}

export {
  copyCometSkillsForPlatform,
  readManifest,
  getManifestSkills,
  createWorkingDirs,
  getAssetsDir,
};
export type { Manifest, LanguageConfig };
