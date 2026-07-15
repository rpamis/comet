#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'assets', 'skills', 'comet', 'scripts');
const CLASSIC_RUNTIME_ROOT = path.join(
  REPO_ROOT,
  'assets',
  'skills',
  'comet',
  'runtime',
  'classic',
);
const SCRIPT_BY_COMMAND = {
  archive: 'comet-archive.mjs',
  guard: 'comet-guard.mjs',
  handoff: 'comet-handoff.mjs',
  'hook-guard': 'comet-hook-guard.mjs',
  state: 'comet-state.mjs',
  validate: 'comet-yaml-validate.mjs',
};

function run(cwd, args, options = {}) {
  const [command, ...rest] = args;
  const script = SCRIPT_BY_COMMAND[command];
  if (!script) throw new Error(`Unknown Classic benchmark command: ${command}`);
  return spawnSync(process.execPath, [path.join(SCRIPTS_DIR, script), ...rest], {
    cwd,
    encoding: 'utf8',
    input: options.input,
    env: {
      ...process.env,
      COMET_RUNTIME_CLASSIC_ROOT: CLASSIC_RUNTIME_ROOT,
      COMET_CLASSIC_SKILL_ROOT: CLASSIC_RUNTIME_ROOT,
      ...options.env,
    },
  });
}

function state(cwd, ...args) {
  const options = {};
  if (args[0] === 'set' && args[2] === 'phase') {
    // Direct phase writes are blocked; the force hatch seeds a phase for the
    // benchmark scenarios.
    options.env = { ...process.env, COMET_FORCE_PHASE: '1' };
  }
  return run(cwd, ['state', ...args], options);
}

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

async function readState(changeDir) {
  const yamlState = parse(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8'));
  try {
    const runJson = JSON.parse(
      await fs.readFile(path.join(changeDir, '.comet', 'run-state.json'), 'utf8'),
    );
    for (const [key, value] of Object.entries(runJson)) {
      yamlState[camelToSnake(key)] = value;
    }
    // Backward-compat aliases: the old yaml format used run_status / run_retries
    // but the JSON format uses status / retries.
    if (runJson.status != null) yamlState.run_status = runJson.status;
    if (runJson.retries != null) yamlState.run_retries = runJson.retries;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return yamlState;
}

function hookInput(filePath) {
  return JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: '// benchmark' },
  });
}

const CONTROLLED_MIGRATION_GUARD_DIAGNOSTIC =
  'BLOCKED — fix failing checks before proceeding to next phase';

function migrationGuardOutcome(result, phase) {
  const diagnostic = result.stderr.includes(CONTROLLED_MIGRATION_GUARD_DIAGNOSTIC)
    ? CONTROLLED_MIGRATION_GUARD_DIAGNOSTIC
    : null;
  return {
    phase,
    status: result.status,
    signal: result.signal ?? null,
    controlledOutcome:
      result.status === 1 && result.signal === null && !result.error && diagnostic !== null,
    diagnostic,
  };
}

async function resetScenario(workspace, name) {
  const directory = path.join(workspace, name);
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

function result(name, startedAt, checks, detail = {}) {
  return {
    name,
    transitionAccuracy: Boolean(checks.transitionAccuracy),
    migrationSuccess: Boolean(checks.migrationSuccess),
    idempotent: Boolean(checks.idempotent),
    contractMatch: Boolean(checks.contractMatch),
    durationMs: Date.now() - startedAt,
    detail,
  };
}

async function profileScenario(workspace, profile) {
  const name = `profile-${profile}`;
  const startedAt = Date.now();
  const directory = await resetScenario(workspace, name);
  state(directory, 'init', name, profile);
  const changeDir = path.join(directory, 'openspec', 'changes', name);

  const migrationGuard = migrationGuardOutcome(run(directory, ['guard', name, 'open']), 'open');
  const migrated = await readState(changeDir);
  const beforeHooks = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');
  const first = run(directory, ['hook-guard'], { input: hookInput('src/index.ts') });
  const afterFirst = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');
  const second = run(directory, ['hook-guard'], { input: hookInput('src/index.ts') });
  const afterSecond = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

  return result(
    name,
    startedAt,
    {
      transitionAccuracy:
        migrationGuard.controlledOutcome &&
        first.status === 2 &&
        second.status === 2 &&
        migrated.current_step === `${profile}.open`,
      migrationSuccess:
        migrationGuard.controlledOutcome &&
        migrated.classic_migration === 1 &&
        migrated.classic_profile === profile &&
        migrated.skill === 'comet-classic',
      idempotent: beforeHooks === afterFirst && afterFirst === afterSecond,
      contractMatch:
        migrated.workflow === profile && migrated.phase === 'open' && migrated.archived === false,
    },
    { currentStep: migrated.current_step, migrationGuard },
  );
}

async function retryFixScenario(workspace) {
  const name = 'retry-fix';
  const startedAt = Date.now();
  const directory = await resetScenario(workspace, name);
  state(directory, 'init', name, 'hotfix');
  for (const [field, value] of [
    ['phase', 'build'],
    ['build_mode', 'direct'],
    ['tdd_mode', 'direct'],
    ['isolation', 'branch'],
    ['verify_mode', 'light'],
    ['verify_result', 'fail'],
  ]) {
    state(directory, 'set', name, field, value);
  }
  const changeDir = path.join(directory, 'openspec', 'changes', name);
  const migrationGuard = migrationGuardOutcome(run(directory, ['guard', name, 'build']), 'build');
  const migrated = await readState(changeDir);
  const beforeHooks = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');
  const first = run(directory, ['hook-guard'], { input: hookInput('src/fix.ts') });
  const afterFirst = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');
  const second = run(directory, ['hook-guard'], { input: hookInput('src/fix.ts') });
  const afterSecond = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

  return result(
    name,
    startedAt,
    {
      transitionAccuracy:
        migrationGuard.controlledOutcome &&
        first.status === 0 &&
        migrated.current_step === 'hotfix.build.execute',
      migrationSuccess:
        migrationGuard.controlledOutcome &&
        migrated.classic_migration === 1 &&
        migrated.skill === 'comet-classic',
      idempotent: second.status === 0 && beforeHooks === afterFirst && afterFirst === afterSecond,
      contractMatch:
        migrated.workflow === 'hotfix' &&
        migrated.phase === 'build' &&
        migrated.verify_result === 'fail',
    },
    { currentStep: migrated.current_step, migrationGuard },
  );
}

async function handoffResumeScenario(workspace) {
  const name = 'handoff-resume';
  const startedAt = Date.now();
  const directory = await resetScenario(workspace, name);
  state(directory, 'init', name, 'full');
  const changeDir = path.join(directory, 'openspec', 'changes', name);
  await fs.writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
  await fs.writeFile(path.join(changeDir, 'design.md'), 'design\n');
  await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] task\n');
  state(directory, 'transition', name, 'open-complete');

  const first = run(directory, ['handoff', name, 'design', '--write']);
  const initial = await readState(changeDir);
  const actionId = `classic-handoff:${initial.handoff_hash}`;
  await fs.writeFile(
    path.join(changeDir, initial.pending_ref),
    JSON.stringify(
      {
        id: actionId,
        stepId: initial.current_step,
        type: 'handoff',
        ref: initial.handoff_hash,
      },
      null,
      2,
    ) + '\n',
  );
  state(directory, 'set', name, 'pending', actionId);
  const resumed = run(directory, ['handoff', name, 'design', '--write']);
  const recovered = await readState(changeDir);
  const trajectory = (await fs.readFile(path.join(changeDir, recovered.trajectory_ref), 'utf8'))
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const recoveredBytes = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');
  const repeated = run(directory, ['handoff', name, 'design', '--write']);
  const repeatedBytes = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');
  const recoveries = trajectory.filter(
    (event) => event.type === 'recovery_reconciled' && event.data?.kind === 'classic-handoff',
  ).length;

  return result(
    name,
    startedAt,
    {
      transitionAccuracy:
        first.status === 0 &&
        resumed.status === 0 &&
        recovered.current_step === 'full.design.document',
      migrationSuccess: recovered.classic_migration === 1 && recovered.pending === null,
      idempotent: repeated.status === 0 && recoveredBytes === repeatedBytes && recoveries === 1,
      contractMatch:
        typeof recovered.handoff_hash === 'string' &&
        recovered.handoff_context.endsWith('design-context.json'),
    },
    { currentStep: recovered.current_step, recoveries },
  );
}

async function fakeOpenSpec(directory) {
  const script = path.join(directory, 'fake-openspec.mjs');
  await fs.writeFile(
    script,
    [
      "import { promises as fs } from 'fs';",
      "import path from 'path';",
      'const change = process.argv[3];',
      "const source = path.join('openspec', 'changes', change);",
      "const target = path.join('openspec', 'changes', 'archive', `${new Date().toISOString().slice(0, 10)}-${change}`);",
      'await fs.mkdir(path.dirname(target), { recursive: true });',
      'await fs.rename(source, target);',
      'process.exit(9);',
    ].join('\n'),
  );
  if (process.platform === 'win32') {
    const command = path.join(directory, 'fake-openspec.cmd');
    await fs.writeFile(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    return command;
  }
  const command = path.join(directory, 'fake-openspec');
  await fs.writeFile(command, `#!/usr/bin/env node\nimport ${JSON.stringify(script)};\n`, {
    mode: 0o755,
  });
  return command;
}

async function archiveRecoveryScenario(workspace) {
  const name = 'archive-recovery';
  const startedAt = Date.now();
  const directory = await resetScenario(workspace, name);
  state(directory, 'init', name, 'full');
  state(directory, 'set', name, 'phase', 'archive');
  state(directory, 'set', name, 'verify_result', 'pass');
  state(directory, 'transition', name, 'archive-confirm');
  const openspec = await fakeOpenSpec(directory);
  const interrupted = run(directory, ['archive', name], {
    env: { COMET_OPENSPEC: openspec },
  });
  const resumed = run(directory, ['archive', name], {
    env: { COMET_OPENSPEC: openspec },
  });
  const archiveDir = path.join(
    directory,
    'openspec',
    'changes',
    'archive',
    `${new Date().toISOString().slice(0, 10)}-${name}`,
  );
  const recovered = await readState(archiveDir);
  const trajectory = (await fs.readFile(path.join(archiveDir, recovered.trajectory_ref), 'utf8'))
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const recoveredBytes = await fs.readFile(path.join(archiveDir, '.comet.yaml'), 'utf8');
  const repeated = run(directory, ['archive', name], {
    env: { COMET_OPENSPEC: openspec },
  });
  const repeatedBytes = await fs.readFile(path.join(archiveDir, '.comet.yaml'), 'utf8');
  const recoveries = trajectory.filter(
    (event) => event.type === 'recovery_reconciled' && event.data?.kind === 'classic-archive',
  ).length;

  return result(
    name,
    startedAt,
    {
      transitionAccuracy:
        interrupted.status === 9 && resumed.status === 0 && recovered.current_step === 'completed',
      migrationSuccess:
        recovered.classic_migration === 1 &&
        recovered.archived === true &&
        recovered.run_status === 'completed',
      idempotent: repeated.status === 0 && recoveredBytes === repeatedBytes && recoveries === 1,
      contractMatch:
        recovered.workflow === 'full' &&
        recovered.phase === 'archive' &&
        recovered.pending === null,
    },
    { currentStep: recovered.current_step, recoveries },
  );
}

async function malformedScenario(workspace) {
  const name = 'malformed-rejection';
  const startedAt = Date.now();
  const directory = await resetScenario(workspace, name);
  state(directory, 'init', name, 'full');
  const changeDir = path.join(directory, 'openspec', 'changes', name);
  const stateFile = path.join(changeDir, '.comet.yaml');
  await fs.appendFile(stateFile, 'unknown_root_field: true\n');
  const before = await fs.readFile(stateFile, 'utf8');
  const first = run(directory, ['hook-guard'], { input: hookInput('src/index.ts') });
  const middle = await fs.readFile(stateFile, 'utf8');
  const second = run(directory, ['hook-guard'], { input: hookInput('src/index.ts') });
  const after = await fs.readFile(stateFile, 'utf8');

  return result(
    name,
    startedAt,
    {
      transitionAccuracy: first.status === 2 && second.status === 2,
      // The reader is lenient about unknown fields (it falls back to the legacy
      // summary rather than crashing); success here is that the malformed state
      // is NOT silently migrated into a Classic Run.
      migrationSuccess: !after.includes('classic_migration:') && before === after,
      idempotent: before === middle && middle === after,
      contractMatch: !before.includes('classic_migration:'),
    },
    { rejected: true },
  );
}

function rate(results, key) {
  return results.filter((item) => item[key]).length / results.length;
}

export async function runClassicBaselineBenchmark(options = {}) {
  const startedAt = Date.now();
  const temporary = !options.workspace;
  const workspace = options.workspace
    ? path.resolve(options.workspace)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-benchmark-'));
  await fs.mkdir(workspace, { recursive: true });

  try {
    const results = [];
    for (const profile of ['full', 'hotfix', 'tweak']) {
      results.push(await profileScenario(workspace, profile));
    }
    results.push(await retryFixScenario(workspace));
    results.push(await handoffResumeScenario(workspace));
    results.push(await archiveRecoveryScenario(workspace));
    results.push(await malformedScenario(workspace));

    return {
      scenarios: results.length,
      transitionAccuracy: rate(results, 'transitionAccuracy'),
      migrationSuccessRate: rate(results, 'migrationSuccess'),
      idempotencyRate: rate(results, 'idempotent'),
      contractMatchRate: rate(results, 'contractMatch'),
      durationMs: Date.now() - startedAt,
      results,
    };
  } finally {
    if (temporary) await fs.rm(workspace, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--workspace') {
      const value = argv[index + 1];
      if (!value) throw new Error('--workspace requires a value');
      options.workspace = value;
      index += 1;
      continue;
    }
    if (argv[index] === '--help') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${argv[index]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'Usage: node scripts/benchmark/classic-baseline-regression.mjs [--workspace <dir>]\n',
    );
  } else {
    const report = await runClassicBaselineBenchmark(options);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (
      report.transitionAccuracy !== 1 ||
      report.migrationSuccessRate !== 1 ||
      report.idempotencyRate !== 1 ||
      report.contractMatchRate !== 1
    ) {
      process.exitCode = 1;
    }
  }
}
