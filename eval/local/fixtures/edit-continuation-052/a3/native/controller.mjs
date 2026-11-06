import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const mode = process.argv[2],
  argv = process.argv.slice(3);
const options = Object.fromEntries(
  argv.reduce((out, v, i) => (v.startsWith('--') ? [...out, [v.slice(2), argv[i + 1]]] : out), []),
);
const root = path.resolve(options.root ?? '/workspace'),
  cliRoot = path.resolve(options['cli-root'] ?? '/opt/comet-current');
if (root === cliRoot) throw Error('Controller requires an isolated project');
const name = 'native-052-edit-continuation',
  left = path.join(root, 'left.unknown');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const counts = () =>
  Object.fromEntries(
    ['a', 'b', 'once'].map((id) => [
      id,
      fs.readFileSync(path.join(root, '.git', `052-count-${id}`), 'utf8').length,
    ]),
  );
const env = {
  ...process.env,
  COMET_DATA_DIR: process.env.COMET_DATA_DIR ?? path.join(root, '.git/052-runtime-data'),
};
function dispatch(request) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '052-negative-'));
  const file = path.join(dir, 'request.json');
  fs.writeFileSync(file, JSON.stringify(request));
  const result = spawnSync(
    process.execPath,
    [
      path.join(cliRoot, 'bin/comet.js'),
      'runtime',
      'dispatch',
      '--application',
      'native',
      '--project-root',
      root,
      '--request',
      file,
      '--details',
    ],
    { cwd: root, env, encoding: 'utf8', timeout: 120000, windowsHide: true },
  );
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {}
  return { exitCode: result.status, json, stdout: result.stdout, stderr: result.stderr };
}
if (mode === 'prepare-edits') {
  const round = Number(options.round);
  if (![1, 2].includes(round)) throw Error('Round must be 1 or 2');
  const before = digest(fs.readFileSync(left));
  if (round === 1) {
    for (let i = 1; i <= 10; i++)
      fs.writeFileSync(
        left,
        `value=1\n# Clarified explanation, save ${i}: the first line is the value.\n`,
      );
    const formal = path.join(root, `docs/comet/changes/${name}/brief.md`);
    const text = fs.readFileSync(formal, 'utf8');
    if (!text.includes('Use the existing text files.'))
      throw Error('Expected original formal text');
    fs.writeFileSync(
      formal,
      text.replace(
        'Use the existing text files.',
        'Use the existing text files; the first line states each value.',
      ),
    );
  } else
    fs.writeFileSync(
      left,
      'value=1\n# A final explanatory note; the first line remains authoritative.\n',
    );
  console.log(
    'COMET_052_EDIT_PROOF=' +
      JSON.stringify({
        schema: 1,
        workflow: 'native',
        round,
        saves: round === 1 ? 10 : 1,
        before,
        after: digest(fs.readFileSync(left)),
        counts: counts(),
      }),
  );
} else if (mode === 'negative-control') {
  const request = JSON.parse(fs.readFileSync(options.file, 'utf8'));
  if (
    request.operation !== 'execute' ||
    request.runId !== name ||
    request.executorId !== 'comet-native-checks'
  )
    throw Error('Only the current Native supplemental check execution is permitted');
  const inspect = dispatch({ protocolVersion: 1, operation: 'inspect', runId: name });
  const r = inspect.json?.data;
  const action = r?.actions.find((a) => a.id === request.actionId);
  if (
    !action ||
    action.status !== 'pending' ||
    request.expectedRevision !== r.revision ||
    !r.commands?.some((c) => c.actionId === action.id && c.name === 'refresh-checks') ||
    JSON.stringify(action.input?.activation?.checkIds) !== JSON.stringify(['a'])
  )
    throw Error('Request is not the current pending supplemental A check');
  const bytes = fs.readFileSync(left),
    before = counts();
  if (!bytes.toString().startsWith('value=1\n'))
    throw Error('Negative control requires original judged value one');
  let rejection;
  try {
    fs.writeFileSync(
      left,
      'value=999\n# Additional substantive change after the Agent judgment.\n',
    );
    rejection = dispatch(request);
    if (rejection.exitCode === 0 || rejection.json?.status !== 'failed')
      throw Error('Runtime did not explicitly reject new unjudged bytes');
    if (JSON.stringify(before) !== JSON.stringify(counts()))
      throw Error('Stale request ran a check');
    const after = dispatch({ protocolVersion: 1, operation: 'inspect', runId: name }).json?.data;
    if (after?.revision !== r.revision) throw Error('Rejected stale request advanced the Run');
  } finally {
    fs.writeFileSync(left, bytes);
  }
  console.log(
    'COMET_052_NEGATIVE_CONTROL_PROOF=' +
      JSON.stringify({
        schema: 1,
        workflow: 'native',
        requestHash: digest(JSON.stringify(request)),
        actionId: request.actionId,
        inputHash: action.inputHash,
        before,
        after: counts(),
        restoredHash: digest(fs.readFileSync(left)),
        rejection: rejection.json ?? rejection.stdout,
        exitCode: rejection.exitCode,
      }),
  );
} else throw Error('Use prepare-edits or negative-control');
