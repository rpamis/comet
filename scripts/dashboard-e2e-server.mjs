/**
 * Build the Dashboard from the current checkout, then serve that exact build
 * for Playwright. A standalone wrapper keeps the build and preview lifecycle
 * explicit on Windows and POSIX without relying on shell chaining.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const previewArgs = [
  'exec',
  'vite',
  'preview',
  '--config',
  'domains/dashboard/web/vite.config.mjs',
  '--host',
  '127.0.0.1',
  '--port',
  '4173',
  '--strictPort',
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env },
      stdio: 'inherit',
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

const build = await run(pnpm, ['run', 'build:dashboard']);
if (build.code !== 0 || build.signal !== null) {
  process.exit(build.code ?? 1);
}

const preview = spawn(pnpm, previewArgs, {
  cwd: root,
  env: { ...process.env },
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true,
});

const forwardSignal = (signal) => {
  if (!preview.killed) preview.kill(signal);
};
process.once('SIGINT', () => forwardSignal('SIGINT'));
process.once('SIGTERM', () => forwardSignal('SIGTERM'));

preview.once('error', (error) => {
  console.error(`[dashboard-e2e] preview failed: ${error.message}`);
  process.exit(1);
});
preview.once('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
