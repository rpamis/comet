import fs from 'node:fs/promises';
import path from 'node:path';
import {
  here,
  SCHEMA,
  assert,
  sha,
  digest,
  equal,
  readJson,
  inspect,
  classic,
  git,
  loadDist,
  loadBaseline,
  counters,
  proof,
  cliIdentity,
  actionSignature,
  assertCheckReceipt,
  assertOriginalHistory,
  originalJudgment,
  assertFixtureInputs,
} from './common.mjs';
import { assertRevisedBuild } from './controller.mjs';

export async function validate(c) {
  const { baseline, baselineHash } = await loadBaseline(c, true);
  const evidenceFile = path.resolve(here, '../model-tool-evidence.json');
  const host = await readJson(evidenceFile);
  assert(
    host.workflow === 'classic' && host.subjectExitCode === 0,
    'The subject model must have a successful actual exit',
  );
  assert(
    Array.isArray(host.forbiddenSkills) && host.forbiddenSkills.length === 0,
    'External Skills or missing Skill audit',
  );
  assert(
    host.seedWasFirstBash === true,
    'Seed must be the first actual subject Bash tool call in this container',
  );
  assert(
    host.ordered === true,
    'Trusted controller calls must occur in seed, judgment, verify, approve order',
  );
  assert(
    host.observedExtraAgentCalls === 0 &&
      host.extraAgentToolCalls?.length === 0 &&
      host.observedSubprocessAgentCalls === 0 &&
      host.subprocessAgentCalls?.length === 0,
    'Observed an extra model Agent or direct child Claude launch',
  );
  const keys = ['seed', 'judgment', 'verify', 'approve'];
  for (const key of keys)
    assert(
      Array.isArray(host.proofs?.[key]) && host.proofs[key].length === 1,
      `Exactly one host-observed ${key} proof is required`,
    );
  const p = Object.fromEntries(keys.map((key) => [key, host.proofs[key][0]]));
  assert(
    Array.isArray(host.bindings) && host.bindings.length === keys.length,
    'Every proof must have exactly one actual tool-use/result binding',
  );
  const modes = { seed: 'seed', judgment: 'judgment', verify: 'verify', approve: 'approve' };
  const ids = new Set();
  for (const key of keys) {
    const item = p[key];
    assert(
      item.schema === `${SCHEMA}.${key}.v1` &&
        item.workflow === 'classic' &&
        item.runId === c.name &&
        item.baselineHash === baselineHash,
      `Invalid ${key} proof identity`,
    );
    const bindings = host.bindings.filter((binding) => binding.mode === modes[key]);
    assert(
      bindings.length === 1 &&
        bindings[0].toolUseId &&
        bindings[0].toolResultHash &&
        bindings[0].proofHash === sha(JSON.stringify(item)),
      `Missing exact ${key} tool-result payload binding`,
    );
    assert(!ids.has(bindings[0].toolUseId), 'One tool call cannot stand in for multiple roles');
    ids.add(bindings[0].toolUseId);
  }
  assert(
    equal(p.seed.baseline, baseline) &&
      digest(p.seed.baseline) === baselineHash &&
      p.seed.originalRunHash === baseline.runHash,
    'Host baseline is not the original actual seed output',
  );
  assert(
    equal(await cliIdentity(c), baseline.cliIdentity),
    'Frozen CLI package bytes changed after the seed',
  );
  assert(
    p.judgment.readOnly === true &&
      p.judgment.simulatedRole === null &&
      p.judgment.runHash === baseline.runHash &&
      p.judgment.beforeRevision === baseline.originalRevision &&
      p.judgment.afterRevision === baseline.originalRevision,
    'Judgment proof must come from readonly inspection before revision',
  );
  assert(
    p.verify.simulatedRole ===
      'Deterministic independent Verifier controller; not an independent model',
    'Verifier must be the explicitly simulated trusted controller',
  );
  assert(
    p.approve.simulatedRole === 'Explicit simulated User; local delivery only' &&
      p.approve.choice === 'local',
    'New Archive approval must come from the explicitly simulated User controller',
  );
  assert(
    p.verify.beforeRevision > p.judgment.afterRevision &&
      p.verify.afterRevision > p.verify.beforeRevision &&
      p.approve.beforeRevision > p.verify.afterRevision &&
      p.approve.afterRevision > p.approve.beforeRevision,
    'Proofs are not ordered through the actual new candidate',
  );

  const run = await inspect(c);
  assert(
    run.status === 'completed' &&
      run.state.archived === true &&
      run.state.branchStatus === 'handled',
    'Final Run/local delivery is incomplete',
  );
  assertOriginalHistory(run, baseline);
  const { newActions, builder, newB } = await assertRevisedBuild(c, run, baseline);
  const judgment = await originalJudgment(c, baseline);
  assert(
    digest(judgment) === p.judgment.judgmentHash &&
      digest(judgment) === p.verify.judgmentHash &&
      equal(judgment, p.judgment.judgment),
    'The actual model judgment changed or differs from the host-observed checkpoint',
  );
  assert(
    p.judgment.currentAHash === sha('value=2\n'),
    'Checkpoint did not observe the actual A behavior change',
  );
  const expectedContinuation = [
    'comet',
    'state',
    'continue-build',
    c.name,
    '--expected-revision',
    String(baseline.originalRevision),
    '--json',
  ];
  assert(
    equal(p.judgment.continuation, expectedContinuation),
    'Model did not receive the original public continuation',
  );
  const allowedSteps = [
    'full.build.execute',
    'full.build.check',
    'full.verify.run',
    'full.verify.check',
    'full.archive.prepare',
    'full.archive.preflight',
    'full.archive.execute',
    'full.archive.deliver',
  ];
  assert(
    newActions.length === allowedSteps.length &&
      allowedSteps.every(
        (step) => newActions.filter((action) => action.stepId === step).length === 1,
      ),
    'Unexpected replay or additional workflow work after the single implementation revision',
  );
  for (const action of newActions)
    assert(action.status === 'succeeded', `New Action did not succeed: ${action.stepId}`);
  const newA = newActions.find((action) => action.stepId === 'full.verify.check');
  const newVerify = newActions.find((action) => action.stepId === 'full.verify.run');
  await assertCheckReceipt(c, run, newA);
  assert(
    newA.outcome.output.reused !== true && equal(newA.outcome.output.argv, baseline.argvA),
    'A was not actually checked with its original command',
  );
  for (const [actual, recorded] of [
    [builder, p.verify.builder],
    [newB, p.verify.retainedB],
    [newA, p.verify.newA],
    [newVerify, p.verify.newVerify],
  ])
    assert(
      actual.id === recorded.id &&
        actual.inputHash === recorded.inputHash &&
        actionSignature(actual) === recorded.signature,
      `Actual new execution differs from trusted Verifier proof: ${actual.stepId}`,
    );
  assert(
    p.approve.newA.id === newA.id && p.approve.newA.signature === actionSignature(newA),
    'User decision did not bind the same verified A',
  );
  const newWaits = run.waits.filter(
    (wait) => !baseline.original.waits.some((original) => original.id === wait.id),
  );
  assert(
    newWaits.length === 1 &&
      newWaits[0].stepId === 'full.archive.confirm' &&
      newWaits[0].status === 'resolved',
    'Only the new Archive approval may be added',
  );
  assert(
    newWaits[0].id === p.approve.waitId &&
      newWaits[0].proposalHash === p.approve.proposalHash &&
      digest(newWaits[0]) === p.approve.waitSignature &&
      newWaits[0].decision?.choice === 'local',
    'Final new approval differs from the actual simulated User decision',
  );
  const newEvidence = (run.evidenceWaits ?? []).filter(
    (wait) => !baseline.original.evidenceWaits.some((original) => original.id === wait.id),
  );
  const expectedEvidence = [
    'full.build.check.evidence',
    'full.verify.report.evidence',
    'full.verify.check.evidence',
  ];
  assert(
    newEvidence.length === expectedEvidence.length &&
      expectedEvidence.every(
        (step) =>
          newEvidence.filter((wait) => wait.stepId === step && wait.status === 'resolved')
            .length === 1,
      ),
    'New evidence must belong only to the fresh Build/Verify chain',
  );
  const acceptedReport = newEvidence.find(
    (wait) => wait.stepId === 'full.verify.report.evidence',
  ).receipt;
  assert(
    acceptedReport?.ref === c.newReportRef &&
      acceptedReport.contentHash === p.verify.reportSha256 &&
      p.approve.reportSha256 === p.verify.reportSha256,
    'New accepted report is not the controller Verifier report',
  );
  const counts = await counters(c);
  assert(
    counts.aText === 'A:1\nA:2\n' &&
      counts.bText === 'B:7\n' &&
      counts.bHash === baseline.counts.bHash,
    'A must run twice and the B side effect once',
  );
  assert(
    equal(counts, p.verify.actualCounters) && equal(counts, p.approve.actualCounters),
    'Actual counters differ from the trusted verification/approval results',
  );

  await assertFixtureInputs(c, baseline, { archived: true, allowNewReport: true });
  assert(
    sha(await fs.readFile(path.join(c.root, c.newReportRef))) === p.verify.reportSha256,
    'The revised report changed after acceptance',
  );
  const archiveActions = run.actions.filter(
    (action) => action.stepId === 'full.archive.execute' && action.status === 'succeeded',
  );
  assert(archiveActions.length === 1, 'Archive must execute successfully exactly once');
  const archiveRef = archiveActions[0].outcome.output.archiveDirectory;
  assert(
    typeof archiveRef === 'string' && archiveRef.startsWith('openspec/changes/archive/'),
    'Missing real archive output',
  );
  const { archivedClassicDocumentRef, annotatedMarkdown } = await loadDist(
    c,
    'domains/comet-classic/classic-archive-annotation.js',
  );
  for (const [ref, source, extra] of [
    [c.designRef, baseline.designText, 'status: final'],
    [c.planRef, baseline.planText, ''],
  ]) {
    const actualRef = archivedClassicDocumentRef(ref, c.change, archiveRef);
    assert(
      (await fs.readFile(path.join(c.root, actualRef), 'utf8')) ===
        annotatedMarkdown(source, path.posix.basename(archiveRef), extra),
      `Original accepted document was replaced: ${ref}`,
    );
  }
  for (const [ref, expected] of Object.entries(baseline.fileHashes).filter(([ref]) =>
    ref.startsWith(c.change + '/'),
  )) {
    const archivedRef = archiveRef + ref.slice(c.change.length);
    assert(
      sha(await fs.readFile(path.join(c.root, archivedRef))) === expected,
      `Original canonical requirement changed: ${ref}`,
    );
  }
  for (const field of [
    'buildMode',
    'tddMode',
    'reviewMode',
    'subagentDispatch',
    'directOverride',
    'isolation',
    'boundBranch',
    'baseRef',
    'createdAt',
    'language',
  ])
    assert(
      equal(run.state[field], baseline.state[field]),
      `Original approved configuration changed: ${field}`,
    );
  await classic(c, 'state', 'delivery', c.name, '--verify');
  const head = await git(c, 'rev-parse', 'HEAD');
  assert(
    Boolean(await git(c, 'ls-tree', '-r', '--name-only', head, '--', archiveRef)),
    'Archive is absent from the actual delivery commit',
  );
  assert(
    (await git(c, 'show', `${head}:left.unknown`)) === 'value=2',
    'Actual delivery commit does not contain A=2',
  );
  assert(
    !(await git(c, 'ls-files', '--', '.comet/runtime')),
    'Runtime management files were committed',
  );
  return proof(c, 'validate', baselineHash, {
    mode: 'validate',
    ok: true,
    finalRevision: run.revision,
    runHash: digest(run),
    cliIdentity: baseline.cliIdentity,
    actualCounters: counts,
    head,
    archiveRef,
    hostEvidenceHash: sha(await fs.readFile(evidenceFile)),
    checks: [
      'Same SDK Run',
      'Actual model implementation judgment and explicit B retention',
      'Original approvals and sources preserved',
      'One new Builder and reused original B',
      'Trusted simulated Verifier with real new A check',
      'Trusted simulated User new Archive approval',
      'One Archive and verified local delivery',
    ],
    limits: [
      'Historical seed and post-edit Verifier/User are explicitly simulated.',
      'No independent model Verifier claim is made.',
      'This validator does not launch a model or establish platform Hook/full release acceptance.',
    ],
  });
}
