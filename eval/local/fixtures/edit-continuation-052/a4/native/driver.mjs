const sortIdentity = (v) =>
  Array.isArray(v)
    ? v.map(sortIdentity)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortIdentity(v[k])]),
        )
      : v;
// Temporary A4 controller. All workflow mutations use the public CLI.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const mode = process.argv[2];
const allowedModes = ['seed', 'checkpoint-judgment', 'verify', 'approve', 'validate'];
if (!allowedModes.includes(mode)) throw Error(`Use ${allowedModes.join(', ')}`);
const pairs = process.argv.slice(3);
if (pairs.length % 2) throw Error('Options require exact name/value pairs');
const args = {};
for (let i = 0; i < pairs.length; i += 2) {
  if (!['--root', '--cli-root'].includes(pairs[i]) || Object.hasOwn(args, pairs[i]))
    throw Error('Unknown or duplicate option');
  args[pairs[i]] = pairs[i + 1];
}
if (!args['--root'] || !args['--cli-root'])
  throw Error('Explicit --root and --cli-root are required');
const root = path.resolve(args['--root']);
const cliRoot = path.resolve(args['--cli-root']);
if (root === cliRoot || !fs.existsSync(path.join(cliRoot, 'bin/comet.js')))
  throw Error('Requires an isolated project and built public CLI');
const workflow = 'native';
const name = 'native-052-authorized-implementation';
const evidence = path.join(root, '.git/052-a4-fixture-evidence');
const oracle = path.join(root, '_eval_trusted_oracles/052-a4');
const env = process.env;
const digest = (value) =>
  crypto
    .createHash('sha256')
    .update(
      typeof value === 'string' || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(sortIdentity(value)),
    )
    .digest('hex');
const assert = (condition, message) => {
  if (!condition) throw Error(message);
};
const read = (ref) => fs.readFileSync(path.join(root, ref), 'utf8');
const put = (ref, value) => {
  const file = path.join(root, ref);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
let sequence = 0;
function command(program, argv) {
  const result = spawnSync(program, argv, {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 24 * 1024 * 1024,
  });
  assert(
    result.status === 0,
    `Public command failed (${result.status}): ${result.stderr || result.stdout}`,
  );
  return result.stdout;
}
function cli(argv) {
  return JSON.parse(command(process.execPath, [path.join(cliRoot, 'bin/comet.js'), ...argv]));
}
function native(...argv) {
  return cli(['native', ...argv, '--project-root', root, '--json']);
}
function dispatch(request) {
  fs.mkdirSync(evidence, { recursive: true });
  const file = path.join(evidence, `${mode}-${++sequence}.request.json`);
  fs.writeFileSync(file, JSON.stringify({ protocolVersion: 1, runId: name, ...request }));
  const result = cli([
    'runtime',
    'dispatch',
    '--application',
    'native',
    '--project-root',
    root,
    '--request',
    file,
    '--details',
  ]);
  assert(result.status === 'succeeded', 'Runtime dispatch failed');
  return result.data;
}
const inspect = () => dispatch({ operation: 'inspect' });
function pending(run, step) {
  const actions = run.actions.filter(
    (action) => action.status === 'pending' && action.stepId === step,
  );
  assert(actions.length === 1, `Expected one pending ${step}`);
  return actions[0];
}
function counts() {
  return Object.fromEntries(
    ['a', 'b', 'once'].map((id) => [
      id,
      fs.existsSync(path.join(root, `.git/052-a4-count-${id}`))
        ? read(`.git/052-a4-count-${id}`).length
        : 0,
    ]),
  );
}
function plans() {
  return ['a', 'b', 'once'].map((id) => ({
    id,
    name: `052 A4 ${id}`,
    executable: process.execPath,
    argv: [
      '-e',
      id === 'once'
        ? 'const f=require("node:fs");f.writeFileSync(".git/052-a4-count-once","1",{flag:"wx"});process.stdout.write("once");'
        : `const f=require("node:fs");const first=f.readFileSync("${id === 'a' ? 'left' : 'right'}.unknown","utf8").split("\\n")[0];if(!${id === 'a' ? '["value=1","value=2"]' : '["value=1"]'}.includes(first))throw Error("invalid API value");f.appendFileSync(".git/052-a4-count-${id}","1");process.stdout.write(first);`,
    ],
    cwdRef: '.',
    timeoutMs: 10000,
    repeatable: id !== 'once',
  }));
}
function submit(action, sessionId, output, verifier = false) {
  dispatch({
    operation: 'claim',
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId,
    claimToken: sessionId,
  });
  if (verifier) {
    const status = native('status', name, '--details').data;
    const active = status.activeActions.find((entry) => entry.id === action.id);
    assert(active?.contextRequest?.commandArgs, 'Verifier task-context request missing');
    cli(
      active.contextRequest.commandArgs
        .slice(1)
        .map((arg) =>
          arg === '<original-task>'
            ? 'Verify the stable value API: left permits one or two, right remains one, and one-time effects must not replay.'
            : arg,
        ),
    );
  }
  return dispatch({
    operation: 'record-outcome',
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: sessionId,
      outcomeId: `${sessionId}-result`,
      status: 'succeeded',
      output,
    },
  });
}
function verifierOutput(run, sessionId, simulatedRole) {
  return {
    candidateId: run.state.builder_handoff.candidate_id,
    verifierExecutionRef: sessionId,
    response: {
      kind: 'final-result',
      result: {
        iteration: run.state.loop.iteration,
        attempt: run.state.loop.attempt,
        verdict: 'pass',
        acceptance: [
          {
            id: 'A1',
            result: 'passed',
            reason:
              'The controller independently read the approved API and current inputs and verified actual Runtime check receipts and one-time counts.',
          },
        ],
        risks: [],
        summary: `${simulatedRole}: deterministic controller validation; not a second real model.`,
      },
    },
  };
}
function baseline() {
  const trusted = path.join(oracle, 'native/baseline.json');
  const file = fs.existsSync(trusted) ? trusted : path.join(evidence, 'baseline.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(value.schema === 'comet.052.native-a4.baseline.v1', 'Invalid A4 baseline');
  return value;
}
function identity(run, b) {
  assert(
    run.runId === b.runId && digest(run.workflow) === digest(b.workflow),
    'Run/workflow changed',
  );
  assert(run.state.shape_confirmation_hash === b.shapeHash, 'Shape approval changed');
  for (const old of b.waits)
    assert(
      digest(run.waits.find((item) => item.id === old.id)) === old.hash,
      'An original approval changed',
    );
  for (const old of b.actions) {
    const action = run.actions.find((item) => item.id === old.id);
    assert(
      action &&
        digest(action.outcome) === old.outcomeHash &&
        digest(action.receipts) === old.receiptsHash &&
        action.inputHash === old.inputHash &&
        action.status === 'succeeded',
      `Original executed Action changed: ${old.stepId}`,
    );
  }
  const shapes = run.waits.filter((wait) =>
    ['shape.confirm', 'supervisor.shape.confirm'].includes(wait.stepId),
  );
  assert(
    shapes.length ===
      b.waits.filter((wait) => ['shape.confirm', 'supervisor.shape.confirm'].includes(wait.stepId))
        .length,
    'Extra Shape approval appeared',
  );
}
function unchangedFormal(run, b) {
  for (const [ref, hash] of Object.entries(b.formal))
    assert(digest(read(ref)) === hash, 'Approved formal bytes changed');
  assert(read('right.unknown') === b.right, 'Unrelated input changed');
  assert(read('left.unknown').split('\n')[0] === 'value=2', 'Subject did not implement A=2');
  identity(run, b);
}
function originalChecks(run, b) {
  const action = run.actions.find((entry) => entry.id === b.checkActionId);
  assert(action?.status === 'succeeded', 'Original check missing');
  assert(digest(action.outcome.output.checks) === b.checksHash, 'Original check receipts changed');
  return action.outcome.output.checks;
}
function modelJudgment(run, b) {
  unchangedFormal(run, b);
  assert(
    run.state.phase === 'archive' && run.state.builder_handoff.candidate_id === b.candidateId,
    'Judgment checkpoint must precede original candidate revision',
  );
  const data = cli(['edit-review', 'show', 'native', name, '--project-root', root, '--json']).data;
  const selected = data.reviews.filter(
    (review) =>
      review.binding.candidateKey === b.candidateId &&
      review.applied &&
      review.observed &&
      review.judgment === 'agent' &&
      review.receipt?.authority.kind === 'runtime-agent',
  );
  assert(selected.length === 1, 'Expected one current Agent observation judgment');
  const review = selected[0];
  assert(
    review.receipt.decision === 'implementation-changed',
    'A behavior change was not classified as implementation-changed',
  );
  assert(
    review.edits.length === 1 &&
      review.edits[0].path === 'left.unknown' &&
      review.edits[0].beforeHash === digest(b.left) &&
      review.edits[0].afterHash === digest(read('left.unknown')),
    'Judgment does not bind exact original/current A bytes',
  );
  assert(!review.receipt.retainedCheckActionIds?.length, 'Whole-action retention would retain A');
  const retained = [...(review.receipt.retainedChecks ?? [])].sort((a, c) =>
    a.checkId.localeCompare(c.checkId),
  );
  assert(
    digest(retained) ===
      digest(['b', 'once'].map((checkId) => ({ actionId: b.checkActionId, checkId }))),
    'Only original B and once may be retained',
  );
  const continuation = native('status', name).data.continuation;
  assert(
    continuation.action === 'repair' &&
      continuation.commandArgs?.includes('--revise-implementation'),
    'Existing implementation revision is not offered',
  );
  return { review, continuation };
}
function successor(run, b, requireVerifierPending) {
  unchangedFormal(run, b);
  const builders = run.actions.filter(
    (action) => action.stepId === 'build.builder' && !b.builderIds.includes(action.id),
  );
  assert(
    builders.length === 1 && builders[0].status === 'succeeded',
    'Expected exactly one real successor Builder',
  );
  assert(run.state.builder_handoff.candidate_id !== b.candidateId, 'No successor candidate');
  assert(
    digest(builders[0].outcome.output.verificationChecks) === digest(b.plans),
    'Subject replaced check definitions',
  );
  assert(
    (run.commands ?? []).filter((command) => command.name === 'revise-implementation').length === 1,
    'Expected one original implementation revision',
  );
  assert(
    !(run.commands ?? []).some((command) =>
      ['refresh-checks', 'revise-requirements'].includes(command.name),
    ),
    'A4 used an unrelated recovery command',
  );
  const checks = run.actions.filter(
    (action) => action.stepId === 'verify.checks' && action.id !== b.checkActionId,
  );
  assert(
    checks.length === 1 && checks[0].status === 'succeeded',
    'Successor check execution missing',
  );
  const actual = checks[0].outcome.output.checks;
  assert(
    actual.length === 3 &&
      actual.every((check) => check.status === 'passed' && check.exitCode === 0),
    'Successor checks did not pass',
  );
  const before = originalChecks(run, b);
  for (const id of ['b', 'once']) {
    const current = actual.find((check) => check.id === id);
    assert(
      current?.reusedFrom?.actionId === b.checkActionId &&
        current.reusedFrom.checkId === id &&
        current.logRef === before.find((check) => check.id === id).logRef,
      `Original ${id} was not retained`,
    );
  }
  const a = actual.find((check) => check.id === 'a');
  assert(
    !a.reusedFrom && a.logRef !== before.find((check) => check.id === 'a').logRef,
    'A did not execute again',
  );
  assert(digest(counts()) === digest({ a: 2, b: 1, once: 1 }), 'Wrong A/B/once actual counts');
  const verifiers = run.actions.filter(
    (action) => action.stepId === 'verify.verifier' && !b.verifierIds.includes(action.id),
  );
  assert(verifiers.length === 1, 'Expected one successor Verifier');
  if (requireVerifierPending)
    assert(
      verifiers[0].status === 'pending' && !verifiers[0].claim,
      'Subject already claimed or supplied independent verification',
    );
  return { builder: builders[0], checks: checks[0], verifier: verifiers[0] };
}
function proof(kind, b, extra) {
  return {
    schema: `comet.052.native-a4.${kind}.v1`,
    workflow,
    runId: name,
    baselineHash: digest(b),
    simulatedRole:
      kind === 'verify'
        ? 'independent-verifier'
        : kind === 'approve'
          ? 'user'
          : kind === 'seed'
            ? 'historical-agent-user-verifier'
            : null,
    realModelCalls: 0,
    ...extra,
  };
}
function seed() {
  fs.mkdirSync(root, { recursive: true });
  for (const ref of [
    '.comet/config.yaml',
    'docs/comet/changes',
    'left.unknown',
    'right.unknown',
    '.git/052-a4-fixture-evidence',
  ])
    assert(
      !fs.existsSync(path.join(root, ref)),
      'Seed only initializes an empty isolated business project',
    );
  if (!fs.existsSync(path.join(root, '.git'))) command('git', ['init', '-q', '-b', 'main']);
  command('git', ['config', 'user.name', '052 A4 simulated history']);
  command('git', ['config', 'user.email', '052-a4@example.invalid']);
  command('git', ['config', 'core.autocrlf', 'false']);
  put(
    '.gitignore',
    '_eval_current_comet/\n_eval_trusted_oracles/\n_eval_target_skills/\n.claude/\n.eval*\n_052_case.json\n_test_context.json\n_test_results.json\nvalidation/\n',
  );
  put('left.unknown', 'value=1\n# Stable API input.\n');
  put('right.unknown', 'value=1\n# Independent stable input.\n');
  command('git', ['add', '.gitignore', 'left.unknown', 'right.unknown']);
  command('git', ['commit', '-qm', 'A4 isolated preapproved API baseline']);
  native('new', name, '--runtime', 'sdk', '--language', 'en');
  const formalRef = `docs/comet/changes/${name}/brief.md`;
  const specRef = `docs/comet/changes/${name}/specs/values/spec.md`;
  put(
    formalRef,
    '# Outcome\nProvide a stable value API.\n# Scope\nRead the first line of left.unknown and right.unknown. The left API permits value=1 or value=2; right remains value=1.\n## Directory structure\n### Modified\n- left.unknown: approved values one or two.\n- right.unknown: independent value one.\n# Non-goals\nPublishing or changing the API format.\n# Acceptance examples\n- Left returns an allowed integer one or two, right returns one, and once is executed exactly once.\n# Constraints and invariants\nPreserve unrelated work and never replay one-time effects.\n# Decisions\nUser authorizes switching the left value within the approved one-or-two range.\n# Open questions\nNone.\n# Verification expectations\nRead actual values, preserve valid independent checks, independently verify changed candidates.\n',
  );
  put(
    specRef,
    '# Values\nThe first line is value=<integer>. Left allows one or two; right remains one. Preserve the stable read interface and one-time effects.\n',
  );
  native('next', name);
  let run = inspect();
  native(
    'next',
    name,
    '--confirmed',
    '--summary',
    'Simulated historical User approves the stable API allowing left one or two.',
    '--expected-state-version',
    String(run.state.state_version),
    '--expected-action',
    'confirm-shape',
  );
  run = inspect();
  const plan = plans();
  run = submit(pending(run, 'build.builder'), '052-a4-history-builder', {
    summary: 'Initial implementation returns one within the approved API.',
    addressedAcceptanceIds: ['A1'],
    acceptanceReview: [
      {
        id: 'A1',
        status: 'implemented-with-evidence',
        evidence: ['left.unknown', 'right.unknown'],
        note: 'Both initial values equal one; left permits a future authorized switch to two.',
      },
    ],
    checks: [],
    knownLimits: [],
    review: null,
    submittedAt: new Date().toISOString(),
    verificationChecks: plan,
  });
  run = dispatch({
    operation: 'execute',
    actionId: pending(run, 'verify.checks').id,
    executorId: 'comet-native-checks',
  });
  assert(digest(counts()) === digest({ a: 1, b: 1, once: 1 }), 'Seed real check counts differ');
  run = submit(
    pending(run, 'verify.verifier'),
    '052-a4-history-independent-verifier',
    verifierOutput(
      run,
      '052-a4-history-independent-verifier',
      'Simulated historical independent Verifier',
    ),
    true,
  );
  native('next', name);
  const accept = native('status', name).data.continuation.commandAlternatives?.find(
    (option) => option.name === 'accept-result',
  );
  assert(accept, 'Seed acceptance unavailable');
  cli(
    accept.commandArgs
      .slice(1)
      .map((arg) =>
        arg === '<summary>' ? 'Simulated historical User accepts the original candidate.' : arg,
      ),
  );
  run = inspect();
  pending(run, 'archive.prepare');
  const check = run.actions.find(
    (action) => action.stepId === 'verify.checks' && action.status === 'succeeded',
  );
  const b = {
    schema: 'comet.052.native-a4.baseline.v1',
    runId: run.runId,
    workflow: run.workflow,
    shapeHash: run.state.shape_confirmation_hash,
    candidateId: run.state.builder_handoff.candidate_id,
    waits: run.waits.map((wait) => ({ id: wait.id, stepId: wait.stepId, hash: digest(wait) })),
    actions: run.actions
      .filter((action) => action.status === 'succeeded')
      .map((action) => ({
        id: action.id,
        stepId: action.stepId,
        inputHash: action.inputHash,
        outcomeHash: digest(action.outcome),
        receiptsHash: digest(action.receipts),
      })),
    builderIds: run.actions
      .filter((action) => action.stepId === 'build.builder')
      .map((action) => action.id),
    verifierIds: run.actions
      .filter((action) => action.stepId === 'verify.verifier')
      .map((action) => action.id),
    reportActionIds: run.actions
      .filter((action) => action.stepId === 'verify.report')
      .map((action) => action.id),
    checkActionId: check.id,
    checksHash: digest(check.outcome.output.checks),
    plans: plan,
    left: read('left.unknown'),
    right: read('right.unknown'),
    formal: { [formalRef]: digest(read(formalRef)), [specRef]: digest(read(specRef)) },
    reportHash: digest(read(`docs/comet/changes/${name}/verification.md`)),
    runHash: digest(run),
    counts: counts(),
  };
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'baseline.json'), JSON.stringify(b));
  return proof('seed', b, {
    baseline: b,
    scope: 'Public CLI simulated historical Agent/User/Verifier; not a model lifecycle',
    counts: counts(),
  });
}
function checkpoint() {
  const b = baseline(),
    run = inspect(),
    result = modelJudgment(run, b);
  const p = proof('judgment', b, {
    runHash: digest(run),
    revision: run.revision,
    candidateId: b.candidateId,
    judgment: result.review,
    judgmentHash: digest(result.review),
    leftHash: digest(read('left.unknown')),
    continuation: result.continuation,
    counts: counts(),
  });
  fs.writeFileSync(path.join(evidence, 'judgment-proof.json'), JSON.stringify(p));
  return p;
}
function verify() {
  const b = baseline(),
    before = inspect(),
    current = successor(before, b, true);
  const judged = JSON.parse(fs.readFileSync(path.join(evidence, 'judgment-proof.json'), 'utf8'));
  assert(
    judged.baselineHash === digest(b) &&
      judged.judgment?.receipt?.decision === 'implementation-changed',
    'No original judgment checkpoint',
  );
  assert(
    judged.leftHash === digest(read('left.unknown')),
    'Input changed after the subject judgment checkpoint',
  );
  const session = '052-simulated-independent-verifier-a4';
  assert(
    current.builder.claim?.sessionId && current.builder.claim.sessionId !== session,
    'Verifier must differ from actual Builder',
  );
  const after = submit(
    current.verifier,
    session,
    verifierOutput(before, session, 'Explicit simulated independent Verifier'),
    true,
  );
  const action = after.actions.find((item) => item.id === current.verifier.id);
  const p = proof('verify', b, {
    beforeRunHash: digest(before),
    afterRunHash: digest(after),
    beforeRevision: before.revision,
    afterRevision: after.revision,
    judgmentHash: judged.judgmentHash,
    candidateId: before.state.builder_handoff.candidate_id,
    builderId: current.builder.id,
    builderSession: current.builder.claim.sessionId,
    actionId: action.id,
    inputHash: action.inputHash,
    actionHash: digest(action),
    outcomeHash: digest(action.outcome),
    verifierSession: session,
    checkActionId: current.checks.id,
    checksHash: digest(current.checks.outcome.output.checks),
    counts: counts(),
  });
  fs.writeFileSync(path.join(evidence, 'verify-proof.json'), JSON.stringify(p));
  return p;
}
function approve() {
  const b = baseline(),
    before = inspect();
  successor(before, b, false);
  const vp = JSON.parse(fs.readFileSync(path.join(evidence, 'verify-proof.json'), 'utf8'));
  const verifier = before.actions.find((action) => action.id === vp.actionId);
  assert(
    vp.baselineHash === digest(b) && digest(verifier) === vp.actionHash,
    'Approval lacks exact controller Verifier',
  );
  const waits = before.waits.filter(
    (wait) => wait.stepId === 'verify.confirm' && !b.waits.some((old) => old.id === wait.id),
  );
  assert(
    waits.length === 1 && waits[0].status === 'pending',
    'New User acceptance must be pending, never supplied by subject',
  );
  const report = before.actions.filter(
    (action) => action.stepId === 'verify.report' && !b.reportActionIds.includes(action.id),
  );
  assert(report.length === 1 && report[0].status === 'succeeded', 'New accepted report missing');
  const reportHash = digest(read(`docs/comet/changes/${name}/verification.md`));
  assert(reportHash !== b.reportHash, 'Old report cannot accept changed implementation');
  const status = native('status', name).data;
  const accept = status.continuation.commandAlternatives?.find(
    (option) => option.name === 'accept-result',
  );
  assert(accept, 'Valid successor acceptance unavailable');
  cli(
    accept.commandArgs
      .slice(1)
      .map((arg) =>
        arg === '<summary>'
          ? 'Explicit simulated User accepts the controller-verified successor within the original API approval.'
          : arg,
      ),
  );
  const after = inspect(),
    wait = after.waits.find((entry) => entry.id === waits[0].id);
  assert(
    wait.status === 'resolved' && wait.decision.choice === 'approved',
    'Simulated acceptance did not resolve',
  );
  const p = proof('approve', b, {
    beforeRunHash: digest(before),
    afterRunHash: digest(after),
    beforeRevision: before.revision,
    afterRevision: after.revision,
    verifierActionId: verifier.id,
    reportActionId: report[0].id,
    reportOutputHash: digest(report[0].outcome.output),
    reportHash,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    waitHash: digest(wait),
    candidateId: after.state.builder_handoff.candidate_id,
    counts: counts(),
  });
  fs.writeFileSync(path.join(evidence, 'approve-proof.json'), JSON.stringify(p));
  return p;
}
async function validate() {
  const b = baseline(),
    run = inspect();
  identity(run, b);
  const host = JSON.parse(fs.readFileSync(path.join(oracle, 'model-tool-evidence.json'), 'utf8'));
  assert(
    host.workflow === workflow &&
      host.subjectExitCode === 0 &&
      host.seedWasFirstBash &&
      host.ordered &&
      host.forbiddenSkills.length === 0,
    'Missing valid host subject evidence',
  );
  assert(
    host.observedExtraAgentCalls === 0 &&
      host.extraAgentToolCalls?.length === 0 &&
      host.observedSubprocessAgentCalls === 0 &&
      host.subprocessAgentCalls?.length === 0,
    'Observed an extra model Agent or direct child Claude launch',
  );
  for (const key of ['seed', 'judgment', 'verify', 'approve'])
    assert(host.proofs[key].length === 1, `Expected one actual ${key} tool result`);
  const [seed, judged, verified, accepted] = ['seed', 'judgment', 'verify', 'approve'].map(
    (key) => host.proofs[key][0],
  );
  for (const p of [seed, judged, verified, accepted])
    assert(p.baselineHash === digest(b), 'Controller baseline differs from trusted seed');
  assert(
    digest(seed.baseline) === digest(b),
    'Trusted baseline differs from actual seed tool result',
  );
  assert(
    judged.judgment.receipt.decision === 'implementation-changed' &&
      verified.judgmentHash === judged.judgmentHash,
    'Subject judgment provenance missing',
  );
  assert(digest(read('left.unknown')) === judged.leftHash, 'Unjudged final A input');
  assert(run.status === 'completed' && run.state.archived, 'Archive incomplete');
  assert(
    read('left.unknown').split('\n')[0] === 'value=2' && read('right.unknown') === b.right,
    'Final behavior differs',
  );
  assert(digest(counts()) === digest({ a: 2, b: 1, once: 1 }), 'Check counts differ');
  const builder = run.actions.filter(
    (action) => action.stepId === 'build.builder' && !b.builderIds.includes(action.id),
  );
  const verifier = run.actions.filter(
    (action) => action.stepId === 'verify.verifier' && !b.verifierIds.includes(action.id),
  );
  const reports = run.actions.filter(
    (action) => action.stepId === 'verify.report' && !b.reportActionIds.includes(action.id),
  );
  assert(
    builder.length === 1 &&
      builder[0].id === verified.builderId &&
      digest(builder[0].outcome.output.verificationChecks) === digest(b.plans),
    'Unexpected successor Builder or plans',
  );
  assert(
    verifier.length === 1 &&
      verifier[0].id === verified.actionId &&
      digest(verifier[0]) === verified.actionHash &&
      verifier[0].claim.sessionId !== builder[0].claim.sessionId,
    'Independent simulated Verifier was forged or replaced',
  );
  assert(
    reports.length === 1 &&
      reports[0].id === accepted.reportActionId &&
      digest(reports[0].outcome.output) === accepted.reportOutputHash,
    'New report does not match User proof',
  );
  const waits = run.waits.filter((wait) => !b.waits.some((old) => old.id === wait.id));
  assert(
    waits.length === 1 && waits[0].id === accepted.waitId && digest(waits[0]) === accepted.waitHash,
    'Unexpected or forged new User decision',
  );
  const checks = run.actions.find((action) => action.id === verified.checkActionId);
  assert(
    checks?.status === 'succeeded' && digest(checks.outcome.output.checks) === verified.checksHash,
    'Actual successor check receipts differ',
  );
  assert(
    (run.commands ?? []).filter((command) => command.name === 'revise-implementation').length ===
      1 &&
      !(run.commands ?? []).some((command) =>
        ['refresh-checks', 'revise-requirements'].includes(command.name),
      ),
    'Wrong revision chain',
  );
  for (const step of ['archive.execute', 'archive.finalize'])
    assert(
      run.actions.filter((action) => action.stepId === step && action.status === 'succeeded')
        .length === 1,
      'Archive was not exactly once',
    );
  const final = run.outputs['archive.finalize'].value;
  const archiveDir = run.outputs['archive.prepare']?.value.archiveDirRef;
  assert(
    typeof archiveDir === 'string' && path.posix.basename(archiveDir) === final.archiveRef,
    'Archive directory must bind the actual preflight',
  );
  assert(
    run.outputs['archive.prepare'].value.reportSha256 === accepted.reportHash,
    'Archive preflight did not bind the new accepted report',
  );
  const archivedReport = read(path.posix.join(archiveDir, 'verification.md'));
  assert(
    digest(archivedReport) === final.reportSha256,
    'Archived final report bytes do not match finalization evidence',
  );
  assert(
    final.stateVersion === run.state.state_version,
    'Final report state version differs from the actual finalizer state',
  );
  const { renderNativeVerificationReport } = await import(
    pathToFileURL(path.join(cliRoot, 'dist/domains/comet-native/native-verification-report-v2.js'))
      .href
  );
  assert(
    archivedReport.toString('utf8') === renderNativeVerificationReport(run.state),
    'Archived report is not the deterministic report for the actual finalized state',
  );
  for (const [ref, expected] of Object.entries(b.formal)) {
    const relative = ref.slice(`docs/comet/changes/${name}/`.length);
    assert(
      digest(read(path.posix.join(archiveDir, relative))) === expected,
      'Archived original formal bytes changed',
    );
  }
  return proof('validate', b, {
    passed: true,
    scope:
      'Real model judgment and Builder continuation after simulated history; deterministic independent Verifier/User controller; not a model full lifecycle',
    counts: counts(),
    candidateId: run.state.builder_handoff.candidate_id,
    builderId: builder[0].id,
    verifierId: verifier[0].id,
    acceptanceId: waits[0].id,
    archiveRef: final.archiveRef,
    finalRunHash: digest(run),
  });
}
try {
  const result = await (mode === 'seed'
    ? seed()
    : mode === 'checkpoint-judgment'
      ? checkpoint()
      : mode === 'verify'
        ? verify()
        : mode === 'approve'
          ? approve()
          : validate());
  const marker = mode === 'checkpoint-judgment' ? 'JUDGMENT' : mode.toUpperCase();
  console.log(`COMET_052_A4_${marker}_PROOF=${JSON.stringify(result)}`);
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
}
