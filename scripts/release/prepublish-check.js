#!/usr/bin/env node

/**
 * Pre-publish security scan.
 * Checks for common secret patterns in files that would be published.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { extname, join } from 'path';

const SECRET_PATTERNS = [
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i, name: 'API key' },
  {
    pattern: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*['"][^\s'"]{8,}['"]/i,
    name: 'Secret/token',
  },
  { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/, name: 'Private key' },
  { pattern: /ghp_[A-Za-z0-9]{36}/, name: 'GitHub token' },
  { pattern: /sk-[A-Za-z0-9]{20,}/, name: 'OpenAI key' },
  { pattern: /xoxb-[0-9]+-[A-Za-z0-9]+/, name: 'Slack token' },
  { pattern: /AKIA[0-9A-Z]{16}/, name: 'AWS access key' },
];

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
]);
const README_IMAGE_PATTERN = /\b(?:src|srcset)=["'](?:\.\/)?img\//;

function normalized(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
}

const npmIgnoreRulesCache = new Map();

function globPatternSource(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[\\^$+.()|[\]{}]/gu, '\\$&');
    }
  }
  return source;
}

function npmIgnorePatternRegExp(pattern) {
  const directoryOnly = pattern.endsWith('/');
  const rooted = pattern.startsWith('/');
  const body = pattern.replace(/^\/+|\/+$/gu, '');
  const source = globPatternSource(body);

  if (!rooted && !body.includes('/')) {
    return { directoryOnly, regexp: new RegExp(`(?:^|/)${source}$`, 'u') };
  }

  return { directoryOnly, regexp: new RegExp(`^${source}$`, 'u') };
}

function readNpmIgnoreRules(directory) {
  const cacheKey = normalized(directory) || '.';
  const cached = npmIgnoreRulesCache.get(cacheKey);
  if (cached) return cached;

  const ignorePath = join(directory, '.npmignore');
  if (!existsSync(ignorePath)) {
    npmIgnoreRulesCache.set(cacheKey, []);
    return [];
  }

  const rules = readFileSync(ignorePath, 'utf-8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const negated = line.startsWith('!');
      const pattern = negated ? line.slice(1) : line;
      const { directoryOnly, regexp } = npmIgnorePatternRegExp(pattern);
      return { basePath: cacheKey === '.' ? '' : cacheKey, directoryOnly, negated, regexp };
    });

  npmIgnoreRulesCache.set(cacheKey, rules);
  return rules;
}

function inheritedNpmIgnoreRules(relativePath) {
  const segments = normalized(relativePath).split('/').filter(Boolean);
  const rules = [...readNpmIgnoreRules('.')];
  let directory = '.';

  for (const segment of segments.slice(0, -1)) {
    directory = join(directory, segment);
    rules.push(...readNpmIgnoreRules(directory));
  }

  return rules;
}

function isIgnoredByNpmIgnore(relativePath, isDirectory, rules) {
  const path = normalized(relativePath);
  let ignored = false;

  for (const rule of rules) {
    let candidate = path;
    if (rule.basePath) {
      if (candidate === rule.basePath) {
        candidate = '';
      } else if (candidate.startsWith(`${rule.basePath}/`)) {
        candidate = candidate.slice(rule.basePath.length + 1);
      } else {
        continue;
      }
    }

    if (rule.directoryOnly && !isDirectory) continue;
    if (rule.regexp.test(candidate)) ignored = !rule.negated;
  }

  return ignored;
}

function* walkIncludedPath(relativePath, excludes, npmIgnoreRules) {
  if (isExcludedFromPackage(relativePath, excludes)) return;

  const stat = statSync(relativePath);
  if (isIgnoredByNpmIgnore(relativePath, stat.isDirectory(), npmIgnoreRules)) return;

  if (stat.isFile()) {
    yield normalized(relativePath);
    return;
  }
  if (!stat.isDirectory()) return;

  const childNpmIgnoreRules = [...npmIgnoreRules, ...readNpmIgnoreRules(relativePath)];
  for (const entry of readdirSync(relativePath)) {
    yield* walkIncludedPath(join(relativePath, entry), excludes, childNpmIgnoreRules);
  }
}

function readPackageFileList() {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
  const files = Array.isArray(packageJson.files) ? packageJson.files : [];
  const includes = files.filter((entry) => typeof entry === 'string' && !entry.startsWith('!'));
  const excludes = files
    .filter((entry) => typeof entry === 'string' && entry.startsWith('!'))
    .map((entry) => normalized(entry.slice(1)));
  return { includes, excludes };
}

function packagePatternRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[\\^$+.()|[\]{}]/gu, '\\$&');
    }
  }
  return new RegExp(`^${source}(?:/.*)?$`, 'u');
}

function isExcludedFromPackage(filePath, excludes) {
  const path = normalized(filePath);
  for (const pattern of excludes) {
    if (packagePatternRegExp(pattern).test(path)) {
      return true;
    }
  }
  return false;
}

function alwaysIncludedPackageFiles() {
  const entries = readdirSync('.');
  return entries.filter((entry) => {
    const lower = entry.toLowerCase();
    return (
      lower === 'package.json' ||
      lower.startsWith('readme') ||
      lower.startsWith('license') ||
      lower.startsWith('licence')
    );
  });
}

function publishedFiles() {
  const { includes, excludes } = readPackageFileList();
  const paths = new Set();

  for (const entry of [...alwaysIncludedPackageFiles(), ...includes]) {
    const relativePath = normalized(entry);
    if (!relativePath || relativePath.startsWith('!') || !existsSync(relativePath)) continue;
    const npmIgnoreRules = statSync(relativePath).isDirectory()
      ? inheritedNpmIgnoreRules(relativePath)
      : [];
    for (const filePath of walkIncludedPath(relativePath, excludes, npmIgnoreRules)) {
      if (!isExcludedFromPackage(filePath, excludes)) {
        paths.add(filePath);
      }
    }
  }

  return [...paths].sort();
}

let found = 0;

for (const filePath of publishedFiles()) {
  const ext = extname(filePath);
  if (!TEXT_EXTENSIONS.has(ext)) continue;

  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    continue;
  }

  for (const { pattern, name } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      console.error(`[SECURITY] Possible ${name} found in ${filePath}`);
      found++;
    }
  }

  if (/README(?:-zh)?\.md$/.test(filePath) && README_IMAGE_PATTERN.test(content)) {
    console.error(
      `[PACKAGE] npm README images must use absolute URLs, not local img/ paths: ${filePath}`,
    );
    found++;
  }
}

if (found > 0) {
  console.error(`\n[SECURITY] ${found} potential secret(s) detected. Aborting publish.`);
  console.error('Review the files above and remove any secrets before publishing.');
  process.exit(1);
}

console.log('[SECURITY] No secrets detected. Safe to publish.');
