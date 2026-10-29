import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { copyCometSkillsForPlatform } from '../../domains/skill/platform-install.js';
import { PLATFORMS } from '../../platform/install/platforms.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'comet.js');
const state = path.join(repositoryRoot, 'assets', 'skills', 'comet', 'scripts', 'comet-state.mjs');

interface DoctorPayload {
  healthy: boolean;
  results: Array<{ check: string; status: string; message: string }>;
}

describe('Classic doctor change discovery', () => {
  let root: string;
  let project: string;
  let home: string;

  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 180_000);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-discovery-'));
    project = path.join(root, 'project');
    home = path.join(root, 'home');
    await fs.mkdir(project);
    await fs.mkdir(home);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function run(script: string, ...args: string[]) {
    return spawnSync(process.execPath, [script, ...args], {
      cwd: project,
      encoding: 'utf8',
      env: {
        ...process.env,
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
    expect(result.stderr).toBe('');
    const payload = JSON.parse(result.stdout) as DoctorPayload;
    return { ...result, payload };
  }

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
