import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { prepareClassicLegacyProject } from '../helpers/classic-project.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

it('reports a Classic phase context estimate separately from trace measurements without writing workflow state', async () => {
  const repository = process.env.COMET_TEST_PACKAGE_ROOT ?? path.resolve('.');
  if (!process.env.COMET_TEST_PACKAGE_ROOT) await ensureCliBuilt(repository);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-context-cost-'));
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    COMET_DATA_DIR: path.join(home, 'data'),
    CODEX_HOME: path.join(home, 'codex'),
    XDG_DATA_HOME: path.join(home, 'xdg-data'),
    XDG_STATE_HOME: path.join(home, 'xdg-state'),
    XDG_CACHE_HOME: path.join(home, 'xdg-cache'),
    XDG_CONFIG_HOME: path.join(home, 'xdg-config'),
    COMET_DAEMON: '0',
    COMET_LANGUAGE: 'en',
  };
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, [path.join(repository, 'bin/comet.js'), ...args, '--json'], {
      cwd: project,
      env,
      encoding: 'utf8',
      windowsHide: true,
    });
  try {
    await fs.mkdir(home);
    await prepareClassicLegacyProject(project);
    execFileSync('git', ['init', '-b', 'main'], { cwd: project, stdio: 'ignore' });
    const init = cli(
      'classic',
      'state',
      'init',
      'context-demo',
      'full',
      '--runtime',
      'sdk',
      '--isolation',
      'current',
    );
    expect(init.status, init.stderr || init.stdout).toBe(0);
    const stateFile = path.join(project, 'openspec/changes/context-demo/comet-state.yaml');
    const originalState = await fs.readFile(stateFile, 'utf8');
    const original = cli('classic', 'state', 'next', 'context-demo');
    expect(original.status, original.stderr || original.stdout).toBe(0);
    const snapshot = cli('classic', 'context-cost', 'context-demo');
    expect(snapshot.status, snapshot.stderr || snapshot.stdout).toBe(0);
    const data = JSON.parse(snapshot.stdout).data;
    expect(data).toMatchObject({
      schema: 'comet.classic.context-cost.v1',
      scope: { change: 'context-demo', phase: 'open', projectRoot: project },
      metrics: { inputTokens: null, toolRoundTrips: null, waitMs: null },
      categories: {
        rule: {
          estimate: { value: expect.any(Number), unit: 'bytes', kind: 'estimated' },
          observed: {},
        },
        stage: {
          estimate: { value: expect.any(Number), unit: 'bytes', kind: 'estimated' },
          observed: {},
        },
        cli: {
          estimate: {
            value: expect.any(Number),
            unit: 'bytes',
            kind: 'estimated',
            source: 'classic-state-next',
          },
          observed: {},
        },
      },
    });
    expect(data.categories.stage.references).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/comet-open\/SKILL\.md$/u),
        expect.stringMatching(/comet-classic\/reference\/scripts\.md$/u),
      ]),
    );
    expect(data.categories.rule.estimate.value).toBeGreaterThan(0);
    expect(data.categories.stage.estimate.value).toBeGreaterThan(0);
    expect(data.categories.cli.estimate.value).toBeGreaterThan(0);

    const traceFile = path.join(root, 'platform-trace.json');
    const trace = {
      schema: 'comet.classic.context-trace.v1',
      scope: data.scope,
      source: 'fixture-platform-trace',
      metrics: { contextBytes: 400, inputTokens: 180, toolRoundTrips: 0, waitMs: 16 },
      categories: { cli: { contextBytes: 80 } },
    };
    await fs.writeFile(traceFile, JSON.stringify(trace));
    const withTrace = cli('classic', 'context-cost', 'context-demo', '--trace', traceFile);
    expect(withTrace.status, withTrace.stderr || withTrace.stdout).toBe(0);
    expect(JSON.parse(withTrace.stdout).data).toMatchObject({
      metrics: {
        contextBytes: { value: 400, unit: 'bytes', kind: 'observed', source: trace.source },
        inputTokens: { value: 180, unit: 'tokens', kind: 'observed', source: trace.source },
        toolRoundTrips: { value: 0, unit: 'calls', kind: 'observed', source: trace.source },
        waitMs: { value: 16, unit: 'ms', kind: 'observed', source: trace.source },
      },
      categories: {
        stage: { observed: {} },
        cli: {
          estimate: data.categories.cli.estimate,
          observed: { contextBytes: { value: 80, unit: 'bytes', kind: 'observed' } },
        },
      },
    });
    await fs.writeFile(
      traceFile,
      JSON.stringify({ ...trace, scope: { ...data.scope, change: 'other' } }),
    );
    const wrongTrace = cli('classic', 'context-cost', 'context-demo', '--trace', traceFile);
    expect(wrongTrace.status).not.toBe(0);
    expect(JSON.parse(wrongTrace.stdout).stderr).toMatch(/trace scope/i);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(originalState);
    expect(
      JSON.parse(cli('classic', 'state', 'next', 'context-demo').stdout).data.run.revision,
    ).toBe(JSON.parse(original.stdout).data.run.revision);

    const revision = JSON.parse(original.stdout).data.run.revision;
    const edited = (await fs.readFile(stateFile, 'utf8')).replace(
      /language: .+/u,
      'language: zh-CN',
    );
    expect(edited).not.toBe(originalState);
    await fs.writeFile(stateFile, edited);
    const recovery = cli('classic', 'context-cost', 'context-demo');
    expect(recovery.status, recovery.stdout).not.toBe(0);
    expect(JSON.parse(recovery.stdout).stderr).toMatch(/settings have not been imported/u);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(edited);
    const importSettings = cli('classic', 'state', 'next', 'context-demo');
    expect(JSON.parse(importSettings.stdout).data.run.revision).toBe(revision + 1);
    expect(cli('classic', 'context-cost', 'context-demo').status).toBe(0);

    const workspaceRoot = path.join(env.COMET_DATA_DIR, 'workspaces');
    const [workspace] = await fs.readdir(workspaceRoot);
    const history = path.join(workspaceRoot, workspace, 'runtime', 'sdk-runs', 'classic');
    const missingHistoryState = await fs.readFile(stateFile, 'utf8');
    await fs.rename(history, `${history}-backup`);
    const missing = cli('classic', 'context-cost', 'context-demo');
    expect(missing.status, missing.stdout).not.toBe(0);
    expect(JSON.parse(missing.stdout).stderr).toMatch(/requires recovery/u);
    await expect(fs.stat(history)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(stateFile, 'utf8')).toBe(missingHistoryState);
    await fs.rename(`${history}-backup`, history);
    expect(cli('classic', 'context-cost', 'context-demo').status).toBe(0);

    expect(
      cli('classic', 'state', 'init', 'compat-demo', 'full', '--runtime', 'compat').status,
    ).toBe(0);
    const compatFile = path.join(project, 'openspec/changes/compat-demo/.comet.yaml');
    await fs.writeFile(
      compatFile,
      (await fs.readFile(compatFile, 'utf8')).replace(/language: .+/u, 'language: null'),
    );
    Object.assign(env, { COMET_LANGUAGE: 'zh-CN' });
    const inherited = cli('classic', 'context-cost', 'compat-demo');
    expect(inherited.status, inherited.stderr || inherited.stdout).toBe(0);
    expect(JSON.parse(inherited.stdout).data.categories.rule.references).toEqual([
      'comet/rules/comet-workflow-guard.md',
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 120_000);
