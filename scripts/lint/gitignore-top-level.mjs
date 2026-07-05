import { readFileSync } from 'node:fs';
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
