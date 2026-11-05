import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { copyCometSkillsForPlatform } from '../../domains/skill/platform-install.js';
import { PLATFORMS } from '../../platform/install/platforms.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(process.env.COMET_TEST_PACKAGE_ROOT ?? repositoryRoot, 'bin', 'comet.js');
const state = path.join(
  process.env.COMET_TEST_PACKAGE_ROOT ?? repositoryRoot,
  'assets',
  'skills',
  'comet',
  'scripts',
  'comet-state.mjs',
);

interface DoctorPayload {
  healthy: boolean;
  results: Array<{ check: string; status: string; message: string }>;
}

describe('Classic doctor change discovery', () => {
  let root: string;
  let project: string;
  let home: string;
  let commandPath: string | undefined;

  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 180_000);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-discovery-'));
    project = path.join(root, 'project');
    home = path.join(root, 'home');
    await fs.mkdir(project);
    await fs.mkdir(home);
    commandPath = undefined;
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function run(script: string, ...args: string[]) {
    const environment = { ...process.env };
    if (commandPath) {
      for (const key of Object.keys(environment))
        if (key.toLowerCase() === 'path') delete environment[key];
      environment.PATH = commandPath;
    }
    return spawnSync(process.execPath, [script, ...args], {
      cwd: project,
      encoding: 'utf8',
      env: {
        ...environment,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--trace-deprecation'].filter(Boolean).join(' '),
        HOME: home,
        USERPROFILE: home,
        APPDATA: path.join(home, 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
        CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
        COMET_DATA_DIR: path.join(root, 'runtime-data'),
      },
    });
  }

  async function initialize(layout: 'docs' | 'legacy') {
    const artifactRoot = path.join(
      project,
      ...(layout === 'docs' ? ['docs', 'openspec'] : ['openspec']),
    );
    await fs.mkdir(path.join(project, '.comet'));
    await fs.writeFile(
      path.join(project, '.comet', 'config.yaml'),
      `schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: ${layout}\n  language: en\n`,
    );
    await fs.mkdir(path.join(artifactRoot, 'changes', 'archive'), { recursive: true });
    await fs.mkdir(path.join(artifactRoot, 'specs'));
    await fs.writeFile(path.join(artifactRoot, 'config.yaml'), 'schema: spec-driven\n');
    await copyCometSkillsForPlatform(
      project,
      PLATFORMS.find((platform) => platform.id === 'claude')!,
      true,
      'skills',
      'project',
      'copy',
      'classic',
    );
    return path.join(artifactRoot, 'changes');
  }

  function doctor() {
    const result = run(cli, 'doctor', project, '--scope', 'project', '--json');
    expect(result.error).toBeUndefined();
    expect(result.stderr, result.stderr).toBe('');
    const payload = JSON.parse(result.stdout) as DoctorPayload;
    return { ...result, payload };
  }

  it.each([false, true])(
    'keeps doctor stderr clean when CodeGraph is resolved through pnpm (installed=%s)',
    async (installed) => {
      project = path.join(root, 'project with spaces');
      await fs.mkdir(project);
      await initialize('docs');
      const commands = path.join(root, 'commands with spaces');
      const globalBin = path.join(root, 'global bin');
      const calls = path.join(root, 'calls.jsonl');
      await fs.mkdir(commands);
      await fs.mkdir(globalBin);
      const shim = async (directory: string, name: string, output: string) => {
        const script = path.join(directory, `${name}.cjs`);
        const program =
          name === 'which'
            ? `if(!['openspec','pnpm'].includes(process.argv[2]))process.exit(1);process.stdout.write(require('node:path').join(${JSON.stringify(commands)},process.argv[2]));`
            : `process.stdout.write(${JSON.stringify(output)});`;
        await fs.writeFile(
          script,
          `require('node:fs').appendFileSync(${JSON.stringify(calls)},JSON.stringify([${JSON.stringify(name)},...process.argv.slice(2)])+'\\n');${program}`,
        );
        if (process.platform === 'win32')
          await fs.writeFile(
            path.join(directory, `${name}.cmd`),
            `@"${process.execPath}" "%~dp0${name}.cjs" %*\r\n`,
          );
        else {
          const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
          await fs.writeFile(
            path.join(directory, name),
            `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
            { mode: 0o755 },
          );
        }
      };
      await shim(commands, 'openspec', '1.6.0');
      await shim(commands, 'pnpm', globalBin);
      if (process.platform !== 'win32') await shim(commands, 'which', '');
      if (installed) {
        await shim(
          globalBin,
          'codegraph',
          JSON.stringify({
            initialized: true,
            pendingChanges: { added: 0, modified: 0, removed: 0 },
            index: { state: 'complete', reindexRecommended: false, pendingRefs: 0 },
          }),
        );
        await fs.mkdir(path.join(project, '.codegraph'));
        await fs.writeFile(path.join(project, '.codegraph', 'codegraph.db'), 'fixture');
      }
      commandPath =
        process.platform === 'win32'
          ? [commands, path.join(process.env.SystemRoot!, 'System32')].join(path.delimiter)
          : commands;
      const result = doctor();
      expect(result.status, JSON.stringify(result.payload)).toBe(0);
      expect(result.payload.results).toContainEqual(
        expect.objectContaining({ check: 'CodeGraph CLI', status: installed ? 'pass' : 'warn' }),
      );
      if (installed)
        expect(result.payload.results).toContainEqual(
          expect.objectContaining({ check: 'CodeGraph project index', status: 'pass' }),
        );
      const invoked = (await fs.readFile(calls, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[]);
      expect(invoked).toContainEqual(['pnpm', 'bin', '-g']);
      if (installed) expect(invoked).toContainEqual(['codegraph', 'status', '--json', project]);
      else expect(invoked.some(([name]) => name === 'codegraph')).toBe(false);
      for (const call of invoked) {
        if (call[0] === 'pnpm') expect(call).toEqual(['pnpm', 'bin', '-g']);
        if (call[0] === 'codegraph')
          expect(call).toEqual(['codegraph', 'status', '--json', project]);
      }
    },
  );

  it.each(['docs', 'legacy'] as const)(
    'ignores non-change entries without changing a healthy doctor exit in %s layout',
    async (layout) => {
      const changes = await initialize(layout);
      const baseline = doctor();
      expect(baseline.status, JSON.stringify(baseline.payload)).toBe(0);
      expect(baseline.payload.healthy).toBe(true);
      const files = ['.DS_Store', '.gitkeep', 'Thumbs.db', '.change.swp', 'change~'];
      for (const file of files) await fs.writeFile(path.join(changes, file), 'not a change\n');
      await fs.mkdir(path.join(changes, '.cache'));
      await fs.writeFile(path.join(changes, '.cache', 'comet-state.yaml'), 'invalid: [\n');
      const noise = doctor();
      expect(noise.status, JSON.stringify(noise.payload)).toBe(0);
      expect(noise.payload.healthy).toBe(true);
      expect(noise.payload.results).toEqual(baseline.payload.results);
      for (const file of files)
        expect(await fs.readFile(path.join(changes, file), 'utf8')).toBe('not a change\n');
      const status = run(cli, 'status', project);
      expect(status.status, status.stderr).toBe(0);
      expect(status.stdout).toContain('No active changes.');
    },
  );

  it.each(['docs', 'legacy'] as const)(
    'still validates real change state and rejects valid-name files and links in %s layout',
    async (layout) => {
      const changes = await initialize(layout);
      const initialized = run(state, 'init', 'valid-change', 'full', '--runtime', 'compat');
      expect(initialized.status, initialized.stderr).toBe(0);
      const healthy = doctor();
      expect(healthy.payload.results).toContainEqual(
        expect.objectContaining({
          check: expect.stringContaining(': valid-change'),
          status: 'pass',
        }),
      );
      expect(healthy.status, JSON.stringify(healthy.payload)).toBe(0);
      await fs.writeFile(path.join(changes, 'plain-file'), 'not a directory\n');
      const outside = path.join(root, 'outside');
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'comet-state.yaml'), 'external evidence\n');
      await fs.symlink(
        outside,
        path.join(changes, 'linked-change'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const changeFiles = await fs.readdir(path.join(changes, 'valid-change'));
      const stateFile = changeFiles.find(
        (file) => file === 'comet-state.yaml' || file === '.comet.yaml',
      );
      expect(stateFile).toBeDefined();
      await fs.writeFile(path.join(changes, 'valid-change', stateFile!), 'workflow: [\n');
      const broken = doctor();
      expect(broken.status).toBe(1);
      for (const name of ['plain-file', 'linked-change', 'valid-change'])
        expect(broken.payload.results).toContainEqual(
          expect.objectContaining({ check: expect.stringContaining(`: ${name}`), status: 'fail' }),
        );
      expect(await fs.readFile(path.join(outside, 'comet-state.yaml'), 'utf8')).toBe(
        'external evidence\n',
      );
      expect(await fs.readFile(path.join(changes, 'plain-file'), 'utf8')).toBe('not a directory\n');
    },
  );
});
