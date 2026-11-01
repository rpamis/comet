import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mode = process.argv[2];
const args = Object.fromEntries(
  process.argv
    .slice(3)
    .reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []),
);
const root = path.resolve(args.root ?? '.');
const cliRoot = path.resolve(
  args['cli-root'] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
);
const evidence = path.resolve(args.evidence ?? path.join(root, '.git/052-fixture-evidence'));
const name = 'native-052-edit-continuation';
const env = {
  ...process.env,
  COMET_DATA_DIR: process.env.COMET_DATA_DIR ?? path.join(root, '.git/052-runtime-data'),
};
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const hash = (v) =>
  crypto
    .createHash('sha256')
    .update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(canonical(v)))
    .digest('hex');
const documentEvidencePrefix = 'COMET_052_LEFT_DOCUMENT_SHA256=';
let sequence = 0;
const transcript = [];
function assert(v, message) {
  if (!v) throw Error(message);
}
function put(relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
function run(program, argv, ok = true) {
  const r = spawnSync(program, argv, {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const log = {
    program,
    argv,
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    error: r.error?.message,
  };
  transcript.push(log);
  if (ok && r.status !== 0) throw Error(JSON.stringify(log));
  return log;
}
function cli(argv, ok = true) {
  const r = run(process.execPath, [path.join(cliRoot, 'bin/comet.js'), ...argv], ok);
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    if (ok) throw Error('CLI returned no JSON: ' + r.stdout);
  }
  return { ...r, json };
}
function native(...argv) {
  return cli(['native', ...argv, '--project-root', root, '--json']).json;
}
function dispatch(request, ok = true) {
  fs.mkdirSync(evidence, { recursive: true });
  const file = path.join(evidence, `request-${mode}-${++sequence}.json`);
  fs.writeFileSync(file, JSON.stringify({ protocolVersion: 1, runId: name, ...request }));
  return cli(
    [
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
    ok,
  );
}
function inspect() {
  const r = dispatch({ operation: 'inspect' }).json;
  assert(r.status === 'succeeded', 'inspect failed');
  return r.data;
}
function edit(operation, options = {}) {
  const argv = ['edit-review', operation, 'native', name, '--project-root', root, '--json'];
  if (options.session) argv.push('--session', options.session);
  if (options.file) argv.push('--file', options.file);
  return cli(argv, options.ok !== false);
}
function pending(run, step) {
  const a = run.actions.find((a) => a.stepId === step && a.status === 'pending');
  assert(a, `Missing pending ${step}`);
  return a;
}
function submit(action, session, output) {
  dispatch({
    operation: 'claim',
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: session,
    claimToken: session,
  });
  if (session === '052-simulated-independent-verifier') {
    const status = native('status', name, '--details').data;
    const a = status.activeActions.find((a) => a.id === action.id);
    const command = a.contextRequest.commandArgs.map((x) =>
      x === '<original-task>' ? 'Keep both fixture values one.' : x,
    );
    cli(command.slice(1));
  }
  const result = dispatch({
    operation: 'record-outcome',
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: session,
      outcomeId: `${session}-result`,
      status: 'succeeded',
      output,
    },
  }).json;
  assert(result.status === 'succeeded', 'Outcome failed');
  return result.data;
}
function counts() {
  return Object.fromEntries(
    ['a', 'b', 'once'].map((id) => [
      id,
      fs.existsSync(path.join(root, '.git', `052-count-${id}`))
        ? fs.readFileSync(path.join(root, '.git', `052-count-${id}`), 'utf8').length
        : 0,
    ]),
  );
}
function completedIdentity(run) {
  return {
    runId: run.runId,
    definitionId: run.definitionId,
    builderHandoff: run.state.builder_handoff,
    waits: run.waits,
    actions: run.actions.filter((a) => a.status === 'succeeded'),
    report: run.outputs['verify.report'],
  };
}
function seed() {
  assert(root !== cliRoot, 'Refuse to seed source repository');
  fs.mkdirSync(root, { recursive: true });
  for (const ref of ['.comet/config.yaml', 'docs/comet/changes', 'left.unknown', 'right.unknown'])
    assert(
      !fs.existsSync(path.join(root, ref)),
      `Seed requires an empty isolated business project: ${ref} already exists`,
    );
  if (!fs.existsSync(path.join(root, '.git'))) run('git', ['init', '-q', '-b', 'main']);
  run('git', ['config', 'user.name', '052 offline fixture']);
  run('git', ['config', 'user.email', '052-fixture@example.invalid']);
  run('git', ['config', 'core.autocrlf', 'false']);
  put(
    '.gitignore',
    '_eval_current_comet/\n_eval_trusted_oracles/\n_eval_target_skills/\n.claude/\n.eval*\n_test_context.json\n_test_results.json\nvalidation/\n',
  );
  put('left.unknown', 'value=1\n# Original explanation.\n');
  put('right.unknown', 'value=1\n# Independent input.\n');
  run('git', ['add', '.gitignore', 'left.unknown', 'right.unknown']);
  run('git', ['commit', '-qm', '052 isolated fixture baseline']);
  native('new', name, '--runtime', 'sdk', '--language', 'en');
  put(
    `docs/comet/changes/${name}/brief.md`,
    '# Outcome\nKeep both fixture values one and current document evidence available.\n# Scope\nRead left.unknown and right.unknown. Check a consumes the complete left document, including its explanation, and emits its current raw-byte SHA256 as COMET_052_LEFT_DOCUMENT_SHA256=<digest>. Check b consumes only the right first-line value.\n## Directory structure\n### Modified\n- left.unknown: value one with an explanation whose complete bytes require current digest evidence.\n- right.unknown: independent value one.\n# Non-goals\nPublishing or changing the value contract.\n# Acceptance examples\n- Both files start with value=1, and the latest successful left document check log contains its current complete-file SHA256.\n# Constraints and invariants\nThe one-time marker executes only once.\n# Decisions\nUse the existing text files.\n# Open questions\nNone.\n# Verification expectations\nRead both values, produce current complete-left-document SHA256 evidence, and preserve the one-time marker.\n',
  );
  put(
    `docs/comet/changes/${name}/specs/values/spec.md`,
    '# Values\nBoth fixture files start with value=1. The original check a consumes every byte of left.unknown, including explanatory text, and emits COMET_052_LEFT_DOCUMENT_SHA256=<current SHA256> to its actual stdout. The latest successful check log must match the complete current document. Check b depends only on the right first-line value; the one-time marker must not replay.\n',
  );
  native('next', name);
  let r = inspect();
  native(
    'next',
    name,
    '--confirmed',
    '--summary',
    'Offline simulated User approves this isolated fixture Shape.',
    '--expected-state-version',
    String(r.state.state_version),
    '--expected-action',
    'confirm-shape',
  );
  r = inspect();
  const plans = ['a', 'b', 'once'].map((id) => ({
    id,
    name: `052 ${id}`,
    executable: process.execPath,
    argv: [
      '-e',
      id === 'once'
        ? "const f=require('node:fs');const p='.git/052-count-once';if(f.existsSync(p))throw Error('one-time replay');f.writeFileSync(p,'1');"
        : `const f=require('node:fs');${id === 'a' ? "const bytes=f.readFileSync('left.unknown');const s=bytes.toString('utf8');" : "const s=f.readFileSync('right.unknown','utf8');"}if(s.split('\\n')[0]!=='value=1')throw Error('value changed');f.appendFileSync('.git/052-count-${id}','1');${id === 'a' ? `process.stdout.write('${documentEvidencePrefix}'+require('node:crypto').createHash('sha256').update(bytes).digest('hex')+'\\n');` : ''}`,
    ],
    cwdRef: '.',
    timeoutMs: 10000,
    repeatable: id !== 'once',
  }));
  r = submit(pending(r, 'build.builder'), '052-simulated-builder', {
    summary: 'Keep the two independent value inputs.',
    addressedAcceptanceIds: ['A1'],
    acceptanceReview: [
      {
        id: 'A1',
        status: 'implemented-with-evidence',
        evidence: ['left.unknown', 'right.unknown'],
        note: 'Both files begin with value=1.',
      },
    ],
    checks: [],
    knownLimits: [],
    review: null,
    submittedAt: new Date().toISOString(),
    verificationChecks: plans,
  });
  r = dispatch({
    operation: 'execute',
    actionId: pending(r, 'verify.checks').id,
    executorId: 'comet-native-checks',
  }).json.data;
  r = submit(pending(r, 'verify.verifier'), '052-simulated-independent-verifier', {
    candidateId: r.state.builder_handoff.candidate_id,
    verifierExecutionRef: '052-simulated-independent-verifier',
    response: {
      kind: 'final-result',
      result: {
        iteration: r.state.loop.iteration,
        attempt: r.state.loop.attempt,
        verdict: 'pass',
        acceptance: [
          {
            id: 'A1',
            result: 'passed',
            reason: 'Real CLI checks read both files and wrote the one-time marker.',
          },
        ],
        risks: [],
        summary: 'Offline simulated independent verifier accepts the small fixture.',
      },
    },
  });
  native('next', name);
  const status = native('status', name).data;
  const alternative = status.continuation.commandAlternatives.find(
    (c) => c.name === 'accept-result',
  );
  assert(alternative, 'No accept-result continuation');
  cli(
    alternative.commandArgs
      .slice(1)
      .map((x) => (x === '<summary>' ? 'Offline simulated User accepts the original fixture.' : x)),
  );
  r = inspect();
  pending(r, 'archive.prepare');
  assert(
    JSON.stringify(counts()) === JSON.stringify({ a: 1, b: 1, once: 1 }),
    'Seed count mismatch',
  );
  const baseline = {
    schema: 1,
    workflow: 'native',
    name,
    scope: 'Public CLI offline seed; simulated Agent/User, zero model calls',
    createdAt: new Date().toISOString(),
    root,
    cliRoot,
    counts: counts(),
    identity: completedIdentity(r),
    identityHash: hash(completedIdentity(r)),
    run: r,
    reportHash: hash(
      fs.readFileSync(path.join(root, `docs/comet/changes/${name}/verification.md`)),
    ),
    formalRef: `docs/comet/changes/${name}/brief.md`,
    formalBytes: fs.readFileSync(path.join(root, `docs/comet/changes/${name}/brief.md`), 'utf8'),
  };
  baseline.trustedBaseline = {
    schema: 'comet.052.native.seed-baseline.v1',
    workflow: 'native',
    name,
    scope: baseline.scope,
    runId: r.runId,
    runHash: hash(r),
    workflowIdentity: r.workflow,
    candidateId: r.state.builder_handoff.candidate_id,
    builderHandoffHash: hash(r.state.builder_handoff),
    waitsHash: hash(r.waits),
    waits: r.waits.map((w) => ({
      id: w.id,
      stepId: w.stepId,
      status: w.status,
      proposalHash: w.proposalHash,
      decision: w.decision,
      hash: hash(w),
    })),
    actions: baseline.identity.actions.map((a) => ({
      id: a.id,
      stepId: a.stepId,
      type: a.type,
      inputHash: a.inputHash,
      hash: hash(a),
      outcomeHash: hash(a.outcome),
    })),
    builderActionIds: r.actions.filter((a) => a.stepId === 'build.builder').map((a) => a.id),
    reportOutputHash: hash(r.outputs['verify.report']),
    reportSha256: r.outputs['verify.report'].value.reportSha256,
    reportHash: baseline.reportHash,
    formalBytes: baseline.formalBytes,
    counts: counts(),
  };
  baseline.trustedBaseline.checkReceipts = r.actions
    .filter((a) => a.stepId === 'verify.checks' && a.status === 'succeeded')
    .flatMap((a) =>
      (a.outcome?.output?.checks ?? []).map((check) => ({
        actionId: a.id,
        checkId: check.id,
        status: check.status,
        exitCode: check.exitCode,
        hash: hash(check),
      })),
    );
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'baseline.json'), JSON.stringify(baseline, null, 2));
  return {
    schema: 1,
    workflow: 'native',
    baseline: baseline.trustedBaseline,
    baselineHash: hash(baseline.trustedBaseline),
    counts: counts(),
    runId: r.runId,
    simulatedAgentAndUser: true,
    realModelCalls: 0,
  };
}
function readBaseline() {
  return JSON.parse(fs.readFileSync(args.baseline ?? path.join(evidence, 'baseline.json'), 'utf8'));
}
function round(roundNumber, negative) {
  const session = `052-simulated-current-agent-${roundNumber}`;
  if (roundNumber === 1) {
    for (let n = 1; n <= 10; n++)
      put(
        'left.unknown',
        `value=1\n# Clarified explanation, save ${n}: the first line is the value.\n`,
      );
    const b = readBaseline();
    put(
      b.formalRef,
      b.formalBytes.replace(
        'Use the existing text files.',
        'Use the existing text files; the first line states each value.',
      ),
    );
    const formal = edit('prepare-applied', { session }).json.data;
    assert(formal.recordTemplate, 'No formal template');
    const f = path.join(evidence, `formal-${roundNumber}.json`);
    fs.writeFileSync(
      f,
      JSON.stringify({
        ...formal.recordTemplate,
        decision: 'non-behavioral',
        summary:
          'Simulated Agent read the complete formal edit: it clarifies the existing value contract without changing requirements; B and once do not consume this editorial wording.',
        retainedChecks: [],
      }),
    );
    edit('record', { file: f });
  } else
    put(
      'left.unknown',
      'value=1\n# A final explanatory note; the first line remains authoritative.\n',
    );
  const obs = edit('observe', { session }).json.data;
  assert(obs.recordTemplate, 'No raw observation template');
  const checks = obs.observation?.availableChecks ?? obs.availableChecks;
  assert(checks, 'No available checks');
  const file = path.join(evidence, `judgment-${roundNumber}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...obs.recordTemplate,
      decision: 'non-behavioral',
      summary:
        'Simulated Agent inspected both inputs and approved text. Only the left-file check is affected; the right-file and one-time check remain applicable.',
      retainedChecks: readBaseline()
        .trustedBaseline.checkReceipts.filter((c) => ['b', 'once'].includes(c.checkId))
        .map(({ actionId, checkId }) => ({ actionId, checkId })),
    }),
  );
  edit('record', { file });
  const input = obs.observation?.refreshInputTemplate ?? obs.refreshInputTemplate;
  assert(input, 'No refresh template');
  const request = path.join(evidence, `refresh-${roundNumber}.json`);
  fs.writeFileSync(
    request,
    JSON.stringify({ ...input, checkIds: ['a'], summary: 'Refresh the affected left-file check.' }),
  );
  if (roundNumber === 1) {
    const before = counts(),
      beforeRunHash = hash(inspect());
    const incomplete = edit('refresh-checks', { file: request, ok: false });
    if (incomplete.status === 0 && incomplete.json?.data?.executeRequest)
      dispatch(incomplete.json.data.executeRequest, false);
    const after = counts(),
      afterRunHash = hash(inspect());
    fs.writeFileSync(
      path.join(evidence, 'unselected-negative-proof.json'),
      JSON.stringify(
        {
          simulatedAgent: true,
          realModelCalls: 0,
          before,
          after,
          beforeRunHash,
          afterRunHash,
          commandExitCode: incomplete.status,
          rejection: incomplete.json ?? incomplete.stdout,
        },
        null,
        2,
      ),
    );
    assert(
      incomplete.status !== 0 && beforeRunHash === afterRunHash && hash(before) === hash(after),
      `Missing formal retention must block before any execution; actual counts ${JSON.stringify(after)}`,
    );
    const formalFile = path.join(evidence, 'formal-1.json');
    const formalRecord = JSON.parse(fs.readFileSync(formalFile, 'utf8'));
    fs.writeFileSync(
      formalFile,
      JSON.stringify({
        ...formalRecord,
        summary:
          formalRecord.summary +
          ' Additional simulated judgment: B and once retain their original execution across these exact formal bytes.',
        retainedChecks: readBaseline()
          .trustedBaseline.checkReceipts.filter((c) => ['b', 'once'].includes(c.checkId))
          .map(({ actionId, checkId }) => ({ actionId, checkId })),
      }),
    );
    edit('record', { file: formalFile });
  }
  const refreshed = edit('refresh-checks', { file: request }).json.data;
  assert(refreshed.executeRequest, 'Missing execute request');
  if (negative) {
    const original = fs.readFileSync(path.join(root, 'left.unknown'));
    const before = counts();
    put('left.unknown', 'value=999\n# Changed after Agent judgment.\n');
    const attempted = dispatch(refreshed.executeRequest, false);
    const after = counts();
    assert(
      attempted.status !== 0 || attempted.json?.status !== 'succeeded',
      'Stale judgment accepted new behavior',
    );
    assert(JSON.stringify(before) === JSON.stringify(after), 'Stale attempt executed a check');
    const proof = {
      schema: 1,
      simulatedAgent: true,
      request: refreshed.executeRequest,
      before,
      after,
      rejection: attempted.json ?? attempted.stdout,
      exitCode: attempted.status,
    };
    fs.writeFileSync(path.join(evidence, 'negative-proof.json'), JSON.stringify(proof, null, 2));
    put('left.unknown', original);
  }
  const executed = dispatch(refreshed.executeRequest).json;
  assert(executed.status === 'succeeded', 'Refresh execution failed');
  const beforeRepeat = counts();
  edit('refresh-checks', { file: request });
  assert(
    JSON.stringify(beforeRepeat) === JSON.stringify(counts()),
    'Repeated refresh replayed checks',
  );
  return counts();
}
async function validate() {
  const source = readBaseline(),
    b = source.trustedBaseline ?? source,
    r = inspect();
  assert(b.schema === 'comet.052.native.seed-baseline.v1', 'Invalid trusted baseline');
  assert(r.runId === b.runId && hash(r.workflow) === hash(b.workflowIdentity), 'Run changed');
  assert(hash(r.state.builder_handoff) === b.builderHandoffHash, 'Builder candidate changed');
  assert(hash(r.waits) === b.waitsHash, 'Original approvals changed or new approval appeared');
  for (const a of b.actions) {
    const now = r.actions.find((x) => x.id === a.id);
    assert(hash(now) === a.hash, `Original successful action changed: ${a.stepId}`);
  }
  assert(hash(r.outputs['verify.report']) === b.reportOutputHash, 'Accepted report output changed');
  assert(
    JSON.stringify(r.actions.filter((a) => a.stepId === 'build.builder').map((a) => a.id)) ===
      JSON.stringify(b.builderActionIds),
    'New Builder started',
  );
  assert(
    JSON.stringify(counts()) === JSON.stringify({ a: 3, b: 1, once: 1 }),
    'Incorrect check counts',
  );
  assert(r.status === 'completed' && r.state.archived, 'Archive incomplete');
  assert(
    r.actions.filter((a) => a.stepId === 'archive.execute' && a.status === 'succeeded').length ===
      1,
    'Archive not exactly once',
  );
  assert(
    r.actions.filter((a) => a.stepId === 'archive.finalize' && a.status === 'succeeded').length ===
      1,
    'Archive finalization not exactly once',
  );
  const { hashRuntimeValue } = await import(
    pathToFileURL(path.join(cliRoot, 'dist/domains/engine/runtime.js')).href
  );
  const commands = r.commands?.filter((c) => c.name === 'refresh-checks') ?? [];
  assert(commands.length === 2, 'Expected exactly two supplemental refresh commands');
  for (const command of commands) {
    const action = r.actions.find((a) => a.id === command.actionId);
    assert(action?.status === 'succeeded', 'Supplemental check not successful');
    assert(
      JSON.stringify(action.input.activation.checkIds) === JSON.stringify(['a']),
      'Refresh ran unrelated check',
    );
    assert(
      command.inputHash === hashRuntimeValue(action.input.activation),
      'Refresh command/action input binding differs',
    );
    assert(
      action.input.activation.reportSha256 === b.reportSha256,
      'Refresh did not preserve accepted report binding',
    );
  }
  const latestCheckAction = r.actions.find((action) => action.id === commands.at(-1).actionId);
  const latestDocumentCheck = latestCheckAction.outcome.output.checks.find(
    (check) => check.id === 'a',
  );
  assert(
    latestDocumentCheck?.status === 'passed' &&
      latestDocumentCheck.exitCode === 0 &&
      !latestDocumentCheck.reusedFrom,
    'Latest document evidence must come from a newly executed successful A check',
  );
  const { resolveWorkspaceRuntimeRootSync } = await import(
    pathToFileURL(path.join(cliRoot, 'dist/platform/paths/workspace-runtime.js')).href
  );
  const { nativeSdkCheckStorageRef } = await import(
    pathToFileURL(path.join(cliRoot, 'dist/domains/comet-native/native-sdk-check-execution.js'))
      .href
  );
  const { readProtectedProjectFile } = await import(
    pathToFileURL(path.join(cliRoot, 'dist/domains/workflow-contract/protected-project-path.js'))
      .href
  );
  const log = await readProtectedProjectFile(
    resolveWorkspaceRuntimeRootSync(root),
    nativeSdkCheckStorageRef(latestDocumentCheck.logRef),
    1024 * 1024,
    { label: '052 actual latest document-evidence check log', bigint: true },
  );
  assert(
    hash(log.bytes) === latestDocumentCheck.logSha256,
    'Actual document-evidence log differs from its Runtime receipt',
  );
  const currentLeftSha256 = hash(fs.readFileSync(path.join(root, 'left.unknown')));
  const digestLines = log.bytes
    .toString('utf8')
    .split(/\r?\n/)
    .filter((line) => line.startsWith(documentEvidencePrefix));
  assert(
    digestLines.length === 1 && digestLines[0] === documentEvidencePrefix + currentLeftSha256,
    'Latest actual A stdout does not evidence the complete current left document',
  );
  const archive = r.outputs['archive.finalize']?.value;
  const archiveDir = r.outputs['archive.prepare']?.value.archiveDirRef;
  assert(
    typeof archiveDir === 'string' && path.posix.basename(archiveDir) === archive.archiveRef,
    'Archive directory must match the actual preflight receipt',
  );
  assert(typeof archive?.archiveRef === 'string', 'Missing archive receipt');
  assert(
    r.outputs['archive.prepare'].value.reportSha256 === b.reportHash,
    'Archive did not bind original accepted report bytes',
  );
  assert(
    hash(fs.readFileSync(path.join(root, archiveDir, 'verification.md'))) === archive.reportSha256,
    'Archived report does not match Runtime finalization receipt',
  );
  assert(
    fs.readFileSync(path.join(root, 'left.unknown'), 'utf8') ===
      'value=1\n# A final explanatory note; the first line remains authoritative.\n',
    'Latest ordinary edit not delivered',
  );
  assert(
    fs.readFileSync(path.join(root, 'right.unknown'), 'utf8') === 'value=1\n# Independent input.\n',
    'Unrelated input changed',
  );
  assert(
    fs.readFileSync(path.join(root, archiveDir, 'brief.md'), 'utf8') ===
      b.formalBytes.replace(
        'Use the existing text files.',
        'Use the existing text files; the first line states each value.',
      ),
    'Formal clarification not preserved',
  );
  return {
    passed: true,
    runId: r.runId,
    counts: counts(),
    refreshActionIds: commands.map((c) => c.actionId),
    originalApprovalHash: hash(r.waits),
    originalAcceptedReportHash: hash(r.outputs['verify.report']),
    originalAcceptedReportFileHash: b.reportHash,
    archivedReportHash: archive.reportSha256,
    baselineHash: hash(b),
    documentEvidence: {
      prefix: documentEvidencePrefix,
      actionId: latestCheckAction.id,
      logRef: latestDocumentCheck.logRef,
      logSha256: latestDocumentCheck.logSha256,
      currentLeftSha256,
    },
    scope:
      'Read-only authoritative Runtime validation; model provenance is established separately by the harness',
  };
}
let result;
try {
  if (mode === 'seed') result = seed();
  else if (mode === 'dryrun') {
    seed();
    round(1, false);
    round(2, true);
    native('archive', name);
    result = { ...(await validate()), simulatedAgentAndUser: true, realModelCalls: 0 };
  } else if (mode === 'validate') result = await validate();
  else throw Error('Use seed, dryrun or validate');
  console.log((mode === 'seed' ? 'COMET_052_SEED_PROOF=' : '') + JSON.stringify(result));
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  if (fs.existsSync(evidence))
    fs.writeFileSync(
      path.join(evidence, `transcript-${mode}.json`),
      JSON.stringify(
        { simulatedAgent: mode !== 'validate', realModelCalls: 0, commands: transcript },
        null,
        2,
      ),
    );
}
