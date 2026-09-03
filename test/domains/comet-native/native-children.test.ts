import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { nativeArchiveCommand } from '../../../domains/comet-native/native-archive-command.js';
import {
  hashNativeParentContract,
  hasNativeSupervisorShapeIntent,
  findNativeV1SupervisorParents,
  inspectNativeChildren,
  nativeChildrenIndexDrift,
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
  confirmNativePortableShape,
  confirmNativePortableSkillCoordinatedPass,
  dispatchNativePortableVerifier,
  executeNativePortableCheckPlan,
  nativePortableChangeDir,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import {
  readNativePortableState,
  writeNativePortableState,
} from '../../../domains/comet-native/native-portable-state.js';
import { inspectNativePortableStatus } from '../../../domains/comet-native/native-portable-status.js';
import { nativeShowCommand } from '../../../domains/comet-native/native-show-command.js';
import type {
  NativePortableAcceptanceState,
  NativePortableState,
} from '../../../domains/comet-native/native-portable-types.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

const PARENT_BRIEF = `# Outcome
Integrate the child changes into one verified result.

# Acceptance examples
- The integrated result contains the first behavior.
- The integrated result contains the second behavior.
`;

const CHILD_BRIEF = `# Outcome
Implement one independently verified child result.

# Acceptance examples
- The child implementation is present on its branch.
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
      review: {
        status: 'passed',
        summary: 'Independent child review passed.',
        reviewerExecutionRef: `${name}-reviewer`,
      },
    },
  });
  const executed = await executeNativePortableCheckPlan({ paths, name, plans: [] });
  const dispatched = await dispatchNativePortableVerifier({
    paths,
    name,
    checks: executed.checks,
  });
  await submitNativePortableVerifierResult({
    paths,
    name,
    checks: executed.checks,
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

async function writeMergedChildProjection(options: {
  paths: NativeProjectPaths;
  source: NativePortableState;
  name: string;
  parentBranch: string;
}): Promise<void> {
  const directory = path.join(options.paths.archiveDir, `2026-08-11-${options.name}`);
  await fs.mkdir(directory, { recursive: true });
  await writeNativePortableState(
    path.join(directory, 'comet-state.yaml'),
    {
      ...options.source,
      name: options.name,
      workspace: {
        isolation: 'worktree',
        change_branch: `comet/${options.name}`,
        target_branch: options.parentBranch,
        finish: 'merge',
      },
    },
    { containedRoot: options.paths.nativeRoot },
  );
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

  it('validates the DAG and hashes only semantic parent contract changes', () => {
    const acceptance: NativePortableAcceptanceState[] = [
      { id: 'A1', source: 'brief.md', text: 'First behavior.', result: 'pending' },
      { id: 'A2', source: 'brief.md', text: 'Second behavior.', result: 'pending' },
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
    expect(hashNativeParentContract({ acceptance, children: parsed })).toBe(
      hashNativeParentContract({ acceptance, children: reformatted }),
    );
    expect(
      hashNativeParentContract({
        acceptance,
        children: { ...parsed, children: [...parsed.children].reverse() },
      }),
    ).not.toBe(hashNativeParentContract({ acceptance, children: parsed }));

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
      { source: CHILDREN.replace('covers: [A2]', 'covers: [A3]'), message: /unknown acceptance/iu },
      {
        source: CHILDREN.replace('covers: [A2]', 'covers: [A1]'),
        message: /do not cover parent acceptance/iu,
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

  it('recognizes an explicit Supervisor split in Decisions before children.yaml exists', () => {
    expect(
      hasNativeSupervisorShapeIntent(`# Decisions

- Selected Supervisor Change for two independent outcomes.
- Child 1 owns the first outcome; Child 2 owns the second outcome.

# Verification expectations
- Run focused checks.
`),
    ).toBe(true);
    expect(
      hasNativeSupervisorShapeIntent(`# Decisions

- Keep this as one Native Change.
- The implementation has two related parts.
`),
    ).toBe(false);
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
      { id: 'A1', source: 'brief.md', text: 'The integrated result contains the first behavior.' },
      { id: 'A2', source: 'brief.md', text: 'The integrated result contains the second behavior.' },
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

  it('validates v2 index text while allowing only failed Spec acceptance into repair children', () => {
    const acceptance = [
      { id: 'A1', source: 'brief.md', text: 'The integrated result contains the first behavior.' },
      { id: 'A2', source: 'brief.md', text: 'The integrated result contains the second behavior.' },
      { id: 'A3', source: 'specs/demo/spec.md', text: 'The formal requirement is retained.' },
    ];

    expect(() =>
      parseNativeChildrenContract(
        READABLE_CHILDREN,
        acceptance.map(({ id }) => id),
        {
          acceptanceCatalog: acceptance,
          requiredAcceptanceIds: ['A1', 'A2'],
        },
      ),
    ).not.toThrow();
    expect(() =>
      parseNativeChildrenContract(
        READABLE_CHILDREN.replace(
          'The integrated result contains the second behavior.',
          'A changed behavior.',
        ),
        acceptance.map(({ id }) => id),
        { acceptanceCatalog: acceptance, requiredAcceptanceIds: ['A1', 'A2'] },
      ),
    ).toThrow(
      /acceptance_index.A2 does not match the acceptance catalog: copy text exactly from the current acceptance catalog/iu,
    );
    expect(() =>
      parseNativeChildrenContract(
        READABLE_CHILDREN.replace('covers: [A1]', 'covers: [A1, A3]'),
        acceptance.map(({ id }) => id),
        { acceptanceCatalog: acceptance, requiredAcceptanceIds: ['A1', 'A2'] },
      ),
    ).toThrow(/unknown acceptance/iu);

    const childFacingSpec = READABLE_CHILDREN.replace(
      'children:',
      `  A3:
    source: specs/demo/spec.md
    text: The formal requirement is retained.
children:`,
    ).replace('covers: [A1]', 'covers: [A1, A3]');
    expect(() =>
      parseNativeChildrenContract(
        childFacingSpec,
        acceptance.map(({ id }) => id),
        { acceptanceCatalog: acceptance, requiredAcceptanceIds: ['A1', 'A2'] },
      ),
    ).toThrow(/extra A3/iu);
    const repairValidation = {
      acceptanceCatalog: acceptance,
      requiredAcceptanceIds: ['A1', 'A2'],
      allowedAcceptanceIds: ['A1', 'A2', 'A3'],
    };
    expect(() =>
      parseNativeChildrenContract(
        childFacingSpec,
        acceptance.map(({ id }) => id),
        repairValidation,
      ),
    ).not.toThrow();
    expect(() =>
      parseNativeChildrenContract(
        childFacingSpec.replace(
          'The formal requirement is retained.',
          'A stale formal requirement.',
        ),
        acceptance.map(({ id }) => id),
        repairValidation,
      ),
    ).toThrow(
      /acceptance_index.A3 does not match the acceptance catalog: copy text exactly from the current acceptance catalog/iu,
    );
  });

  it('reports stale acceptance-index drift under the advisory policy instead of throwing', () => {
    const acceptance = [
      { id: 'A1', source: 'brief.md', text: 'The integrated result contains the first behavior.' },
      { id: 'A2', source: 'brief.md', text: 'The integrated result contains the second behavior.' },
    ];
    const acceptanceIds = acceptance.map(({ id }) => id);
    const options = { acceptanceCatalog: acceptance, requiredAcceptanceIds: acceptanceIds };
    const driftedText = READABLE_CHILDREN.replace(
      'The integrated result contains the second behavior.',
      'A stale copy of the second behavior.',
    );

    expect(() => parseNativeChildrenContract(driftedText, acceptanceIds, options)).toThrow(
      /does not match the acceptance catalog/iu,
    );
    const drifted = parseNativeChildrenContract(driftedText, acceptanceIds, {
      ...options,
      policy: 'advisory',
    });
    expect(drifted.acceptance_index?.A2?.text).toBe('A stale copy of the second behavior.');
    expect(nativeChildrenIndexDrift(drifted, acceptanceIds, options)).toEqual({
      missing: [],
      extra: [],
      mismatched: ['A2'],
      uncovered: [],
      unknownCovers: [],
    });

    const staleIds = READABLE_CHILDREN.replace(
      /  A2:[\s\S]*?children:/u,
      '  A9:\n    source: brief.md\n    text: A stale extra acceptance.\nchildren:',
    );
    const extraIndex = parseNativeChildrenContract(staleIds, acceptanceIds, {
      ...options,
      policy: 'advisory',
    });
    expect(nativeChildrenIndexDrift(extraIndex, acceptanceIds, options)).toMatchObject({
      missing: ['A2'],
      extra: ['A9'],
      uncovered: ['A9'],
    });
  });

  it('downgrades a drifted children copy to a confirmation prompt instead of blocking status', async () => {
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

    const parentCreated = await nativeNewCommand(['parent'], repository);
    expect(parentCreated.exitCode).toBe(0);
    const parentPaths = await nativeProjectPaths(repository, 'docs');
    await ensureNativeDirectories(parentPaths);
    const parentDir = nativePortableChangeDir(parentPaths, 'parent');
    await fs.writeFile(path.join(parentDir, 'brief.md'), PARENT_BRIEF);
    await fs.writeFile(path.join(parentDir, 'children.yaml'), CHILDREN);
    const parentConfirmed = await nativeNextCommand(
      ['parent', '--summary', 'Confirm the parent contract', '--confirmed'],
      repository,
    );
    expect(data(parentConfirmed).state).toMatchObject({ phase: 'build' });
    const parentState = await readNativePortableChange(parentPaths, 'parent');
    const confirmedChildren = await inspectNativeChildren({
      paths: parentPaths,
      state: parentState,
    });
    expect(confirmedChildren?.confirmed).toBe(true);

    // Simulate a stale copy from another worktree: the child-plan index no
    // longer matches the confirmed acceptance set.
    await fs.writeFile(
      path.join(parentDir, 'children.yaml'),
      CHILDREN.replace('covers: [A2]', 'covers: [A3]'),
    );
    const drifted = await inspectNativeChildren({ paths: parentPaths, state: parentState });
    expect(drifted?.confirmed).toBe(false);
    expect(
      drifted?.children.some(({ message }) =>
        /Parent Shape confirmation is required/iu.test(message ?? ''),
      ),
    ).toBe(true);
    await expect(
      inspectNativePortableStatus({ paths: parentPaths, name: 'parent' }),
    ).resolves.toMatchObject({ name: 'parent' });
  });

  it('gates the parent on real child merges and starts dependents from the integrated HEAD', async () => {
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
    await fs.mkdir(path.join(repository, 'src'), { recursive: true });
    await fs.writeFile(path.join(repository, 'src', 'base.ts'), 'export const base = true;\n');
    await fs.mkdir(path.join(repository, 'openspec', 'changes', 'child-a'), { recursive: true });
    await fs.writeFile(
      path.join(repository, 'openspec', 'changes', 'child-a', '.comet.yaml'),
      'phase: build\n',
    );
    git(repository, ['add', '.']);
    git(repository, ['commit', '-m', 'seed parent integration branch']);

    const parentCreated = await nativeNewCommand(['parent'], repository);
    expect(parentCreated.exitCode).toBe(0);
    const parentPaths = await nativeProjectPaths(repository, 'docs');
    await ensureNativeDirectories(parentPaths);
    const parentDir = nativePortableChangeDir(parentPaths, 'parent');
    await fs.writeFile(path.join(parentDir, 'brief.md'), PARENT_BRIEF);
    await fs.writeFile(path.join(parentDir, 'children.yaml'), CHILDREN);
    const parentConfirmed = await nativeNextCommand(
      ['parent', '--summary', 'Confirm the parent contract', '--confirmed'],
      repository,
    );
    expect(data(parentConfirmed).state).toMatchObject({ phase: 'build' });
    const parentState = await readNativePortableChange(parentPaths, 'parent');
    expect(parentState).toMatchObject({
      phase: 'build',
      workspace: { change_branch: 'integration' },
      children_contract_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });

    const initialChildren = await inspectNativeChildren({ paths: parentPaths, state: parentState });
    expect(initialChildren?.children.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'child-a', status: 'ready' },
      { name: 'child-b', status: 'pending' },
      { name: 'child-c', status: 'ready' },
    ]);
    expect(initialChildren?.readyChildren).toEqual(['child-a', 'child-c']);
    await expect(
      inspectNativePortableStatus({ paths: parentPaths, name: 'parent' }),
    ).resolves.toMatchObject({
      childSummary: { total: 3, ready: 2, pending: 1 },
      readyChildren: ['child-a', 'child-c'],
    });

    const gated = await nativeNextCommand(
      ['parent', '--summary', 'Advance the ready children'],
      repository,
    );
    expect(data(gated)).toMatchObject({
      state: { phase: 'build' },
      readyChildren: ['child-a', 'child-c'],
      continuation: { action: 'advance-children', runnerAction: { kind: 'none' } },
    });
    await expect(nativeShowCommand(['parent'], repository)).resolves.toMatchObject({
      data: {
        continuation: { action: 'advance-children', runnerAction: { kind: 'none' } },
      },
    });
    await expect(nativeDoctorCommand(['parent', '--repair'], repository)).resolves.toMatchObject({
      data: {
        continuation: { action: 'advance-children', runnerAction: { kind: 'none' } },
      },
    });
    const parentRunner = createNativeRunnerChannel();
    await expect(
      submitNativePortableBuilderCandidate({
        paths: parentPaths,
        name: 'parent',
        input: {
          identity: parentRunner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'parent-builder',
          }),
          summary: 'A parent Builder must not run.',
          addressedAcceptanceIds: parentState.acceptance.map(({ id }) => id),
          review: {
            status: 'passed',
            summary: 'Independent parent review passed.',
            reviewerExecutionRef: 'parent-reviewer-early',
          },
        },
      }),
    ).rejects.toThrow(/parent Build advances child changes/iu);

    git(repository, ['add', 'docs/comet/changes/parent']);
    git(repository, ['commit', '-m', 'confirm parent child plan']);
    expect(git(repository, ['status', '--short'])).toBe('');

    const earlyDependentCreated = await nativeNewCommand(
      ['child-b', '--isolation', 'worktree', '--target-branch', 'integration'],
      repository,
    );
    const earlyDependentRoot = data(earlyDependentCreated).preparation?.projectRoot;
    expect(earlyDependentCreated.exitCode).toBe(0);
    expect(earlyDependentRoot).toBeTruthy();
    linkedWorktrees.push({ repository, root: earlyDependentRoot! });
    await expect(
      inspectNativeChildren({
        paths: parentPaths,
        state: await readNativePortableState(path.join(parentDir, 'comet-state.yaml')),
      }),
    ).resolves.toMatchObject({
      children: expect.arrayContaining([
        expect.objectContaining({
          name: 'child-b',
          status: 'blocked',
          message: expect.stringMatching(/started before its dependencies merged/iu),
        }),
      ]),
    });

    const childCreated = await nativeNewCommand(
      ['child-a', '--isolation', 'worktree', '--target-branch', 'integration'],
      repository,
    );
    const childRoot = data(childCreated).preparation?.projectRoot;
    expect(childCreated.exitCode).toBe(0);
    expect(childRoot).toBeTruthy();
    linkedWorktrees.push({ repository, root: childRoot! });
    const childConfig = await readProjectConfig(childRoot!);
    const childPaths = await nativeProjectPaths(childRoot!, childConfig!.native.artifact_root);
    const childDir = nativePortableChangeDir(childPaths, 'child-a');
    await fs.writeFile(path.join(childDir, 'brief.md'), CHILD_BRIEF);
    const childShaped = await confirmNativePortableShape({ paths: childPaths, name: 'child-a' });
    await fs.writeFile(path.join(childRoot!, 'src', 'a.ts'), 'export const childA = true;\n');
    await verifyChild({ paths: childPaths, state: childShaped });

    const archivePreview = await nativeArchiveCommand(
      ['child-a', '--dry-run', '--finish', 'merge'],
      childRoot!,
    );
    expect(archivePreview.exitCode).toBe(0);
    git(childRoot!, ['add', '-A']);
    git(childRoot!, ['commit', '-m', 'implement verified child a']);
    expect(git(repository, ['status', '--short'])).toBe('');

    const archived = await nativeArchiveCommand(['child-a', '--confirmed'], childRoot!);
    expect(archived.exitCode).toBe(0);
    expect(data(archived).workspaceFinishResult).toMatchObject({ merged: true });
    await expect(fs.readFile(path.join(repository, 'src', 'a.ts'), 'utf8')).resolves.toContain(
      'export const childA = true;',
    );

    const parentAfterMerge = await readNativePortableState(
      path.join(parentDir, 'comet-state.yaml'),
    );
    const afterA = await inspectNativeChildren({ paths: parentPaths, state: parentAfterMerge });
    expect(afterA?.children.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'child-a', status: 'done' },
      { name: 'child-b', status: 'blocked' },
      { name: 'child-c', status: 'ready' },
    ]);
    expect(afterA?.children[1]?.message).toMatch(/does not include merged dependencies: child-a/iu);
    expect(afterA?.readyChildren).toEqual(['child-c']);

    execFileSync('git', ['worktree', 'remove', '--force', earlyDependentRoot!], {
      cwd: repository,
      stdio: 'ignore',
    });
    await fs.rm(earlyDependentRoot!, { recursive: true, force: true });
    const earlyIndex = linkedWorktrees.findIndex(({ root }) => root === earlyDependentRoot);
    if (earlyIndex >= 0) linkedWorktrees.splice(earlyIndex, 1);
    git(repository, ['branch', '-D', 'comet/child-b']);
    await expect(
      inspectNativeChildren({ paths: parentPaths, state: parentAfterMerge }),
    ).resolves.toMatchObject({
      children: expect.arrayContaining([
        expect.objectContaining({ name: 'child-b', status: 'ready' }),
      ]),
      readyChildren: ['child-b', 'child-c'],
    });

    const parentHeadAfterA = git(repository, ['rev-parse', 'HEAD']);
    const dependentCreated = await nativeNewCommand(
      ['child-b', '--isolation', 'worktree', '--target-branch', 'integration'],
      repository,
    );
    const dependentRoot = data(dependentCreated).preparation?.projectRoot;
    expect(dependentCreated.exitCode).toBe(0);
    expect(dependentRoot).toBeTruthy();
    linkedWorktrees.push({ repository, root: dependentRoot! });
    expect(git(dependentRoot!, ['rev-parse', 'HEAD'])).toBe(parentHeadAfterA);
    await expect(fs.readFile(path.join(dependentRoot!, 'src', 'a.ts'), 'utf8')).resolves.toContain(
      'export const childA = true;',
    );
    await expect(
      inspectNativeChildren({ paths: parentPaths, state: parentAfterMerge }),
    ).resolves.toMatchObject({
      children: expect.arrayContaining([
        expect.objectContaining({ name: 'child-b', status: 'active' }),
      ]),
    });

    const archivedDirectory = path.join(
      parentPaths.archiveDir,
      path.basename(data(archived).archiveDir!),
    );
    const archivedA = await readNativePortableState(
      path.join(archivedDirectory, 'comet-state.yaml'),
    );
    await writeMergedChildProjection({
      paths: parentPaths,
      source: archivedA,
      name: 'child-b',
      parentBranch: 'integration',
    });
    await writeMergedChildProjection({
      paths: parentPaths,
      source: archivedA,
      name: 'child-c',
      parentBranch: 'integration',
    });
    const uncommittedProjection = await inspectNativeChildren({
      paths: parentPaths,
      state: parentAfterMerge,
    });
    expect(uncommittedProjection?.allDone).toBe(false);
    git(repository, ['add', 'docs/comet/archive']);
    git(repository, ['commit', '-m', 'record merged child projections']);
    const allDone = await inspectNativeChildren({ paths: parentPaths, state: parentAfterMerge });
    expect(allDone?.allDone).toBe(true);
    const discoveredParent = await findNativeV1SupervisorParents({
      paths: parentPaths,
      childName: 'child-c',
      targetBranch: 'integration',
    });
    expect(discoveredParent.candidate?.state.name).toBe('parent');

    const pendingParentName = 'parent-pending';
    const pendingParentDir = nativePortableChangeDir(parentPaths, pendingParentName);
    await fs.cp(parentDir, pendingParentDir, { recursive: true });
    const pendingParentState = await readNativePortableState(
      path.join(pendingParentDir, 'comet-state.yaml'),
    );
    pendingParentState.name = pendingParentName;
    const pendingChildrenSource = `${CHILDREN}  - name: child-pending\n    depends_on: []\n    covers: []\n`;
    await fs.writeFile(path.join(pendingParentDir, 'children.yaml'), pendingChildrenSource);
    pendingParentState.children_contract_hash = hashNativeParentContract({
      acceptance: pendingParentState.acceptance,
      children: parseNativeChildrenContract(
        pendingChildrenSource,
        pendingParentState.acceptance.map(({ id }) => id),
      ),
    });
    await writeNativePortableState(
      path.join(pendingParentDir, 'comet-state.yaml'),
      pendingParentState,
    );
    const ambiguousParent = await findNativeV1SupervisorParents({
      paths: parentPaths,
      childName: 'child-c',
      targetBranch: 'integration',
    });
    expect(ambiguousParent.candidate).toBeNull();
    expect(ambiguousParent.blockers.join('\n')).toMatch(
      /multiple active parents|parent-pending is not ready to advance/iu,
    );
    pendingParentState.workspace.target_branch = 'other';
    await writeNativePortableState(
      path.join(pendingParentDir, 'comet-state.yaml'),
      pendingParentState,
    );
    const mismatchedParent = await findNativeV1SupervisorParents({
      paths: parentPaths,
      childName: 'child-c',
      targetBranch: 'integration',
    });
    expect(mismatchedParent.candidate).toBeNull();
    expect(mismatchedParent.blockers.join('\n')).toMatch(/targets other, not integration/iu);
    const missingParent = await findNativeV1SupervisorParents({
      paths: parentPaths,
      childName: 'unknown-child',
      targetBranch: 'integration',
    });
    expect(missingParent.candidate).toBeNull();
    expect(missingParent.blockers.join('\n')).toMatch(/no active v1 parent declaring it/iu);

    const parentReviewInput = path.join(repository, 'parent-review-input.json');
    await fs.writeFile(
      parentReviewInput,
      JSON.stringify({
        kind: 'builder-handoff',
        summary: 'Reviewed the final integrated parent result.',
        addressed_acceptance_ids: parentState.acceptance.map(({ id }) => id),
        checks: [],
        known_limits: [],
        review: {
          status: 'passed',
          summary: 'Independent parent code review passed.',
          reviewer_execution_ref: 'parent-reviewer',
        },
      }),
    );
    const integrated = await nativeNextCommand(
      ['parent', '--runner-input', parentReviewInput],
      repository,
    );
    expect(data(integrated).state).toMatchObject({ phase: 'verify' });
    const integratedState = await readNativePortableChange(parentPaths, 'parent');
    expect(integratedState).toMatchObject({
      phase: 'verify',
      builder_handoff: {
        addressed_acceptance_ids: parentState.acceptance.map(({ id }) => id),
        review: { reviewer_execution_ref: 'parent-reviewer' },
      },
    });
    expect(integratedState.acceptance.map(({ id, text }) => ({ id, text }))).toEqual(
      parentState.acceptance.map(({ id, text }) => ({ id, text })),
    );

    const parentChecks = await executeNativePortableCheckPlan({
      paths: parentPaths,
      name: 'parent',
      plans: [],
    });
    const parentDispatched = await dispatchNativePortableVerifier({
      paths: parentPaths,
      name: 'parent',
      checks: parentChecks.checks,
    });
    const verifier = createNativeRunnerChannel();
    const failed = await submitNativePortableVerifierResult({
      paths: parentPaths,
      name: 'parent',
      checks: parentChecks.checks,
      maxVerifyFailures: 3,
      envelope: verifier.envelopeVerifierResponse({
        candidateId: parentDispatched.builder_handoff!.candidate_id,
        identity: verifier.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'parent-verifier',
        }),
        payload: {
          kind: 'final-result',
          result: {
            iteration: parentDispatched.loop.iteration,
            attempt: parentDispatched.loop.attempt,
            verdict: 'fail',
            acceptance: parentDispatched.acceptance.map(({ id }, index) => ({
              id,
              result: index === 0 ? 'failed' : 'passed',
              reason: index === 0 ? 'The integrated behavior needs repair.' : 'Passed.',
            })),
            risks: [],
            summary: 'The parent integration needs a repair child.',
          },
        },
      }),
    });
    expect(failed.state).toMatchObject({
      phase: 'build',
      verification_result: 'fail',
      loop: { stage: 'repairing' },
    });

    const repairRequired = await nativeNextCommand(
      ['parent', '--summary', 'Plan the failed parent acceptance repair'],
      repository,
    );
    expect(data(repairRequired).continuation).toMatchObject({
      action: 'repair',
      requiredInputs: ['repair-child'],
      runnerAction: { kind: 'none' },
    });
    await fs.writeFile(path.join(parentDir, 'children.yaml'), REORDERED_CHILDREN);
    await expect(
      inspectNativePortableStatus({ paths: parentPaths, name: 'parent' }),
    ).resolves.toMatchObject({
      continuation: {
        action: 'advance-children',
        commandArgs: ['comet', 'native', 'next', 'parent', '--summary', '<summary>'],
        requiredInputs: ['summary'],
        runnerAction: { kind: 'none' },
      },
    });
    const bypassAttempt = await nativeNextCommand(
      ['parent', '--summary', 'Reorder completed children without repairing'],
      repository,
    );
    expect(data(bypassAttempt).state).toMatchObject({
      phase: 'shape',
      acceptance: { total: 0 },
    });
    await expect(
      nativeNextCommand(
        ['parent', '--summary', 'Try to reconfirm without a repair child', '--confirmed'],
        repository,
      ),
    ).rejects.toThrow(/repair plan requires an unfinished child covering: A1/iu);
    await fs.appendFile(
      path.join(parentDir, 'children.yaml'),
      `  - name: repair-parent-a1
    depends_on: [child-a, child-b, child-c]
    covers: [A1]
`,
    );
    const replanned = await nativeNextCommand(
      ['parent', '--summary', 'Confirm the repair child plan', '--confirmed'],
      repository,
    );
    expect(data(replanned)).toMatchObject({
      state: { phase: 'build' },
      readyChildren: ['repair-parent-a1'],
    });
    await expect(readNativePortableChange(parentPaths, 'parent')).resolves.toMatchObject({
      children_contract_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  }, 120_000);
});
