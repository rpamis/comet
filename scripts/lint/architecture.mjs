import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  readGitignoredDirectoryEntries,
  readGitignoredTopLevelEntries,
} from './gitignore-top-level.mjs';

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readGitmodulePaths() {
  const modulesPath = path.join(root, '.gitmodules');
  if (!existsSync(modulesPath)) return new Set();
  const content = readFileSync(modulesPath, 'utf8');
  const paths = new Set();
  for (const match of content.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)) {
    paths.add(match[1].replaceAll('\\', '/'));
  }
  return paths;
}

function exists(relativePath) {
  return existsSync(path.join(root, relativePath));
}

function isDirectory(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return existsSync(absolutePath) && statSync(absolutePath).isDirectory();
}

function isFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return existsSync(absolutePath) && statSync(absolutePath).isFile();
}

function directoryNames(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return [];
  return readdirSync(absolutePath)
    .filter((entry) => statSync(path.join(absolutePath, entry)).isDirectory())
    .sort();
}

function entryNames(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return [];
  return readdirSync(absolutePath).sort();
}

function walkFiles(relativePath, ignoredNames = new Set(), ignoredRelativePaths = new Set()) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return [];

  const files = [];
  const visit = (currentAbsolutePath, currentRelativePath) => {
    let entries;
    try {
      entries = readdirSync(currentAbsolutePath);
    } catch (error) {
      fail(`cannot scan ${currentRelativePath}: ${error.message}`);
      return;
    }

    for (const entry of entries) {
      if (ignoredNames.has(entry)) continue;
      if (entry.startsWith('.pytest')) continue;
      if (entry === '.cache') continue;
      const entryAbsolutePath = path.join(currentAbsolutePath, entry);
      const entryRelativePath = path.join(currentRelativePath, entry).replaceAll(path.sep, '/');
      if (ignoredRelativePaths.has(entryRelativePath)) continue;
      if (
        entryRelativePath === 'eval/local/logs' ||
        entryRelativePath === 'eval/langsmith/logs' ||
        entryRelativePath === 'eval/.venv'
      ) {
        continue;
      }
      const stats = statSync(entryAbsolutePath);
      if (stats.isDirectory()) {
        visit(entryAbsolutePath, entryRelativePath);
      } else {
        files.push(entryRelativePath);
      }
    }
  };

  visit(absolutePath, relativePath);
  return files.sort();
}

function assertArrayEquals(name, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${name} must be ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
  }
}

const layout = readJson('config/repository-layout.json');
assertArrayEquals('repository-layout.sourceRoots', layout.sourceRoots, [
  'app',
  'domains',
  'platform',
]);
assertArrayEquals('repository-layout.testRoots', layout.testRoots, ['test']);

const allowedTopLevelEntries = new Set(layout.allowedTopLevelEntries ?? []);
const gitignoredTopLevelEntries = readGitignoredTopLevelEntries(root);
const gitignoredDirectoryEntries = readGitignoredDirectoryEntries(root);
const gitSubmodulePaths = readGitmodulePaths();
for (const entry of entryNames('.')) {
  if (gitignoredTopLevelEntries.has(entry)) continue;
  if (!allowedTopLevelEntries.has(entry)) {
    fail(`${entry} is not an allowed top-level repository entry`);
  }
}

for (const sourceRoot of layout.sourceRoots) {
  if (!isDirectory(sourceRoot)) {
    fail(`source root "${sourceRoot}" is listed in config/repository-layout.json but missing`);
  }
}

const rootSourceExtensions = new Set(['.ts', '.tsx', '.jsx', '.cjs']);
const allowedRootSourceFiles = new Set(['build.js', 'eslint.config.js', 'vitest.config.ts']);
for (const entry of entryNames('.')) {
  const extension = path.extname(entry);
  if (rootSourceExtensions.has(extension) && !allowedRootSourceFiles.has(entry)) {
    fail(
      `${entry} is source-like code at the repository root; move it under app/, domains/, platform/, or scripts/`,
    );
  }
}

if (exists('src')) {
  fail('legacy src/ root is not allowed; use app/, domains/, or platform/');
}

if (exists('test/ts')) {
  fail(
    'legacy test/ts/ root is not allowed; move tests to test/app, test/domains, test/platform, test/repository, or test/scripts',
  );
}

assertArrayEquals('app modules', directoryNames('app'), layout.appModules);
assertArrayEquals('domain modules', directoryNames('domains'), layout.domainModules);
assertArrayEquals('platform modules', directoryNames('platform'), layout.platformModules);

for (const scriptModule of directoryNames('scripts')) {
  if (!layout.scriptModules.includes(scriptModule)) {
    fail(`scripts/${scriptModule}/ is not an allowed scripts module`);
  }
}

for (const [name, entry] of Object.entries(layout.classicRuntime.entries ?? {})) {
  if (!isFile(entry)) {
    fail(`classic runtime entry "${name}" -> "${entry}" is missing`);
  }
}
for (const [name, output] of Object.entries(layout.classicRuntime.outputs ?? {})) {
  if (!isFile(output)) {
    fail(`classic runtime output "${name}" -> "${output}" is missing`);
  }
}
for (const [name, entry] of Object.entries(layout.nativeRuntime?.entries ?? {})) {
  if (!isFile(entry)) {
    fail(`native runtime entry "${name}" -> "${entry}" is missing`);
  }
}
for (const [name, output] of Object.entries(layout.nativeRuntime?.outputs ?? {})) {
  if (!isFile(output)) {
    fail(`native runtime output "${name}" -> "${output}" is missing`);
  }
}
for (const [name, entry] of Object.entries(layout.entryRuntime?.entries ?? {})) {
  if (!isFile(entry)) {
    fail(`entry resolver runtime entry "${name}" -> "${entry}" is missing`);
  }
}
for (const [name, output] of Object.entries(layout.entryRuntime?.outputs ?? {})) {
  if (!isFile(output)) {
    fail(`entry resolver runtime output "${name}" -> "${output}" is missing`);
  }
}
if (!isFile(layout.manifestPath)) {
  fail(`asset manifest "${layout.manifestPath}" is missing`);
}
for (const [locale, skillsRoot] of Object.entries(layout.skillsRoots ?? {})) {
  if (!isDirectory(skillsRoot)) {
    fail(`skills root "${locale}" points to missing directory ${skillsRoot}`);
  }
}

const allowedTestRoots = [
  'app',
  'domains',
  'fixtures',
  'helpers',
  'platform',
  'repository',
  'scripts',
];
const testRoots = directoryNames('test');
for (const testRoot of testRoots) {
  if (!allowedTestRoots.includes(testRoot)) {
    fail(`test/${testRoot}/ is not an allowed test root`);
  }
}

const domainNames = new Set(layout.domainModules);
for (const testDomain of directoryNames('test/domains')) {
  if (!domainNames.has(testDomain)) {
    fail(`test/domains/${testDomain}/ has no matching domains/${testDomain}/ source module`);
  }
}

const codeFilePattern = /\.(cjs|js|jsx|mjs|ts|tsx)$/;
const ignoredGeneratedTrees = new Set([
  '.agents',
  '.codex',
  '.comet',
  '.git',
  '.pytest_cache',
  '.tmp',
  '__pycache__',
  'coverage',
  'dist',
  'node_modules',
  ...[...gitSubmodulePaths].filter((submodulePath) => !submodulePath.includes('/')),
]);
const ignoredGeneratedRelativePaths = new Set([
  ...gitignoredDirectoryEntries,
  ...[...gitSubmodulePaths].filter((submodulePath) => submodulePath.includes('/')),
]);
for (const file of walkFiles('.', ignoredGeneratedTrees, ignoredGeneratedRelativePaths)) {
  if (!codeFilePattern.test(file)) continue;
  const normalized = file.replaceAll('\\', '/');
  const allowed =
    normalized.startsWith('app/') ||
    normalized.startsWith('domains/') ||
    normalized.startsWith('platform/') ||
    normalized.startsWith('scripts/') ||
    normalized.startsWith('test/') ||
    normalized.startsWith('assets/skills/comet/scripts/') ||
    normalized.startsWith('assets/skills/comet-native/scripts/') ||
    normalized.startsWith('eval/local/skills/') ||
    normalized === 'bin/comet.js' ||
    allowedRootSourceFiles.has(normalized);
  if (!allowed) {
    fail(`${normalized} is code outside an approved code root`);
  }
}

for (const file of walkFiles('domains/comet-native')) {
  if (!/\.ts$/u.test(file)) continue;
  const content = readFileSync(path.join(root, file), 'utf8');
  if (/\bfrom\s+['"][^'"]*comet-classic[^'"]*['"]/u.test(content)) {
    fail(`${file} must not import the Classic domain`);
  }
}

for (const guide of ['AGENTS.md', 'CLAUDE.md']) {
  const content = readFileSync(path.join(root, guide), 'utf8');
  if (!content.includes('## 项目结构规范')) {
    fail(`${guide} must document the project structure rules`);
  }
  if (!content.includes('test/ts')) {
    fail(`${guide} must explicitly ban the legacy test/ts bucket`);
  }
  if (
    !content.includes('app/`') ||
    !content.includes('domains/`') ||
    !content.includes('platform/`')
  ) {
    fail(`${guide} must describe the app/domains/platform source layout`);
  }
}

const packageJson = readJson('package.json');
if (packageJson.scripts?.['lint:architecture'] !== 'node scripts/lint/architecture.mjs') {
  fail('package.json must expose lint:architecture');
}
if (!packageJson.scripts?.lint?.includes('pnpm run lint:architecture')) {
  fail('package.json lint script must run lint:architecture');
}

if (failures.length > 0) {
  console.error('Architecture lint failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Architecture lint passed');
