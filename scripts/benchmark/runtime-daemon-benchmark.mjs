import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const BIN = path.join(REPO_ROOT, 'bin', 'comet.js');
const SAMPLE_COUNT = Math.max(3, Number(process.env.COMET_BENCHMARK_SAMPLES ?? 9));
const WARMUP_COUNT = Math.max(0, Number(process.env.COMET_BENCHMARK_WARMUP ?? 1));
const IDLE_TIMEOUT_MS = Number(process.env.COMET_BENCHMARK_IDLE_TIMEOUT_MS ?? 250);

let ownedFixtureRoot = null;

function setupBenchmarkProject() {
  const requested = process.env.COMET_BENCHMARK_PROJECT_ROOT;
  if (requested) return path.resolve(requested);
  const root = mkdtempSync(path.join(os.tmpdir(), 'comet-runtime-daemon-benchmark-'));
  ownedFixtureRoot = root;
  const git = (args) => {
    const result = spawnSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`benchmark fixture git setup failed: ${result.stderr ?? ''}`);
    }
  };
  git(['init', '-q', '-b', 'benchmark']);
  git(['config', 'user.email', 'comet-benchmark@example.test']);
  git(['config', 'user.name', 'Comet benchmark']);
  const run = (args) => {
    const result = spawnSync(process.execPath, [BIN, ...args], {
      cwd: root,
      env: {
        ...process.env,
        COMET_DAEMON: 'off',
        COMET_SKIP_UPDATE_CHECK: '1',
      },
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(
        `benchmark fixture setup failed (${args.join(' ')}): ${result.stderr ?? ''}${result.stdout ?? ''}`,
      );
    }
  };
  run(['native', 'init', '--project-root', root, '--language', 'en', '--json']);
  run([
    'native',
    'new',
    'daemon-benchmark',
    '--project-root',
    root,
    '--isolation',
    'current',
    '--json',
  ]);
  return root;
}

const PROJECT_ROOT = setupBenchmarkProject();

process.on('exit', () => {
  if (ownedFixtureRoot) {
    try {
      rmSync(ownedFixtureRoot, { recursive: true, force: true });
    } catch {
      // The daemon stop path normally releases the fixture before exit. If a
      // host keeps a transient file lock after a failed benchmark, leave the
      // temp directory for the OS cleanup rather than masking the result.
    }
  }
});

function run(args, extraEnv = {}) {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      COMET_TASK: '',
      COMET_TASK_PHASE: '',
      COMET_TASK_PATH: '',
      COMET_SKIP_UPDATE_CHECK: '1',
      COMET_DAEMON: 'auto',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const milliseconds = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `benchmark command failed (${result.error?.message ?? result.signal ?? result.status})\n${result.stderr ?? ''}\n${result.stdout ?? ''}`,
    );
  }
  return { milliseconds, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function parseJson(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `${label} did not return JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function assertSuccessful(result, label) {
  if (result.exitCode !== 0) throw new Error(`${label} returned exitCode ${result.exitCode}`);
  if (result.command !== 'status') throw new Error(`${label} returned ${result.command}`);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(values) {
  const usable = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (usable.length === 0) return null;
  return {
    median: Number(median(usable).toFixed(2)),
    p95: Number(percentile(usable, 0.95).toFixed(2)),
    values: usable.map((value) => Number(value.toFixed(2))),
  };
}

function gitOutput(args) {
  const result = spawnSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.status === 0 ? (result.stdout ?? '') : '';
}

function sourceBuildIdentity() {
  const commit = gitOutput(['rev-parse', 'HEAD']).trim() || 'unknown';
  const diff = gitOutput([
    'diff',
    '--binary',
    '--no-ext-diff',
    '--',
    'app',
    'bin',
    'config',
    'domains',
    'platform',
    'scripts',
    'package.json',
  ]);
  const sourceFiles = [
    'app/commands/daemon-server.ts',
    'bin/comet.js',
    'bin/comet-daemon-router.js',
    'platform/process/comet-daemon.ts',
    'platform/process/runtime-metrics.ts',
    'platform/process/git.ts',
    'scripts/benchmark/runtime-daemon-benchmark.mjs',
  ];
  const sourceDigest = createHash('sha256');
  for (const relative of sourceFiles) {
    try {
      sourceDigest.update(relative);
      sourceDigest.update(readFileSync(path.join(REPO_ROOT, relative)));
    } catch {
      sourceDigest.update(`${relative}:missing`);
    }
  }
  return {
    commit,
    workingTreeDigest: createHash('sha256').update(diff, 'utf8').digest('hex').slice(0, 40),
    runtimeSourceDigest: sourceDigest.digest('hex').slice(0, 40),
  };
}

function generatedBuildIdentity() {
  const files = [
    path.join(REPO_ROOT, 'dist', 'app', 'commands', 'daemon-server.js'),
    path.join(REPO_ROOT, 'dist', 'platform', 'process', 'comet-daemon.js'),
    path.join(REPO_ROOT, 'assets', 'skills', 'comet', 'scripts', 'comet-runtime.mjs'),
    path.join(REPO_ROOT, 'assets', 'skills', 'comet-native', 'scripts', 'comet-native-runtime.mjs'),
  ];
  const digest = createHash('sha256');
  for (const file of files) {
    try {
      digest.update(path.relative(REPO_ROOT, file));
      digest.update(readFileSync(file));
    } catch {
      return 'missing';
    }
  }
  return digest.digest('hex').slice(0, 40);
}

function daemonStatus(environment) {
  return parseJson(
    run(['daemon', 'status', '--project-root', PROJECT_ROOT, '--json'], environment),
    'daemon status',
  );
}

function sample(label, environment, count = SAMPLE_COUNT) {
  const values = [];
  const processIds = new Set();
  const memoryRss = [];
  const memoryHeap = [];
  const durations = [];
  const queues = [];
  const gitCommands = [];
  const filesystemReads = [];
  const filesystemWrites = [];
  for (let index = 0; index < count; index += 1) {
    const result = run(['native', 'status', '--project-root', PROJECT_ROOT, '--json'], environment);
    const parsed = parseJson(result, label);
    assertSuccessful(parsed, label);
    values.push(result.milliseconds);
    if (parsed.data?.items === undefined) throw new Error(`${label} has no status postcondition`);
    const daemon = daemonStatus(environment);
    if (daemon.running) {
      processIds.add(daemon.pid);
      memoryRss.push(daemon.memoryRssBytes);
      memoryHeap.push(daemon.memoryHeapUsedBytes);
      durations.push(daemon.lastRequest?.durationMs);
      queues.push(daemon.lastRequest?.queueMs);
      gitCommands.push(daemon.lastRequest?.gitCommands);
      filesystemReads.push(daemon.lastRequest?.filesystemReads);
      filesystemWrites.push(daemon.lastRequest?.filesystemWrites);
    }
  }
  return {
    label,
    samples: values.length,
    processIds: [...processIds],
    processStarts: processIds.size,
    medianMs: Number(median(values).toFixed(2)),
    p95Ms: Number(percentile(values, 0.95).toFixed(2)),
    valuesMs: values.map((value) => Number(value.toFixed(2))),
    memory: {
      rssBytes: summarize(memoryRss),
      heapUsedBytes: summarize(memoryHeap),
    },
    work: {
      requestDurationMs: summarize(durations),
      queueMs: summarize(queues),
      gitCommands: gitCommands.reduce((sum, value) => sum + (value ?? 0), 0),
      filesystemReads: filesystemReads.every((value) => value === null || value === undefined)
        ? null
        : filesystemReads.reduce((sum, value) => sum + (value ?? 0), 0),
      filesystemWrites: filesystemWrites.every((value) => value === null || value === undefined)
        ? null
        : filesystemWrites.reduce((sum, value) => sum + (value ?? 0), 0),
    },
  };
}

function sleep(milliseconds) {
  const result = spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${milliseconds})`], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('benchmark sleep failed');
}

function packageVersion() {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
}

const existingDaemon = parseJson(
  run(['daemon', 'status', '--project-root', PROJECT_ROOT, '--json'], { COMET_DAEMON: 'off' }),
  'initial daemon status',
);
if (existingDaemon.running) {
  run(['daemon', 'stop', '--project-root', PROJECT_ROOT, '--json'], {
    COMET_DAEMON_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
  });
}
const cold = run(['native', 'status', '--project-root', PROJECT_ROOT, '--json'], {
  COMET_DAEMON_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
});
const coldJson = parseJson(cold, 'cold daemon request');
assertSuccessful(coldJson, 'cold daemon request');
const coldDaemon = daemonStatus({ COMET_DAEMON_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS) });
const warmup = [];
for (let index = 0; index < WARMUP_COUNT; index += 1) {
  const result = run(['native', 'status', '--project-root', PROJECT_ROOT, '--json'], {
    COMET_DAEMON_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
  });
  assertSuccessful(parseJson(result, `warmup ${index + 1}`), `warmup ${index + 1}`);
  warmup.push(result.milliseconds);
}
const warm = sample('warm daemon request', {
  COMET_DAEMON_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
});
run(['daemon', 'stop', '--project-root', PROJECT_ROOT, '--json'], {
  COMET_DAEMON_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
});
const single = sample('single process fallback', { COMET_DAEMON: 'off' });
run(['native', 'status', '--project-root', PROJECT_ROOT, '--json'], {
  COMET_DAEMON_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
});
sleep(Math.max(IDLE_TIMEOUT_MS * 4, 1_000));
const idleRestart = run(['native', 'status', '--project-root', PROJECT_ROOT, '--json'], {
  COMET_DAEMON_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
});
const idleRestartJson = parseJson(idleRestart, 'idle restart request');
assertSuccessful(idleRestartJson, 'idle restart request');
const idleDaemon = daemonStatus({ COMET_DAEMON_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS) });
run(['daemon', 'stop', '--project-root', PROJECT_ROOT, '--json'], {
  COMET_DAEMON_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
});

process.stdout.write(
  JSON.stringify(
    {
      schema: 'comet.runtime-daemon-benchmark.v2',
      packageVersion: packageVersion(),
      node: process.version,
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
      },
      sourceBuildIdentity: sourceBuildIdentity(),
      generatedBuildIdentity: generatedBuildIdentity(),
      projectRoot: PROJECT_ROOT,
      sampleCount: SAMPLE_COUNT,
      warmupCount: WARMUP_COUNT,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      coldStartMs: Number(cold.milliseconds.toFixed(2)),
      coldProcessId: coldDaemon.running ? coldDaemon.pid : null,
      idleRestartMs: Number(idleRestart.milliseconds.toFixed(2)),
      idleRestartProcessId: idleDaemon.running ? idleDaemon.pid : null,
      processStarts: [coldDaemon, idleDaemon].filter((value) => value.running).length,
      memory: {
        coldRssBytes: coldDaemon.memoryRssBytes ?? null,
        coldHeapUsedBytes: coldDaemon.memoryHeapUsedBytes ?? null,
        idleRestartRssBytes: idleDaemon.memoryRssBytes ?? null,
        idleRestartHeapUsedBytes: idleDaemon.memoryHeapUsedBytes ?? null,
      },
      warm,
      single,
      warmupMs: warmup.map((value) => Number(value.toFixed(2))),
      notes: [
        'Fixture preparation and cleanup are outside the timed intervals.',
        'The single process sample disables the daemon and is not compared with model or Agent time; no daemon memory/work counters exist for that path.',
        `Warm daemon samples report Runtime process reuse; daemon idle timeout is ${IDLE_TIMEOUT_MS}ms.`,
        'Git work counts the shared Runtime Git adapter; filesystem counts use Node process resource usage when the host exposes them.',
        'Queue time is measured at the daemon request boundary; the current single-connection handler has no internal queue.',
      ],
    },
    null,
    2,
  ) + '\n',
);
