import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assert,
  readJson,
  writeJson,
  parseArgs,
  hash,
  inspect,
  classic,
  git,
  counters,
} from './common.mjs';

// Validator reads authoritative public CLI state and local Git; it never submits judgments or outcomes.
const o = parseArgs(process.argv.slice(2));
const c = await readJson(o.config);
const baselineFile = o.baseline || path.join(c.evidenceRoot, 'baseline.json');
const baseline = await readJson(baselineFile);
const results = [];
const check = (label, ok) => {
  results.push({ label, ok: Boolean(ok) });
  assert(ok, label);
};
try {
  const run = await inspect(c);
  const count = await counters(c);
  const b = run.actions.find((a) => a.id === baseline.checkB.id);
  const a = run.actions.find((a) => a.id === baseline.checkA.id);
  check(
    'Same SDK Run and workflow identity',
    run.runId === baseline.run.runId &&
      run.workflow.id === baseline.run.workflow.id &&
      run.workflow.version === baseline.run.workflow.version,
  );
  const originalPreserved = (actual, original) => {
    if (!actual) return false;
    const clone = structuredClone(actual);
    if (!original.executionOrigin && clone.executionOrigin) {
      if (!isDeepStrictEqual(clone.executionOrigin, { workflow: baseline.run.workflow }))
        return false;
      delete clone.executionOrigin;
    }
    return isDeepStrictEqual(clone, original);
  };
  check('Original B receipt and execution unchanged', originalPreserved(b, baseline.checkB));
  check('Original A receipt retained', originalPreserved(a, baseline.checkA));
  check('Only A reran; once-only B did not replay', count.A === 2 && count.B === 1);
  check(
    'Original approvals retained with no new approvals',
    isDeepStrictEqual(run.waits, baseline.run.waits),
  );
  check(
    'Original evidence receipts retained with no new evidence waits',
    isDeepStrictEqual(run.evidenceWaits, baseline.run.evidenceWaits),
  );
  const implementationAgent = (x) =>
    ['invoke_skill', 'call_agent'].includes(x.type) && !x.stepId.startsWith('full.archive.');
  check(
    'No new Builder or implementation Agent Actions',
    JSON.stringify(run.actions.filter(implementationAgent).map((x) => x.id)) ===
      JSON.stringify(baseline.run.actions.filter(implementationAgent).map((x) => x.id)),
  );
  const archive = run.outputs['full.archive.execute']?.value.archiveDirectory;
  check('Archive output has a directory', typeof archive === 'string');
  const { archivedClassicDocumentRef, annotatedMarkdown } = await import(
    pathToFileURL(path.join(c.dist, 'domains/comet-classic/classic-archive-annotation.js')).href
  );
  const reportRef = archivedClassicDocumentRef(c.reportRef, `openspec/changes/${c.name}`, archive);
  check(
    'Original verification report bytes retained',
    (await fs.readFile(path.join(c.projectRoot, reportRef), 'utf8')) === baseline.report,
  );
  const left = await fs.readFile(path.join(c.projectRoot, 'left.unknown'), 'utf8');
  check(
    'Latest tenth save delivered',
    left === 'value=1\n# explanation save 10: value remains one\n',
  );
  check(
    'Independent right input unchanged',
    (await fs.readFile(path.join(c.projectRoot, 'right.unknown'), 'utf8')) === baseline.right,
  );
  const designRef = archivedClassicDocumentRef(c.designRef, `openspec/changes/${c.name}`, archive);
  const design = await fs.readFile(path.join(c.projectRoot, designRef), 'utf8');
  check(
    'Formal clarification delivered with exact Runtime archive annotation',
    design ===
      annotatedMarkdown(
        baseline.design +
          '\nEditorial clarification: the trailing explanation lines document the same approved values.\n',
        path.posix.basename(archive),
        'status: final',
      ),
  );
  check(
    'One successful Archive execution',
    run.actions.filter((x) => x.stepId === 'full.archive.execute' && x.status === 'succeeded')
      .length === 1,
  );
  check(
    'Run and local delivery complete',
    run.status === 'completed' &&
      run.state.archived === true &&
      run.state.branchStatus === 'handled',
  );
  const delivery = await classic(c, 'state', 'delivery', c.name, '--verify');
  check('Public delivery verification succeeded', Boolean(delivery));
  check(
    'Archive exists in delivery commit',
    Boolean(await git(c, 'ls-tree', '-r', '--name-only', 'HEAD', '--', archive)),
  );
  check('Runtime state excluded from Git', !(await git(c, 'ls-files', '--', '.comet/runtime')));
  const neg = await readJson(
    o['negative-proof'] || path.join(c.evidenceRoot, 'negative-control.json'),
  );
  check(
    'Host observed stale judgment rejection without execution',
    neg.schema === 'comet.052.negative-control.v1' &&
      neg.hostObserved === true &&
      neg.runId === run.runId &&
      neg.result.exitCode !== 0 &&
      neg.result.response?.status === 'failed' &&
      JSON.stringify(neg.countBefore) === JSON.stringify(neg.countAfter) &&
      neg.waitsUnchanged === true &&
      neg.revisionUnchanged === true &&
      neg.originalInputRestored === true,
  );
  const saves = await readJson(
    o['edit-proof'] || path.join(c.evidenceRoot, 'host-edit-observation.json'),
  );
  check(
    'Host observed ten saves without Run advancement',
    saves.schema === 'comet.052.edit.v1' &&
      saves.workflow === 'classic' &&
      saves.runId === run.runId &&
      saves.hostObserved &&
      saves.round === 1 &&
      saves.saves === 10 &&
      saves.runUnchanged &&
      saves.leftHash === hash(left),
  );
  const retained = run.actions.filter((x) => x.ref === 'classic-check');
  const commands = run.commands?.filter((cmd) => cmd.name === 'refresh-checks') || [];
  const refresh =
    commands.length === 1 ? run.actions.find((x) => x.id === commands[0].actionId) : null;
  const { hashRuntimeValue } = await import(
    pathToFileURL(path.join(c.dist, 'domains/engine/runtime.js')).href
  );
  check(
    'A supplemental command bound to original source and activation',
    run.commands.length === 1 &&
      refresh?.input?.activation?.sourceActionId === baseline.checkA.id &&
      commands[0].inputHash === hashRuntimeValue(refresh.input.activation) &&
      retained.length === 3 &&
      retained.every((x) => x.status === 'succeeded') &&
      neg.actionId === refresh.id,
  );
  check(
    'Original check program bytes retained',
    /^[a-f0-9]{64}$/.test(baseline.checkProgramSha256 || '') &&
      hash(await fs.readFile(path.join(c.projectRoot, 'checks.mjs'))) ===
        baseline.checkProgramSha256,
  );
  const refreshedA = refresh.outcome?.output;
  check(
    'Latest A is an actual successful execution of the original command',
    refresh.outcome?.status === 'succeeded' &&
      refresh.claim?.executorId === 'comet-classic-check' &&
      refreshedA?.scope === 'verify' &&
      refreshedA.exitCode === 0 &&
      refreshedA.reused === false &&
      JSON.stringify(refreshedA.argv) === JSON.stringify(baseline.checkA.outcome.output.argv),
  );
  const { classicSdkCheckDirectoryRef } = await import(
    pathToFileURL(path.join(c.dist, 'domains/comet-classic/classic-sdk-check-record.js')).href
  );
  const logRef = refreshedA.receiptRef;
  check(
    'Latest A log belongs to this Run and differs from the original log',
    typeof logRef === 'string' &&
      path.posix.normalize(logRef) === logRef &&
      logRef.startsWith(classicSdkCheckDirectoryRef(run) + '/') &&
      logRef.endsWith('.log') &&
      logRef !== baseline.checkA.outcome.output.receiptRef &&
      /^[a-f0-9]{64}$/.test(refreshedA.contentHash || ''),
  );
  const { readClassicProjectBytes } = await import(
    pathToFileURL(path.join(c.dist, 'domains/comet-classic/classic-protected-path.js')).href
  );
  const previousDataRoot = process.env.COMET_DATA_DIR;
  let logBytes;
  try {
    process.env.COMET_DATA_DIR = c.dataRoot;
    logBytes = await readClassicProjectBytes(c.projectRoot, logRef, {
      label: '052 actual A document digest log',
    });
  } finally {
    if (previousDataRoot === undefined) delete process.env.COMET_DATA_DIR;
    else process.env.COMET_DATA_DIR = previousDataRoot;
  }
  check(
    'Latest A actual log SHA-256 matches its Runtime receipt',
    hash(logBytes) === refreshedA.contentHash,
  );
  const leftBytes = await fs.readFile(path.join(c.projectRoot, 'left.unknown'));
  const currentLeftSha256 = hash(leftBytes);
  const digestPrefix = 'COMET_052_LEFT_DOCUMENT_SHA256=';
  const digestLines = logBytes
    .toString('utf8')
    .split(/\r?\n/)
    .filter((line) => line.startsWith(digestPrefix));
  check(
    'Latest A actual log contains exactly the current complete left document SHA-256',
    digestLines.length === 1 &&
      digestLines[0] === digestPrefix + currentLeftSha256 &&
      logBytes.toString('utf8').includes(digestPrefix + currentLeftSha256 + '\n'),
  );
  check(
    'Explanatory edits changed the complete left document digest without changing value one',
    currentLeftSha256 !== hash(baseline.left) &&
      leftBytes.toString('utf8').split(/\r?\n/)[0] === 'value=1',
  );
  const report = {
    ok: true,
    checks: results,
    runId: run.runId,
    revision: run.revision,
    counters: count,
    baselineSha256: hash(await fs.readFile(baselineFile)),
    transport: c.cli ? 'public-bin-cli' : 'public-command-handler',
    limits: [
      'No model was launched by this validator. Host evidence files must be outside model writable mounts.',
      'Seed decisions are explicitly simulated and excluded from model assessment.',
      'A public command-handler dryrun does not establish built CLI/package acceptance.',
    ],
  };
  if (o.output) await writeJson(o.output, report);
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  const report = { ok: false, checks: results, error: String(e.stack || e) };
  if (o.output) await writeJson(o.output, report);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
