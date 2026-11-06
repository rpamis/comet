import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const NAME = 'classic-052-authorized-implementation';
export const SCHEMA = 'comet.052.classic-a4';
export const checkScript = `import fs from 'node:fs';
import assert from 'node:assert/strict';
const [name, log] = process.argv.slice(2);
assert.ok(name === 'A' || name === 'B');
const source = fs.readFileSync(name === 'A' ? 'left.unknown' : 'right.unknown', 'utf8');
const match = /^value=(\\d+)\\n$/.exec(source);
assert.ok(match, 'Stable value-file API must be preserved');
const value = Number(match[1]);
assert.ok(name === 'A' ? [1, 2].includes(value) : value === 7, 'Value is outside the approved contract');
if (name === 'B') assert.equal(fs.existsSync(log), false, 'Once-only B side effect must never replay');
fs.appendFileSync(log, name + ':' + value + '\\n');
console.log(JSON.stringify({ check: name, value, passed: true }));
`;
export const checkPolicy = (c) => ({
  version: 2,
  commands: [c.argvA, c.argvB].map((argv) => ({
    argv,
    cwd: '.',
    files: ['left.unknown', 'right.unknown', 'checks.mjs'],
  })),
});
export const fixtureRefs = (c) => [
  'left.unknown',
  'right.unknown',
  'checks.mjs',
  '.comet/check-policy.json',
  '.comet/config.yaml',
  'openspec/config.yaml',
  'simulated-user-build-config.json',
  `${c.change}/proposal.md`,
  `${c.change}/design.md`,
  `${c.change}/tasks.md`,
  `${c.change}/specs/values/spec.md`,
  c.designRef,
  c.planRef,
  c.reportRef,
];
export const assert = (value, message) => {
  if (!value) throw new Error(message);
};
export const sha = (value) => createHash('sha256').update(value).digest('hex');
export const canonical = (value) => JSON.stringify(sortValue(value));
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  return value;
}
export const digest = (value) => sha(canonical(value));
export const equal = (a, b) => canonical(a) === canonical(b);
export const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
export const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, canonical(value) + '\n');
};
export const put = async (c, ref, text) => {
  const file = path.join(c.root, ref);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
};
export async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function config(args) {
  assert(
    args.length === 4,
    'Exactly --cli-root and --root are required; no arbitrary request, name or evidence path is accepted',
  );
  const pairs = [];
  for (let index = 0; index < args.length; index += 2) pairs.push([args[index], args[index + 1]]);
  const options = Object.fromEntries(pairs);
  assert(
    new Set(pairs.map(([key]) => key)).size === 2 &&
      Object.keys(options).sort().join(',') === '--cli-root,--root',
    'Invalid or duplicate controller options',
  );
  assert(
    options['--root'] === '/workspace' && options['--cli-root'] === '/opt/comet-current',
    'A4 controller is restricted to the isolated /workspace and frozen /opt/comet-current',
  );
  const c = { root: '/workspace', cliRoot: '/opt/comet-current', name: NAME };
  c.cli = path.join(c.cliRoot, 'bin/comet.js');
  c.dist = path.join(c.cliRoot, 'dist');
  c.evidence = path.join(c.root, '.git/052-a4-fixture-evidence');
  c.transport = path.join(c.evidence, 'transport');
  c.counterA = path.join(c.evidence, 'check-A.log');
  c.counterB = path.join(c.evidence, 'check-B.log');
  c.change = `openspec/changes/${NAME}`;
  c.designRef = 'docs/superpowers/specs/a4-technical-design.md';
  c.planRef = 'docs/superpowers/plans/a4-work-plan.md';
  c.reportRef = 'docs/superpowers/reports/a4-original-verification.md';
  c.newReportRef = 'docs/superpowers/reports/a4-revised-verification.md';
  c.argvA = [process.execPath, 'checks.mjs', 'A', c.counterA];
  c.argvB = [process.execPath, 'checks.mjs', 'B', c.counterB];
  return c;
}

export function processRun(c, program, args, timeout = 180000) {
  return new Promise((resolve) =>
    execFile(
      program,
      args,
      { cwd: c.root, env: process.env, windowsHide: true, timeout, maxBuffer: 24 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({
          exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout,
          stderr,
        }),
    ),
  );
}
export async function git(c, ...args) {
  const result = await processRun(c, 'git', args);
  assert(result.exitCode === 0, `Isolated git operation failed: ${result.stderr}`);
  return result.stdout.trim();
}
export async function cli(c, args, allowFailure = false) {
  const result = await processRun(c, process.execPath, [c.cli, ...args]);
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    response = null;
  }
  if (!allowFailure)
    assert(
      result.exitCode === 0 && response,
      `Public CLI failed: ${result.stderr}\n${result.stdout}`,
    );
  return { ...result, response, data: response?.data };
}
export async function classic(c, ...args) {
  const command = [...args];
  const separator = command.indexOf('--');
  command.splice(separator < 0 ? command.length : separator, 0, '--json');
  return (await cli(c, ['classic', ...command])).data;
}
export async function inspect(c) {
  await fs.mkdir(c.transport, { recursive: true });
  const file = path.join(c.transport, `inspect-${randomUUID()}.json`);
  await writeJson(file, { protocolVersion: 1, operation: 'inspect', runId: c.name });
  const result = await cli(c, [
    'runtime',
    'dispatch',
    '--application',
    'classic-full',
    '--project-root',
    c.root,
    '--request',
    file,
    '--json',
    '--details',
  ]);
  const run = result.data?.actions ? result.data : result.data?.run;
  assert(
    run?.runId === NAME && Array.isArray(run.actions),
    'Public inspect did not return the actual named SDK Run',
  );
  return run;
}
export async function editShow(c) {
  return (
    await cli(c, ['edit-review', 'show', 'classic', c.name, '--project-root', c.root, '--json'])
  ).data;
}
export const loadDist = (c, ref) => import(pathToFileURL(path.join(c.dist, ref)).href);
export async function counters(c) {
  const read = (file) =>
    fs.readFile(file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
  const [A, B] = await Promise.all([read(c.counterA), read(c.counterB)]);
  return {
    A: A.split('\n').filter(Boolean).length,
    B: B.split('\n').filter(Boolean).length,
    aText: A,
    bText: B,
    aHash: sha(A),
    bHash: sha(B),
  };
}
export function actionSignature(action) {
  const copy = structuredClone(action);
  delete copy.executionOrigin;
  return digest(copy);
}
export function originalSummary(run) {
  return {
    actions: run.actions.map((action) => ({
      id: action.id,
      stepId: action.stepId,
      type: action.type,
      status: action.status,
      inputHash: action.inputHash,
      signature: actionSignature(action),
      executionOrigin: action.executionOrigin ?? null,
    })),
    waits: run.waits.map((wait) => ({
      id: wait.id,
      stepId: wait.stepId,
      status: wait.status,
      proposalHash: wait.proposalHash,
      signature: digest(wait),
    })),
    evidenceWaits: (run.evidenceWaits ?? []).map((wait) => ({
      id: wait.id,
      stepId: wait.stepId,
      status: wait.status,
      signature: digest(wait),
    })),
  };
}
export function assertOriginalHistory(run, baseline, { permitCancelledArchive = true } = {}) {
  for (const original of baseline.original.actions) {
    const actual = run.actions.find((action) => action.id === original.id);
    assert(actual, `Original Action disappeared: ${original.id}`);
    const upgraded = actual.executionOrigin;
    assert(
      equal(upgraded ?? null, original.executionOrigin) ||
        (original.executionOrigin === null && equal(upgraded, { workflow: baseline.workflow })),
      `Original Action execution origin changed: ${original.id}`,
    );
    if (
      permitCancelledArchive &&
      original.status === 'pending' &&
      ['full.archive.preflight', 'full.archive.execute'].includes(original.stepId)
    ) {
      assert(
        ['pending', 'cancelled'].includes(actual.status) &&
          actual.inputHash === original.inputHash &&
          !actual.claim &&
          !actual.outcome,
        'Original pending Archive was executed or repurposed',
      );
      const normalized = structuredClone(actual);
      if (normalized.status === 'cancelled') {
        normalized.status = 'pending';
        delete normalized.reason;
      }
      assert(
        actionSignature(normalized) === original.signature,
        'Original cancelled Archive input changed',
      );
    } else
      assert(
        actionSignature(actual) === original.signature,
        `Original Action changed: ${original.id}`,
      );
  }
  for (const original of baseline.original.waits)
    assert(
      digest(run.waits.find((wait) => wait.id === original.id)) === original.signature,
      `Original Wait changed: ${original.id}`,
    );
  for (const original of baseline.original.evidenceWaits)
    assert(
      digest(run.evidenceWaits?.find((wait) => wait.id === original.id)) === original.signature,
      `Original evidence changed: ${original.id}`,
    );
}
export async function cliIdentity(c) {
  const files = {};
  async function walk(ref) {
    const full = path.join(c.cliRoot, ref);
    const stat = await fs.lstat(full);
    assert(!stat.isSymbolicLink(), `Frozen CLI source is a symlink: ${ref}`);
    if (stat.isDirectory())
      for (const name of (await fs.readdir(full)).sort()) await walk(`${ref}/${name}`);
    else if (stat.isFile()) files[ref] = sha(await fs.readFile(full));
  }
  for (const ref of ['package.json', 'bin', 'dist']) await walk(ref);
  return {
    algorithm: 'sha256-canonical-file-map',
    files: Object.keys(files).length,
    hash: digest(files),
  };
}
export async function loadBaseline(c, readonlyOnly = false) {
  const trusted = path.join(here, 'baseline.json');
  const file = (await exists(trusted)) ? trusted : path.join(c.evidence, 'baseline.json');
  assert(
    !readonlyOnly || file === trusted,
    'Final validation requires the host-frozen readonly baseline',
  );
  const baseline = await readJson(file);
  assert(
    baseline.schema === `${SCHEMA}.seed-baseline.v1` &&
      baseline.runId === c.name &&
      baseline.root === c.root &&
      baseline.cliRoot === c.cliRoot,
    'Seed baseline identity differs from the fixed isolated task',
  );
  assert(
    equal(baseline.argvA, c.argvA) && equal(baseline.argvB, c.argvB),
    'Baseline may not substitute the fixed actual check commands',
  );
  assert(
    equal(Object.keys(baseline.fileHashes ?? {}).sort(), fixtureRefs(c).sort()) &&
      Object.values(baseline.fileHashes).every((value) => /^[a-f0-9]{64}$/.test(value)),
    'Baseline may contain only the fixed fixture file references',
  );
  assert(
    baseline.state?.plan === c.planRef &&
      baseline.state?.designDoc === c.designRef &&
      baseline.state?.verificationReport === c.reportRef,
    'Baseline document references differ from this fixture',
  );
  return { baseline, baselineHash: digest(baseline) };
}
export function proof(c, mode, baselineHash, details) {
  return {
    schema: `${SCHEMA}.${mode}.v1`,
    workflow: 'classic',
    runId: c.name,
    baselineHash,
    ...details,
  };
}
export function emit(mode, value) {
  console.log(`COMET_052_A4_${mode}_PROOF=${JSON.stringify(value)}`);
}

export async function assertCheckReceipt(c, run, action) {
  assert(
    action?.status === 'succeeded' &&
      action.outcome?.status === 'succeeded' &&
      action.outcome.output?.exitCode === 0,
    'Expected a succeeded real check',
  );
  const { assertClassicSdkCheckReceipt } = await loadDist(
    c,
    'domains/comet-classic/classic-sdk-check-record.js',
  );
  await assertClassicSdkCheckReceipt(c.root, run, action, {
    status: action.outcome.status,
    output: action.outcome.output,
  });
}
export async function originalJudgment(c, baseline) {
  const { classicEditReviewScope } = await loadDist(
    c,
    'domains/comet-classic/classic-edit-review.js',
  );
  const { inspectEditReviews } = await loadDist(c, 'domains/workflow-contract/edit-review.js');
  const scope = await classicEditReviewScope(c.root, c.name, baseline.state);
  const reviews = await inspectEditReviews(scope);
  const matching = reviews.filter(
    (review) =>
      review.applied &&
      review.receipt?.authority.kind === 'runtime-agent' &&
      review.receipt.decision === 'implementation-changed' &&
      equal(review.receipt.retainedCheckActionIds, [baseline.checkB.id]) &&
      (!review.receipt.retainedChecks || review.receipt.retainedChecks.length === 0) &&
      review.edits.length === 1 &&
      review.edits[0].path === 'left.unknown' &&
      review.edits[0].beforeHash === sha('value=1\n') &&
      review.edits[0].afterHash === sha('value=2\n'),
  );
  assert(
    matching.length === 1,
    'Requires one actual applied current-Agent implementation judgment retaining only the original B Action',
  );
  return matching[0];
}
export async function assertFixtureInputs(
  c,
  baseline,
  { archived = false, allowNewReport = false } = {},
) {
  assert(
    (await fs.readFile(path.join(c.root, 'left.unknown'), 'utf8')) === 'value=2\n',
    'A must actually expose value 2',
  );
  assert(
    (await fs.readFile(path.join(c.root, 'checks.mjs'), 'utf8')) === checkScript,
    'The model may not replace the fixed actual check program',
  );
  assert(
    equal(await readJson(path.join(c.root, '.comet/check-policy.json')), checkPolicy(c)),
    'The model may not replace the fixed check scope or commands',
  );
  for (const [ref, expected] of Object.entries(baseline.fileHashes)) {
    if (
      ref === 'left.unknown' ||
      (archived && (ref.startsWith(c.change + '/') || ref === c.designRef || ref === c.planRef))
    )
      continue;
    assert(
      sha(await fs.readFile(path.join(c.root, ref))) === expected,
      `Fixture input changed outside authorized A: ${ref}`,
    );
  }
  if (!allowNewReport)
    assert(
      !(await exists(path.join(c.root, c.newReportRef))),
      'The model must leave the independent simulated Verifier report to the trusted controller',
    );
}
