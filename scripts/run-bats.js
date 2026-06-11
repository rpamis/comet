#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function escapeRegExp(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function findUsableBash() {
  const candidates = [
    process.env.COMET_TEST_BASH,
    process.env.COMET_BASH,
    'bash',
    ...(process.platform === 'win32'
      ? [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        ]
      : []),
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    const probe = spawnSync(candidate, ['-lc', 'uname -s'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim()) {
      if (process.platform === 'win32' && /linux/i.test(probe.stdout)) continue;
      return candidate;
    }
  }
  return null;
}

const bashCommand = findUsableBash();
const bashUname = bashCommand
  ? (spawnSync(bashCommand, ['-lc', 'uname -s'], { encoding: 'utf8' }).stdout || '').trim()
  : '';
const isGitBash = /^(MINGW|MSYS|CYGWIN)/.test(bashUname);

function toBashPath(filePath) {
  const resolved = path.resolve(filePath).replace(/\\/g, '/');
  const driveMatch = resolved.match(/^([A-Za-z]):\/(.*)$/);
  if (!driveMatch) return resolved;
  if (process.platform === 'win32' && isGitBash) {
    return `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
  }
  return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function expandArgs(args) {
  const files = [];
  for (const arg of args) {
    if (!arg.includes('*')) {
      files.push(arg);
      continue;
    }

    const dir = path.dirname(arg);
    const base = path.basename(arg);
    const pattern = new RegExp(`^${base.split('*').map(escapeRegExp).join('.*')}$`);
    for (const entry of readdirSync(dir)) {
      if (pattern.test(entry)) files.push(path.join(dir, entry));
    }
  }
  return files.sort();
}

function parseBats(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const prelude = [];
  const tests = [];
  let current = null;

  for (const line of lines) {
    const testMatch = line.match(/^@test "(.+)" \{\s*$/);
    if (testMatch) {
      current = { name: testMatch[1], body: [] };
      continue;
    }

    if (current) {
      if (/^\}\s*$/.test(line)) {
        tests.push(current);
        current = null;
      } else {
        current.body.push(line);
      }
      continue;
    }

    prelude.push(line);
  }

  if (current) {
    throw new Error(`Unclosed @test block: ${current.name}`);
  }

  return { prelude, tests };
}

function compileBats(file) {
  const content = readFileSync(file, 'utf8');
  const { prelude, tests } = parseBats(content);
  const testDir = toBashPath(path.dirname(file));
  const chunks = [
    '#!/usr/bin/env bash',
    'set +e',
    `export BATS_TEST_DIRNAME=${shellQuote(testDir)}`,
    'status=0',
    'output=""',
    'run() {',
    '  output="$("$@" 2>&1)"',
    '  status=$?',
    '  return 0',
    '}',
    ...prelude,
  ];

  tests.forEach((test, index) => {
    chunks.push(`__bats_test_${index + 1}() {`);
    chunks.push('  set -e');
    chunks.push(...test.body.map((line) => `  ${line}`));
    chunks.push('}');
  });

  chunks.push('failures=0');
  tests.forEach((test, index) => {
    const fn = `__bats_test_${index + 1}`;
    chunks.push(`__bats_output="$(mktemp)"`);
    chunks.push(`if ( trap teardown EXIT; setup; ${fn} ) >"$__bats_output" 2>&1; then`);
    chunks.push(`  echo "ok ${index + 1} - ${test.name}"`);
    chunks.push('else');
    chunks.push(`  echo "not ok ${index + 1} - ${test.name}"`);
    chunks.push('  cat "$__bats_output" >&2');
    chunks.push('  failures=$((failures + 1))');
    chunks.push('fi');
    chunks.push('rm -f "$__bats_output"');
  });
  chunks.push('exit "$failures"');

  return chunks.join('\n');
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: run-bats.js <file.bats> [...]');
  process.exit(1);
}

const files = expandArgs(args);
if (files.length === 0) {
  console.error(`No .bats files matched: ${args.join(' ')}`);
  process.exit(1);
}

if (!bashCommand) {
  console.error('ERROR: usable bash not found. Install Git Bash or set COMET_TEST_BASH/COMET_BASH to a working bash executable.');
  console.error('Windows WSL launcher bash.exe is not supported for Comet shell tests.');
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const tests = parseBats(readFileSync(file, 'utf8')).tests;
  console.log(`# ${file}`);
  console.log(`1..${tests.length}`);

  const tempDir = mkdtempSync(path.join(tmpdir(), 'comet-bats-'));
  const compiled = path.join(tempDir, 'compiled.bash');
  writeFileSync(compiled, compileBats(file), 'utf8');

  const result = spawnSync(bashCommand, [toBashPath(compiled)], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) failures += result.status ?? 1;

  rmSync(tempDir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
