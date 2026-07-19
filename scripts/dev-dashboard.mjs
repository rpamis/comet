/**
 * dev-dashboard.mjs — Start dashboard dev server with HMR.
 *
 * Usage:
 *   node scripts/dev-dashboard.mjs [project-path] [--port 4399]
 *
 * Starts the comet dashboard backend (API) in the background and the Vite
 * dev server (with proxy) in the foreground. The backend scans the given
 * project path (defaults to current directory).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const args = process.argv.slice(2);
let projectPath = '.';
let port = '4399';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = args[++i];
  } else if (!args[i].startsWith('-')) {
    projectPath = args[i];
  }
}

const resolvedProject = path.resolve(projectPath);

console.log(`[dev-dashboard] Project: ${resolvedProject}`);
console.log(`[dev-dashboard] API port: ${port}`);
console.log(`[dev-dashboard] Starting backend...`);

const backend = spawn(
  'node',
  [path.join(root, 'bin', 'comet.js'), 'dashboard', resolvedProject, '--port', port, '--no-open'],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  },
);

backend.stdout.on('data', (data) => {
  const line = data.toString().trim();
  if (line) console.log(`[backend] ${line}`);
});

backend.stderr.on('data', (data) => {
  const line = data.toString().trim();
  if (line) console.error(`[backend] ${line}`);
});

// Wait for backend to be ready before starting vite
const startVite = () => {
  console.log(`[dev-dashboard] Starting Vite dev server...`);
  const vite = spawn(
    'npx',
    ['vite', '--config', path.join(root, 'domains', 'dashboard', 'web', 'vite.config.mjs')],
    {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env },
    },
  );

  vite.on('exit', (code) => {
    backend.kill();
    process.exit(code ?? 0);
  });
};

// Give backend a moment to start
setTimeout(startVite, 2000);

process.on('SIGINT', () => {
  backend.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  backend.kill();
  process.exit(0);
});
