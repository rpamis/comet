import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_PATTERN = /^(?:app|domains|platform|scripts|test)\/.*\.(?:cjs|js|jsx|mjs|ts|tsx)$/u;
const FORMAT_PATTERN =
  /^(?:\.claude\/rules\/|\.github\/|app\/|config\/|domains\/|platform\/|scripts\/|test\/)|^(?:AGENTS|CLAUDE)\.md$|^(?:build\.js|package\.json|tsconfig\.json|vitest\.config\.ts)$/u;
const RUNTIME_SOURCE_PATTERN =
  /^(?:domains\/(?:comet-classic|comet-entry|comet-native|workflow-contract)\/.*\.(?:ts|tsx)|platform\/process\/hook-adapter\.ts|scripts\/build\/build-(?:classic|entry|native)-runtime\.mjs|assets\/skills\/(?:comet|comet-native)\/scripts\/.*\.mjs)$/u;
const AGENT_RULE_PATTERN =
  /^(?:(?:AGENTS|CLAUDE)\.md|\.claude\/rules\/.*\.md|(?:app|assets|docs|eval|platform|test|domains\/[^/]+|scripts\/release)\/AGENTS\.md)$/u;

function normalizeFile(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function command(executable, args) {
  return {
    executable,
    args,
    command: [executable, ...args].join(' '),
  };
}

export function resolvePnpmInvocation({
  platform = process.platform,
  pathValue = process.env.PATH ?? '',
  npmExecPath = process.env.npm_execpath,
} = {}) {
  if (platform !== 'win32') return { executable: 'pnpm', argumentPrefix: [] };

  const candidates = [];
  if (npmExecPath?.endsWith('.cjs') || npmExecPath?.endsWith('.js')) {
    candidates.push(npmExecPath);
  }
  for (const directory of pathValue.split(';').filter(Boolean)) {
    candidates.push(path.join(directory, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
  }
  const pnpmEntry = candidates.find((candidate) => existsSync(candidate));
  if (!pnpmEntry) {
    throw new Error('Cannot resolve the pnpm JavaScript entrypoint from PATH on Windows');
  }
  return { executable: process.execPath, argumentPrefix: [pnpmEntry] };
}

export function planChangedVerification(changedFiles) {
  const files = [...new Set(changedFiles.map(normalizeFile).filter(Boolean))].sort();
  const checks = [];
  const checkIds = new Set();
  const commandKeys = new Set();
  const add = (id, executable, args, reason) => {
    const commandKey = JSON.stringify([executable, args]);
    if (checkIds.has(id) || commandKeys.has(commandKey)) return;
    checkIds.add(id);
    commandKeys.add(commandKey);
    checks.push({ id, ...command(executable, args), reason });
  };

  if (files.some((file) => SOURCE_PATTERN.test(file) || file === 'config/repository-layout.json')) {
    add(
      'architecture',
      'pnpm',
      ['lint:architecture'],
      'Source, test, script, or repository layout changed.',
    );
  }
  if (files.some((file) => /^(?:app|domains|platform|test)\/.*\.(?:ts|tsx)$/u.test(file))) {
    add('typecheck', 'pnpm', ['exec', 'tsc', '--noEmit'], 'TypeScript source or tests changed.');
  }
  if (files.some((file) => FORMAT_PATTERN.test(file))) {
    add('format', 'pnpm', ['format:check'], 'A repository-formatted file changed.');
  }
  if (files.some((file) => RUNTIME_SOURCE_PATTERN.test(file))) {
    add(
      'generated',
      'pnpm',
      ['check:generated'],
      'Runtime source, build entry, or generated Runtime asset changed.',
    );
  }
  if (files.some((file) => AGENT_RULE_PATTERN.test(file))) {
    add(
      'agent-rules',
      'pnpm',
      ['exec', 'vitest', 'run', 'test/repository/development-agent-rules.test.ts'],
      'Repository Agent instructions or Claude path rules changed.',
    );
  }

  const domainNames = new Set();
  let appChanged = false;
  let platformChanged = false;
  let scriptsChanged = false;
  for (const file of files) {
    const domain = /^domains\/([^/]+)\/.*\.(?:ts|tsx)$/u.exec(file)?.[1];
    if (domain) domainNames.add(domain);
    if (/^app\/.*\.(?:ts|tsx)$/u.test(file)) appChanged = true;
    if (/^platform\/.*\.(?:ts|tsx)$/u.test(file)) platformChanged = true;
    if (/^scripts\/.*\.(?:js|mjs|cjs|ts)$/u.test(file)) scriptsChanged = true;
  }
  if (appChanged) {
    add('app', 'pnpm', ['exec', 'vitest', 'run', 'test/app'], 'App source changed.');
  }
  if (platformChanged) {
    add('platform', 'pnpm', ['exec', 'vitest', 'run', 'test/platform'], 'Platform source changed.');
  }
  if (scriptsChanged) {
    add(
      'scripts',
      'pnpm',
      ['exec', 'vitest', 'run', 'test/scripts'],
      'Repository scripts changed.',
    );
  }
  for (const domain of [...domainNames].sort()) {
    add(
      `domain:${domain}`,
      'pnpm',
      ['exec', 'vitest', 'run', `test/domains/${domain}`],
      `Domain ${domain} changed.`,
    );
  }
  for (const file of files.filter((candidate) =>
    /^test\/.*\.test\.(?:ts|tsx|js)$/u.test(candidate),
  )) {
    const coveredByModuleSuite =
      (appChanged && file.startsWith('test/app/')) ||
      (platformChanged && file.startsWith('test/platform/')) ||
      (scriptsChanged && file.startsWith('test/scripts/')) ||
      [...domainNames].some((domain) => file.startsWith(`test/domains/${domain}/`));
    if (coveredByModuleSuite) continue;
    add(
      `test:${file}`,
      'pnpm',
      ['exec', 'vitest', 'run', file],
      'The test file changed and must execute directly.',
    );
  }

  return checks;
}

function parseArguments(argv) {
  const options = { base: 'HEAD', json: false, plan: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base') {
      const value = argv[index + 1];
      if (!value) throw new Error('--base requires a Git revision');
      options.base = value;
      index += 1;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--plan') {
      options.plan = true;
    } else if (argument === '--help') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function gitLines(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles(base) {
  gitLines(['rev-parse', '--verify', `${base}^{commit}`]);
  return [
    ...gitLines(['diff', '--name-only', '--diff-filter=ACMRD', base, '--']),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ];
}

function printHelp() {
  console.log(`Usage: pnpm verify:changed --base <git-ref> [--plan] [--json]

Plans and runs the read-only checks required by files changed from <git-ref>.
The default base is HEAD, which validates staged, unstaged, and untracked work.`);
}

function run(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    printHelp();
    return 0;
  }
  const files = changedFiles(options.base);
  const checks = planChangedVerification(files);
  if (options.json) {
    console.log(
      JSON.stringify(
        { base: options.base, files: files.map(normalizeFile).sort(), checks },
        null,
        2,
      ),
    );
  } else {
    console.log(`Changed verification from ${options.base}: ${checks.length} check(s)`);
    for (const check of checks) console.log(`- ${check.command} (${check.reason})`);
  }
  if (options.plan) return 0;

  const invocation = resolvePnpmInvocation();
  for (const check of checks) {
    const result = spawnSync(invocation.executable, [...invocation.argumentPrefix, ...check.args], {
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
