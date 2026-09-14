import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export function spawnNativePortableProcess(options: {
  repositoryRoot: string;
  payload: Record<string, unknown>;
}): ChildProcess {
  const worker = path.join(
    options.repositoryRoot,
    'test',
    'helpers',
    'native-portable-process-worker.mjs',
  );
  const payload = Buffer.from(
    JSON.stringify({ repositoryRoot: options.repositoryRoot, ...options.payload }),
    'utf8',
  ).toString('base64url');
  return spawn(process.execPath, [worker, payload], {
    cwd: options.repositoryRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function waitForProcessExit(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Process ${child.pid} did not exit`)),
      timeoutMs,
    );
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
