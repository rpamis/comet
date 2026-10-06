import { resolveCometDaemonRoute, shouldAutoStartCometDaemon } from './comet-daemon-route.js';
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { resolveCometDaemonRoute, shouldAutoStartCometDaemon } from './comet-daemon-route.js';

function packageVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

function daemonBuildId(serverPath) {
  try {
    const assetPaths = [
      serverPath,
      fileURLToPath(new URL('../dist/platform/process/comet-daemon.js', import.meta.url)),
      fileURLToPath(new URL('../assets/skills/comet/scripts/comet-runtime.mjs', import.meta.url)),
      fileURLToPath(
        new URL('../assets/skills/comet-native/scripts/comet-native-runtime.mjs', import.meta.url),
      ),
    ];
    const stamps = assetPaths.map((file) => Math.trunc(statSync(file).mtimeMs)).join('-');
    return `${packageVersion()}:${stamps}`;
  } catch {
    return packageVersion();
  }
}

function projectRootFromArgs(args) {
  const index = args.indexOf('--project-root');
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) {
    return path.resolve(args[index + 1]);
  }
  let cursor = path.resolve(process.cwd());
  while (true) {
    if (existsSync(path.join(cursor, '.comet', 'config.yaml'))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return path.resolve(process.cwd());
    cursor = parent;
  }
}

async function daemonModule() {
  try {
    const daemon = await import('../dist/platform/process/comet-daemon.js');
    if (process.platform !== 'win32') return daemon;
    const broker = await import('../dist/platform/process/windows-process-broker.js');
    return { ...daemon, ...broker };
  } catch {
    return null;
  }
}

function serverPath() {
  return fileURLToPath(new URL('../dist/app/commands/daemon-server.js', import.meta.url));
}

function launchLockPath(endpoint) {
  const key = endpoint.key ?? endpoint.endpoint.replace(/[^a-z0-9_-]+/giu, '_');
  return path.join(os.tmpdir(), 'comet-daemon-launch', `${key}.lock`);
}

function takeLaunchLock(endpoint) {
  const lockPath = launchLockPath(endpoint);
  mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    const fd = openSync(lockPath, 'wx');
    writeFileSync(fd, `${process.pid}\n`, 'utf8');
    closeSync(fd);
    return lockPath;
  } catch (error) {
    if (error?.code !== 'EEXIST') return null;
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > 15_000) unlinkSync(lockPath);
    } catch {
      // Another launcher may be holding or removing the lock.
    }
    return null;
  }
}

function startServer(module, endpoint, buildId, projectRoot) {
  const entry = serverPath();
  if (!existsSync(entry)) return false;
  const lockPath = takeLaunchLock(endpoint);
  if (!lockPath) return false;
  try {
    const cwd = fileURLToPath(new URL('../', import.meta.url));
    const env = {
      ...process.env,
      COMET_DAEMON_ENVIRONMENT_FINGERPRINT: endpoint.environmentFingerprint,
      COMET_DAEMON_SERVER: '1',
      COMET_DAEMON_START_LOCK: lockPath,
    };
    if (process.platform === 'win32') {
      const launched = module.launchWindowsProcessWithBroker({
        command: process.execPath,
        args: [entry, endpoint.endpoint, buildId, projectRoot],
        cwd,
        env,
      });
      if (!launched.started) throw new Error(launched.error ?? 'Windows daemon launch failed');
      return true;
    }
    const child = spawn(process.execPath, [entry, endpoint.endpoint, buildId, projectRoot], {
      // Keep the detached server out of the project workspace. A daemon must
      // not keep a temporary project root as its process cwd after the client
      // command exits, otherwise Windows cannot remove that workspace.
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
    });
    child.unref();
    return true;
  } catch {
    try {
      unlinkSync(lockPath);
    } catch {
      // The launcher no longer owns a usable child; a later attempt can age
      // out this lock if the filesystem refused immediate cleanup.
    }
    return false;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestWithLaunch(
  module,
  options,
  launch,
  waitForLaunch = true,
  deadline = performance.now() + (launch && waitForLaunch ? 10_000 : (options.timeoutMs ?? 5_000)),
) {
  const waitForPendingLaunch = process.platform === 'win32' && launch && waitForLaunch;
  const request = () => {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) throw new Error('Comet daemon startup timed out');
    return module.sendCometDaemonRequest({
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 5_000, remaining),
    });
  };
  try {
    return await request();
  } catch {
    if (!launch || performance.now() >= deadline) return null;
    const started = startServer(module, options.endpoint, options.buildId, options.projectRoot);
    if (!started && (!waitForPendingLaunch || !existsSync(launchLockPath(options.endpoint)))) {
      return null;
    }
  }
  if (!waitForLaunch) return null;
  const delays = [20, 40, 80, 160, 320, 640, 1_000];
  // 所有平台的 IPC 和启动重试共用总期限，超时后仍由调用方回退到本地 Runtime。
  // Windows 自动读取不等待后台启动；显式 start 可等候已有启动锁。
  for (let attempt = 0; waitForPendingLaunch || attempt < delays.length; attempt += 1) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return null;
    await wait(Math.min(delays[attempt] ?? 1_000, remaining));
    try {
      return await request();
    } catch {
      // The detached server may still be loading the runtime bundle.
    }
  }
  return null;
}

function writeCommandResponse(response) {
  if (response.stdout) process.stdout.write(response.stdout);
  if (response.stderr) process.stderr.write(response.stderr);
  process.exitCode = response.exitCode ?? (response.ok ? 0 : 70);
}

export async function tryRunCometDaemon(argv = process.argv.slice(2)) {
  const deadline = performance.now() + (process.platform === 'win32' ? 5_000 : 10_000);
  if (!shouldAutoStartCometDaemon() || process.env.COMET_DAEMON_SERVER === '1') return false;
  const selected = resolveCometDaemonRoute(argv);
  if (!selected) return false;
  const module = await daemonModule();
  if (!module) return false;
  const root = projectRootFromArgs(argv);
  const entry = serverPath();
  const buildId = process.env.COMET_DAEMON_BUILD_ID ?? daemonBuildId(entry);
  const endpoint = module.resolveCometDaemonEndpoint(root, buildId);
  const response = await requestWithLaunch(
    module,
    {
      endpoint,
      buildId,
      projectRoot: root,
      cwd: process.cwd(),
      runtime: selected.runtime,
      argv: selected.commandArgs,
      timeoutMs: 5_000,
    },
    true,
    // Let the first Windows request run in the caller while the broker warms
    // the daemon. Later requests reuse the server once it is listening.
    process.platform !== 'win32',
    deadline,
  );
  if (!response?.ok) return false;
  writeCommandResponse(response);
  return true;
}

function controlHelp() {
  process.stdout.write(
    [
      'Usage: comet daemon <start|status|stop> [--project-root <path>] [--json]',
      '',
      'The daemon is on-demand, project-scoped, and exits after an idle period.',
      '',
    ].join('\n'),
  );
}

function parseControlArgs(argv) {
  const action = argv[1] ?? 'status';
  const root = projectRootFromArgs(argv);
  return { action, root, json: argv.includes('--json') };
}

export async function runCometDaemonCommand(argv = process.argv.slice(2)) {
  const startedAt = performance.now();
  if (argv[0] !== 'daemon') return false;
  const parsed = parseControlArgs(argv);
  if (parsed.action === '--help' || parsed.action === '-h') {
    controlHelp();
    return true;
  }
  if (!['start', 'status', 'stop'].includes(parsed.action)) {
    process.stderr.write(`Unknown daemon action: ${parsed.action}\n`);
    controlHelp();
    process.exitCode = 64;
    return true;
  }
  const module = await daemonModule();
  const entry = serverPath();
  if (!module) {
    process.stderr.write('Comet daemon runtime is not built; run pnpm build first.\n');
    process.exitCode = 70;
    return true;
  }
  const buildId = process.env.COMET_DAEMON_BUILD_ID ?? daemonBuildId(entry);
  const endpoint = module.resolveCometDaemonEndpoint(parsed.root, buildId);
  if (parsed.action === 'start') {
    const response = await requestWithLaunch(
      module,
      {
        endpoint,
        buildId,
        projectRoot: parsed.root,
        cwd: process.cwd(),
        control: 'status',
        timeoutMs: 5_000,
      },
      true,
      true,
      startedAt + 10_000,
    );
    if (!response?.ok) {
      process.stderr.write('Unable to start the Comet daemon.\n');
      process.exitCode = 70;
    } else if (parsed.json) process.stdout.write(JSON.stringify(response.status ?? {}) + '\n');
    else process.stdout.write(`Comet daemon running (pid ${response.status?.pid ?? 'unknown'}).\n`);
    return true;
  }
  const response = await requestWithLaunch(
    module,
    {
      endpoint,
      buildId,
      projectRoot: parsed.root,
      cwd: process.cwd(),
      control: parsed.action,
      timeoutMs: 3_000,
    },
    false,
    false,
    startedAt + 3_000,
  );
  if (parsed.action === 'status') {
    const value = response?.ok ? { running: true, ...response.status } : { running: false };
    if (parsed.json) process.stdout.write(JSON.stringify(value) + '\n');
    else
      process.stdout.write(
        value.running
          ? `Comet daemon running (pid ${value.pid}).\n`
          : 'Comet daemon is not running.\n',
      );
    return true;
  }
  if (!response?.ok) {
    process.stderr.write('Comet daemon is not running.\n');
    process.exitCode = 1;
  } else if (parsed.json) process.stdout.write(JSON.stringify({ stopped: true }) + '\n');
  else process.stdout.write('Comet daemon stopped.\n');
  return true;
}
