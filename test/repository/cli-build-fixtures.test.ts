import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const probes = vi.hoisted(() => ({
  readProcessIdentity: vi.fn(async () => 'synthetic-process-identity'),
  inspectProcessLiveness: vi.fn(async () => 'alive'),
}));
vi.mock('../../platform/process/process-identity.js', () => probes);

const roots: string[] = [];
beforeEach(() => {
  probes.inspectProcessLiveness.mockResolvedValue('alive');
  probes.readProcessIdentity.mockResolvedValue('synthetic-process-identity');
});
afterEach(async () => {
  for (const root of roots.splice(0)) {
    expect(path.relative(os.tmpdir(), root).startsWith('comet-cli-build-fixture-')).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-build-fixture-'));
  roots.push(root);
  for (const directory of ['app/cli', 'domains/example', 'platform', 'dist/app/cli'])
    await fs.mkdir(path.join(root, directory), { recursive: true });
  await fs.writeFile(path.join(root, 'app/cli/index.ts'), 'export const cli = true;\n');
  await fs.writeFile(path.join(root, 'domains/example/index.ts'), 'export const api = true;\n');
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
  await fs.writeFile(
    path.join(root, 'build.js'),
    `import fs from 'node:fs';
const files=['app/cli/index','domains/example/index'];
for(const name of files){fs.mkdirSync('dist/'+name.split('/').slice(0,-1).join('/'),{recursive:true});for(const ext of ['.js','.js.map','.d.ts','.d.ts.map'])fs.writeFileSync('dist/'+name+ext,'built');}
fs.appendFileSync('build-count.txt','build\\n');
`,
  );
  await fs.writeFile(path.join(root, 'dist/app/cli/index.js'), 'partial build');
  const future = new Date(Date.now() + 60_000);
  await fs.utimes(path.join(root, 'dist/app/cli/index.js'), future, future);
  return root;
}

async function owner(root: string, ageMs: number) {
  const ref = path.join(root, '.comet-test-build.lock');
  const bytes = JSON.stringify({
    pid: process.pid,
    nonce: 'existing-build-owner',
    createdAt: Date.now() - ageMs,
    hostname: os.hostname(),
    processIdentity: 'existing-process-identity',
  });
  await fs.writeFile(ref, bytes);
  const old = new Date(Date.now() - ageMs);
  await fs.utimes(ref, old, old);
  return { ref, bytes };
}

it('rebuilds when a fresh CLI entry is missing compiled SDK modules', async () => {
  const root = await fixture();
  await ensureCliBuilt(root);
  expect(await fs.readFile(path.join(root, 'build-count.txt'), 'utf8')).toBe('build\n');
  expect(await fs.readFile(path.join(root, 'dist/domains/example/index.js'), 'utf8')).toBe('built');
});

it('rejects a successful build process that still leaves compiled modules incomplete', async () => {
  const root = await fixture();
  await fs.writeFile(
    path.join(root, 'build.js'),
    "import fs from 'node:fs';fs.writeFileSync('dist/app/cli/index.js','still partial');\n",
  );
  await expect(ensureCliBuilt(root)).rejects.toThrow('CLI build outputs are incomplete');
});

it('does not take a live build lock just because its timestamp is old', async () => {
  const root = await fixture();
  const prior = await owner(root, 10 * 60_000);
  await expect(
    ensureCliBuilt(root, { lockOptions: { timeoutMs: 40, retryMs: 5 } }),
  ).rejects.toThrow('Timed out waiting');
  expect(await fs.readFile(prior.ref, 'utf8')).toBe(prior.bytes);
  await expect(fs.access(path.join(root, 'build-count.txt'))).rejects.toThrow();
});

it('recovers a lock whose recorded process identity has exited', async () => {
  const root = await fixture();
  await owner(root, 0);
  probes.inspectProcessLiveness.mockResolvedValue('dead');
  await ensureCliBuilt(root, { lockOptions: { timeoutMs: 100, retryMs: 5 } });
  expect(await fs.readFile(path.join(root, 'build-count.txt'), 'utf8')).toBe('build\n');
  await expect(fs.access(path.join(root, '.comet-test-build.lock'))).rejects.toThrow();
});

it('keeps an owner whose process identity cannot be established', async () => {
  const root = await fixture();
  const prior = await owner(root, 10 * 60_000);
  probes.inspectProcessLiveness.mockResolvedValue('unknown');
  await expect(
    ensureCliBuilt(root, { lockOptions: { timeoutMs: 40, retryMs: 5 } }),
  ).rejects.toThrow('Timed out waiting');
  expect(await fs.readFile(prior.ref, 'utf8')).toBe(prior.bytes);
});
