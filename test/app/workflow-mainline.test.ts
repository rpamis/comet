import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { prepareClassicLegacyProject } from '../helpers/classic-project.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repository = process.env.COMET_TEST_PACKAGE_ROOT ?? path.resolve('.');
const cli = path.join(repository, 'bin/comet.js');
const nativeNext = path.join(
  repository,
  'assets/skills/comet-native/scripts/comet-native-next.mjs',
);
const change = 'mainline';
const session = 'fixture-shape';

let temporary: string;
let project: string;

beforeAll(async () => {
  if (!process.env.COMET_TEST_PACKAGE_ROOT) await ensureCliBuilt(repository);
}, 120_000);

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-mainline-'));
  project = path.join(temporary, 'project');
  await fs.mkdir(project);
});

afterEach(async () => {
  await fs.rm(temporary, { recursive: true, force: true });
});

function run(entry: string, args: string[], input?: string) {
  const result = spawnSync(process.execPath, [entry, ...args, '--json'], {
    cwd: project,
    input,
    encoding: 'utf8',
    env: { ...process.env, COMET_DATA_DIR: path.join(temporary, 'data'), COMET_DAEMON: 'off' },
  });
  return {
    code: result.status,
    response: JSON.parse(result.stdout),
    text: result.stdout + result.stderr,
  };
}

function cliSuccess(...args: string[]) {
  const result = run(cli, args);
  expect(result.code, result.text).toBe(0);
  return result.response;
}

it('initializes and selects the new Classic Run with one explicit command', async () => {
  await prepareClassicLegacyProject(project);
  const first = cliSuccess(
    'state',
    'init',
    change,
    'full',
    '--runtime',
    'sdk',
    '--isolation',
    'current',
    '--select',
  );
  const selectionFile = path.join(project, '.comet/current-change.json');
  const selected = await fs.readFile(selectionFile, 'utf8');
  expect(JSON.parse(selected)).toMatchObject({ workflow: 'classic', change });
  expect(first.data).toMatchObject({
    phase: 'open',
    run: { id: change, revision: 1 },
    nextAction: { stepId: 'full.open', kind: 'action' },
  });
  const failed = run(cli, ['state', 'init', change, 'full', '--runtime', 'sdk', '--select']);
  expect(failed.code).not.toBe(0);
  expect(await fs.readFile(selectionFile, 'utf8')).toBe(selected);
  cliSuccess('state', 'init', 'another', 'full', '--runtime', 'sdk');
  expect(await fs.readFile(selectionFile, 'utf8')).toBe(selected);
});

it('submits Native Shape over stdin to its original Action and waits for approval', async () => {
  cliSuccess('native', 'new', change);
  const claimed = cliSuccess('native', 'next', change, '--session', session);
  await fs.writeFile(
    path.join(project, 'docs/comet/changes', change, 'brief.md'),
    '# Outcome\nAccept stdin results.\n# Scope\nCLI.\n# Non-goals\nNone.\n# Acceptance examples\n- Preserve the pending decision.\n',
  );
  const action = claimed.data.task.actionId;
  const args = [change, '--action', action, '--session', session, '--result', '-'];
  const payload = JSON.stringify({
    status: 'succeeded',
    output: {
      acceptance: [{ source: 'brief.md', text: 'Preserve the pending decision.' }],
    },
  });
  const before = cliSuccess('native', 'status', change).data.run;
  const wrong = run(
    cli,
    ['native', 'next', change, '--action', action, '--session', 'wrong-session', '--result', '-'],
    payload,
  );
  expect(wrong.code).not.toBe(0);
  expect(cliSuccess('native', 'status', change).data.run).toEqual(before);
  const returned = run(nativeNext, args, payload);
  expect(returned.code, returned.text).toBe(0);
  expect(returned.response.data.next.askUser).toEqual(expect.any(String));
  const after = cliSuccess('native', 'status', change).data.run;
  expect(after.waits).toEqual([
    expect.objectContaining({ stepId: 'shape.confirm', status: 'pending' }),
  ]);
  const repeated = run(cli, ['native', 'next', ...args], payload);
  expect(repeated.code, repeated.text).toBe(0);
  expect(cliSuccess('native', 'status', change).data.run).toEqual(after);
});
