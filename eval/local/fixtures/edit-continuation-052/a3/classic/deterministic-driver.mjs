import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  here,
  hash,
  assert,
  readJson,
  writeJson,
  put,
  parseArgs,
  git,
  invoke,
  runtime,
  inspect,
  edit,
  classic,
  counters,
} from './common.mjs';

// Seed and deterministic-full explicitly simulate Agent/User. No model is called.
const [mode, ...argv] = process.argv.slice(2);
const o = parseArgs(argv);
async function seed() {
  const owned = o['project-root']
    ? null
    : await fs.mkdtemp(path.join(os.tmpdir(), 'comet052-classic-'));
  const projectRoot = path.resolve(o['project-root'] || path.join(owned, 'project'));
  const evidenceRoot = path.resolve(o['evidence-root'] || path.join(owned, 'evidence'));
  assert(
    !evidenceRoot.startsWith(projectRoot + path.sep) ||
      evidenceRoot.startsWith(path.join(projectRoot, '.git') + path.sep),
    'Evidence must be outside raw candidate inputs; .git evidence is allowed before host freezes the oracle',
  );
  for (const ref of [
    'left.unknown',
    'right.unknown',
    'checks.mjs',
    '.comet/config.yaml',
    'openspec/config.yaml',
  ])
    assert(
      !(await fs.stat(path.join(projectRoot, ref)).then(
        () => true,
        () => false,
      )),
      `Seed requires an isolated project without existing fixture target: ${ref}`,
    );
  assert(o['source-root'], 'An explicit built public CLI root is required');
  const sourceRoot = path.resolve(o['source-root']);
  const commandEnvironment = o.openspec ? { COMET_OPENSPEC: o.openspec } : {};
  const actualEnvironment = Object.fromEntries(
    [
      'COMET_DATA_DIR',
      'COMET_OPENSPEC',
      'COMET_DAEMON',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_NOSYSTEM',
      'CI',
    ]
      .filter((k) => process.env[k] !== undefined)
      .map((k) => [k, process.env[k]]),
  );
  const c = {
    schema: '052.classic.fixture.v1',
    projectRoot,
    evidenceRoot,
    sourceRoot,
    dist: path.resolve(o.dist || path.join(sourceRoot, 'dist')),
    cli: o.cli ? path.resolve(o.cli) : null,
    openspec:
      o.openspec ||
      process.env.COMET_OPENSPEC ||
      (process.platform === 'win32' ? 'openspec.cmd' : '/usr/local/bin/openspec'),
    name: 'classic-052-edit',
    dataRoot: process.env.COMET_DATA_DIR || path.join(evidenceRoot, 'data'),
    commandEnvironment,
    actualEnvironment,
    transportRoot: path.join(evidenceRoot, 'transport'),
    counterA: path.join(evidenceRoot, 'check-A.log'),
    counterB: path.join(evidenceRoot, 'check-B.log'),
    designRef: 'docs/superpowers/specs/technical-design.md',
    planRef: 'docs/superpowers/plans/work-plan.md',
    reportRef: 'docs/superpowers/reports/verify.md',
    session: '052-current-agent',
    seedSimulation: true,
    realModelCalls: 0,
  };
  c.actualEnvironment.COMET_DATA_DIR = c.dataRoot;
  Object.assign(c.actualEnvironment, commandEnvironment);
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(evidenceRoot, { recursive: true });
  await writeJson(path.join(evidenceRoot, 'fixture.json'), c);
  const { renderCometProjectGitignore } = await import(
    pathToFileURL(path.join(c.dist, 'domains/workflow-contract/project-gitignore.js')).href
  );
  await put(
    projectRoot,
    '.gitignore',
    renderCometProjectGitignore(
      await fs.readFile(path.join(projectRoot, '.gitignore'), 'utf8').catch(() => ''),
    ),
  );
  await put(
    projectRoot,
    '.comet/config.yaml',
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n  language: en\n  context_compression: off\n  review_mode: standard\n  auto_transition: true\n',
  );
  await put(projectRoot, 'openspec/config.yaml', 'schema: spec-driven\n');
  await fs.mkdir(path.join(projectRoot, 'openspec/changes/archive'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'openspec/specs'), { recursive: true });
  await put(projectRoot, 'left.unknown', 'value=1\n# original explanation\n');
  await put(projectRoot, 'right.unknown', 'value=2\n');
  await put(
    projectRoot,
    'checks.mjs',
    `import fs from 'node:fs';\nimport {createHash} from 'node:crypto';\nconst [name,log]=process.argv.slice(2);\nconst ref=name==='A'?'left.unknown':'right.unknown';\nconst expected=name==='A'?'value=1':'value=2';\nconst bytes=fs.readFileSync(ref);\nif(bytes.toString('utf8').split(/\\r?\\n/)[0]!==expected)process.exit(17);\nif(name==='B'&&fs.existsSync(log))throw Error('Once-only B must never replay');\nfs.appendFileSync(log,name+'\\n');\nif(name==='A')process.stdout.write('COMET_052_LEFT_DOCUMENT_SHA256='+createHash('sha256').update(bytes).digest('hex')+'\\n');\n`,
  );
  c.argvA = [process.execPath, 'checks.mjs', 'A', c.counterA];
  c.argvB = [process.execPath, 'checks.mjs', 'B', c.counterB];
  await put(
    projectRoot,
    '.comet/check-policy.json',
    JSON.stringify({
      version: 2,
      commands: [
        { argv: c.argvA, cwd: '.', files: ['left.unknown', 'checks.mjs'] },
        { argv: c.argvB, cwd: '.', files: ['right.unknown', 'checks.mjs'] },
      ],
    }),
  );
  await writeJson(path.join(evidenceRoot, 'fixture.json'), c);
  await writeJson(path.join(projectRoot, 'simulated-user-build-config.json'), {
    build_mode: 'direct',
    tdd_mode: 'direct',
    review_mode: 'off',
    subagent_dispatch: null,
    direct_override: true,
  });
  await git(c, 'init', '--quiet', '-b', 'main');
  await git(c, 'config', 'user.name', 'Comet isolated Eval');
  await git(c, 'config', 'user.email', 'eval@example.invalid');
  await git(c, 'config', 'core.autocrlf', 'false');
  await git(c, 'config', 'commit.gpgsign', 'false');
  await git(
    c,
    'add',
    '--',
    '.gitignore',
    '.comet/config.yaml',
    'openspec/config.yaml',
    'left.unknown',
    'right.unknown',
    'checks.mjs',
    'simulated-user-build-config.json',
  );
  await git(c, 'commit', '--quiet', '-m', 'Isolated fixture baseline');
  await classic(c, 'state', 'init', c.name, 'full', '--isolation', 'current', '--runtime', 'sdk');
  const change = `openspec/changes/${c.name}`;
  await put(
    projectRoot,
    `${change}/proposal.md`,
    '# Value fixture\n\n## Why\nDocument and verify the existing two independent values and the exact current left document.\n\n## What Changes\n- Preserve left value one and right value two.\n- Check A validates the left first line and emits the SHA-256 of every raw byte in the current left.unknown document, including explanatory lines, as COMET_052_LEFT_DOCUMENT_SHA256=<digest> followed by one newline.\n- Check B independently validates the right first line and keeps its one-time side effect.\n\n## Impact\n- Affected spec: values\n- Affected files: left.unknown, right.unknown, checks.mjs\n',
  );
  await put(
    projectRoot,
    `${change}/design.md`,
    '# Design\nPreserve left value one and right value two. Check A reads the complete raw left.unknown document, validates first-line value=1, and emits its current SHA-256 using COMET_052_LEFT_DOCUMENT_SHA256=<digest> followed by one newline. Explanatory edits preserve the numeric value but change this document digest. Check B reads only right.unknown and retains its one-time effect.\n',
  );
  await put(projectRoot, `${change}/tasks.md`, '- [ ] Verify values <!-- comet-task:values -->\n');
  await put(
    projectRoot,
    `${change}/specs/values/spec.md`,
    '## ADDED Requirements\n\n### Requirement: Independent values\nThe system SHALL expose left value one and right value two.\n\n#### Scenario: Read values\n- **WHEN** the existing files are read\n- **THEN** left is one and right is two\n\n### Requirement: Current left document digest\nCheck A SHALL validate first-line value=1 and emit COMET_052_LEFT_DOCUMENT_SHA256=<digest> followed by one newline, where digest is the lowercase SHA-256 of every raw byte in the current left.unknown document.\n\n#### Scenario: Explanatory lines change\n- **WHEN** the left document explanation changes while its first line remains value=1\n- **THEN** the numeric value remains one and the recorded document digest matches the complete current left document\n',
  );
  const open = await classic(c, 'guard', c.name, 'open');
  await classic(c, 'guard', c.name, 'open', '--apply', '--approval-hash', open.approvalHash);
  const design = await classic(
    c,
    'state',
    'propose-design',
    c.name,
    '--proposal',
    'Keep both value fields. Trailing # lines are explanatory prose, while check A consumes every raw byte of left.unknown and emits its current SHA-256 as COMET_052_LEFT_DOCUMENT_SHA256=<digest>. Check B and its one-time effect remain independent.',
  );
  await classic(
    c,
    'state',
    'decide-design',
    c.name,
    '--proposal-hash',
    design.wait.proposalHash,
    '--choice',
    'approved',
  );
  await put(
    projectRoot,
    c.designRef,
    `---\ncomet_change: ${c.name}\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\nLeft remains one; right remains two. Trailing # lines explain the fields and do not change their values. Check A reads all raw bytes of left.unknown, validates first-line value=1, and writes COMET_052_LEFT_DOCUMENT_SHA256=<digest> followed by one newline to stdout; the digest is the current complete document SHA-256, including explanatory lines. Check B only validates right.unknown and preserves its one-time side effect.\n`,
  );
  await classic(
    c,
    'state',
    'complete-design',
    c.name,
    '--design-doc',
    c.designRef,
    '--approval-hash',
    design.wait.proposalHash,
  );
  const configFile = path.join(projectRoot, 'simulated-user-build-config.json');
  await writeJson(configFile, {
    build_mode: 'direct',
    tdd_mode: 'direct',
    review_mode: 'off',
    subagent_dispatch: null,
    direct_override: true,
  });
  const build = await classic(c, 'state', 'propose-build', c.name, '--file', configFile);
  await classic(
    c,
    'state',
    'decide-build',
    c.name,
    '--proposal-hash',
    build.wait.proposalHash,
    '--choice',
    'approved',
  );
  await put(
    projectRoot,
    c.planRef,
    `<!-- comet-task-authority: ${change}/tasks.md -->\n# Plan\n<!-- comet-task-ref:values -->\nVerify the independent values and record check A's SHA-256 of the complete current left document. Preserve check B's independent one-time side effect.\n`,
  );
  await classic(c, 'state', 'submit-plan', c.name, '--plan', c.planRef);
  await put(projectRoot, `${change}/tasks.md`, '- [x] Verify values <!-- comet-task:values -->\n');
  await classic(c, 'guard', c.name, 'build', '--apply', '--local', '--', ...c.argvB);
  await put(
    projectRoot,
    c.reportRef,
    '# Verification\nThe real checks read the unknown-extension files: left is one and right is two. Check A records the SHA-256 of the complete current left document in its actual stdout receipt. Check B and its one-time effect are independent.\n',
  );
  await classic(
    c,
    'guard',
    c.name,
    'verify',
    '--report',
    c.reportRef,
    '--apply',
    '--local',
    '--',
    ...c.argvA,
  );
  const archive = await classic(
    c,
    'state',
    'propose-archive',
    c.name,
    '--summary',
    'Deliver the independently checked fixture locally.',
  );
  await classic(
    c,
    'state',
    'decide-archive',
    c.name,
    '--proposal-hash',
    archive.wait.proposalHash,
    '--choice',
    'local',
  );
  const run = await inspect(c);
  const checkA = run.actions.find((a) => a.stepId === 'full.verify.check');
  const checkB = run.actions.find((a) => a.stepId === 'full.build.check');
  assert(
    checkA?.status === 'succeeded' && checkB?.status === 'succeeded',
    'Seed requires original real A and B checks',
  );
  assert(
    (await counters(c)).A === 1 && (await counters(c)).B === 1,
    'Seed must execute each check once',
  );
  const identityFiles = [
    'domains/comet-classic/classic-edit-review-command.js',
    'domains/comet-classic/classic-sdk-revision-application.js',
    'domains/comet-classic/classic-sdk-archive-preflight.js',
    'app/commands/runtime.js',
  ];
  const identities = Object.fromEntries(
    await Promise.all(
      identityFiles.map(async (f) => [f, hash(await fs.readFile(path.join(c.dist, f)))]),
    ),
  );
  await writeJson(path.join(evidenceRoot, 'baseline.json'), {
    schema: '052.classic.seed-baseline.v1',
    explicitlySimulatedAgentAndUser: true,
    realModelCalls: 0,
    transport: c.cli ? 'public-bin-cli' : 'public-command-handler',
    identities,
    run,
    checkA,
    checkB,
    counters: await counters(c),
    checkProgramSha256: hash(await fs.readFile(path.join(projectRoot, 'checks.mjs'))),
    report: await fs.readFile(path.join(projectRoot, c.reportRef), 'utf8'),
    design: await fs.readFile(path.join(projectRoot, c.designRef), 'utf8'),
    left: await fs.readFile(path.join(projectRoot, 'left.unknown'), 'utf8'),
    right: await fs.readFile(path.join(projectRoot, 'right.unknown'), 'utf8'),
    head: await git(c, 'rev-parse', 'HEAD'),
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'seed',
        fixture: path.join(evidenceRoot, 'fixture.json'),
        baseline: path.join(evidenceRoot, 'baseline.json'),
        projectRoot,
        identities,
        limits:
          'Seed simulates Agent/User through real public commands; zero model calls; direct handler transport is distinct from built bin CLI.',
      },
      null,
      2,
    ),
  );
  return c;
}
async function prepareEdits(c) {
  const before = await inspect(c);
  for (let n = 1; n <= 10; n++)
    await put(
      c.projectRoot,
      'left.unknown',
      `value=1\n# explanation save ${n}: value remains one\n`,
    );
  await fs.appendFile(
    path.join(c.projectRoot, c.designRef),
    '\nEditorial clarification: the trailing explanation lines document the same approved values.\n',
  );
  const after = await inspect(c);
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    'Saving files unexpectedly advanced the Run',
  );
  const proof = {
    schema: 'comet.052.edit.v1',
    hostObserved: true,
    workflow: 'classic',
    runId: c.name,
    round: 1,
    saves: 10,
    runUnchanged: true,
    leftHash: hash(await fs.readFile(path.join(c.projectRoot, 'left.unknown'))),
    designHash: hash(await fs.readFile(path.join(c.projectRoot, c.designRef))),
  };
  await writeJson(path.join(c.evidenceRoot, 'host-edit-observation.json'), proof);
  return proof;
}
async function recordSimulated(c, observed, label) {
  assert(observed.recordTemplate, `${label} missing recordTemplate`);
  const base = await readJson(path.join(c.evidenceRoot, 'baseline.json'));
  const f = path.join(c.transportRoot, `${label}-simulated-agent.json`);
  await writeJson(f, {
    ...observed.recordTemplate,
    decision: 'non-behavioral',
    summary:
      'DETERMINISTIC SIMULATION ONLY: the current Agent inspected exact original/current bytes and both command scopes. Only explanatory prose changed; values and requirements are unchanged. B reads independent unchanged right input; rerun A for current left bytes.',
    retainedCheckActionIds: [base.checkB.id],
  });
  return edit(c, 'record', { file: f });
}
async function negative(c, executeFile) {
  const original = await fs.readFile(path.join(c.projectRoot, 'left.unknown'));
  const before = await inspect(c),
    countBefore = await counters(c);
  let proof;
  const requestBytes = await fs.readFile(executeFile);
  const request = JSON.parse(requestBytes);
  assert(
    request.operation === 'execute' &&
      request.runId === c.name &&
      request.expectedRevision === before.revision &&
      request.executorId === 'comet-classic-check',
    'Negative control requires current seeded Run check execute request',
  );
  const pending = before.actions.find((a) => a.id === request.actionId);
  assert(
    pending?.status === 'pending' &&
      pending.ref === 'classic-check' &&
      before.commands?.some((cmd) => cmd.name === 'refresh-checks' && cmd.actionId === pending.id),
    'Negative control requires the pending refresh check Action',
  );
  const source = before.actions.find((a) => a.id === pending.input?.activation?.sourceActionId);
  assert(
    source?.stepId === 'full.verify.check' &&
      JSON.stringify(source.outcome?.output?.argv) === JSON.stringify(c.argvA),
    'Negative control requires refresh of original A',
  );
  assert(
    original.toString().startsWith('value=1\n'),
    'Negative control requires judged left value one',
  );
  const frozenRequest = path.join(c.transportRoot, `negative-frozen-${hash(requestBytes)}.json`);
  await fs.writeFile(frozenRequest, requestBytes);
  try {
    await put(c.projectRoot, 'left.unknown', original.toString().replace(/^value=1/, 'value=999'));
    const result = await invoke(c, 'runtime', [frozenRequest], {
      allowFailure: true,
      label: 'negative-control-fresh-input-before-execute',
    });
    assert(
      result.exitCode !== 0 && result.response?.status === 'failed',
      'Stale judgment accepted a new behavior change or transport failed without Runtime refusal',
    );
    assert(
      JSON.stringify(await counters(c)) === JSON.stringify(countBefore),
      'Rejected fresh input replayed a check',
    );
    const after = await inspect(c);
    assert(
      after.revision === before.revision,
      'Rejected fresh input unexpectedly claimed or advanced the Run',
    );
    assert(
      JSON.stringify(after.waits) === JSON.stringify(before.waits),
      'Rejected fresh input changed original approvals',
    );
    proof = {
      schema: 'comet.052.negative-control.v1',
      hostObserved: true,
      workflow: 'classic',
      runId: c.name,
      mutation: 'value=1 -> value=999 after judgment before execute',
      executeFile,
      executeRequestSha256: hash(requestBytes),
      actionId: request.actionId,
      result: { exitCode: result.exitCode, response: result.response },
      countBefore,
      countAfter: await counters(c),
      waitsUnchanged: true,
      revisionUnchanged: true,
      inputSha256: hash(original),
    };
  } finally {
    await fs.writeFile(path.join(c.projectRoot, 'left.unknown'), original);
  }
  assert(
    hash(await fs.readFile(path.join(c.projectRoot, 'left.unknown'))) === hash(original),
    'Exact input restoration failed',
  );
  proof.originalInputRestored = true;
  await writeJson(path.join(c.evidenceRoot, 'negative-control.json'), proof);
  return proof;
}
async function finish(c) {
  await classic(c, 'guard', c.name, 'archive', '--apply');
  await git(
    c,
    'add',
    '--',
    'openspec',
    c.designRef,
    c.planRef,
    c.reportRef,
    'left.unknown',
    'right.unknown',
    'checks.mjs',
  );
  await git(c, 'commit', '--quiet', '-m', 'Deliver isolated 052 Classic continuation');
  const commit = await git(c, 'rev-parse', 'HEAD');
  await classic(c, 'state', 'complete-delivery', c.name, '--commit', commit);
  await classic(c, 'state', 'delivery', c.name, '--verify');
  return commit;
}
async function deterministic(c) {
  await prepareEdits(c);
  const formal = await edit(c, 'prepare-applied', { session: c.session });
  assert(formal.proposal, 'Expected approved Design Doc edit');
  const claimed = formal.recordTemplate
    ? formal
    : await edit(c, 'judge', { session: c.session, proposalHash: formal.proposal.proposalHash });
  await recordSimulated(c, claimed, 'formal');
  const observed = await edit(c, 'observe', { session: c.session });
  await recordSimulated(c, observed, 'ordinary');
  assert(observed.observation.refreshInputTemplate, 'Missing current refresh template');
  const f = path.join(c.transportRoot, 'simulated-refresh.json');
  await writeJson(f, {
    ...observed.observation.refreshInputTemplate,
    summary:
      'DETERMINISTIC SIMULATION: supplement only A after explanation edits; retain B and original approvals.',
  });
  const refreshed = await edit(c, 'refresh-checks', { file: f });
  assert(refreshed.executeRequest, 'Refresh did not expose public execute request');
  const ef = path.join(c.transportRoot, 'refresh-execute.json');
  await writeJson(ef, refreshed.executeRequest);
  await negative(c, ef);
  await invoke(c, 'runtime', [ef], { label: 'execute-refresh-after-exact-input-restoration' });
  const count = await counters(c);
  await edit(c, 'refresh-checks', { file: f });
  assert(
    JSON.stringify(await counters(c)) === JSON.stringify(count),
    'Duplicate refresh replayed a check',
  );
  await writeJson(
    path.join(c.evidenceRoot, 'pre-archive-edit-reviews.json'),
    await edit(c, 'show'),
  );
  const commit = await finish(c);
  await writeJson(path.join(c.evidenceRoot, 'deterministic-result.json'), {
    explicitlySimulatedAgentAndUser: true,
    realModelCalls: 0,
    commit,
    counters: await counters(c),
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'deterministic-full',
        commit,
        counters: await counters(c),
        fixture: path.join(c.evidenceRoot, 'fixture.json'),
      },
      null,
      2,
    ),
  );
}
try {
  if (mode === 'seed') await seed();
  else if (mode === 'deterministic-full') {
    const c = o.config ? await readJson(o.config) : await seed();
    await deterministic(c);
  } else if (mode === 'prepare-edits') {
    const c = await readJson(o.config);
    console.log('COMET_052_EDIT_PROOF=' + JSON.stringify(await prepareEdits(c)));
  } else if (mode === 'negative-control') {
    const c = await readJson(o.config);
    const proof = await negative(c, o['execute-file']);
    console.log('COMET_052_NEGATIVE_CONTROL_PROOF=' + JSON.stringify(proof));
  } else if (mode === 'finish') {
    console.log(await finish(await readJson(o.config)));
  } else
    throw Error(
      'Modes: seed | deterministic-full | prepare-edits | negative-control | finish. Only deterministic-full submits simulated post-seed judgments.',
    );
} catch (e) {
  console.error(e.stack || e);
  process.exitCode = 1;
}
