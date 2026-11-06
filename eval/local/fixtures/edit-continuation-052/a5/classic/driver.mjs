import fs from 'node:fs/promises';
import path from 'node:path';
import {
  here,
  SCHEMA,
  assert,
  sha,
  digest,
  equal,
  config,
  readJson,
  processRun,
  inspect,
  cli,
  formalRefs,
  counters,
  inputHashes,
  cliIdentity,
  git,
  loadBaseline,
  assertOriginalRun,
  assertExpectedFiles,
  checkReceipts,
  judgment,
  proof,
  emit,
  runIdentity,
} from './common.mjs';

async function seed(c) {
  assert(
    typeof process.env.COMET_DATA_DIR === 'string' && process.env.COMET_DATA_DIR.length > 0,
    'The harness must provide its persistent COMET_DATA_DIR before seeding',
  );
  const original = path.resolve(here, '../original-a3/classic/driver.mjs');
  const result = await processRun(
    c,
    process.execPath,
    [original, 'seed', '--cli-root', c.cliRoot, '--root', c.root, '--evidence', c.evidence],
    240000,
  );
  assert(
    result.exitCode === 0,
    `Historical public CLI seed failed: ${result.stderr}\n${result.stdout}`,
  );
  const source = await readJson(path.join(c.evidence, 'baseline.json'));
  const fixture = await readJson(path.join(c.evidence, 'fixture.json'));
  assert(
    fixture.name === c.name &&
      fixture.cli === c.cli &&
      fixture.dataRoot === process.env.COMET_DATA_DIR &&
      equal(fixture.argvA, c.argvA) &&
      equal(fixture.argvB, c.argvB),
    'Historical fixture is not the fixed public CLI / persistent-volume setup',
  );
  const run = await inspect(c);
  assert(equal(run, source.run), 'Historical seed changed before the formal edit');
  assert(
    run.status === 'running' &&
      run.state.phase === 'archive' &&
      run.state.verifyResult === 'pass' &&
      run.state.archiveConfirmation === 'confirmed' &&
      !run.state.archived,
    'Seed must be accepted and locally approved, immediately before Archive',
  );
  assert(
    (await counters(c)).A === 1 && (await counters(c)).B === 1,
    'Historical seed must execute A and once-only B exactly once',
  );
  const originalFileHashes = await inputHashes(c);
  const [proposalRef, specRef] = formalRefs(c);
  const additions = {
    [proposalRef]:
      '\n## JSON export\nAdd a user-facing command `node export-values.mjs --format json`. It reads the existing left and right values and prints exactly one JSON line with numeric fields `left`, `right`, and `sum`; for the existing fixture this is {"left":1,"right":2,"sum":3}.\n',
    [specRef]:
      '\n### Requirement: Export values as JSON\nThe system SHALL provide `node export-values.mjs --format json` and emit exactly one JSON line with numeric fields left, right, and sum.\n\n#### Scenario: Export the existing values\n- **WHEN** a user runs `node export-values.mjs --format json` with left value one and right value two\n- **THEN** stdout is exactly {"left":1,"right":2,"sum":3} followed by a newline, the process exits successfully, and the existing value files remain unchanged\n',
  };
  const expectedFormal = {};
  const updatedText = {};
  const formalContext = {};
  for (const ref of formalRefs(c)) {
    const beforeText = await fs.readFile(path.join(c.root, ref), 'utf8');
    const afterText = beforeText + additions[ref];
    expectedFormal[ref] = { beforeHash: sha(beforeText), afterHash: sha(afterText) };
    updatedText[ref] = afterText;
    formalContext[ref] = {
      beforeText,
      afterText,
      beforeHash: sha(beforeText),
      afterHash: sha(afterText),
    };
  }
  const contextRef = '.git/052-a5-fixture-evidence/formal-edit-context.json';
  const contextBytes =
    JSON.stringify(
      { schema: `${SCHEMA}.formal-context.v1`, runId: c.name, files: formalContext },
      null,
      2,
    ) + '\n';
  await fs.writeFile(path.join(c.root, contextRef), contextBytes);
  const baseline = {
    schema: `${SCHEMA}.baseline.v1`,
    workflow: 'classic',
    runId: c.name,
    root: c.root,
    cliRoot: c.cliRoot,
    dataRoot: fixture.dataRoot,
    runHash: digest(run),
    originalRevision: run.revision,
    original: runIdentity(run),
    argvA: c.argvA,
    argvB: c.argvB,
    counts: await counters(c),
    originalFileHashes,
    expectedFormal,
    head: await git(c, 'rev-parse', 'HEAD'),
    formalContext: { ref: contextRef, sha256: sha(contextBytes) },
    originalChecks: await checkReceipts(c, run),
    cliIdentity: await cliIdentity(c),
    simulatedRoles: [
      'Historical Agent, independent Verifier and User decisions are deterministic seed setup only',
    ],
    expectedContext: {
      changedFiles: formalRefs(c),
      requestedFeature:
        'export-values.mjs --format json emits one JSON line with numeric left, right and sum',
      implementationUnchanged: true,
    },
  };
  for (const [ref, text] of Object.entries(updatedText))
    await fs.writeFile(path.join(c.root, ref), text);
  const after = await inspect(c);
  assertOriginalRun(after, baseline);
  await assertExpectedFiles(c, baseline);
  // The host freezes this actual tool output. Later validation never reads this local copy.
  await fs.writeFile(
    path.join(c.evidence, 'a5-baseline.json'),
    JSON.stringify(baseline, null, 2) + '\n',
  );
  return proof(c, 'seed', digest(baseline), {
    baseline,
    originalRunHash: baseline.runHash,
    afterEditRunHash: digest(after),
    simulatedRole: 'Deterministic historical Agent/Verifier/User seed only',
    realModelCalls: 0,
    editedFormalFiles: formalRefs(c),
  });
}

async function checkpoint(c) {
  const { baseline, baselineHash } = await loadBaseline(c, { allowLocalCheckpoint: true });
  const before = await inspect(c);
  assertOriginalRun(before, baseline);
  await assertExpectedFiles(c, baseline);
  await checkReceipts(c, before, baseline.originalChecks);
  const actual = await judgment(c, baseline);
  // Without --apply this public Guard checks readiness and returns before either executor.
  const guard = await cli(c, ['classic', 'guard', c.name, 'archive', '--json'], true);
  assert(
    guard.exitCode === 1 && guard.data?.checks?.blocked === true && guard.data.checks.passed === 0,
    'Public Archive readiness must refuse the unapproved formal change',
  );
  assert(
    /requirements-changed/.test(JSON.stringify(guard.data.issues)),
    'Archive must be blocked by the actual semantic judgment, not a transport or unrelated error',
  );
  const after = await inspect(c);
  assertOriginalRun(after, baseline);
  assert(digest(before) === digest(after), 'Readiness inspection mutated the Run');
  await assertExpectedFiles(c, baseline);
  return proof(c, 'checkpoint', baselineHash, {
    passed: true,
    readOnly: true,
    simulatedRole: null,
    runHash: digest(after),
    beforeRevision: before.revision,
    afterRevision: after.revision,
    judgment: actual.reviews,
    judgmentHash: digest(actual.reviews),
    continuation: actual.continuation,
    actualCounters: await counters(c),
    currentFileHashes: await inputHashes(c),
    guard: {
      argv: ['classic', 'guard', c.name, 'archive', '--json'],
      exitCode: guard.exitCode,
      data: {
        checks: guard.data.checks,
        issues: guard.data.issues,
        continuation: guard.data.continuation,
      },
      stderr: guard.stderr,
    },
    boundary:
      'Public Archive readiness preview only; no Archive executor and no new Runtime Action',
  });
}

try {
  const [mode, ...args] = process.argv.slice(2);
  assert(['seed', 'checkpoint', 'validate'].includes(mode), 'Modes: seed | checkpoint | validate');
  const c = config(args);
  const result =
    mode === 'seed'
      ? await seed(c)
      : mode === 'checkpoint'
        ? await checkpoint(c)
        : await (await import('./validator.mjs')).validate(c);
  emit(mode, result);
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
