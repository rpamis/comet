import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { statusCommand } from '../../app/commands/status.js';
import { ensureClassicRuntimeRun } from '../../domains/comet-classic/classic-runtime-run.js';
import { createNativeChange } from '../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../domains/comet-native/native-paths.js';

const stateScript = path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-state.mjs');

function state(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [stateScript, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, COMET_FORCE_PHASE: '1' },
  });
}

async function snapshotChange(changeDir: string): Promise<{ files: string[]; yaml: Buffer }> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(changeDir, absolute).replaceAll('\\', '/');
      files.push(relative);
      if (entry.isDirectory()) await visit(absolute);
    }
  }
  await visit(changeDir);
  return {
    files: files.sort(),
    yaml: await fs.readFile(path.join(changeDir, '.comet.yaml')),
  };
}

async function setCometYamlField(
  changeDir: string,
  field: string,
  value: string | null,
): Promise<void> {
  const yamlPath = path.join(changeDir, '.comet.yaml');
  const yaml = await fs.readFile(yamlPath, 'utf8');
  const rendered = value === null ? 'null' : value;
  const pattern = new RegExp(`^${field}:.*$`, 'mu');
  const next = pattern.test(yaml)
    ? yaml.replace(pattern, `${field}: ${rendered}`)
    : `${yaml.trimEnd()}\n${field}: ${rendered}\n`;
  await fs.writeFile(yamlPath, next);
}

describe('status command', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-status-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('classifies mixed Comet and OpenSpec changes in sorted JSON output', async () => {
    const changesDir = path.join(tmpDir, 'openspec', 'changes');
    state(tmpDir, 'init', 'z-comet-ready', 'full');
    state(tmpDir, 'set', 'z-comet-ready', 'phase', 'archive');
    state(tmpDir, 'set', 'z-comet-ready', 'verify_result', 'pass');
    await fs.writeFile(path.join(changesDir, 'z-comet-ready', 'tasks.md'), '- [ ] ignored\n');

    state(tmpDir, 'init', 'b-invalid-comet', 'full');
    await fs.appendFile(
      path.join(changesDir, 'b-invalid-comet', '.comet.yaml'),
      'unknown_root_field: true\n',
    );

    await fs.mkdir(path.join(changesDir, 'a-open-complete'), { recursive: true });
    await fs.writeFile(
      path.join(changesDir, 'a-open-complete', 'tasks.md'),
      '- [x] first\n- [X] second\n',
    );
    await fs.mkdir(path.join(changesDir, 'c-open-incomplete'), { recursive: true });
    await fs.writeFile(
      path.join(changesDir, 'c-open-incomplete', 'tasks.md'),
      '- [x] first\n- [ ] second\n',
    );
    await fs.mkdir(path.join(changesDir, 'archive', 'old-change'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'archive', 'old-change', 'tasks.md'), '- [x] done\n');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await statusCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const payload = JSON.parse(json);
    expect(payload).toMatchObject({
      schema: 'comet.status.v2',
      defaultEntry: {
        workflow: 'classic',
        skill: 'comet-classic',
        source: 'legacy-fallback',
      },
      workflows: {
        native: { changes: [] },
        classic: {
          changes: [
            expect.objectContaining({ name: 'b-invalid-comet' }),
            expect.objectContaining({ name: 'z-comet-ready' }),
          ],
        },
      },
      unmanagedOpenSpec: [
        expect.objectContaining({ name: 'a-open-complete' }),
        expect.objectContaining({ name: 'c-open-incomplete' }),
      ],
    });
    const changes = payload.changes;
    expect(changes.map((change: { name: string }) => change.name)).toEqual([
      'a-open-complete',
      'b-invalid-comet',
      'c-open-incomplete',
      'z-comet-ready',
    ]);
    expect(changes[0]).toEqual({
      name: 'a-open-complete',
      cometManaged: false,
      archiveReady: true,
      recommendedArchiveCommand: 'openspec archive a-open-complete -y',
      workflow: null,
      phase: null,
      buildMode: null,
      isolation: null,
      boundBranch: null,
      verifyMode: null,
      verifyResult: null,
      designDoc: null,
      plan: null,
      tasksCompleted: 2,
      tasksTotal: 2,
      nextCommand: null,
      currentStep: null,
      runtimeMode: null,
      runtimeEval: null,
      commandChecks: null,
    });
    expect(changes[1]).toMatchObject({
      name: 'b-invalid-comet',
      cometManaged: true,
      archiveReady: false,
      recommendedArchiveCommand: 'comet archive b-invalid-comet',
      phase: 'invalid',
      commandChecks: null,
      error: expect.stringContaining('unknown_root_field'),
    });
    expect(changes[2]).toMatchObject({
      name: 'c-open-incomplete',
      cometManaged: false,
      archiveReady: false,
      recommendedArchiveCommand: 'openspec archive c-open-incomplete -y',
      tasksCompleted: 1,
      tasksTotal: 2,
      commandChecks: null,
    });
    expect(changes[3]).toMatchObject({
      name: 'z-comet-ready',
      cometManaged: true,
      archiveReady: true,
      recommendedArchiveCommand: 'comet archive z-comet-ready',
      phase: 'archive',
      verifyResult: 'pass',
      tasksCompleted: 0,
      tasksTotal: 1,
      commandChecks: null,
    });
    expect(changes.every((change: { boundBranch?: unknown }) => 'boundBranch' in change)).toBe(
      true,
    );
  });

  it('includes latest build and verify command checks for a synchronized Comet Run', async () => {
    state(tmpDir, 'init', 'audited', 'full');
    await ensureClassicRuntimeRun(path.join(tmpDir, 'openspec', 'changes', 'audited'));
    expect(
      state(
        tmpDir,
        'record-check',
        'audited',
        'build',
        '--command',
        'pnpm build',
        '--exit-code',
        '0',
        '--cwd',
        '.',
      ).status,
    ).toBe(0);
    expect(
      state(
        tmpDir,
        'record-check',
        'audited',
        'verify',
        '--command',
        'pnpm test',
        '--exit-code',
        '2',
        '--cwd',
        'packages/app',
      ).status,
    ).toBe(0);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await statusCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(JSON.parse(json).changes[0].commandChecks).toEqual({
      build: expect.objectContaining({
        runId: expect.any(String),
        scope: 'build',
        command: 'pnpm build',
        exitCode: 0,
        cwd: '.',
      }),
      verify: expect.objectContaining({
        runId: expect.any(String),
        scope: 'verify',
        command: 'pnpm test',
        exitCode: 2,
        cwd: 'packages/app',
      }),
    });

    const textLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await statusCommand(tmpDir);
      const output = textLog.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('build_check: pass (pnpm build; cwd: .; recorded:');
      expect(output).toContain(
        'verify_check: fail exit=2 (pnpm test; cwd: packages/app; recorded:',
      );
    } finally {
      textLog.mockRestore();
    }
  });

  it('labels mixed text output and recommends archive commands only for ready changes', async () => {
    const changesDir = path.join(tmpDir, 'openspec', 'changes');
    state(tmpDir, 'init', 'comet-ready', 'full');
    state(tmpDir, 'set', 'comet-ready', 'phase', 'archive');
    state(tmpDir, 'set', 'comet-ready', 'verify_result', 'pass');
    state(tmpDir, 'init', 'comet-not-ready', 'full');
    await fs.mkdir(path.join(changesDir, 'open-ready'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'open-ready', 'tasks.md'), '- [x] done\n');
    await fs.mkdir(path.join(changesDir, 'open-not-ready'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'open-not-ready', 'tasks.md'), '- [ ] todo\n');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await statusCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('comet-ready [Comet] [phase: archive]');
    expect(output).toContain('comet-not-ready [Comet] [phase: open]');
    expect(output).toContain('open-ready [OpenSpec] [plain change [1/1 tasks]]');
    expect(output).toContain('open-not-ready [OpenSpec] [plain change [0/1 tasks]]');
    expect(output).toContain('recommended archive: comet archive comet-ready');
    expect(output).toContain('recommended archive: openspec archive open-ready -y');
    expect(output).not.toContain('recommended archive: comet archive comet-not-ready');
    expect(output).not.toContain('recommended archive: openspec archive open-not-ready -y');
    expect(output.match(/recommended archive:/g)).toHaveLength(2);
  });

  it('prints the next command for active changes', async () => {
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'next-build');
    state(tmpDir, 'init', 'next-build', 'full');
    state(tmpDir, 'set', 'next-build', 'phase', 'build');
    state(tmpDir, 'set', 'next-build', 'build_mode', 'executing-plans');
    state(tmpDir, 'set', 'next-build', 'tdd_mode', 'tdd');
    state(tmpDir, 'set', 'next-build', 'isolation', 'branch');
    state(tmpDir, 'set', 'next-build', 'verify_mode', 'light');
    state(tmpDir, 'set', 'next-build', 'design_doc', 'docs/superpowers/specs/next-build.md');
    state(tmpDir, 'set', 'next-build', 'plan', 'docs/superpowers/plans/next-build.md');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n- [ ] todo\n');
    await ensureClassicRuntimeRun(changeDir);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await statusCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('next: /comet-build');
    expect(output).toContain('[1/2 tasks]');
    expect(output).toContain('run_step: full.build.plan');
  });

  it('prints branch-bound workspace modes with bound branch and omits bound suffix for null isolation', async () => {
    const changesDir = path.join(tmpDir, 'openspec', 'changes');
    state(tmpDir, 'init', 'current-bound', 'full');
    await setCometYamlField(path.join(changesDir, 'current-bound'), 'isolation', 'current');
    await setCometYamlField(path.join(changesDir, 'current-bound'), 'bound_branch', 'feature-A');

    state(tmpDir, 'init', 'branch-bound', 'full');
    await setCometYamlField(path.join(changesDir, 'branch-bound'), 'isolation', 'branch');
    await setCometYamlField(path.join(changesDir, 'branch-bound'), 'bound_branch', 'feature-B');

    state(tmpDir, 'init', 'worktree-bound', 'full');
    await setCometYamlField(path.join(changesDir, 'worktree-bound'), 'isolation', 'worktree');
    await setCometYamlField(path.join(changesDir, 'worktree-bound'), 'bound_branch', 'feature-C');

    state(tmpDir, 'init', 'null-bound', 'full');
    await setCometYamlField(path.join(changesDir, 'null-bound'), 'bound_branch', 'feature-D');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await statusCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('isolation: current (bound: feature-A)');
    expect(output).toContain('isolation: branch (bound: feature-B)');
    expect(output).toContain('isolation: worktree (bound: feature-C)');
    expect(output).not.toContain('feature-D');
  });

  it('includes boundBranch in JSON status output', async () => {
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'current-bound');
    state(tmpDir, 'init', 'current-bound', 'full');
    await setCometYamlField(changeDir, 'isolation', 'current');
    await setCometYamlField(changeDir, 'bound_branch', 'feature-A');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await statusCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(JSON.parse(json).changes[0]).toMatchObject({
      name: 'current-bound',
      isolation: 'current',
      boundBranch: 'feature-A',
    });
  });

  it('keeps legacy state without a Run byte-for-byte read-only in text and JSON status', async () => {
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'next-verify');
    state(tmpDir, 'init', 'next-verify', 'full');
    state(tmpDir, 'set', 'next-verify', 'phase', 'verify');
    const yamlPath = path.join(changeDir, '.comet.yaml');
    const yaml = (await fs.readFile(yamlPath, 'utf8')).replace(/^run_id:.*\r?\n/mu, '');
    await fs.writeFile(yamlPath, yaml);
    await fs.rm(path.join(changeDir, '.comet'), { recursive: true, force: true });
    const before = await snapshotChange(changeDir);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await statusCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const change = JSON.parse(json).changes[0];
    expect(change.nextCommand).toBe('/comet-verify');
    expect(change.currentStep).toBeNull();
    expect(change.runtimeMode).toBe('legacy-state');
    expect(change.runtimeEval).toBeNull();
    expect(change.commandChecks).toBeNull();
    expect(await snapshotChange(changeDir)).toEqual(before);

    const textLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await statusCommand(tmpDir);
    } finally {
      textLog.mockRestore();
    }
    expect(await snapshotChange(changeDir)).toEqual(before);
  });

  it.each([
    ['an invalid migration marker', 'marker', 'classic_migration must be 1'],
    ['a mismatched Run skill identity', 'skill', 'Classic Run skill mismatch'],
  ])(
    'reports %s as invalid without changing the synchronized change',
    async (_label, fault, error) => {
      const changeDir = path.join(tmpDir, 'openspec', 'changes', `invalid-${fault}`);
      state(tmpDir, 'init', `invalid-${fault}`, 'full');
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

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let json: string;
      try {
        await statusCommand(tmpDir, { json: true });
        json = log.mock.calls.map((call) => call.join(' ')).join('\n');
      } finally {
        log.mockRestore();
      }

      expect(JSON.parse(json).changes[0]).toMatchObject({
        cometManaged: true,
        phase: 'invalid',
        runtimeMode: 'invalid',
        commandChecks: null,
        error: expect.stringContaining(error),
      });
      expect(await snapshotChange(changeDir)).toEqual(before);
    },
  );

  it('reports invalid state without modifying it', async () => {
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'invalid');
    state(tmpDir, 'init', 'invalid', 'full');
    await fs.appendFile(
      path.join(changeDir, '.comet.yaml'),
      'build_command: npm run build\nunknown_root_field: true\n',
    );
    const before = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await statusCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(JSON.parse(json).changes[0]).toMatchObject({
      name: 'invalid',
      phase: 'invalid',
      error: expect.stringContaining('unknown_root_field'),
    });
    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).toBe(before);
  });

  it('keeps invalid errors visible and only prints the invalid recovery hint for invalid changes', async () => {
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'invalid');
    state(tmpDir, 'init', 'invalid', 'full');
    await fs.appendFile(path.join(changeDir, '.comet.yaml'), 'unknown_root_field: true\n');

    state(tmpDir, 'init', 'runtime-eval-fail', 'full');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await statusCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('error: Invalid Classic state: unknown field(s): unknown_root_field');
    expect(output).toContain('next: inspect .comet.yaml and rerun comet doctor');
    expect(output).toContain('runtime-eval-fail [Comet] [phase: open]');
    expect(output.match(/next: inspect \.comet\.yaml and rerun comet doctor/g)).toHaveLength(1);
  });

  it('prints actionable runtime-eval recovery guidance for valid changes', async () => {
    state(tmpDir, 'init', 'runtime-eval-fail', 'full');
    await ensureClassicRuntimeRun(path.join(tmpDir, 'openspec', 'changes', 'runtime-eval-fail'));

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await statusCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain(
      'runtime_check: fail (full.open; missing: openspec.proposal, openspec.tasks)',
    );
    expect(output).toContain(
      'next: run /comet-open or restore missing evidence (openspec.proposal, openspec.tasks), then rerun comet doctor',
    );
  });

  it('reports Classic runtime mode from shared diagnostics', async () => {
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'demo');
    state(tmpDir, 'init', 'demo', 'full');
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] build\n');
    await ensureClassicRuntimeRun(changeDir);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json: string;
    try {
      await statusCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }
    const payload = JSON.parse(json);

    expect(payload.changes[0]).toMatchObject({
      name: 'demo',
      currentStep: 'full.open',
      runtimeMode: 'engine-projection',
    });
  });

  it('renders the default entry and workflow partitions in text output', async () => {
    await writeProjectConfig(tmpDir, defaultProjectConfig('docs'));
    const paths = await nativeProjectPaths(tmpDir, 'docs');
    await createNativeChange({ paths, name: 'native-text', language: 'en' });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await statusCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('Default Entry: native -> /comet-native [project-config]');
    expect(output).toContain('Native Changes:');
    expect(output).toContain('native-text [Native] [phase: shape]');
    expect(output).toContain('Classic Changes:');
    expect(output).toContain('Unmanaged OpenSpec Changes:');
  });
});
