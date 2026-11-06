import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function normalizePattern(pattern) {
  return pattern.replaceAll('\\', '/').trim();
}

export function readGitignoredTopLevelEntries(root, gitignorePath = '.gitignore') {
  const source = readFileSync(path.join(root, gitignorePath), 'utf8');
  const ignored = new Set();

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = normalizePattern(rawLine);
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    if (line.includes('*')) continue;

    const withoutLeadingSlash = line.startsWith('/') ? line.slice(1) : line;
    const normalized = withoutLeadingSlash.endsWith('/')
      ? withoutLeadingSlash.slice(0, -1)
      : withoutLeadingSlash;
    if (!normalized || normalized.includes('/')) continue;
    ignored.add(normalized);
  }

  // Git resolves local exclusions, global excludes and linked-worktree metadata;
  // its default index check keeps tracked entries subject to architecture checks.
  const entries = readdirSync(root);
  if (entries.length) {
    const result = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
      cwd: root,
      input: `${entries.join('\0')}\0`,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0)
      for (const entry of result.stdout.split('\0')) if (entry) ignored.add(entry);
  }

  return ignored;
}

export function readGitignoredDirectoryEntries(root, gitignorePath = '.gitignore') {
  const source = readFileSync(path.join(root, gitignorePath), 'utf8');
  const ignored = new Set();

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = normalizePattern(rawLine);
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    if (line.includes('*')) continue;

    const withoutLeadingSlash = line.startsWith('/') ? line.slice(1) : line;
    if (!withoutLeadingSlash.endsWith('/')) continue;

    const normalized = withoutLeadingSlash.slice(0, -1);
    if (!normalized) continue;
    ignored.add(normalized);
  }

  return ignored;
}
