import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

import { afterEach, describe, expect, it } from 'vitest';

import { nativeArchiveCommand } from '../../../domains/comet-native/native-archive-command.js';
import {
  inspectNativeChildren,
  parseNativeChildrenContract,
} from '../../../domains/comet-native/native-children.js';
import {
  defaultProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { nativeNewCommand } from '../../../domains/comet-native/native-new-command.js';
import { nativeNextCommand } from '../../../domains/comet-native/native-next-command.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  confirmNativePortableSkillCoordinatedPass,
  dispatchNativePortableVerifier,
  nativePortableChangeDir,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { inspectNativePortableStatus } from '../../../domains/comet-native/native-portable-status.js';
import type {
  NativePortableAcceptanceState,
  NativePortableState,
} from '../../../domains/comet-native/native-portable-types.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import { nativeShowCommand } from '../../../domains/comet-native/native-show-command.js';
import {
  assertChildDependenciesIntegrated,
  createNativeSupervisorState,
  createNativeSupervisorTask,
  reconcileNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor-model.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor-state.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';
import { ensureCometProjectGitignore } from '../../../domains/workflow-contract/project-gitignore.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';

async function guardedShapeConfirmationArgs(
  paths: NativeProjectPaths,
  name: string,
  summary: string,
): Promise<string[]> {
  const state = await readNativePortableChange(paths, name);
  return [
    name,
    '--summary',
    summary,
    '--confirmed',
    '--expected-state-version',
    String(state.state_version),
    '--expected-action',
    'confirm-shape',
  ];
}

const PARENT_BRIEF = `# Outcome
Integrate the child changes into one verified result.

# Scope
Coordinate the child changes and verify the integrated result.

## Directory structure
### Created
None.
### Modified
None.
### Deleted
None.
### Not created
None.

# Non-goals
Do not introduce behavior outside the child changes.

# Acceptance examples
- The integrated result contains the first behavior.
- The integrated result contains the second behavior.

# Constraints and invariants
Every child result remains independently traceable.

# Decisions
No product behavior change: this fixture validates Supervisor coordination only.

# Open questions
None.

# Verification expectations
Run the focused Supervisor coordination checks.
`;

const CHILD_BRIEF = `# Outcome
Implement one independently verified child result.

# Scope
Implement the assigned child behavior and its checks.

## Directory structure
### Created
None.
### Modified
None.
### Deleted
None.
### Not created
None.

# Non-goals
Do not change unrelated capabilities.

# Acceptance examples
- The child implementation is present on its branch.

# Constraints and invariants
The child remains independently verifiable.

# Decisions
No product behavior change: this fixture validates child coordination only.

# Open questions
None.

# Verification expectations
Run the focused child checks.
`;

const CHILDREN = `schema: comet.native.children.v1
children:
  - name: child-a
    depends_on: []
    covers: [A1]
  - name: child-b
    depends_on: [child-a]
    covers: [A2]
  - name: child-c
    depends_on: []
    covers: [A1]
`;

const READABLE_CHILDREN = `schema: comet.native.children.v2
acceptance_index:
  A1:
    source: brief.md
    text: The integrated result contains the first behavior.
  A2:
    source: brief.md
    text: The integrated result contains the second behavior.
children:
  - name: child-a
    depends_on: []
    covers: [A1]
  - name: child-b
    depends_on: [child-a]
    covers: [A2]
`;

const REORDERED_CHILDREN = `schema: comet.native.children.v1
children:
  - name: child-a
    depends_on: []
    covers: [A1]
  - name: child-c
    depends_on: []
    covers: [A1]
  - name: child-b
    depends_on: [child-a]
    covers: [A2]
`;

interface CommandData {
  state?: NativePortableState;
  preparation?: { projectRoot?: string };
  children?: Array<{ name: string; status: string }>;
  readyChildren?: string[];
  continuation?: {
    action?: string;
    commandArgs?: string[] | null;
    requiredInputs?: string[];
    runnerAction?: { kind?: string } | null;
  };
  archiveDir?: string;
  workspaceFinishResult?: { merged?: boolean } | null;
  healthy?: boolean;
  findings?: Array<{ code: string; message: string }>;
}

function git(projectRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function data(result: { data?: unknown }): CommandData {
  return (result.data ?? {}) as CommandData;
}

async function verifyChild(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<NativePortableState> {
  const { paths } = options;
  const { name } = options.state;
  const candidateId = `${name}-candidate`;
  const runner = createNativeRunnerChannel();
  await submitNativePortableBuilderCandidate({
    paths,
    name,
    input: {
      identity: runner.captureExecutionIdentity({
        identityProvider: 'test-host',
        executionRef: `${name}-builder`,
      }),
      candidateId,
      summary: 'Implemented the child behavior.',
      addressedAcceptanceIds: options.state.acceptance.map(({ id }) => id),
      acceptanceReview: fixtureAcceptanceReview(options.state.acceptance.map(({ id }) => id)),
      review: {
        status: 'passed',
        summary: 'Independent child review passed.',
        reviewerExecutionRef: `${name}-reviewer`,
      },
    },
  });
  const checkOutput = execFileSync(
    process.execPath,
    ['-e', 'console.log("Actual child platform check passed")'],
    { cwd: paths.projectRoot, encoding: 'utf8' },
  );
  expect(checkOutput).toContain('Actual child platform check passed');
  const dispatched = await dispatchNativePortableVerifier({
    paths,
    name,
  });
  await submitNativePortableVerifierResult({
    paths,
    name,
    maxVerifyFailures: 3,
    envelope: runner.envelopeVerifierResponse({
      candidateId,
      identity: runner.captureExecutionIdentity({
        identityProvider: 'test-host',
        executionRef: `${name}-verifier`,
      }),
      payload: {
        kind: 'final-result',
        result: {
          iteration: dispatched.loop.iteration,
          attempt: dispatched.loop.attempt,
          verdict: 'pass',
          acceptance: dispatched.acceptance.map(({ id }) => ({
            id,
            result: 'passed',
            reason: 'Verified in the child worktree.',
          })),
          risks: [],
          summary: 'The child acceptance criteria passed.',
        },
      },
    }),
  });
  return confirmNativePortableSkillCoordinatedPass({ paths, name });
}

describe('Native parent and child changes', () => {
  const repositories: string[] = [];
  const linkedWorktrees: Array<{ repository: string; root: string }> = [];

  afterEach(async () => {
    for (const { repository, root } of linkedWorktrees.splice(0).reverse()) {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', root], {
          cwd: repository,
          stdio: 'ignore',
        });
      } catch {
        // Preserve the assertion failure instead of replacing it with cleanup noise.
      }
      await fs.rm(root, { recursive: true, force: true });
    }
    await Promise.all(
      repositories
        .splice(0)
        .map((repository) => fs.rm(repository, { recursive: true, force: true })),
    );
  });

  it('validates declared dependency structure while allowing parent-only acceptance', () => {
    const acceptance: NativePortableAcceptanceState[] = [
      {
        id: 'A1',
        source: 'brief.md',
        text: 'First behavior.',
        result: 'pending',
      },
      {
        id: 'A2',
        source: 'brief.md',
        text: 'Second behavior.',
        result: 'pending',
      },
    ];
    const parsed = parseNativeChildrenContract(
      CHILDREN,
      acceptance.map(({ id }) => id),
    );
    const reformatted = parseNativeChildrenContract(
      `# Formatting and key order are not contract semantics.
schema: comet.native.children.v1
children:
  - covers:
      - A1
    name: child-a
    depends_on: []
  - covers: [A2]
    depends_on: [child-a, child-a]
    name: child-b
  - depends_on: []
    covers: [A1]
    name: child-c
`,
      acceptance.map(({ id }) => id),
    );

    expect(parsed.children.map(({ name }) => name)).toEqual(['child-a', 'child-b', 'child-c']);
    expect(reformatted.children[1].depends_on).toEqual(['child-a']);
    expect(() =>
      parseNativeChildrenContract(
        CHILDREN.replace('covers: [A2]', 'covers: [A1]'),
        acceptance.map(({ id }) => id),
      ),
    ).not.toThrow();
    const invalidContracts = [
      {
        source: CHILDREN.replace('name: child-b', 'name: child-a'),
        message: /names must be unique/iu,
      },
      {
        source: CHILDREN.replace('depends_on: [child-a]', 'depends_on: [missing]'),
        message: /depends on unknown child/iu,
      },
      {
        source: CHILDREN.replace(
          'depends_on: []\n    covers: [A1]',
          'depends_on: [child-b]\n    covers: [A1]',
        ),
        message: /dependency cycle/iu,
      },
      {
        source: CHILDREN.replace('covers: [A2]', 'covers: [A3]'),
        message: /unknown acceptance/iu,
      },
    ];
    for (const invalid of invalidContracts) {
      expect(() =>
        parseNativeChildrenContract(
          invalid.source,
          acceptance.map(({ id }) => id),
        ),
      ).toThrow(invalid.message);
    }
  });

  it('parses children.v2 summaries without acceptance ownership fields', () => {
    const parsed = parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: integration-core
    summary: Owns the parent integration branch.
    depends_on: []
  - name: dashboard
    summary: Connects the read-only status view.
    depends_on: [integration-core]
`);

    expect(parsed).toEqual({
      schema: 'comet.native.children.v2',
      children: [
        {
          name: 'integration-core',
          summary: 'Owns the parent integration branch.',
          depends_on: [],
          covers: [],
        },
        {
          name: 'dashboard',
          summary: 'Connects the read-only status view.',
          depends_on: ['integration-core'],
          covers: [],
        },
      ],
    });
  });

  it('accepts a readable v2 acceptance index while retaining the v1 contract', () => {
    const acceptance = [
      {
        id: 'A1',
        source: 'brief.md',
        text: 'The integrated result contains the first behavior.',
      },
      {
        id: 'A2',
        source: 'brief.md',
        text: 'The integrated result contains the second behavior.',
      },
    ];

    expect(
      parseNativeChildrenContract(
        READABLE_CHILDREN,
        acceptance.map(({ id }) => id),
      ),
    ).toEqual(
      expect.objectContaining({
        schema: 'comet.native.children.v2',
        acceptance_index: {
          A1: { source: acceptance[0].source, text: acceptance[0].text },
          A2: { source: acceptance[1].source, text: acceptance[1].text },
        },
      }),
    );
    expect(
      parseNativeChildrenContract(
        CHILDREN,
        acceptance.map(({ id }) => id),
      ),
    ).toMatchObject({
      schema: 'comet.native.children.v1',
    });
  });

  it('derives referenced v2 acceptance from the current catalog without copying its text', () => {
    const source =
      'schema: comet.native.children.v2\nchildren:\n  - name: first\n    depends_on: []\n    covers: [A1]\n  - name: second\n    depends_on: [first]\n    covers: [A2]\n';
    const acceptanceCatalog = [
      { id: 'A1', source: 'brief.md', text: 'First approved behavior.' },
      { id: 'A2', source: 'brief.md', text: 'Second approved behavior.' },
      {
        id: 'A3',
        source: 'specs/demo/spec.md',
        text: 'Not authorized for a repair child.',
      },
    ];
    const options = { acceptanceCatalog, requiredAcceptanceIds: ['A1', 'A2'] };
    expect(parseNativeChildrenContract(source, ['A1', 'A2'], options).acceptance_index).toEqual({
      A1: { source: 'brief.md', text: 'First approved behavior.' },
      A2: { source: 'brief.md', text: 'Second approved behavior.' },
    });
    expect(() =>
      parseNativeChildrenContract(
        source.replace('covers: [A2]', 'covers: [A3]'),
        ['A1', 'A2'],
        options,
      ),
    ).toThrow(/acceptance|coverage/iu);
    expect(() => parseNativeChildrenContract(source, ['A1', 'A2'])).toThrow(/catalog|summary/iu);
    expect(
      parseNativeChildrenContract(source, ['A1', 'A2'], {
        ...options,
        acceptanceCatalog: [
          {
            ...acceptanceCatalog[0],
            text: 'Changed behavior requires a new Shape.',
          },
          acceptanceCatalog[1],
        ],
      }).acceptance_index?.A1.text,
    ).toBe('Changed behavior requires a new Shape.');
  });

  it('rejects mixed v2 child-plan variants with an actionable format error', () => {
    const indexedWithSummary = READABLE_CHILDREN.replace(
      'depends_on: []\n    covers: [A1]',
      'summary: Owns the first behavior.\n    depends_on: []',
    );
    expect(() => parseNativeChildrenContract(indexedWithSummary, ['A1', 'A2'])).toThrow(
      /indexed v2 child .*fields are invalid: missing covers; unexpected summary; expected name, depends_on, covers/iu,
    );

    const summaryWithCovers = `
schema: comet.native.children.v2
children:
  - name: integration-core
    summary: Owns the parent integration branch.
    depends_on: []
    covers: [A1]
    `;
    expect(() => parseNativeChildrenContract(summaryWithCovers)).toThrow(
      /summary v2 child .*fields are invalid: unexpected covers; expected name, summary, depends_on/iu,
    );
  });

  it('explains the acceptance index mapping and entry fields', () => {
    expect(() =>
      parseNativeChildrenContract(
        READABLE_CHILDREN.replace(
          /acceptance_index:[\s\S]*?children:/u,
          'acceptance_index: []\nchildren:',
        ),
        ['A1', 'A2'],
      ),
    ).toThrow(
      'acceptance_index must be an object keyed by acceptance ID, for example A1: { source: brief.md, text: "Full acceptance text" }',
    );
    expect(() =>
      parseNativeChildrenContract(READABLE_CHILDREN.replace('source: brief.md', 'file: brief.md'), [
        'A1',
        'A2',
      ]),
    ).toThrow(
      'acceptance_index.A1 fields are invalid: missing source; unexpected file; expected source, text',
    );
  });

  it('derives contract-changed child states through the dependency gate (issue #439)', () => {
    const contract = parseNativeChildrenContract(READABLE_CHILDREN, ['A1', 'A2']);
    const repository = '/tmp/unused-repository';
    const state = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'main',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: repository,
      contract,
    });
    // Issue setup: child-a integrated, child-b pending on it, and the confirmed
    // contract then grows a new child that child-b must additionally wait on.
    const childA = state.children.find(({ name }) => name === 'child-a');
    const childB = state.children.find(({ name }) => name === 'child-b');
    childA!.status = 'integrated';
    childB!.status = 'pending';
    const revised = parseNativeChildrenContract(
      `schema: comet.native.children.v2
acceptance_index:
  A1:
    source: brief.md
    text: The integrated result contains the first behavior.
  A2:
    source: brief.md
    text: The integrated result contains the second behavior.
  A3:
    source: brief.md
    text: The integrated result contains the third behavior.
children:
  - name: child-a
    depends_on: []
    covers: [A1]
  - name: child-new
    depends_on: []
    covers: [A3]
  - name: child-b
    depends_on: [child-a, child-new]
    covers: [A2]
`,
      ['A1', 'A2', 'A3'],
    );

    // child-b has no candidate and its new dependency is not integrated, so the
    // reconciled state must stay pending instead of becoming dispatch-ready.
    const reconciled = reconcileNativeSupervisorState({
      state,
      contract: revised,
    });
    const reconciledB = reconciled.children.find(({ name }) => name === 'child-b');
    expect(reconciledB?.status).toBe('pending');
    expect(reconciledB?.blocker).toBeNull();
    const reconciledNew = reconciled.children.find(({ name }) => name === 'child-new');
    expect(reconciledNew?.status).toBe('ready');

    // A child whose dependencies are all integrated may become ready again.
    // Reconciliation reads actual dependency facts even when only prose changes.
    // The integrated child remains immutable.
    const integratedNew = reconciled.children.find(({ name }) => name === 'child-new');
    integratedNew!.status = 'integrated';
    const revised2 = parseNativeChildrenContract(
      `schema: comet.native.children.v2
acceptance_index:
  A1:
    source: brief.md
    text: The integrated result contains the first behavior.
  A2:
    source: brief.md
    text: The integrated result contains the second behavior.
  A3:
    source: brief.md
    text: The integrated result contains the refined third behavior.
children:
  - name: child-a
    depends_on: []
    covers: [A1]
  - name: child-new
    depends_on: []
    covers: [A3]
  - name: child-b
    depends_on: [child-a, child-new]
    covers: [A2]
`,
      ['A1', 'A2', 'A3'],
    );
    const promoted = reconcileNativeSupervisorState({
      state: reconciled,
      contract: revised2,
    });
    const promotedB = promoted.children.find(({ name }) => name === 'child-b');
    expect(promotedB?.status).toBe('ready');
    expect(promoted.children.find(({ name }) => name === 'child-new')?.status).toBe('integrated');

    // Prose changes do not invalidate a recorded candidate.
    const withCandidate = reconcileNativeSupervisorState({
      state,
      contract: revised,
    });
    const candidateB = withCandidate.children.find(({ name }) => name === 'child-b');
    candidateB!.candidateCommit = 'b'.repeat(40);
    const reverified = reconcileNativeSupervisorState({
      state: withCandidate,
      contract: revised2,
    });
    const reverifiedB = reverified.children.find(({ name }) => name === 'child-b');
    expect(reverifiedB?.status).toBe('pending');
    expect(reverifiedB?.candidateCommit).toBe('b'.repeat(40));
  });

  it('finds and repairs a self-locked supervisor overlay through doctor (issue #439)', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-lock-439-'));
    repositories.push(repository);
    git(repository, ['init', '-b', 'main']);
    git(repository, ['config', 'user.email', 'native@example.test']);
    git(repository, ['config', 'user.name', 'Native Test']);
    await fs.writeFile(path.join(repository, '.gitignore'), '.comet/runtime/\n');
    git(repository, ['add', '.']);
    git(repository, ['commit', '-m', 'seed']);
    await writeProjectConfig(repository, defaultProjectConfig('docs', 'en'));
    git(repository, ['add', '.']);
    git(repository, ['commit', '-m', 'configure comet']);
    expect((await nativeNewCommand(['parent', '--runtime', 'compat'], repository)).exitCode).toBe(
      0,
    );
    const paths = await nativeProjectPaths(repository, 'docs');
    const directory = nativePortableChangeDir(paths, 'parent');
    await fs.writeFile(path.join(directory, 'brief.md'), PARENT_BRIEF);
    await fs.writeFile(path.join(directory, 'children.yaml'), READABLE_CHILDREN);
    await confirmNativePortableShape({
      paths,
      name: 'parent',
      coordinationMode: 'multi-session',
    });

    const contract = parseNativeChildrenContract(READABLE_CHILDREN, ['A1', 'A2']);
    const supervisor = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'main',
      targetCommit: git(repository, ['rev-parse', 'HEAD']),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: repository,
      contract,
    });
    // Reproduce the locked overlay: child-a integrated, child-b wrongly ready
    // although child-a is not integrated.
    supervisor.children.find(({ name }) => name === 'child-a')!.status = 'pending';
    const childB = supervisor.children.find(({ name }) => name === 'child-b')!;
    childB.status = 'ready';
    childB.blocker =
      'Confirmed Supervisor contract changed; verify the current acceptance scope again.';
    await writeNativeSupervisorState(paths, supervisor);

    const diagnosis = await nativeDoctorCommand(['parent'], repository);
    expect(diagnosis).toMatchObject({
      exitCode: 65,
      data: {
        healthy: false,
        findings: [
          expect.objectContaining({
            code: 'portable-supervisor-ready-dependencies-unmet',
          }),
        ],
      },
    });

    const repaired = await nativeDoctorCommand(['parent', '--repair'], repository);
    expect(repaired).toMatchObject({
      exitCode: 0,
      data: {
        repaired: true,
        supervisorDependencyRepair: ['child-b'],
      },
    });
    const healed = await readNativeSupervisorState(paths, 'parent');
    expect(healed?.children.find(({ name }) => name === 'child-b')?.status).toBe('pending');
    // After the repair no ready child fails the dispatcher's dependency gate,
    // so advance-children can proceed with the actually ready children.
    for (const child of healed!.children) {
      if (child.status === 'ready') {
        expect(() => assertChildDependenciesIntegrated(healed!, child)).not.toThrow();
      }
    }
  });

  it('reads original parent child progress without modifying it after a workspace branch change', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-parent-recovery-'));
    repositories.push(repository);
    git(repository, ['init', '-b', 'integration']);
    git(repository, ['config', 'user.email', 'native@example.test']);
    git(repository, ['config', 'user.name', 'Native Test']);
    await writeProjectConfig(repository, defaultProjectConfig('docs', 'en'));
    git(repository, ['add', '.']);
    git(repository, ['commit', '-m', 'seed parent']);
    expect((await nativeNewCommand(['parent', '--runtime', 'compat'], repository)).exitCode).toBe(
      0,
    );
    const paths = await nativeProjectPaths(repository, 'docs');
    const directory = nativePortableChangeDir(paths, 'parent');
    await fs.writeFile(path.join(directory, 'brief.md'), PARENT_BRIEF);
    await fs.writeFile(path.join(directory, 'children.yaml'), CHILDREN);
    const prepared = await nativeNextCommand(['parent', '--summary', 'Prepare parent'], repository);
    const original = await readNativePortableChange(paths, 'parent');
    const previous = await inspectNativeChildren({ paths, state: original });
    expect(previous?.children).toHaveLength(3);
    expect(previous?.readyChildren).toBeInstanceOf(Array);
    git(repository, ['switch', '-c', 'wrong-parent-workspace']);
    const observed = await nativeNextCommand(['parent'], repository);
    expect(observed.exitCode).toBe(0);
    expect(await readNativePortableChange(paths, 'parent')).toEqual(original);
    const after = await inspectNativeChildren({ paths, state: original });
    expect(after).toEqual(previous);
  });

  it('retains approval after a children edit and leaves its meaning to the Agent', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-children-'));
    repositories.push(repository);
    git(repository, ['init', '-b', 'integration']);
    git(repository, ['config', 'user.email', 'native@example.test']);
    git(repository, ['config', 'user.name', 'Native Test']);

    const config = defaultProjectConfig('docs', 'en');
    config.workflows = ['native', 'classic'];
    config.default_workflow = 'native';
    await writeProjectConfig(repository, config);
    await fs.writeFile(
      path.join(repository, '.gitignore'),
      '.comet/runtime/\n.comet/current-change.json\n',
    );
    git(repository, ['add', '.']);
    git(repository, ['commit', '--allow-empty', '-m', 'seed parent integration branch']);

    const parentCreated = await nativeNewCommand(['parent', '--runtime', 'compat'], repository);
    expect(parentCreated.exitCode).toBe(0);
    const parentPaths = await nativeProjectPaths(repository, 'docs');
    await ensureNativeDirectories(parentPaths);
    const parentDir = nativePortableChangeDir(parentPaths, 'parent');
    await fs.writeFile(path.join(parentDir, 'brief.md'), PARENT_BRIEF);
    await fs.writeFile(path.join(parentDir, 'children.yaml'), CHILDREN);
    const parentPrepared = await nativeNextCommand(
      ['parent', '--summary', 'Prepare the parent contract confirmation'],
      repository,
    );
    expect(data(parentPrepared).state).toMatchObject({
      phase: 'shape',
      status: 'await-user',
    });
    const parentConfirmed = await nativeNextCommand(
      await guardedShapeConfirmationArgs(parentPaths, 'parent', 'Confirm the parent contract'),
      repository,
    );
    expect(data(parentConfirmed).state).toMatchObject({ phase: 'build' });
    const parentState = await readNativePortableChange(parentPaths, 'parent');
    const confirmedChildren = await inspectNativeChildren({
      paths: parentPaths,
      state: parentState,
    });
    expect(confirmedChildren?.confirmed).toBe(true);

    // Reassigning a current ID does not automatically withdraw approval.
    await fs.writeFile(
      path.join(parentDir, 'children.yaml'),
      CHILDREN.replace('covers: [A2]', 'covers: [A3]'),
    );
    const drifted = await inspectNativeChildren({
      paths: parentPaths,
      state: parentState,
    });
    expect(drifted?.confirmed).toBe(true);
    expect(
      drifted?.children.some(({ message }) =>
        /Parent Shape confirmation is required/iu.test(message ?? ''),
      ),
    ).toBe(false);
    await expect(
      inspectNativePortableStatus({ paths: parentPaths, name: 'parent' }),
    ).resolves.toMatchObject({ name: 'parent' });
  });

  it('binds a Supervisor Shape to Git that was initialized after the change was created', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-children-'));
    repositories.push(repository);

    // The project is configured before any Git repository exists.
    const config = defaultProjectConfig('docs', 'en');
    config.workflows = ['native', 'classic'];
    config.default_workflow = 'native';
    await writeProjectConfig(repository, config);

    const parentCreated = await nativeNewCommand(
      ['parent', '--isolation', 'current', '--runtime', 'compat'],
      repository,
    );
    expect(parentCreated.exitCode).toBe(0);
    let parentPaths = await nativeProjectPaths(repository, 'docs');
    await ensureNativeDirectories(parentPaths);
    const parentDir = nativePortableChangeDir(parentPaths, 'parent');
    await fs.writeFile(path.join(parentDir, 'brief.md'), PARENT_BRIEF);
    await fs.writeFile(path.join(parentDir, 'children.yaml'), READABLE_CHILDREN);

    expect(await readNativePortableChange(parentPaths, 'parent')).toMatchObject({
      workspace: {
        isolation: 'current',
        change_branch: null,
        target_branch: null,
      },
    });
    await expect(
      nativeNextCommand(['parent', '--summary', 'Prepare the parent contract'], repository),
    ).rejects.toThrow(/Git integration branch/u);
    await expect(nativeDoctorCommand(['parent'], repository)).resolves.toMatchObject({
      exitCode: 65,
      data: {
        healthy: false,
        findings: [
          expect.objectContaining({
            code: 'portable-supervisor-git-binding-missing',
          }),
        ],
      },
    });

    // Git is initialized only after the change already exists.
    git(repository, ['init', '-b', 'main']);
    git(repository, ['config', 'user.email', 'native@example.test']);
    git(repository, ['config', 'user.name', 'Native Test']);
    await ensureCometProjectGitignore(repository);
    git(repository, ['add', '.']);
    git(repository, ['commit', '--allow-empty', '-m', 'seed after the change exists']);

    await expect(nativeDoctorCommand(['parent'], repository)).resolves.toMatchObject({
      exitCode: 65,
      data: {
        healthy: false,
        findings: [
          expect.objectContaining({
            code: 'portable-supervisor-git-binding-missing',
            message: expect.stringContaining('main'),
          }),
        ],
      },
    });
    const previousRuntimeRoot = parentPaths.workspaceRuntimeRoot;
    parentPaths = await nativeProjectPaths(repository, 'docs');
    expect(parentPaths.workspaceRuntimeRoot).not.toBe(previousRuntimeRoot);
    const recovered = await nativeNextCommand(
      ['parent', '--summary', 'Recover the portable Shape in the new Git workspace'],
      repository,
    );
    expect(recovered.data).toMatchObject({
      state: {
        phase: 'shape',
        status: 'await-user',
        workspace: { change_branch: 'main', target_branch: 'main' },
      },
    });

    const parentPrepared = recovered;
    expect(data(parentPrepared).state).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      workspace: { change_branch: 'main', target_branch: 'main' },
    });
    expect(
      (await readNativePortableChange(parentPaths, 'parent')).history.some(
        ({ outcome, summary }) =>
          outcome === 'recovery' && /bound to branch main/u.test(summary.text),
      ),
    ).toBe(true);

    const parentConfirmed = await nativeNextCommand(
      [
        ...(await guardedShapeConfirmationArgs(
          parentPaths,
          'parent',
          'Confirm the parent contract',
        )),
        '--coordination-mode',
        'multi-session',
      ],
      repository,
    );
    expect(data(parentConfirmed).state).toMatchObject({
      phase: 'build',
      workspace: { change_branch: 'main', target_branch: 'main' },
    });
    expect(git(repository, ['branch', '--list', 'comet/supervisor/parent/integration'])).toContain(
      'comet/supervisor/parent/integration',
    );
    await expect(nativeDoctorCommand(['parent'], repository)).resolves.toMatchObject({
      exitCode: 0,
      data: { healthy: true },
    });
  });

  it('refuses to bind a pre-Git Supervisor Shape from a dirty Git baseline', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-children-'));
    repositories.push(repository);
    const config = defaultProjectConfig('docs', 'en');
    config.workflows = ['native', 'classic'];
    config.default_workflow = 'native';
    await writeProjectConfig(repository, config);
    await nativeNewCommand(['parent', '--isolation', 'current', '--runtime', 'compat'], repository);
    const paths = await nativeProjectPaths(repository, 'docs');
    await ensureNativeDirectories(paths);
    const changeDir = nativePortableChangeDir(paths, 'parent');
    await fs.writeFile(path.join(changeDir, 'brief.md'), PARENT_BRIEF);
    await fs.writeFile(path.join(changeDir, 'children.yaml'), READABLE_CHILDREN);

    git(repository, ['init', '-b', 'main']);
    git(repository, ['config', 'user.email', 'native@example.test']);
    git(repository, ['config', 'user.name', 'Native Test']);
    await ensureCometProjectGitignore(repository);
    git(repository, ['add', '.']);
    git(repository, ['commit', '-m', 'seed after the change exists']);
    const recovered = await nativeNextCommand(['parent'], repository);
    expect(recovered.data).toMatchObject({
      state: {
        phase: 'shape',
        workspace: { change_branch: null, target_branch: null },
      },
    });
    await fs.writeFile(path.join(repository, 'uncommitted.txt'), 'not part of the baseline\n');

    await expect(nativeDoctorCommand(['parent'], repository)).resolves.toMatchObject({
      exitCode: 65,
      data: {
        findings: [
          expect.objectContaining({
            message: expect.stringMatching(/clean current working directory/iu),
          }),
        ],
      },
    });
    await expect(
      nativeNextCommand(
        [
          'parent',
          '--summary',
          'Prepare the parent contract confirmation',
          '--coordination-mode',
          'multi-session',
        ],
        repository,
      ),
    ).rejects.toThrow(/clean current working directory/iu);
    await expect(readNativePortableChange(paths, 'parent')).resolves.toMatchObject({
      workspace: { change_branch: null, target_branch: null },
    });
  });

  it('refuses to bind a pre-Git Supervisor Shape while a child task is active', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-children-'));
    repositories.push(repository);
    const config = defaultProjectConfig('docs', 'en');
    config.workflows = ['native', 'classic'];
    config.default_workflow = 'native';
    await writeProjectConfig(repository, config);
    await nativeNewCommand(['parent', '--isolation', 'current', '--runtime', 'compat'], repository);
    const paths = await nativeProjectPaths(repository, 'docs');
    await ensureNativeDirectories(paths);
    const changeDir = nativePortableChangeDir(paths, 'parent');
    await fs.writeFile(path.join(changeDir, 'brief.md'), PARENT_BRIEF);
    await fs.writeFile(path.join(changeDir, 'children.yaml'), READABLE_CHILDREN);

    git(repository, ['init', '-b', 'main']);
    git(repository, ['config', 'user.email', 'native@example.test']);
    git(repository, ['config', 'user.name', 'Native Test']);
    await ensureCometProjectGitignore(repository);
    git(repository, ['add', '.']);
    git(repository, ['commit', '-m', 'seed after the change exists']);
    const currentPaths = await nativeProjectPaths(repository, 'docs');
    const recovered = await nativeNextCommand(['parent'], repository);
    expect(recovered.data).toMatchObject({
      state: {
        phase: 'shape',
        workspace: { change_branch: null, target_branch: null },
      },
    });
    const head = git(repository, ['rev-parse', 'HEAD']);
    const supervisor = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'main',
      targetCommit: head,
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: repository,
      contract: parseNativeChildrenContract(READABLE_CHILDREN, ['A1', 'A2']),
    });
    const active = createNativeSupervisorTask(supervisor, {
      role: 'builder',
      child: 'child-a',
      projectRoot: repository,
      runId: 'active-builder',
    });
    await writeNativeSupervisorState(currentPaths, active.state);

    await expect(nativeDoctorCommand(['parent'], repository)).resolves.toMatchObject({
      exitCode: 65,
      data: {
        findings: [
          expect.objectContaining({
            message: expect.stringMatching(/active child tasks/iu),
          }),
        ],
      },
    });
    await expect(
      nativeNextCommand(
        [
          'parent',
          '--summary',
          'Prepare the parent contract confirmation',
          '--coordination-mode',
          'multi-session',
        ],
        repository,
      ),
    ).rejects.toThrow(/active child tasks/iu);
    await expect(readNativePortableChange(paths, 'parent')).resolves.toMatchObject({
      workspace: { change_branch: null, target_branch: null },
    });
  });
  it('continues the approved v1 parent from actual merged Child archives at its explicit root', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'native-v1-explicit-parent-'));
    repositories.push(repository);
    git(repository, ['init', '-b', 'integration']);
    git(repository, ['config', 'user.email', 'native@example.test']);
    git(repository, ['config', 'user.name', 'Native Test']);
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(repository, config);
    await ensureCometProjectGitignore(repository);
    await fs.mkdir(path.join(repository, 'src'), { recursive: true });
    await fs.writeFile(path.join(repository, 'src/base.ts'), 'export const base=true;\n');
    git(repository, ['add', '.']);
    git(repository, ['commit', '-m', 'seed explicit parent']);
    expect((await nativeNewCommand(['parent', '--runtime', 'compat'], repository)).exitCode).toBe(
      0,
    );
    const parentPaths = await nativeProjectPaths(repository, 'docs'),
      parentDir = nativePortableChangeDir(parentPaths, 'parent');
    await fs.writeFile(path.join(parentDir, 'brief.md'), PARENT_BRIEF);
    await fs.writeFile(path.join(parentDir, 'children.yaml'), CHILDREN);
    const approved = await confirmNativePortableShape({
      paths: parentPaths,
      name: 'parent',
    });
    expect(approved.children_contract?.schema).toBe('comet.native.children.v1');
    const approval = approved.children_contract_ref,
      originalContract = approved.children_contract;
    git(repository, ['add', 'docs/comet/changes/parent']);
    git(repository, ['commit', '-m', 'fixture user approved v1 parent scope']);
    let expectedBase = git(repository, ['rev-parse', 'HEAD']);
    for (const name of ['child-a', 'child-b', 'child-c']) {
      const created = await nativeNewCommand(
        [name, '--runtime', 'compat', '--isolation', 'worktree', '--target-branch', 'integration'],
        repository,
      );
      expect(created.exitCode).toBe(0);
      const childRoot = data(created).preparation!.projectRoot;
      linkedWorktrees.push({ repository, root: childRoot });
      expect(git(childRoot, ['rev-parse', 'HEAD'])).toBe(expectedBase);
      if (name === 'child-b')
        expect(await fs.readFile(path.join(childRoot, 'src/child-a.ts'), 'utf8')).toContain(
          'child-a',
        );
      const childPaths = await nativeProjectPaths(childRoot, 'docs'),
        childDir = nativePortableChangeDir(childPaths, name);
      await fs.writeFile(path.join(childDir, 'brief.md'), CHILD_BRIEF);
      const shaped = await confirmNativePortableShape({
        paths: childPaths,
        name,
      });
      await fs.writeFile(
        path.join(childRoot, 'src', name + '.ts'),
        'export const value=' + JSON.stringify(name) + ';\n',
      );
      await verifyChild({ paths: childPaths, state: shaped });
      expect(
        (await nativeArchiveCommand([name, '--dry-run', '--finish', 'merge'], childRoot)).exitCode,
      ).toBe(0);
      git(childRoot, ['add', '-A']);
      git(childRoot, ['commit', '-m', 'actual verified ' + name]);
      const archived = await nativeArchiveCommand([name, '--confirmed'], childRoot);
      expect(archived.exitCode).toBe(0);
      expect(data(archived).workspaceFinishResult).toMatchObject({
        merged: true,
      });
      expect(await fs.readFile(path.join(repository, 'src', name + '.ts'), 'utf8')).toContain(name);
      const index = linkedWorktrees.findIndex((e) => e.root === childRoot);
      if (index >= 0) linkedWorktrees.splice(index, 1);
      await expect(fs.stat(childRoot)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expectedBase = git(repository, ['rev-parse', 'HEAD']);
      const parent = await readNativePortableChange(parentPaths, 'parent');
      expect(parent.children_contract_ref).toBe(approval);
      expect(parent.children_contract).toEqual(originalContract);
      // All evidence used here is already committed at this explicitly supplied parent root.
      const local = await inspectNativeChildren({
        paths: parentPaths,
        state: parent,
      });
      expect(local?.children.find((c) => c.name === name)?.status).toBe('done');
      if (name === 'child-a')
        expect(local?.children.find((c) => c.name === 'child-b')?.status).toBe('ready');
    }
    const completedChildren = await inspectNativeChildren({
      paths: parentPaths,
      state: await readNativePortableChange(parentPaths, 'parent'),
    });
    expect(completedChildren?.allDone).toBe(true);
    const report = execFileSync(
      process.execPath,
      [
        '-e',
        'const fs=require("node:fs"),assert=require("node:assert/strict");for(const n of ["child-a","child-b","child-c"])assert.ok(fs.readFileSync("src/"+n+".ts","utf8").includes(n));console.log("Actual complete parent integration passed")',
      ],
      { cwd: repository, encoding: 'utf8' },
    );
    expect(report).toContain('Actual complete parent integration passed');
    const input = path.join(repository, 'parent-result.json');
    await fs.writeFile(
      input,
      JSON.stringify({
        kind: 'builder-handoff',
        summary: 'All actual Child outputs are integrated at the explicit parent root.',
        addressed_acceptance_ids: approved.acceptance.map((a) => a.id),
        acceptance_review: fixtureAcceptanceReview(approved.acceptance.map((a) => a.id)),
        checks: [
          {
            name: 'Actual complete parent integration',
            result: 'passed',
            note: report.trim(),
          },
        ],
        known_limits: [],
      }),
    );
    const submitted = await nativeNextCommand(['parent', '--runner-input', input], repository);
    expect(submitted.exitCode).toBe(0);
    expect(data(submitted).state).toMatchObject({ phase: 'verify' });
    expect((await readNativePortableChange(parentPaths, 'parent')).children_contract_ref).toBe(
      approval,
    );
  }, 120000);
});
