import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const BASELINE_FILE = path.join(path.dirname(SCRIPT_PATH), 'runtime-coldstart-baseline.json');
const SCHEMA = 'comet.runtime-benchmark.v2';
const DEFAULT_THRESHOLD = 0.3;
const PROFILE_PREFIX = 'COMET_BENCHMARK_PROFILE=';
const FS_PROFILE_PREFIX = 'COMET_BENCHMARK_FS_PROFILE=';

export function isolatedBenchmarkEnvironment(home, inherited = process.env) {
  return {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData/Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local/share'),
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_CONFIG_SYSTEM: path.join(home, 'git-system'),
    NODE_OPTIONS: '',
    COMET_TASK: '',
    COMET_TASK_PHASE: '',
    COMET_TASK_PATH: '',
    COMET_SKIP_UPDATE_CHECK: '1',
  };
}

export function validateRuntimeProcess(target, result) {
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `${target.name}: unsuccessful process (${result.error?.message ?? result.signal ?? result.status})\n${result.stderr ?? ''}\n${result.stdout ?? ''}`,
    );
  }
  return target.validate?.(result.stdout ?? '', result);
}

/** Preparation and postcondition checks are deliberately outside the timed interval. */
export async function measureRuntimeSample(target, env, options = {}) {
  await target.prepare?.();
  const spawn = options.spawn ?? spawnSync;
  const start = process.hrtime.bigint();
  const result = spawn(
    process.execPath,
    [...(options.profile ? ['--require', options.profile] : []), ...target.args],
    {
      cwd: target.cwd,
      env,
      encoding: 'utf8',
      input: target.input,
      timeout: options.timeout ?? 30_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );
  const milliseconds = Number(process.hrtime.bigint() - start) / 1e6;
  await validateRuntimeProcess(target, result);
  await target.postcondition?.();
  const profile = (result.stderr ?? '').split('\n').find((line) => line.startsWith(PROFILE_PREFIX));
  const fsProfile = (result.stderr ?? '')
    .split('\n')
    .find((line) => line.startsWith(FS_PROFILE_PREFIX));
  if (options.profile && !profile) throw new Error(`${target.name}: missing Git instrumentation`);
  return {
    milliseconds,
    exitCode: result.status,
    stdoutBytes: Buffer.byteLength(result.stdout ?? ''),
    stderrBytes: Buffer.byteLength(result.stderr ?? ''),
    git: profile ? JSON.parse(profile.slice(PROFILE_PREFIX.length)) : null,
    fs: fsProfile ? JSON.parse(fsProfile.slice(FS_PROFILE_PREFIX.length)) : null,
  };
}

function jsonSuccess(stdout) {
  const result = JSON.parse(stdout);
  if (result.exitCode !== undefined && result.exitCode !== 0)
    throw new Error('Runtime envelope failed');
  if (result.status === 'failed' || result.error)
    throw new Error('Runtime returned a failure envelope');
  return result;
}

function expectedData(expected) {
  return (stdout) => {
    const result = jsonSuccess(stdout);
    for (const [key, value] of Object.entries(expected)) {
      if (result.data?.[key] !== value)
        throw new Error(`Unexpected Runtime data.${key}: expected ${value}`);
    }
  };
}

async function directorySnapshot(root) {
  const files = new Map();
  const directories = new Set();
  async function walk(directory) {
    directories.add(directory);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      // Fixtures do not mutate Git history or the index; Git object files may be read-only.
      if (entry.name === '.git') continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error('Benchmark fixtures must not contain symbolic links');
      if (entry.isDirectory()) await walk(file);
      else files.set(file, await fs.readFile(file));
    }
  }
  await walk(root);
  return { files, directories };
}

async function restoreSnapshot(root, snapshot) {
  const current = await directorySnapshot(root);
  for (const file of current.files.keys()) {
    if (!snapshot.files.has(file)) await fs.unlink(file);
  }
  for (const directory of [...current.directories].sort((a, b) => b.length - a.length)) {
    if (!snapshot.directories.has(directory)) await fs.rmdir(directory);
  }
  for (const directory of snapshot.directories) await fs.mkdir(directory, { recursive: true });
  for (const [file, bytes] of snapshot.files) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  }
}

const PROFILE_LOADER = `const cp = require('node:child_process');
const rows = [];
for (const method of ['execFileSync', 'spawnSync']) {
  const original = cp[method];
  cp[method] = function (...args) {
    const start = process.hrtime.bigint();
    try { return original.apply(this, args); }
    finally {
      if (/(?:^|[\\\\/])git(?:\\.exe)?$/i.test(String(args[0]))) {
        rows.push({ args: args[1], milliseconds: Number(process.hrtime.bigint() - start) / 1e6 });
      }
    }
  };
}
const fsRows = [];
const fsp = require('node:fs').promises;
for (const method of ['readFile', 'stat', 'lstat', 'readdir']) {
  const original = fsp[method];
  fsp[method] = async function (...args) {
    const start = process.hrtime.bigint();
    let bytes;
    try {
      const value = await original.apply(this, args);
      if (method === 'readFile') {
        bytes = Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value);
      }
      return value;
    }
    finally {
      fsRows.push({
        method,
        milliseconds: Number(process.hrtime.bigint() - start) / 1e6,
        ...(bytes === undefined ? {} : { bytes }),
      });
    }
  };
}
require('node:module').syncBuiltinESMExports();
process.on('exit', () => {
  process.stderr.write('${PROFILE_PREFIX}' + JSON.stringify(rows) + '\\n');
  process.stderr.write('${FS_PROFILE_PREFIX}' + JSON.stringify(fsRows) + '\\n');
});
`;

async function createFixture(repoRoot, worktreeCounts) {
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, 'comet-runtime-benchmark-'));
  const home = path.join(root, 'home');
  const env = isolatedBenchmarkEnvironment(home);
  const bin = path.join(repoRoot, 'bin/comet.js');
  const native = path.join(root, 'native');
  const classic = path.join(root, 'classic');
  const targets = [];
  const profile = path.join(root, 'profile.cjs');
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(profile, PROFILE_LOADER);
  const cleanup = async () => {
    const resolved = await fs.realpath(root);
    if (
      path.dirname(resolved).toLowerCase() !== temp.toLowerCase() ||
      !path.basename(resolved).startsWith('comet-runtime-benchmark-')
    ) {
      throw new Error('Refusing to clean a benchmark directory outside its temporary root');
    }
    await fs.rm(resolved, { recursive: true, force: true });
  };
  function git(cwd, args) {
    const result = spawnSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    });
    validateRuntimeProcess({ name: `fixture git ${args[0]}` }, result);
    return result.stdout.trim();
  }
  async function initialize(cwd) {
    await fs.mkdir(cwd, { recursive: true });
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.name', 'Comet benchmark']);
    git(cwd, ['config', 'user.email', 'benchmark@example.test']);
    await fs.writeFile(path.join(cwd, 'README.md'), '# Runtime fixture\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'fixture']);
  }
  const cli = (cwd, args, validate = jsonSuccess) =>
    measureRuntimeSample(
      { name: `fixture ${args.join(' ')}`, cwd, args: [bin, ...args], validate },
      env,
    );
  const add = (name, cwd, args, validate = jsonSuccess, extra = {}) =>
    targets.push({ name, cwd, args: [bin, ...args], validate, ...extra });
  try {
    await initialize(native);
    await initialize(classic);
    await cli(
      native,
      ['native', 'new', 'benchmark-native', '--json'],
      expectedData({ phase: 'shape', state_version: 1 }),
    );
    await fs.mkdir(path.join(classic, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(classic, '.comet/config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    await fs.mkdir(path.join(classic, 'openspec/changes'), { recursive: true });
    await fs.mkdir(path.join(classic, 'openspec/specs'), { recursive: true });
    await cli(classic, ['state', 'init', 'benchmark-classic', 'tweak', '--json']);
    await cli(classic, ['state', 'select', 'benchmark-classic', '--json']);
    const changeDir = path.join(native, 'docs/comet/changes/benchmark-native');
    const stateFile = path.join(changeDir, 'comet-state.yaml');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Outcome\nVerify a fixture behavior.\n# Scope\nOne minimal change.\n# Non-goals\nNo extra behavior.\n# Acceptance examples\n- The fixture behaves correctly.\n# Constraints and invariants\nKeep existing behavior.\n# Decisions\nUse the smallest implementation.\n# Open questions\nNone.\n# Verification expectations\nRun the focused check.\n',
    );
    const snapshotRoots = ['docs', '.comet'].map((part) => path.join(native, part));
    const snapshots = await Promise.all(snapshotRoots.map(directorySnapshot));
    const restore = async () => {
      for (let i = 0; i < snapshots.length; i++)
        await restoreSnapshot(snapshotRoots[i], snapshots[i]);
      const state = parse(await fs.readFile(stateFile, 'utf8'));
      if (state.phase !== 'shape' || state.state_version !== 1 || state.status !== 'active')
        throw new Error('Native benchmark snapshot is not the original Shape');
    };
    const validateNext = (stdout) => {
      const result = jsonSuccess(stdout);
      if (
        result.data?.state?.phase !== 'shape' ||
        result.data?.state?.status !== 'await-user' ||
        result.data?.continuation?.action !== 'confirm-shape'
      )
        throw new Error('Native next did not prepare the expected Shape confirmation');
    };
    const nextExtra = {
      prepare: restore,
      postcondition: async () => {
        const state = parse(await fs.readFile(stateFile, 'utf8'));
        if (state.phase !== 'shape' || state.status !== 'await-user' || state.state_version !== 2)
          throw new Error('Native next failed its persisted postcondition');
      },
    };
    targets.push({
      name: 'node-empty',
      cwd: native,
      args: ['--eval', ''],
      validate: (stdout) => {
        if (stdout !== '') throw new Error('Node baseline produced output');
      },
    });
    add('cli-version', native, ['--version'], (stdout) => {
      if (!/^\d+\.\d+\.\d+/u.test(stdout)) throw new Error('Invalid CLI version');
    });
    add('cli-help', native, ['--help'], (stdout) => {
      if (!stdout.includes('Usage: comet')) throw new Error('Invalid CLI help');
    });
    const resolution = (stdout) => {
      if (jsonSuccess(stdout).workflow !== 'native') throw new Error('Wrong workflow');
    };
    add('entry-public', native, ['workflow', 'resolve', '.', '--json'], resolution);
    add(
      'entry-public-activate',
      native,
      ['workflow', 'resolve', '.', '--activate', '--json'],
      resolution,
    );
    add('classic-current-public', classic, ['state', 'current', '--json'], (stdout) => {
      if (!jsonSuccess(stdout).stdout?.includes('benchmark-classic'))
        throw new Error('No selected Classic change');
    });
    add(
      'classic-next-public',
      classic,
      ['state', 'next', 'benchmark-classic', '--json'],
      expectedData({ change: 'benchmark-classic', phase: 'open' }),
    );
    add(
      'native-show-public',
      native,
      ['native', 'show', 'benchmark-native', '--json'],
      (stdout) => {
        if (jsonSuccess(stdout).data?.state?.name !== 'benchmark-native')
          throw new Error('Wrong Native show target');
      },
    );
    const checkRoot = path.join(root, 'classic-check');
    await initialize(checkRoot);
    await fs.mkdir(path.join(checkRoot, '.comet'), { recursive: true });
    await fs.copyFile(
      path.join(classic, '.comet/config.yaml'),
      path.join(checkRoot, '.comet/config.yaml'),
    );
    await fs.writeFile(path.join(checkRoot, '.gitignore'), '.comet/runtime/\n');
    await fs.mkdir(path.join(checkRoot, 'openspec/changes'), { recursive: true });
    await fs.mkdir(path.join(checkRoot, 'openspec/specs'), { recursive: true });
    await cli(checkRoot, ['state', 'init', 'benchmark-check', 'tweak', '--json']);
    const checkArgs = [
      'check',
      'run',
      'benchmark-check',
      'build',
      '--local',
      '--json',
      '--',
      process.execPath,
      '-e',
      "console.log('fixture check passed')",
    ];
    const validateCheck = (reused) => (stdout) => {
      const result = jsonSuccess(stdout).data;
      if (
        !result ||
        result.exitCode !== 0 ||
        Boolean(result.reused) !== reused ||
        result.inputBefore !== result.inputAfter
      ) {
        throw new Error('Classic check did not produce the expected valid evidence');
      }
    };
    const freshCheckSnapshot = await directorySnapshot(checkRoot);
    await cli(checkRoot, checkArgs, validateCheck(false));
    const passedCheckSnapshot = await directorySnapshot(checkRoot);
    add('classic-check-execute', checkRoot, checkArgs, validateCheck(false), {
      prepare: () => restoreSnapshot(checkRoot, freshCheckSnapshot),
    });
    add('classic-check-reuse', checkRoot, checkArgs, validateCheck(true), {
      prepare: () => restoreSnapshot(checkRoot, passedCheckSnapshot),
    });
    add('classic-check-invalidate', checkRoot, checkArgs, validateCheck(false), {
      prepare: async () => {
        await restoreSnapshot(checkRoot, passedCheckSnapshot);
        await fs.writeFile(path.join(checkRoot, 'README.md'), '# Changed check input\n');
      },
    });
    const nativeCheckRoot = path.join(root, 'native-check');
    await initialize(nativeCheckRoot);
    await fs.writeFile(path.join(nativeCheckRoot, '.gitignore'), '.comet/runtime/\n');
    await cli(nativeCheckRoot, ['native', 'new', 'benchmark-check', '--json']);
    await fs.writeFile(
      path.join(nativeCheckRoot, 'docs/comet/changes/benchmark-check/brief.md'),
      '# Acceptance examples\n- The fixture behaves correctly.\n',
    );
    const nativeModule = (name) =>
      JSON.stringify(
        pathToFileURL(path.join(repoRoot, 'dist/domains/comet-native', name + '.js')).href,
      );
    const nativeCheckPrelude = `
      import * as runtime from ${nativeModule('native-portable-runtime')};
      import { nativeProjectPaths } from ${nativeModule('native-paths')};
      import { readNativeLocalExecution } from ${nativeModule('native-local-execution')};
      import { createNativeRunnerChannel } from ${nativeModule('native-runner-protocol')};
      const paths = await nativeProjectPaths(process.cwd(), 'docs');
      const name = 'benchmark-check';
      const passed = {id:'passed',name:'Passed',executable:process.execPath,argv:['-e',"console.log('passed')"],cwdRef:'.',timeoutMs:10000,repeatable:true};
      const interrupted = {id:'interrupted',name:'Interrupted',executable:process.execPath,argv:['-e','setTimeout(() => {}, 250)'],cwdRef:'.',timeoutMs:20,repeatable:true};
    `;
    const nativeDriver = (code) => ['--input-type=module', '--eval', nativeCheckPrelude + code];
    await measureRuntimeSample(
      {
        name: 'prepare Native check candidate',
        cwd: nativeCheckRoot,
        args: nativeDriver(`
        await runtime.prepareNativePortableShapeConfirmation({paths,name});
        await runtime.confirmNativePortableShape({paths,name});
        const runner = createNativeRunnerChannel();
        await runtime.submitNativePortableBuilderCandidate({paths,name,input:{
          identity:runner.captureExecutionIdentity({identityProvider:'benchmark',executionRef:'builder'}),
          candidateId:'benchmark-candidate',summary:'Fixture implemented.',addressedAcceptanceIds:['A1']
        }});
      `),
      },
      env,
    );
    const nativeFresh = await directorySnapshot(nativeCheckRoot);
    const nativeExecution = nativeDriver(`
      await runtime.executeNativePortableCheckPlan({paths,name,plans:[passed]});
      console.log(JSON.stringify((await readNativeLocalExecution(runtime.nativeLocalExecutionFile(paths,name))).checks));
    `);
    const validateNativeChecks = (counts, statuses) => (stdout) => {
      const checks = JSON.parse(stdout);
      if (
        JSON.stringify(checks.map((c) => c.executionCount)) !== JSON.stringify(counts) ||
        JSON.stringify(checks.map((c) => c.status)) !== JSON.stringify(statuses)
      )
        throw new Error('Native check evidence or execution counts did not match the scenario');
    };
    await measureRuntimeSample(
      {
        name: 'prepare Native passed evidence',
        cwd: nativeCheckRoot,
        args: nativeExecution,
        validate: validateNativeChecks([1], ['passed']),
      },
      env,
    );
    const nativePassed = await directorySnapshot(nativeCheckRoot);
    for (const [name, snapshot] of [
      ['native-check-execute', nativeFresh],
      ['native-check-reuse', nativePassed],
    ]) {
      targets.push({
        name,
        cwd: nativeCheckRoot,
        args: nativeExecution,
        validate: validateNativeChecks([1], ['passed']),
        prepare: () => restoreSnapshot(nativeCheckRoot, snapshot),
      });
    }
    await restoreSnapshot(nativeCheckRoot, nativeFresh);
    await measureRuntimeSample(
      {
        name: 'prepare Native interrupted evidence',
        cwd: nativeCheckRoot,
        args: nativeDriver(
          `await runtime.executeNativePortableCheckPlan({paths,name,plans:[passed,interrupted]});`,
        ),
      },
      env,
    );
    const nativeInterrupted = await directorySnapshot(nativeCheckRoot);
    targets.push({
      name: 'native-check-retry-interrupted',
      cwd: nativeCheckRoot,
      args: nativeDriver(`
        await runtime.retryNativePortableCheckPlan({paths,name,checkIds:['interrupted']});
        console.log(JSON.stringify((await readNativeLocalExecution(runtime.nativeLocalExecutionFile(paths,name))).checks));
      `),
      validate: validateNativeChecks([1, 2], ['passed', 'interrupted']),
      prepare: () => restoreSnapshot(nativeCheckRoot, nativeInterrupted),
    });
    const nextArgs = [
      'native',
      'next',
      'benchmark-native',
      '--summary',
      'Fixture ready',
      '--expected-state-version',
      '1',
      '--expected-action',
      'prepare-shape-confirmation',
      '--json',
    ];
    add('native-next-public', native, nextArgs, validateNext, nextExtra);
    targets.push({
      name: 'native-next-direct',
      cwd: native,
      args: [
        path.join(repoRoot, 'assets/skills/comet-native/scripts/comet-native-next.mjs'),
        ...nextArgs.slice(2),
      ],
      validate: validateNext,
      ...nextExtra,
    });
    for (const origin of [false, true]) {
      const taskRoot = path.join(root, origin ? 'task-origin' : 'task-no-origin');
      await initialize(taskRoot);
      await fs.mkdir(path.join(taskRoot, '.comet'), { recursive: true });
      await fs.copyFile(
        path.join(native, '.comet/config.yaml'),
        path.join(taskRoot, '.comet/config.yaml'),
      );
      if (origin)
        git(taskRoot, ['remote', 'add', 'origin', 'https://example.test/runtime-benchmark.git']);
      const taskArgs = [
        'task',
        '.',
        '--task',
        'Inspect the fixture behavior',
        '--session',
        'benchmark-context',
        '--json',
      ];
      // The empty-context scenario is a repeated task after its project knowledge
      // was delivered once. The normal plugin and freshness paths still run.
      await cli(taskRoot, taskArgs, (stdout) => {
        const context = jsonSuccess(stdout).context;
        if (
          !Array.isArray(context) ||
          !context.some((entry) =>
            entry.manifest?.some((item) => item.owner === 'comet.project-knowledge'),
          )
        )
          throw new Error(
            `Task fixture did not deliver project knowledge: ${stdout.slice(0, 1600)}`,
          );
      });
      add(
        origin ? 'task-origin' : 'task-no-origin',
        taskRoot,
        taskArgs,
        (stdout, result) => {
          if (jsonSuccess(stdout).context?.length !== 0)
            throw new Error('Expected empty fixture context');
          if (result.stderr.includes('Project knowledge:'))
            throw new Error('Task fixture reported degraded knowledge retrieval');
        },
        {
          origin,
          contextState:
            'same explicit session after initial project-knowledge delivery; no unseen context',
        },
      );
    }
    let count = 1;
    for (const size of [...new Set(worktreeCounts)].sort((a, b) => a - b)) {
      add(
        `native-status-public-${size}`,
        native,
        ['native', 'status', 'benchmark-native', '--json'],
        expectedData({ name: 'benchmark-native', phase: 'shape' }),
        {
          worktreeCount: size,
          prepare: async () => {
            await restore();
            while (count < size) {
              count++;
              const name = `scale-${count}`;
              const worktree = path.join(root, name);
              git(native, ['worktree', 'add', '-b', name, worktree, 'main']);
              await cli(
                worktree,
                ['native', 'new', name, '--json'],
                expectedData({ name, phase: 'shape' }),
              );
            }
          },
        },
      );
    }
    return { root, home, env, profile, targets, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function buildIdentity(repoRoot, suppliedSourceHead) {
  const files = ['bin/comet.js', 'bin/fast-runtime-router.js', 'package.json'];
  async function collect(relative) {
    for (const entry of await fs.readdir(path.join(repoRoot, relative), { withFileTypes: true })) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) await collect(file);
      else if (entry.isFile() && /\.(?:js|mjs)$/u.test(file)) files.push(file);
    }
  }
  for (const directory of [
    'dist/app',
    'dist/domains',
    'dist/platform',
    'assets/skills/comet/scripts',
    'assets/skills/comet-native/scripts',
  ])
    await collect(directory);
  const digest = createHash('sha256');
  for (const file of files.sort())
    digest.update(file.replaceAll('\\', '/')).update(await fs.readFile(path.join(repoRoot, file)));
  let sourceHead = suppliedSourceHead;
  if (sourceHead !== undefined && !/^[a-f0-9]{40}$/u.test(sourceHead))
    throw new Error('Invalid source HEAD; supply the complete Git commit SHA');
  if (sourceHead === undefined) {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    validateRuntimeProcess({ name: 'source identity' }, head);
    sourceHead = head.stdout.trim();
  }
  return {
    sourceHead,
    sourceHeadOrigin:
      suppliedSourceHead === undefined ? 'git-rev-parse' : 'supplied-for-frozen-package',
    buildSha256: digest.digest('hex'),
    fileCount: files.length,
  };
}

export async function runRuntimeBenchmark(options = {}) {
  const runs = options.runs ?? 15;
  const worktreeCounts = options.worktreeCounts ?? [1, 10, 30];
  if (
    !Number.isSafeInteger(runs) ||
    runs < 1 ||
    worktreeCounts.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 30)
  )
    throw new Error('Invalid benchmark runs or worktree counts');
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const gitMetadata = (args) => {
    const result = spawnSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const fixture = await createFixture(repoRoot, worktreeCounts);
  const report = {
    schema: SCHEMA,
    complete: false,
    createdAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: os.arch(),
    osRelease: os.release(),
    gitVersion: gitMetadata(['--version']),
    branch: gitMetadata(['branch', '--show-current']),
    workingTreeStatus: gitMetadata(['status', '--short']),
    packageVersion: JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'))
      .version,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    threshold: DEFAULT_THRESHOLD,
    timing: 'fresh-node-process-warm-filesystem; excludes fixture setup and postcondition checks',
    warmups: 3,
    runs,
    gitBudgetsEnforced: options.enforceGitBudgets !== false,
    results: {},
  };
  try {
    report.benchmarkSha256 = createHash('sha256')
      .update(await fs.readFile(SCRIPT_PATH))
      .digest('hex');
    Object.assign(report, await buildIdentity(repoRoot, options.sourceHead));
    const unknownTargets =
      options.targets?.filter((name) => !fixture.targets.some((target) => target.name === name)) ??
      [];
    if (unknownTargets.length)
      throw new Error(`Unknown benchmark targets: ${unknownTargets.join(', ')}`);
    for (const target of fixture.targets) {
      if (options.targets?.length && !options.targets.includes(target.name)) continue;
      for (let i = 0; i < report.warmups; i++) await measureRuntimeSample(target, fixture.env);
      const samples = [];
      for (let i = 0; i < runs; i++) samples.push(await measureRuntimeSample(target, fixture.env));
      const profile = await measureRuntimeSample(target, fixture.env, { profile: fixture.profile });
      const gitBudget =
        target.name === 'task-origin'
          ? 1
          : target.name === 'task-no-origin'
            ? 2
            : target.name.startsWith('native-status-public-')
              ? 5
              : target.name.startsWith('native-next-')
                ? 7
                : target.name === 'entry-public-activate'
                  ? 0
                  : null;
      const gitBudgetMet = gitBudget === null || profile.git.length <= gitBudget;
      if (report.gitBudgetsEnforced && !gitBudgetMet)
        throw new Error(
          `${target.name}: ${profile.git.length} Git processes exceeds budget ${gitBudget}`,
        );
      const times = samples.map(({ milliseconds }) => milliseconds).sort((a, b) => a - b);
      report.results[target.name] = {
        command: target.args.map((arg) =>
          arg.replaceAll(repoRoot, '<package>').replaceAll(fixture.root, '<fixture>'),
        ),
        worktreeCount: target.worktreeCount ?? 1,
        origin: target.origin ?? false,
        ...(target.contextState ? { contextState: target.contextState } : {}),
        median: times[Math.floor(times.length / 2)],
        p95Observed: times[Math.ceil(times.length * 0.95) - 1],
        samples,
        gitCalls: profile.git?.length ?? 0,
        gitBudget,
        gitBudgetMet,
        gitProfile: profile.git,
        gitMilliseconds: profile.git?.reduce((sum, row) => sum + row.milliseconds, 0) ?? 0,
        fsCalls: profile.fs?.length ?? 0,
        fsReadBytes: profile.fs?.reduce((sum, row) => sum + (row.bytes ?? 0), 0) ?? 0,
        fsProfile: profile.fs,
        fsMilliseconds: profile.fs?.reduce((sum, row) => sum + row.milliseconds, 0) ?? 0,
        profileSource: 'separate instrumented successful process',
      };
      options.onResult?.(target.name, report.results[target.name]);
    }
    if (Object.keys(report.results).length === 0)
      throw new Error('No benchmark targets were selected');
    report.complete = true;
    return report;
  } finally {
    await fixture.cleanup();
  }
}

export async function writeRuntimeReport(file, report) {
  if (
    report.schema !== SCHEMA ||
    !report.complete ||
    Object.keys(report.results).length === 0 ||
    Object.values(report.results).some(
      (row) =>
        !row.samples.length ||
        row.samples.some(
          (sample) =>
            sample.exitCode !== 0 ||
            !Number.isFinite(sample.milliseconds) ||
            sample.milliseconds < 0,
        ),
    )
  )
    throw new Error('Refusing to record an incomplete or failed benchmark');
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export async function writeRuntimeBaseline(file, report) {
  if (
    report.gitBudgetsEnforced !== true ||
    Object.values(report.results).some((row) => row.gitBudgetMet !== true)
  )
    throw new Error('Refusing to record a baseline without passing Git budgets');
  await writeRuntimeReport(file, report);
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--record') ? 'record' : args.includes('--check') ? 'check' : 'print';
  const runsArg = args.find((arg) => arg.startsWith('--runs='));
  const targetsArg = args.find((arg) => arg.startsWith('--targets='));
  const worktreesArg = args.find((arg) => arg.startsWith('--worktrees='));
  const outputArg = args.find((arg) => arg.startsWith('--output='));
  const packageArg = args.find((arg) => arg.startsWith('--package-root='));
  const sourceArg = args.find((arg) => arg.startsWith('--source-head='));
  const measureBefore = args.includes('--measure-before');
  if (
    args.some(
      (arg) =>
        !['--record', '--check', '--measure-before'].includes(arg) &&
        !/^--(?:runs|targets|worktrees|output|package-root|source-head)=.+$/u.test(arg),
    ) ||
    (args.includes('--record') && args.includes('--check')) ||
    (measureBefore && mode !== 'print')
  )
    throw new Error(
      'Usage: runtime-coldstart-benchmark.mjs [--record|--check|--measure-before] [--runs=N] [--targets=name,...] [--worktrees=1,10,30] [--output=file] [--package-root=path] [--source-head=sha]',
    );
  const report = await runRuntimeBenchmark({
    ...(runsArg ? { runs: Number(runsArg.slice(7)) } : {}),
    ...(targetsArg ? { targets: targetsArg.slice(10).split(',') } : {}),
    ...(worktreesArg ? { worktreeCounts: worktreesArg.slice(12).split(',').map(Number) } : {}),
    ...(packageArg ? { repoRoot: path.resolve(packageArg.slice(15)) } : {}),
    ...(sourceArg ? { sourceHead: sourceArg.slice(14) } : {}),
    enforceGitBudgets: !measureBefore,
    onResult: (name, row) =>
      console.log(
        `${name.padEnd(28)} ${row.median.toFixed(1)} ms median; ${row.gitCalls} Git; ${row.fsCalls} FS; ${row.samples.length} samples`,
      ),
  });
  if (mode === 'record') await writeRuntimeBaseline(BASELINE_FILE, report);
  if (outputArg) await writeRuntimeReport(path.resolve(outputArg.slice(9)), report);
  if (mode === 'check') {
    const baseline = JSON.parse(await fs.readFile(BASELINE_FILE, 'utf8'));
    if (
      baseline.schema !== SCHEMA ||
      !baseline.complete ||
      baseline.gitBudgetsEnforced !== true ||
      Object.values(baseline.results).some((row) => row.gitBudgetMet !== true)
    )
      throw new Error('Record a valid scenario baseline before checking performance');
    for (const [name, row] of Object.entries(report.results)) {
      const before = baseline.results[name];
      if (!before || row.median > before.median * (1 + (baseline.threshold ?? DEFAULT_THRESHOLD)))
        throw new Error(`Runtime benchmark regression or missing baseline: ${name}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
