import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { spawnSync } from 'child_process';
import { readRunState } from '../../../domains/engine/state.js';
import { ensureClassicRuntimeRun } from '../../../domains/comet-classic/classic-runtime-run.js';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const stateScript = path.join(scriptsDir, 'comet-state.mjs');
const validateScript = path.join(scriptsDir, 'comet-yaml-validate.mjs');
const buildScript = path.resolve('scripts', 'build', 'build-classic-runtime.mjs');
const temporaryDirectories: string[] = [];

async function snapshotChange(changeDir: string): Promise<{ files: string[]; yaml: Buffer }> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      files.push(path.relative(changeDir, absolute).replaceAll('\\', '/'));
      if (entry.isDirectory()) await visit(absolute);
    }
  }
  await visit(changeDir);
  return { files: files.sort(), yaml: await fs.readFile(path.join(changeDir, '.comet.yaml')) };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
      ),
  );
});

describe('Classic runtime CLI adapter', () => {
  it('records current-Run command checks through the state dispatcher', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-record-check-'));
    temporaryDirectories.push(directory);
    const previous = process.cwd();
    process.chdir(directory);
    try {
      const { runClassicCli } = await import('../../../domains/comet-classic/classic-cli.js');
      expect((await runClassicCli(['state', 'init', 'demo', 'full'])).exitCode).toBe(0);
      await ensureClassicRuntimeRun(path.join(directory, 'openspec', 'changes', 'demo'));
      const result = await runClassicCli([
        'state',
        'record-check',
        'demo',
        'build',
        '--command',
        'npx tsc --noEmit',
        '--exit-code',
        '0',
        '--cwd',
        '.',
      ]);

      expect(result).toMatchObject({ exitCode: 0 });
      expect(result.stderr).toContain('[RECORDED] build exit=0 cwd=. command=npx tsc --noEmit');
    } finally {
      process.chdir(previous);
    }
  });

  it('rejects record-check without a current Run without changing any files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-record-check-legacy-'));
    temporaryDirectories.push(directory);
    const previous = process.cwd();
    process.chdir(directory);
    try {
      const { runClassicCli } = await import('../../../domains/comet-classic/classic-cli.js');
      expect((await runClassicCli(['state', 'init', 'demo', 'full'])).exitCode).toBe(0);
      const changeDir = path.join(directory, 'openspec', 'changes', 'demo');
      const yamlPath = path.join(changeDir, '.comet.yaml');
      const yaml = (await fs.readFile(yamlPath, 'utf8')).replace(/^run_id:.*\r?\n/mu, '');
      await fs.writeFile(yamlPath, yaml);
      await fs.rm(path.join(changeDir, '.comet'), { recursive: true, force: true });
      const before = await snapshotChange(changeDir);

      const result = await runClassicCli([
        'state',
        'record-check',
        'demo',
        'build',
        '--command',
        'pnpm build',
        '--exit-code',
        '0',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('existing synchronized Classic Run');
      expect(await snapshotChange(changeDir)).toEqual(before);
    } finally {
      process.chdir(previous);
    }
  });

  it.each([
    ['an invalid migration marker', 'marker', 'classic_migration must be 1'],
    ['a mismatched Run skill identity', 'skill', 'Classic Run skill mismatch'],
  ])('rejects record-check with %s without changing any files', async (_label, fault, error) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `comet-record-check-${fault}-`));
    temporaryDirectories.push(directory);
    const previous = process.cwd();
    process.chdir(directory);
    try {
      const { runClassicCli } = await import('../../../domains/comet-classic/classic-cli.js');
      expect((await runClassicCli(['state', 'init', 'demo', 'full'])).exitCode).toBe(0);
      const changeDir = path.join(directory, 'openspec', 'changes', 'demo');
      await ensureClassicRuntimeRun(changeDir);
      if (fault === 'marker') {
        const yamlPath = path.join(changeDir, '.comet.yaml');
        const yaml = (await fs.readFile(yamlPath, 'utf8')).replace(
          /^classic_migration:.*$/mu,
          'classic_migration: 999',
        );
        await fs.writeFile(yamlPath, yaml);
      } else {
        const runPath = path.join(changeDir, '.comet', 'run-state.json');
        const run = JSON.parse(await fs.readFile(runPath, 'utf8'));
        run.skill = 'not-comet-classic';
        await fs.writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
      }
      const before = await snapshotChange(changeDir);

      const result = await runClassicCli([
        'state',
        'record-check',
        'demo',
        'build',
        '--command',
        'pnpm build',
        '--exit-code',
        '0',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(error);
      expect(await snapshotChange(changeDir)).toEqual(before);
    } finally {
      process.chdir(previous);
    }
  });

  it.each([
    [['deploy', '--command', 'npm test', '--exit-code', '0'], 'Invalid command check scope'],
    [['build', '--exit-code', '0'], 'Missing option: --command'],
    [['build', '--command', 'npm test', '--exit-code', '1.5'], 'integer'],
    [['build', '--command', 'npm test', '--exit-code', '0', '--wat'], 'Unknown option'],
  ])('rejects invalid record-check arguments %#', async (tail, message) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-record-check-invalid-'));
    temporaryDirectories.push(directory);
    const previous = process.cwd();
    process.chdir(directory);
    try {
      const { runClassicCli } = await import('../../../domains/comet-classic/classic-cli.js');
      expect((await runClassicCli(['state', 'init', 'demo', 'full'])).exitCode).toBe(0);
      const result = await runClassicCli(['state', 'record-check', 'demo', ...tail]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(message);
    } finally {
      process.chdir(previous);
    }
  });

  it('routes a command and preserves stdout, stderr, and exit code', async () => {
    const { runClassicCli } = await import('../../../domains/comet-classic/classic-cli.js');
    const result = await runClassicCli(['state', 'get', 'phase'], {
      state: async (args) => ({
        exitCode: 3,
        stdout: args.join('|'),
        stderr: 'diagnostic',
      }),
    });

    expect(result).toEqual({
      exitCode: 3,
      stdout: 'get|phase',
      stderr: 'diagnostic',
    });
  });

  it('serializes the complete command result for internal --json callers', async () => {
    const { runClassicCli } = await import('../../../domains/comet-classic/classic-cli.js');
    const result = await runClassicCli(['validate', '--json', 'change-dir'], {
      validate: async (_args, options) => ({
        exitCode: 2,
        stdout: options.json ? 'structured' : 'plain',
        stderr: 'invalid state',
      }),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBeUndefined();
    expect(JSON.parse(result.stdout ?? '')).toEqual({
      command: 'validate',
      exitCode: 2,
      stdout: 'structured',
      stderr: 'invalid state',
    });
  });

  it('rejects unknown commands after all recognized handlers are registered', async () => {
    const { runClassicCli } = await import('../../../domains/comet-classic/classic-cli.js');

    await expect(runClassicCli(['unknown'])).resolves.toMatchObject({
      exitCode: 64,
      stderr: expect.stringContaining('Unknown Classic command'),
    });
  });

  it('routes intent frames through the Classic CLI', async () => {
    const { runClassicCli } = await import('../../../domains/comet-classic/classic-cli.js');
    const frame = {
      schema_version: 'comet.intent.v1',
      utterance: 'fix the broken guard',
      locale: 'en',
      intent: { name: 'fix_bug', confidence: 0.92 },
      entities: [{ type: 'bug_signal', value: 'broken', text: 'broken' }],
      slots: {
        requested_action: 'fix',
        workflow_candidate: 'hotfix',
        user_explicit_workflow: null,
        change_id: null,
        target_area: 'guard',
        scope: 'small',
        existing_behavior: true,
        new_capability: false,
        public_api_change: false,
        schema_change: false,
        cross_module_change: false,
      },
      context: { active_changes_count: 0, active_change_names: [], dirty_worktree: false },
      evidence: [
        { field: 'intent.name', quote: 'fix', source: 'user' },
        { field: 'slots.workflow_candidate', quote: 'broken', source: 'user' },
      ],
      proposed_route: {
        name: 'hotfix',
        next_skill: 'comet-hotfix',
        confidence: 0.9,
        requires_confirmation: false,
        fallback_reason: null,
      },
    };

    const result = await runClassicCli(['intent', 'route', JSON.stringify(frame)]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout ?? '')).toMatchObject({
      route: { name: 'hotfix', next_skill: 'comet-hotfix' },
    });
  });

  it('returns readable intent validation errors', async () => {
    const { runClassicCli } = await import('../../../domains/comet-classic/classic-cli.js');

    const result = await runClassicCli(['intent', 'route', '{"schema_version":"wrong"}']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid CometIntentFrame');
  });
  it('routes intent frames from --stdin', async () => {
    const { runClassicCli } = await import('../../../domains/comet-classic/classic-cli.js');
    const frame = {
      schema_version: 'comet.intent.v1',
      utterance: 'fix the broken guard',
      locale: 'en',
      intent: { name: 'fix_bug', confidence: 0.92 },
      entities: [{ type: 'bug_signal', value: 'broken', text: 'broken' }],
      slots: {
        requested_action: 'fix',
        workflow_candidate: 'hotfix',
        user_explicit_workflow: null,
        change_id: null,
        target_area: 'guard',
        scope: 'small',
        existing_behavior: true,
        new_capability: false,
        public_api_change: false,
        schema_change: false,
        cross_module_change: false,
      },
      context: { active_changes_count: 0, active_change_names: [], dirty_worktree: false },
      evidence: [
        { field: 'intent.name', quote: 'fix', source: 'user' },
        { field: 'slots.workflow_candidate', quote: 'broken', source: 'user' },
      ],
      proposed_route: {
        name: 'hotfix',
        next_skill: 'comet-hotfix',
        confidence: 0.9,
        requires_confirmation: false,
        fallback_reason: null,
      },
    };

    const originalStdin = process.stdin;
    const input = new PassThrough();
    input.end(JSON.stringify(frame));
    Object.defineProperty(process, 'stdin', { value: input, configurable: true });

    const result = await runClassicCli(['intent', 'route', '--stdin']);

    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout ?? '')).toMatchObject({
      route: { name: 'hotfix', next_skill: 'comet-hotfix' },
    });
  });
});
describe('Classic script bundles', () => {
  it('runs without dist or node_modules and exposes JSON diagnostics', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-script-'));
    temporaryDirectories.push(directory);
    const isolatedStateScript = path.join(directory, 'comet-state.mjs');
    await fs.copyFile(
      path.join(scriptsDir, 'comet-runtime.mjs'),
      path.join(directory, 'comet-runtime.mjs'),
    );
    await fs.copyFile(stateScript, isolatedStateScript);

    const result = spawnSync(
      process.execPath,
      [isolatedStateScript, 'get', 'missing', 'phase', '--json'],
      {
        cwd: directory,
        encoding: 'utf8',
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      exitCode: result.status,
    });
  });

  it('is fresh and lists the shared runtime plus launchers in the shipped manifest', async () => {
    const check = spawnSync(process.execPath, [buildScript, '--check'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    const manifest = JSON.parse(
      await fs.readFile(path.resolve('assets', 'manifest.json'), 'utf8'),
    ) as {
      skills: string[];
    };

    expect(check.status, check.stderr || check.stdout).toBe(0);
    expect(manifest.skills).toContain('comet/scripts/comet-runtime.mjs');
    expect(manifest.skills).toContain('comet/scripts/comet-state.mjs');
    expect(manifest.skills).toContain('comet/scripts/comet-guard.mjs');
    expect(manifest.skills).toContain('comet/scripts/comet-intent.mjs');
  });

  it('executes state and validation commands from a standalone project', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-script-state-'));
    temporaryDirectories.push(directory);

    const init = spawnSync(process.execPath, [stateScript, 'init', 'demo', 'full'], {
      cwd: directory,
      encoding: 'utf8',
    });
    const demoDir = path.join(directory, 'openspec', 'changes', 'demo');
    await fs.writeFile(path.join(demoDir, 'proposal.md'), 'proposal\n');
    await fs.writeFile(path.join(demoDir, 'design.md'), 'design\n');
    await fs.writeFile(path.join(demoDir, 'tasks.md'), '- [x] seed\n');
    const get = spawnSync(process.execPath, [stateScript, 'get', 'demo', 'phase'], {
      cwd: directory,
      encoding: 'utf8',
    });
    const set = spawnSync(
      process.execPath,
      [stateScript, 'set', 'demo', 'build_mode', 'executing-plans'],
      { cwd: directory, encoding: 'utf8' },
    );
    const transition = spawnSync(
      process.execPath,
      [stateScript, 'transition', 'demo', 'open-complete'],
      { cwd: directory, encoding: 'utf8' },
    );
    const next = spawnSync(process.execPath, [stateScript, 'next', 'demo'], {
      cwd: directory,
      encoding: 'utf8',
    });
    const validate = spawnSync(process.execPath, [validateScript, 'demo'], {
      cwd: directory,
      encoding: 'utf8',
    });

    expect(init.status).toBe(0);
    expect(get).toMatchObject({ status: 0, stdout: 'open\n' });
    expect(set.status).toBe(0);
    expect(transition.status).toBe(0);
    const eventLog = await fs.readFile(path.join(demoDir, '.comet', 'state-events.jsonl'), 'utf8');
    expect(JSON.parse(eventLog.trim())).toMatchObject({
      schemaVersion: 1,
      change: 'demo',
      event: 'open-complete',
      source: 'comet-state',
      from: { phase: 'open' },
      to: { phase: 'design' },
      effects: [{ field: 'phase', from: 'open', to: 'design' }],
    });
    expect(next.stdout).toContain('SKILL: comet-design');
    expect(validate.status).toBe(0);
    expect(validate.stderr).toContain('validation PASSED');
  });

  it('keeps task-checkoff validation in the TypeScript state command', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-script-task-'));
    temporaryDirectories.push(directory);
    await fs.mkdir(path.join(directory, 'docs'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'docs', 'plan.md'),
      '- [x] Implement runtime facade\n- [ ] Continue migration\n',
    );

    const pass = spawnSync(
      process.execPath,
      [stateScript, 'task-checkoff', 'docs/plan.md', 'Implement runtime facade'],
      { cwd: directory, encoding: 'utf8' },
    );
    const fail = spawnSync(
      process.execPath,
      [stateScript, 'task-checkoff', 'docs/plan.md', 'Continue migration'],
      { cwd: directory, encoding: 'utf8' },
    );

    expect(pass.status).toBe(0);
    expect(pass.stdout).toContain('TASK_CHECKOFF: PASS');
    expect(fail.status).toBe(1);
    expect(fail.stderr).toContain('task is not checked');
  });

  it('rejects direct writes to machine-owned Run fields', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-script-owned-'));
    temporaryDirectories.push(directory);
    spawnSync(process.execPath, [stateScript, 'init', 'demo', 'full'], {
      cwd: directory,
      encoding: 'utf8',
    });

    const result = spawnSync(
      process.execPath,
      [stateScript, 'set', 'demo', 'current_step', 'completed'],
      { cwd: directory, encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unknown field');
  });

  it('re-resolves the Run step when migrated Classic configuration changes', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-script-sync-'));
    temporaryDirectories.push(directory);
    spawnSync(process.execPath, [stateScript, 'init', 'demo', 'full'], {
      cwd: directory,
      encoding: 'utf8',
    });
    const changeDir = path.join(directory, 'openspec', 'changes', 'demo');
    await ensureClassicRuntimeRun(changeDir);
    spawnSync(process.execPath, [stateScript, 'set', 'demo', 'phase', 'build'], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, COMET_FORCE_PHASE: '1' },
    });
    // Full-workflow build source writes require a recorded design_doc, otherwise
    // the hook guard treats it as an illegal phase jump.
    await fs.mkdir(path.join(directory, 'docs'), { recursive: true });
    await fs.writeFile(path.join(directory, 'docs', 'design.md'), 'design\n');
    spawnSync(process.execPath, [stateScript, 'set', 'demo', 'design_doc', 'docs/design.md'], {
      cwd: directory,
      encoding: 'utf8',
    });
    await fs.mkdir(path.join(directory, 'docs'), { recursive: true });
    await fs.writeFile(path.join(directory, 'docs', 'plan.md'), '- [ ] implement\n');

    const set = spawnSync(process.execPath, [stateScript, 'set', 'demo', 'plan', 'docs/plan.md'], {
      cwd: directory,
      encoding: 'utf8',
    });
    const runState = await readRunState(changeDir);

    expect(set.status).toBe(0);
    expect(runState).not.toBeNull();
    expect(runState!.currentStep).toBe('full.build.configure');
  });
});
