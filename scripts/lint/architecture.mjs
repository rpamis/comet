import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
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
  '.zcode',
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
const allowedCodeFiles = new Set(layout.allowedCodeFiles ?? []);
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
    allowedCodeFiles.has(normalized) ||
    normalized === 'bin/comet.js' ||
    allowedRootSourceFiles.has(normalized);
  if (!allowed) {
    fail(`${normalized} is code outside an approved code root`);
  }
}

function normalizeRepositoryPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function sourceLayer(file) {
  const normalized = normalizeRepositoryPath(file);
  return normalized.split('/')[0];
}

function readCompilerOptions() {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    return {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      allowJs: true,
    };
  }
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) {
    fail(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
    return {};
  }
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath));
  for (const diagnostic of parsed.errors) {
    fail(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  }
  return { ...parsed.options, allowJs: true };
}

function importDeclarationIsRuntime(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
  }
  return clause.namedBindings !== undefined;
}

function exportDeclarationIsRuntime(node) {
  if (node.isTypeOnly) return false;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function collectDependencies(file, content) {
  const scriptKind = file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const dependencies = [];
  const sourceLine = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      dependencies.push({
        specifier: node.moduleSpecifier.text,
        runtime: importDeclarationIsRuntime(node),
        line: sourceLine(node),
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      dependencies.push({
        specifier: node.moduleSpecifier.text,
        runtime: exportDeclarationIsRuntime(node),
        line: sourceLine(node),
      });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (
        node.arguments.length === 1 &&
        argument &&
        (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
      ) {
        dependencies.push({ specifier: argument.text, runtime: true, line: sourceLine(node) });
      } else {
        dependencies.push({ specifier: null, runtime: true, line: sourceLine(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return dependencies;
}

function pathIsWithinModule(file, modulePath) {
  const normalizedModule = normalizeRepositoryPath(modulePath).replace(/\/$/u, '');
  return file === normalizedModule || file.startsWith(`${normalizedModule}/`);
}

function pureModelDependencyIsForbidden(specifier, target) {
  if (/^(?:node:)?fs(?:\/promises)?$/u.test(specifier)) return true;
  if (!target) return false;
  if (sourceLayer(target) === 'app' || sourceLayer(target) === 'platform') return true;
  return /(?:^|\/)(?:[^/]*-(?:cli|entry|lock|recovery)|native-change|native-supervisor|native-portable-runtime)\.tsx?$/u.test(
    target,
  );
}

function checkSourceDependencies() {
  const sourceFiles = new Set(
    layout.sourceRoots.flatMap((sourceRoot) =>
      walkFiles(sourceRoot).filter((file) => codeFilePattern.test(file)),
    ),
  );
  const compilerOptions = readCompilerOptions();
  const dependencyRules = layout.dependencyRules ?? {};
  const pureModelModules = new Set(
    (dependencyRules.pureModelModules ?? []).map(normalizeRepositoryPath),
  );
  const workflowCoreModules = (dependencyRules.workflowCoreModules ?? []).map(
    normalizeRepositoryPath,
  );
  const compatibilityFacadesByImplementation = new Map();
  for (const rule of dependencyRules.compatibilityFacades ?? []) {
    const facade = normalizeRepositoryPath(rule.facade ?? '');
    const implementations = (rule.implementations ?? []).map(normalizeRepositoryPath);
    if (!sourceFiles.has(facade) || implementations.length === 0) {
      fail(`compatibility facade ${facade || '(missing)'} must reference exact source files`);
      continue;
    }
    for (const implementation of implementations) {
      if (!sourceFiles.has(implementation) || /[*?{}[\]]/u.test(implementation)) {
        fail(`compatibility facade ${facade} must reference exact source files`);
        continue;
      }
      const facades = compatibilityFacadesByImplementation.get(implementation) ?? new Set();
      facades.add(facade);
      compatibilityFacadesByImplementation.set(implementation, facades);
    }
  }
  const exceptionKeys = new Set();
  const usedExceptionKeys = new Set();
  for (const exception of dependencyRules.exceptions ?? []) {
    const from = normalizeRepositoryPath(exception.from ?? '');
    const to = normalizeRepositoryPath(exception.to ?? '');
    const reason = typeof exception.reason === 'string' ? exception.reason.trim() : '';
    if (!from || !to || /[*?{}[\]]/u.test(from) || /[*?{}[\]]/u.test(to)) {
      fail('dependency exception paths must be exact files');
      continue;
    }
    if (!sourceFiles.has(from) || !sourceFiles.has(to)) {
      fail(`dependency exception ${from} -> ${to} must reference existing source files`);
      continue;
    }
    if (!reason) {
      fail(`dependency exception ${from} -> ${to} must include a reason`);
      continue;
    }
    exceptionKeys.add(`${from}\0${to}`);
  }

  const moduleResolutionHost = {
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    realpath: ts.sys.realpath,
    directoryExists: ts.sys.directoryExists,
    getCurrentDirectory: () => root,
    getDirectories: ts.sys.getDirectories,
  };
  const resolveSource = (importer, specifier) => {
    const normalizedSpecifier = specifier.replaceAll('\\', '/');
    const resolved = ts.resolveModuleName(
      normalizedSpecifier,
      path.join(root, importer),
      compilerOptions,
      moduleResolutionHost,
    ).resolvedModule?.resolvedFileName;
    if (!resolved) return null;
    const relative = normalizeRepositoryPath(path.relative(root, resolved));
    return sourceFiles.has(relative) ? relative : null;
  };

  const graph = new Map();
  for (const file of [...sourceFiles].sort()) {
    const content = readFileSync(path.join(root, file), 'utf8');
    const edges = [];
    for (const imported of collectDependencies(file, content)) {
      if (imported.specifier === null) {
        fail(`${file}:${imported.line} has a dynamic import that cannot be resolved statically`);
        continue;
      }
      const target = resolveSource(file, imported.specifier);
      if (!target) {
        const importedExtension = path.extname(imported.specifier.replaceAll('\\', '/'));
        if (
          imported.specifier.startsWith('.') &&
          (importedExtension === '' || codeFilePattern.test(importedExtension))
        ) {
          fail(`${file}:${imported.line} cannot resolve local dependency ${imported.specifier}`);
        }
        if (
          pureModelModules.has(file) &&
          imported.runtime &&
          pureModelDependencyIsForbidden(imported.specifier, null)
        ) {
          fail(`${file} is a pure model and must not depend on ${imported.specifier}`);
        }
        continue;
      }
      const exceptionKey = `${file}\0${target}`;
      const dependencyIsExcepted = exceptionKeys.has(exceptionKey);
      if (dependencyIsExcepted) {
        usedExceptionKeys.add(exceptionKey);
      }
      edges.push({ target, runtime: imported.runtime });
      if (dependencyIsExcepted) continue;
      if (
        (sourceLayer(file) === 'platform' && ['app', 'domains'].includes(sourceLayer(target))) ||
        (sourceLayer(file) === 'domains' && sourceLayer(target) === 'app')
      ) {
        fail(`${file} must not depend on ${target}`);
      }
      if (file.startsWith('domains/comet-native/') && target.startsWith('domains/comet-classic/')) {
        fail(`${file} must not depend on ${target}`);
      }
      if (
        workflowCoreModules.some((modulePath) => pathIsWithinModule(file, modulePath)) &&
        target.startsWith('domains/comet-entry/')
      ) {
        fail(`${file} must not depend on ${target}`);
      }
      if (
        pureModelModules.has(file) &&
        imported.runtime &&
        pureModelDependencyIsForbidden(imported.specifier, target)
      ) {
        fail(`${file} is a pure model and must not depend on ${target}`);
      }
      if (compatibilityFacadesByImplementation.get(file)?.has(target)) {
        fail(`${file} must not depend on compatibility facade ${target}`);
      }
    }
    graph.set(file, edges);
  }

  for (const exceptionKey of exceptionKeys) {
    if (!usedExceptionKeys.has(exceptionKey)) {
      const [from, to] = exceptionKey.split('\0');
      fail(`dependency exception ${from} -> ${to} is unused`);
    }
  }

  const runtimeGraph = new Map(
    [...graph].map(([file, edges]) => [
      file,
      edges.filter(({ runtime }) => runtime).map(({ target }) => target),
    ]),
  );
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const reportedCycles = new Set();
  const visit = (file) => {
    if (visiting.has(file)) {
      const cycleStart = stack.indexOf(file);
      const cycle = [...stack.slice(cycleStart), file];
      const key = [...cycle.slice(0, -1)].sort().join('|');
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        fail(`runtime dependency cycle: ${cycle.join(' -> ')}`);
      }
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const dependency of runtimeGraph.get(file) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  };
  for (const file of [...runtimeGraph.keys()].sort()) visit(file);
}

checkSourceDependencies();

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
