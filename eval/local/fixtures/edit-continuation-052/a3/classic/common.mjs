import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const hash = (v) => createHash('sha256').update(v).digest('hex');
export const assert = (v, m) => {
  if (!v) throw Error(m);
};
export const readJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
export const writeJson = async (f, v) => {
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify(v, null, 2) + '\n');
};
export const put = async (root, ref, text) => {
  const f = path.join(root, ref);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, text);
};
export const parseArgs = (args) => {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(args[i].startsWith('--') && args[i + 1], `Invalid argument: ${args[i]}`);
    out[args[i].slice(2)] = args[i + 1];
  }
  return out;
};
export function environment(c) {
  return { ...process.env, COMET_DATA_DIR: c.dataRoot, ...(c.commandEnvironment || {}) };
}
export function processRun(exe, args, c, timeout = 180000) {
  return new Promise((resolve) =>
    execFile(
      exe,
      args,
      {
        cwd: c.projectRoot,
        env: environment(c),
        windowsHide: true,
        timeout,
        maxBuffer: 32 * 1024 * 1024,
      },
      (err, stdout, stderr) =>
        resolve({
          exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout,
          stderr,
          error: err ? String(err) : null,
        }),
    ),
  );
}
export async function git(c, ...args) {
  const r = await processRun('git', args, c);
  assert(r.exitCode === 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
export async function invoke(
  c,
  kind,
  args,
  { allowFailure = false, label = kind, log = true } = {},
) {
  assert(
    typeof c.cli === 'string' && path.resolve(c.cli) === path.join(c.sourceRoot, 'bin/comet.js'),
    'The fixture requires the selected public bin CLI',
  );
  await fs.mkdir(c.transportRoot, { recursive: true });
  let actualArgs;
  if (kind === 'classic') {
    actualArgs = [...args];
    const sep = actualArgs.indexOf('--');
    actualArgs.splice(sep < 0 ? actualArgs.length : sep, 0, '--json');
  } else actualArgs = args;
  let command;
  if (kind === 'classic') command = ['classic', ...actualArgs];
  if (kind === 'runtime')
    command = [
      'runtime',
      'dispatch',
      '--application',
      'classic-full',
      '--request',
      args[0],
      '--project-root',
      c.projectRoot,
      '--json',
      '--details',
    ];
  if (kind === 'edit-review') {
    const [op, name, options] = args;
    command = ['edit-review', op, 'classic', name, '--project-root', c.projectRoot];
    for (const [key, val] of Object.entries(options || {}))
      if (val !== undefined)
        command.push('--' + key.replace(/[A-Z]/g, (s) => '-' + s.toLowerCase()), String(val));
  }
  command = [c.cli, ...command];
  const start = Date.now();
  const result = await processRun(process.execPath, command, c);
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    response = null;
  }
  const entry = {
    label,
    kind,
    args,
    transport: 'public-bin-cli',
    milliseconds: Date.now() - start,
    ...result,
    response,
  };
  if (log)
    await fs.appendFile(path.join(c.evidenceRoot, 'commands.jsonl'), JSON.stringify(entry) + '\n');
  if (!allowFailure) assert(result.exitCode === 0, `${label}: ${result.stderr}\n${result.stdout}`);
  return { ...entry, data: response?.data };
}
export async function runtime(c, request, options) {
  const f = path.join(c.transportRoot, `runtime-${randomUUID()}.json`);
  await writeJson(f, request);
  return invoke(c, 'runtime', [f], options);
}
export const inspect = async (c) =>
  (
    await runtime(
      c,
      { protocolVersion: 1, operation: 'inspect', runId: c.name },
      { label: 'read-only-public-inspect' },
    )
  ).data;
export const edit = async (c, operation, options = {}) =>
  (
    await invoke(c, 'edit-review', [operation, c.name, options], {
      label: `edit-review-${operation}`,
    })
  ).data;
export const classic = async (c, ...args) => (await invoke(c, 'classic', args)).data;
export async function counters(c) {
  const a = await fs.readFile(c.counterA, 'utf8').catch(() => ''),
    b = await fs.readFile(c.counterB, 'utf8').catch(() => '');
  return { A: a.split('\n').filter(Boolean).length, B: b.split('\n').filter(Boolean).length };
}
