import '../../helpers/isolated-agent-home.js';
import { nativePreferredChangeRuntimeDir } from '../../../domains/comet-native/native-paths.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { archiveNativePortableChange } from '../../../domains/comet-native/native-portable-archive.js';

import { Lexer } from 'marked';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNativePortableAcceptance } from '../../../domains/comet-native/native-portable-requirements.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';

import {
  confirmNativePortableShape as confirmNativePortableShapeAtBoundary,
  createNativePortableChange,
  dispatchNativePortableVerifier,
  isNativePortableChange,
  nativePortableChangeDir,
  nativePortableStateFile,
  prepareNativePortableShapeConfirmation,
  readNativePortableChange,
  recordNativePortableVerifierFailure,
  returnNativePortableChangeToShape,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';

function passedReview(reviewerExecutionRef: string) {
  return {
    status: 'passed' as const,
    summary: 'Independent read-only review passed.',
    reviewerExecutionRef,
  };
}

describe('Native portable Runtime vertical path', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-portable-runtime-'));
    await fs.mkdir(path.join(root, '.git'));
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, {
      ...config,
      native: { ...config.native, document_writes: 'revert' },
    });
    paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('bounds portable names, state discovery, and initial project configuration', async () => {
    expect(() => nativePortableChangeDir(paths, '../escape')).toThrow('Invalid Native change name');
    await expect(isNativePortableChange(paths, 'missing')).resolves.toBe(false);

    await createNativePortableChange({
      paths,
      name: 'discovery-branches',
      language: 'en',
      initialProjectConfig: defaultProjectConfig('docs', 'en'),
    });
    expect(await fs.readFile(paths.configFile, 'utf8')).toContain('artifact_root');
    await expect(isNativePortableChange(paths, 'discovery-branches')).resolves.toBe(true);

    const stateFile = nativePortableStateFile(paths, 'discovery-branches');
    await fs.writeFile(stateFile, 'not a Native state');
    await expect(isNativePortableChange(paths, 'discovery-branches')).resolves.toBe(false);
    await fs.rm(stateFile);
    await fs.mkdir(stateFile);
    await expect(isNativePortableChange(paths, 'discovery-branches')).rejects.toMatchObject({
      code: expect.any(String),
    });
    await fs.rm(stateFile, { recursive: true });

    await expect(
      createNativePortableChange({ paths, name: 'bad_name', language: 'en' }),
    ).rejects.toThrow('Invalid Native change name');
  });

  it('discovers proposed and modified capabilities while ignoring non-directories', async () => {
    await createNativePortableChange({
      paths,
      name: 'discovery',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, 'discovery');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The discovered capability is valid.\n',
    );
    await fs.writeFile(path.join(changeDir, 'specs', 'README.md'), 'ignored');
    await fs.mkdir(path.join(changeDir, 'specs', 'new-capability'));
    await fs.writeFile(
      path.join(changeDir, 'specs', 'new-capability', 'spec.md'),
      '# Requirement\nThe new capability works.\n',
    );
    await fs.mkdir(path.join(paths.specsDir, 'existing-capability'), {
      recursive: true,
    });
    await fs.writeFile(path.join(paths.specsDir, 'existing-capability', 'spec.md'), 'old');
    await fs.mkdir(path.join(changeDir, 'specs', 'existing-capability'));
    await fs.writeFile(
      path.join(changeDir, 'specs', 'existing-capability', 'spec.md'),
      '# Requirement\nThe existing capability works.\n',
    );

    await expect(confirmNativePortableShape({ paths, name: 'discovery' })).resolves.toMatchObject({
      spec_changes: [
        { capability: 'existing-capability', operation: 'modify' },
        { capability: 'new-capability', operation: 'create' },
      ],
    });
  });

  it('rejects an invalid proposed capability while preparing Shape confirmation', async () => {
    await createNativePortableChange({
      paths,
      name: 'invalid-capability',
      language: 'en',
    });
    const invalidDir = nativePortableChangeDir(paths, 'invalid-capability');
    await fs.writeFile(
      path.join(invalidDir, 'brief.md'),
      '# Acceptance examples\n- The invalid capability is rejected.\n',
    );
    await fs.mkdir(path.join(invalidDir, 'specs', 'bad_name'));
    await expect(
      prepareNativePortableShapeConfirmation({
        paths,
        name: 'invalid-capability',
      }),
    ).rejects.toThrow('Invalid Native capability');
  });

  it('persists the Shape confirmation boundary and rejects blockers or early confirmation', async () => {
    await createNativePortableChange({
      paths,
      name: 'shape-boundary',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, 'shape-boundary');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The confirmation boundary is persisted.\n',
    );

    await expect(
      confirmNativePortableShapeAtBoundary({ paths, name: 'shape-boundary' }),
    ).rejects.toThrow('persisted user confirmation boundary');

    const waiting = await prepareNativePortableShapeConfirmation({
      paths,
      name: 'shape-boundary',
      expectedContinuation: {
        stateVersion: 1,
        action: 'prepare-shape-confirmation',
      },
    });
    expect(waiting).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      state_version: 2,
      loop: { stage: 'await-user', next_action: 'confirm-shape' },
      acceptance: [{ id: 'A1', result: 'pending' }],
    });

    await expect(
      confirmNativePortableShapeAtBoundary({
        paths,
        name: 'shape-boundary',
        expectedContinuation: { stateVersion: 1, action: 'confirm-shape' },
      }),
    ).rejects.toThrow('Native continuation is stale');

    await expect(
      confirmNativePortableShapeAtBoundary({
        paths,
        name: 'shape-boundary',
        expectedContinuation: { stateVersion: 2, action: 'confirm-shape' },
      }),
    ).resolves.toMatchObject({
      phase: 'build',
      status: 'active',
      state_version: 3,
    });
  });

  it('keeps Shape confirmation valid across newline and trailing-whitespace normalization', async () => {
    await createNativePortableChange({
      paths,
      name: 'normalized-shape-context',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, 'normalized-shape-context');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Scope\n- Stable scope.\n\n# Acceptance examples\n- The behavior is accepted.\n',
    );
    await prepareNativePortableShapeConfirmation({
      paths,
      name: 'normalized-shape-context',
    });

    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Scope  \r\n- Stable scope.\t\r\n\r\n# Acceptance examples\r\n- The behavior is accepted.  \r\n\r\n',
    );

    await expect(
      confirmNativePortableShapeAtBoundary({
        paths,
        name: 'normalized-shape-context',
      }),
    ).resolves.toMatchObject({ phase: 'build', status: 'active' });
  });

  it('clears stale Supervisor coordination before confirming an ordinary Shape', async () => {
    execFileSync('git', ['-C', root, 'init', '-b', 'master'], {
      stdio: 'ignore',
    });
    await fs.writeFile(path.join(root, 'baseline.txt'), 'baseline\n');
    execFileSync('git', ['-C', root, 'add', 'baseline.txt'], {
      stdio: 'ignore',
    });
    execFileSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.com',
        'commit',
        '-m',
        'baseline',
      ],
      { stdio: 'ignore' },
    );
    execFileSync('git', ['-C', root, 'switch', '-c', 'parent'], {
      stdio: 'ignore',
    });
    await createNativePortableChange({
      paths,
      name: 'reduced-supervisor',
      language: 'en',
      workspaceBinding: {
        isolation: 'branch',
        changeBranch: 'parent',
        targetBranch: 'master',
      },
    });
    const changeDir = nativePortableChangeDir(paths, 'reduced-supervisor');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Scope\n- Original scope.\n\n# Acceptance examples\n- The first behavior is visible.\n- The second behavior is visible.\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'children.yaml'),
      `schema: comet.native.children.v2
acceptance_index:
  A1:
    source: brief.md
    text: The first behavior is visible.
  A2:
    source: brief.md
    text: The second behavior is visible.
children:
  - name: first-child
    depends_on: []
    covers: [A1]
  - name: second-child
    depends_on: []
    covers: [A2]
`,
    );
    await prepareNativePortableShapeConfirmation({
      paths,
      name: 'reduced-supervisor',
      coordinationMode: 'multi-session',
    });
    const building = await confirmNativePortableShapeAtBoundary({
      paths,
      name: 'reduced-supervisor',
    });
    expect(building.coordination_mode).toBe('multi-session');

    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Scope\n- Reduced to an ordinary change.\n\n# Acceptance examples\n- The first behavior is visible.\n- The second behavior is visible.\n',
    );
    await fs.rm(path.join(changeDir, 'children.yaml'));
    await returnNativePortableChangeToShape({
      paths,
      name: 'reduced-supervisor',
      reason: 'The Agent explicitly revises this to an ordinary plan.',
      allowedPhases: ['build'],
    });

    const waiting = await prepareNativePortableShapeConfirmation({
      paths,
      name: 'reduced-supervisor',
    });
    expect(waiting.coordination_mode).toBeUndefined();
    await expect(
      confirmNativePortableShapeAtBoundary({
        paths,
        name: 'reduced-supervisor',
      }),
    ).resolves.toMatchObject({ phase: 'build', status: 'active' });
  });

  it.each([
    'https://example.com/spec',
    'http://example.com/spec',
    'www.example.com',
    '<https://example.com/spec>',
    'reader@example.com',
  ])('derives unchanged acceptance across parser metadata for %s', async (link) => {
    await createNativePortableChange({
      paths,
      name: 'autolink',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, 'autolink');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Scope\nSee ${link}.\n# Acceptance examples\n- Follow the reference.\n`,
    );
    await fs.mkdir(path.join(changeDir, 'specs/links'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs/links/spec.md'),
      `# Links\nReference: ${link}.\n`,
    );
    const state = {
      ...(await readNativePortableChange(paths, 'autolink')),
      document_constraints_version: 3 as const,
    };
    const options = {
      paths,
      state,
      specChanges: [{ capability: 'links', source: 'specs/links/spec.md' }],
    };
    const original = await readNativePortableAcceptance(options);
    const lex = Lexer.prototype.blockTokens;
    let links = 0;
    const addMetadata = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(addMetadata);
      else if (value && typeof value === 'object') {
        const token = value as Record<string, unknown>;
        if (token.type === 'link') {
          token.autolink = true;
          token.parserMetadata = 'new-version';
          links++;
        }
        Object.values(token).forEach(addMetadata);
      }
    };
    const spy = vi.spyOn(Lexer.prototype, 'blockTokens').mockImplementation(function (
      this: Lexer,
      ...args
    ) {
      const tokens = lex.apply(this, args);
      // 在实际块级入口注入行内元数据，继续验证这些字段不会改变验收。
      for (const token of tokens) {
        if (token.type === 'paragraph') token.tokens = Lexer.lexInline(token.text);
      }
      addMetadata(tokens);
      return tokens;
    });
    try {
      expect(await readNativePortableAcceptance(options)).toEqual(original);
      expect(links).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('confirms formal Markdown larger than the retired four-megabyte budget', async () => {
    await createNativePortableChange({
      paths,
      name: 'large-formal-doc',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, 'large-formal-doc');
    const padding = 'x'.repeat(4 * 1024 * 1024 + 1_024);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Acceptance examples\n- The large formal document remains valid.\n\n# Notes\n<!-- ${padding} -->\n`,
    );

    await expect(
      confirmNativePortableShape({ paths, name: 'large-formal-doc' }),
    ).resolves.toMatchObject({
      phase: 'build',
      acceptance: [{ id: 'A1', text: 'The large formal document remains valid.' }],
    });
  });

  it('keeps v2 child plans readable while retaining the complete Runtime acceptance matrix', async () => {
    execFileSync('git', ['-C', root, 'init', '-b', 'master'], {
      stdio: 'ignore',
    });
    await fs.writeFile(path.join(root, 'baseline.txt'), 'baseline\n');
    execFileSync('git', ['-C', root, 'add', 'baseline.txt'], {
      stdio: 'ignore',
    });
    execFileSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.com',
        'commit',
        '-m',
        'baseline',
      ],
      { stdio: 'ignore' },
    );
    execFileSync('git', ['-C', root, 'switch', '-c', 'parent'], {
      stdio: 'ignore',
    });
    await createNativePortableChange({
      paths,
      name: 'readable-child-plan',
      language: 'en',
      workspaceBinding: {
        isolation: 'branch',
        changeBranch: 'parent',
        targetBranch: 'master',
      },
    });
    const changeDir = nativePortableChangeDir(paths, 'readable-child-plan');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The first behavior is visible.\n- The second behavior is visible.\n',
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'demo'));
    await fs.writeFile(
      path.join(changeDir, 'specs', 'demo', 'spec.md'),
      '# Requirement: Demo\nThe Runtime MUST preserve the formal requirement.\n\n## Scenarios\n### Scenario: Formal behavior\n- **WHEN** the behavior is exercised\n- **THEN** the formal result is retained\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'children.yaml'),
      `schema: comet.native.children.v2
acceptance_index:
  A1:
    source: brief.md
    text: The first behavior is visible.
  A2:
    source: brief.md
    text: The second behavior is visible.
children:
  - name: demo-child
    depends_on: []
    covers: [A1, A2]
`,
    );
    const state = await confirmNativePortableShape({
      paths,
      name: 'readable-child-plan',
    });

    expect(state.acceptance.length).toBeGreaterThan(2);
    expect(state.acceptance.filter(({ source }) => source === 'brief.md')).toHaveLength(2);
    expect(state.children_contract_ref).toEqual(expect.any(String));
  });

  it('rejects multi-child Supervisor Shape confirmation without a coordination mode', async () => {
    for (const args of [
      ['init', '-b', 'master'],
      ['config', 'user.name', 'SIMULATED Fixture'],
      ['config', 'user.email', 'fixture@example.invalid'],
      ['config', 'commit.gpgsign', 'false'],
      ['commit', '--allow-empty', '-m', 'SIMULATED fixture baseline'],
      ['switch', '-c', 'parent'],
    ])
      execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    await createNativePortableChange({
      paths,
      name: 'coordination-required',
      language: 'en',
      workspaceBinding: {
        isolation: 'branch',
        changeBranch: 'parent',
        targetBranch: 'master',
      },
    });
    const changeDir = nativePortableChangeDir(paths, 'coordination-required');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The first behavior is visible.\n- The second behavior is visible.\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'children.yaml'),
      `schema: comet.native.children.v2
acceptance_index:
  A1:
    source: brief.md
    text: The first behavior is visible.
  A2:
    source: brief.md
    text: The second behavior is visible.
children:
  - name: first-child
    depends_on: []
    covers: [A1]
  - name: second-child
    depends_on: []
    covers: [A2]
`,
    );
    const stateFile = nativePortableStateFile(paths, 'coordination-required');
    await prepareNativePortableShapeConfirmation({
      paths,
      name: 'coordination-required',
    });
    const initialState = await fs.readFile(stateFile, 'utf8');

    await expect(
      confirmNativePortableShapeAtBoundary({
        paths,
        name: 'coordination-required',
      }),
    ).rejects.toThrow(
      'Native Supervisor Shape requires --coordination-mode multi-session or single-session',
    );
    expect(await fs.readFile(stateFile, 'utf8')).toBe(initialState);
  });

  it('rejects a late host response without charging the current Verifier attempt', async () => {
    await createNativePortableChange({
      paths,
      name: 'late-host-response',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, 'late-host-response');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- Late Verifier responses cannot mutate the current attempt.\n',
    );
    let state = await confirmNativePortableShape({
      paths,
      name: 'late-host-response',
    });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'late-builder',
        }),
        candidateId: 'late-candidate',
        summary: 'Implemented.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        review: passedReview('late-reviewer'),
      },
    });

    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      verifierExecutionId: 'late-verifier-1',
    });
    state = await recordNativePortableVerifierFailure({
      paths,
      name: state.name,
      summary: 'First execution ended before producing a result.',
      expected: {
        stateVersion: state.state_version,
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verifierExecutionRef: 'late-verifier-1',
      },
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      verifierExecutionId: 'late-verifier-2',
    });
    const before = state;

    await expect(
      submitNativePortableVerifierResult({
        paths,
        name: state.name,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'late-candidate',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'late-verifier-1',
          }),
          payload: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Late result.' }],
              risks: [],
              summary: 'Late result.',
            },
          },
        }),
      }),
    ).rejects.toThrow('current candidate and task');
    const after = await readNativePortableChange(paths, state.name);
    expect(after.state_version).toBe(before.state_version);
    expect(after.loop.execution_failure_count).toBe(before.loop.execution_failure_count);
    expect(after.loop.attempt).toBe(2);
  });

  it('creates only portable user artifacts without a local execution overlay', async () => {
    const name = 'small-change';
    await createNativePortableChange({ paths, name, language: 'en' });
    expect((await fs.readdir(nativePortableChangeDir(paths, name))).sort()).toEqual([
      'brief.md',
      'comet-state.yaml',
      'specs',
    ]);
    await expect(
      fs.stat(path.join(nativePreferredChangeRuntimeDir(paths, name), 'state.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const allFiles = await fs.readdir(root, { recursive: true });
    expect(allFiles.join('\n')).not.toMatch(
      /baseline|snapshot|trajectory|checkpoint|receipt|evidence|run-state/iu,
    );
  });
  it('does not infer that an external Verifier ended when its dispatch process exits', async () => {
    const name = 'platform-task-stays-active';
    await createNativePortableChange({ paths, name, language: 'en' });
    await fs.writeFile(
      path.join(nativePortableChangeDir(paths, name), 'brief.md'),
      '# Acceptance examples\n- An unrelated launcher exit must not finish the task.\n',
    );
    let state = await confirmNativePortableShape({ paths, name });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'SIMULATED Agent',
          executionRef: 'SIMULATED builder',
        }),
        candidateId: 'candidate',
        summary: 'SIMULATED implemented',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        review: passedReview('SIMULATED reviewer'),
      },
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name,
      verifierExecutionId: 'SIMULATED independent verifier',
    });
    const before = await fs.readFile(nativePortableStateFile(paths, name));
    execFileSync(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    const result = await runNativeCli(['next', name, '--project-root', root, '--json']);
    expect(result.exitCode, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout!).data.continuation.action).toBe('await-verifier');
    expect(await fs.readFile(nativePortableStateFile(paths, name))).toEqual(before);
    expect((await readNativePortableChange(paths, name)).verifier_action).toEqual(
      state.verifier_action,
    );
  });
  it('accepts a trusted complete platform Verifier result and writes its report only before explicit current user acceptance', async () => {
    const name = 'verify-change';
    await createNativePortableChange({ paths, name, language: 'en' });
    const dir = nativePortableChangeDir(paths, name);
    await fs.writeFile(
      path.join(dir, 'brief.md'),
      '# Acceptance examples\n- The command prints ready.\n',
    );
    let state = await confirmNativePortableShape({ paths, name });
    const runner = createNativeRunnerChannel();
    const observed = execFileSync(process.execPath, ['-e', "console.log('ready')"], {
      encoding: 'utf8',
    });
    expect(observed.trim()).toBe('ready');
    state = await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'SIMULATED Agent',
          executionRef: 'builder-1',
        }),
        candidateId: 'candidate-1',
        summary: 'SIMULATED implemented',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [
          {
            name: 'Actual ordinary Node command',
            result: 'passed',
            note: 'Agent observed ready',
          },
        ],
        review: passedReview('reviewer-1'),
      },
    });
    await expect(archiveNativePortableChange({ paths, name })).rejects.toThrow('not archive-ready');
    state = await dispatchNativePortableVerifier({
      paths,
      name,
      verifierExecutionId: 'verifier-1',
    });
    const payload = {
      kind: 'final-result',
      result: {
        iteration: 1,
        attempt: 1,
        verdict: 'pass',
        acceptance: [
          {
            id: 'A1',
            result: 'passed',
            reason: 'SIMULATED independent reviewer observed ready',
          },
        ],
        risks: [],
        summary: 'SIMULATED trusted full review',
      },
    };
    const before = await fs.readFile(nativePortableStateFile(paths, name));
    await expect(
      submitNativePortableVerifierResult({
        paths,
        name,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'candidate-1',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'SIMULATED Agent',
            executionRef: 'builder-1',
          }),
          payload,
        }),
      }),
    ).rejects.toThrow();
    expect(await fs.readFile(nativePortableStateFile(paths, name))).toEqual(before);
    const submitted = await submitNativePortableVerifierResult({
      paths,
      name,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: 'candidate-1',
        identity: runner.captureExecutionIdentity({
          identityProvider: 'SIMULATED Agent',
          executionRef: 'verifier-1',
        }),
        payload,
      }),
    });
    expect(submitted.state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
    });
    await expect(archiveNativePortableChange({ paths, name })).rejects.toThrow('not archive-ready');
    expect(await fs.readFile(path.join(dir, 'verification.md'), 'utf8')).toContain(
      'generated_from_state_version:',
    );
    const accepted = await runNativeCli([
      'next',
      name,
      '--accept-result',
      '--summary',
      'SIMULATED USER accepts the current result',
      '--expected-state-version',
      String(submitted.state.state_version),
      '--expected-action',
      'accept-result',
      '--project-root',
      root,
      '--json',
    ]);
    expect(accepted.exitCode, accepted.stdout).toBe(0);
    expect((await readNativePortableChange(paths, name)).phase).toBe('archive');
  });
});
