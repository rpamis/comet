import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { WorkflowRun } from '../../domains/engine/runtime.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import { createDiskApplication } from '../helpers/workflow-application.js';

const repository = path.resolve('.');
const cli = path.join(repository, 'bin/comet.js');
const previousCli = process.env.COMET_PINNED_UPGRADE_FROM_CLI ?? cli;
const currentCli = process.env.COMET_PINNED_UPGRADE_TO_CLI ?? cli;
let root: string;
let project: string;

beforeAll(() => ensureCliBuilt(repository));
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-pinned-upgrade-'));
  project = path.join(root, 'project');
  await fs.mkdir(project);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function invoke(executable: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: project,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      COMET_DAEMON: 'off',
      COMET_DATA_DIR: path.join(root, 'data'),
      HOME: path.join(root, 'home'),
      USERPROFILE: path.join(root, 'home'),
    },
  });
  expect(result.error).toBeUndefined();
  return result;
}

function succeeded(result: ReturnType<typeof invoke>) {
  expect(result.status, result.stdout || result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

async function fixture(base: 'native' | 'classic-hotfix' | 'classic-full' | 'standalone') {
  const app = await createDiskApplication(root, { external: true });
  await fs.cp(app.skillRoot, path.join(app.packageRoot, 'skills/writer'), { recursive: true });
  app.manifest.skills[0].root = 'skills/writer';
  app.manifest.base = base;
  app.manifest.runtimeVersion = '0.5.4';
  await fs.writeFile(app.file, JSON.stringify(app.manifest));
  const module = path.join(app.packageRoot, app.manifest.module);
  const source = await fs.readFile(module, 'utf8');
  await fs.writeFile(
    module,
    source.replace(
      'authorize: async () => true,',
      "authorize: async () => true, reconcile: async () => ({ resolution: 'not-executed', evidence: 'Fixture has no external service' }),",
    ),
  );
  return app;
}

async function dispatch(executable: string, application: string[], operation: object) {
  const request = path.join(root, 'request.json');
  await fs.writeFile(request, JSON.stringify({ runId: 'report', ...operation }));
  return invoke(
    executable,
    'runtime',
    'dispatch',
    '--details',
    ...application,
    '--project-root',
    project,
    '--request',
    request,
  );
}

function claim(action: WorkflowRun['actions'][number], executorId: string, claimToken: string) {
  return {
    operation: 'claim',
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId,
    claimToken,
    capabilities: ['skill-script'],
  };
}

it.each(['native', 'classic-hotfix', 'classic-full', 'standalone'] as const)(
  'cold-inspects and continues the original 0.5.4 %s Run after a Comet upgrade',
  async (base) => {
    const app = await fixture(base);
    const file = ['--application-file', app.file];
    const before = await fs.readFile(app.file, 'utf8');
    const started: WorkflowRun = succeeded(
      await dispatch(previousCli, file, {
        operation: 'start',
        workflow: { id: 'editorial', version: '1' },
        input: { topic: 'Upgrade report' },
      }),
    ).data;
    const prepare = started.actions[0];
    succeeded(await dispatch(previousCli, file, claim(prepare, 'manual-tool', 'prepare-claim')));
    const waiting: WorkflowRun = succeeded(
      await dispatch(previousCli, file, {
        operation: 'record-outcome',
        outcome: {
          actionId: prepare.id,
          attempt: prepare.attempt,
          inputHash: prepare.inputHash,
          claimToken: 'prepare-claim',
          outcomeId: 'prepared',
          status: 'succeeded',
          output: { scope: 'report' },
        },
      }),
    ).data;
    const wait = waiting.waits[0];
    const approved = succeeded(
      await dispatch(previousCli, file, {
        operation: 'resolve-wait',
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'approved-before-upgrade',
        choice: 'multi-session',
      }),
    );
    const original = ['--application', app.manifest.id];
    const inspect = { operation: 'inspect' };
    const cold = succeeded(await dispatch(currentCli, original, inspect));
    expect(cold.application).toEqual(approved.application);
    expect(cold.data).toEqual(approved.data);
    const draft = (cold.data as WorkflowRun).actions.find((action) => action.stepId === 'draft')!;
    const dependency = path.join(app.packageRoot, 'skills/writer/reference/suffix.txt');
    const module = path.join(app.packageRoot, app.manifest.module);
    for (const [damaged, code, message] of [
      [dependency, 'INVALID_WORKFLOW', /Skill 内容发生漂移：writer/u],
      [module, 'WORKFLOW_CHANGED', /发生变化/u],
    ] as const) {
      const bytes = await fs.readFile(damaged);
      await fs.appendFile(damaged, '\n// drift\n');
      const refused = await dispatch(
        currentCli,
        original,
        claim(draft, 'local-skill', 'continuation'),
      );
      expect(refused.status).not.toBe(0);
      expect(JSON.parse(refused.stdout).error).toMatchObject({
        code,
        message: expect.stringMatching(message),
      });
      await fs.writeFile(damaged, bytes);
      expect(succeeded(await dispatch(currentCli, original, inspect)).data).toEqual(cold.data);
    }
    const resumed = succeeded(
      await dispatch(currentCli, original, claim(draft, 'local-skill', 'continuation')),
    );
    expect(resumed.application).toEqual(approved.application);
    expect(resumed.data).toMatchObject({
      runId: 'report',
      definitionHashes: started.definitionHashes,
      revision: cold.data.revision + 1,
      waits: cold.data.waits,
    });
    expect(resumed.data.actions).toHaveLength(cold.data.actions.length);
    expect(resumed.data.actions[0]).toEqual(cold.data.actions[0]);
    expect(
      resumed.data.actions.find((action: { id: string }) => action.id === draft.id),
    ).toMatchObject({
      id: draft.id,
      attempt: draft.attempt,
      inputHash: draft.inputHash,
      status: 'running',
    });
    expect(await fs.readFile(app.file, 'utf8')).toBe(before);
  },
);

it('exports and installs a 0.5.4 fixed package at project and user scope after a Comet upgrade', async () => {
  const app = await fixture('standalone');
  const exported = succeeded(
    invoke(
      currentCli,
      'application',
      'export',
      app.file,
      path.join(root, 'export'),
      '--project',
      project,
      '--json',
    ),
  );
  const manifest = await fs.readFile(app.file, 'utf8');
  expect(await fs.readFile(exported.file, 'utf8')).toBe(manifest);
  for (const scope of ['user', 'project']) {
    const args = [
      'application',
      'install',
      exported.file,
      '--project',
      project,
      '--scope',
      scope,
      '--json',
    ];
    const preview = succeeded(invoke(currentCli, ...args, '--preview'));
    const installed = succeeded(
      invoke(currentCli, ...args, '--confirmation-hash', preview.confirmationHash),
    );
    expect(await fs.readFile(installed.file, 'utf8')).toBe(manifest);
    const started = succeeded(
      await dispatch(currentCli, ['--application', app.manifest.id], {
        operation: 'start',
        runId: `installed-${scope}`,
        workflow: { id: 'editorial', version: '1' },
        input: { topic: 'Installed report' },
      }),
    );
    expect(started.application.runtimeVersion).toBe('0.5.4');
    expect(started.application.packageRoot).toBe(path.dirname(installed.file));
  }
});
