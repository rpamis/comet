import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import { prepareClassicLegacyProject } from '../helpers/classic-project.js';
import { collectDashboardChangeDetail } from '../../domains/dashboard/collector.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin/comet.js');
const nativeNext = path.join(
  repositoryRoot,
  'assets/skills/comet-native/scripts/comet-native-next.mjs',
);
const name = 'resume-guidance';
const session = 'shape-session';
const brief =
  '# Outcome\nResume a change.\n# Scope\nCLI.\n# Non-goals\nNone.\n# Acceptance examples\n- A resumed change retains its decision.\n';

let directory: string;
let project: string;

beforeAll(() => ensureCliBuilt(repositoryRoot), 120_000);

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-resume-guidance-'));
  project = path.join(directory, 'project');
  await fs.mkdir(project);
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

function run(entry: string, args: string[], expected = 0): string {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: project,
    encoding: 'utf8',
    env: {
      ...process.env,
      COMET_DATA_DIR: path.join(directory, 'data'),
      COMET_DAEMON: 'off',
    },
  });
  expect(result.status, result.stdout + result.stderr).toBe(expected);
  return result.stdout;
}

function command(...args: string[]) {
  return JSON.parse(run(cli, [...args, '--json']));
}

function resume(utterance = `Continue ${name}`) {
  return command('resume-probe', '--utterance', utterance);
}

function createNative() {
  command('native', 'new', name);
}

async function writeBrief() {
  await fs.writeFile(path.join(project, 'docs/comet/changes', name, 'brief.md'), brief);
}

it('resumes a Native change with the original pending user decision', async () => {
  createNative();
  const claimed = command('native', 'next', name, '--session', session);
  await writeBrief();
  const report = path.join(directory, 'shape.json');
  await fs.writeFile(
    report,
    JSON.stringify({
      status: 'succeeded',
      output: {
        acceptance: [{ source: 'brief.md', text: 'A resumed change retains its decision.' }],
      },
    }),
  );
  command(
    'native',
    'next',
    name,
    '--session',
    session,
    '--action',
    claimed.data.task.actionId,
    '--result',
    report,
  );

  const before = command('native', 'status', name).data.run;
  expect(resume()).toMatchObject({
    action: 'auto_resume',
    nextCommand: '/comet-native',
    resume: {
      projectRoot: await fs.realpath(project),
      runId: name,
      kind: 'decision',
      stepId: 'shape.confirm',
      question: expect.stringMatching(/confirm|确认/iu),
    },
  });
  expect(resume().resume.commandArgs).toBeUndefined();
  expect(run(cli, ['status'])).toMatch(/confirm.+Shape|确认.+Shape|Confirm.+target/iu);
  expect(resume('Continue').resume).toBeUndefined();
  expect(command('native', 'status', name).data.run).toEqual(before);
});

it('identifies the running Native Action for reconciliation without claiming it again', async () => {
  createNative();
  const claimed = command('native', 'next', name, '--session', session);
  const before = command('native', 'status', name).data.run;
  expect(resume()).toMatchObject({
    resume: {
      kind: 'reconcile',
      stepId: 'shape.prepare',
      actionId: claimed.data.task.actionId,
      instruction: expect.stringMatching(/original|原/iu),
    },
  });
  expect(resume().resume.commandArgs).toBeUndefined();
  expect(command('native', 'status', name).data.run).toEqual(before);
});

it('returns the selected worktree and pending Native action without reading its namesake', async () => {
  const primary = project;
  const linked = path.join(directory, 'linked');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: primary, stdio: 'pipe' });
  git('init', '-q');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'fixture',
  );
  git('worktree', 'add', '-b', 'linked', linked);

  createNative();
  command('native', 'next', name, '--session', session);
  const original = command('native', 'status', name).data.run;

  project = linked;
  createNative();
  expect(resume()).toMatchObject({
    action: 'auto_resume',
    resume: {
      projectRoot: await fs.realpath(linked),
      runId: name,
      kind: 'continue',
      stepId: 'shape.prepare',
      commandArgs: expect.arrayContaining([
        'comet',
        'native',
        'next',
        name,
        '--project-root',
        linked,
      ]),
    },
  });
  project = primary;
  expect(resume().resume.kind).toBe('reconcile');
  expect(command('native', 'status', name).data.run).toEqual(original);
});

it('resumes Classic at the stored SDK decision and shows it in the Dashboard', async () => {
  await prepareClassicLegacyProject(project);
  command('state', 'init', name, 'full', '--runtime', 'sdk');
  const change = path.join(project, 'openspec/changes', name);
  for (const file of ['proposal.md', 'design.md', 'tasks.md'])
    await fs.writeFile(
      path.join(change, file),
      file === 'tasks.md'
        ? '- [ ] Implement the approved change\n'
        : '# Scope\nPreserve the workflow.\n',
    );
  const open = command('guard', name, 'open');
  // This approval belongs only to the isolated test Run.
  command('guard', name, 'open', '--apply', '--approval-hash', open.data.approvalHash);
  command('state', 'propose-design', name, '--proposal', 'Keep the documented scope.');
  const before = command('state', 'next', name).data.run;
  const current = resume();
  expect.soft(current).toMatchObject({
    nextCommand: '/comet-classic',
    resume: {
      runId: name,
      projectRoot: await fs.realpath(project),
      kind: 'decision',
      stepId: 'full.design.confirm',
      question: expect.stringMatching(/Classic design proposal/u),
      choices: ['approved', 'rejected'],
    },
  });
  expect.soft(current.resume?.commandArgs).toBeUndefined();
  const previous = process.env.COMET_DATA_DIR;
  process.env.COMET_DATA_DIR = path.join(directory, 'data');
  try {
    const detail = await collectDashboardChangeDetail(project, `openspec/changes/${name}`);
    expect.soft(detail?.next).toMatchObject({
      command: null,
      reason: expect.stringMatching(/确认|决定/u),
    });
  } finally {
    if (previous === undefined) delete process.env.COMET_DATA_DIR;
    else process.env.COMET_DATA_DIR = previous;
  }
  expect(command('state', 'next', name).data.run).toEqual(before);
});

it('points missing Native Shape acceptance back to the original command and brief', async () => {
  createNative();
  const args = [
    name,
    '--summary',
    'A resume request',
    '--expected-state-version',
    '1',
    '--expected-action',
    'prepare-shape-confirmation',
    '--json',
  ];
  let retryArgs: string[] | undefined;
  for (const [entry, prefix] of [
    [cli, ['native', 'next']],
    [nativeNext, []],
  ] as const) {
    const reply = JSON.parse(run(entry, [...prefix, ...args], 65));
    expect(reply.error.message).toMatch(/acceptance criterion/iu);
    expect(reply.next.command).toMatch(/comet native next resume-guidance/iu);
    expect(reply.data.recovery.affectedPaths).toEqual([
      path.join(await fs.realpath(project), 'docs/comet/changes', name, 'brief.md'),
    ]);
    expect(reply.data.recovery.diagnosticArgs).toEqual([]);
    retryArgs = reply.data.recovery.recoveryArgs;
    expect(retryArgs?.slice(0, 3)).toEqual(['comet', 'native', 'next']);
  }
  await writeBrief();
  const reply = JSON.parse(run(nativeNext, retryArgs!.slice(3)));
  expect(reply.data.continuation).toMatchObject({ requiresUserDecision: true });
});
