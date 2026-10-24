import * as requirements from '../../../domains/comet-native/native-portable-requirements.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as acceptanceParser from '../../../domains/comet-native/native-acceptance.js';
import { deriveBriefAcceptanceCriteria } from '../../../domains/comet-native/native-acceptance.js';
import { inspectNativePortableAcceptanceDrift } from '../../../domains/comet-native/native-portable-requirements.js';
import {
  collectNativeSdkShapeProposal,
  defineNativeWorkflowApplication,
} from '../../../domains/comet-native/native-sdk-application.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import {
  createMemoryRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

describe('Native acceptance Markdown boundaries', () => {
  it.each(['Acceptance examples', '验收示例'])(
    'ends %s at a sibling or higher heading, at any heading depth',
    (title) => {
      for (const depth of [1, 2, 3]) {
        for (let boundary = 1; boundary <= depth; boundary++) {
          const source = `${'#'.repeat(depth)} ${title}\r\n- First criterion.\r\n- Last criterion.\r\n\r\n${'#'.repeat(boundary)} Independent section\r\n- Never a criterion.\r\n`;
          expect(deriveBriefAcceptanceCriteria(source).map(({ text }) => text)).toEqual([
            'First criterion.',
            'Last criterion.',
          ]);
        }
      }
    },
  );

  it('does not append a later block to the final list item even inside its section', () => {
    const source = `# Acceptance examples
- First criterion.
- Last criterion.

## Spec → 测试名与断言计划
| Test | Line |
| --- | --- |
| last criterion | planned |
`;
    expect(deriveBriefAcceptanceCriteria(source).map(({ text }) => text)).toEqual([
      'First criterion.',
      'Last criterion.',
    ]);
  });

  it('retains nested criterion headings, lists, tables and fenced examples', () => {
    const source = `## Acceptance examples
- First criterion.

  ### Detailed contract
  The result is visible.

  - Nested requirement.

  | Input | Output |
  | --- | --- |
  | valid | accepted |

  \`\`\`\`md
  # Not a real boundary
  ## Acceptance examples
  - Not a new criterion.
  \`\`\`
  Still inside the four-backtick fence.
  \`\`\`\`
- Second criterion.

### A lower acceptance subsection
- Third criterion.

## Independent section
Ignored text.
`;
    const criteria = deriveBriefAcceptanceCriteria(source);
    expect(criteria).toHaveLength(3);
    expect(criteria[0].text).toContain('### Detailed contract The result is visible.');
    expect(criteria[0].text).toContain('- Nested requirement.');
    expect(criteria[0].text).toContain('| valid | accepted |');
    expect(criteria[0].text).toContain('# Not a real boundary');
    expect(criteria[0].text).toContain('Still inside the four-backtick fence.');
    expect(criteria[1].text).toBe('Second criterion.');
    expect(criteria[2].text).toBe('Third criterion.');
    expect(
      deriveBriefAcceptanceCriteria(source.replace('accepted |', 'rejected |'))[0].id,
    ).not.toBe(criteria[0].id);
  });

  it('recognizes ordered and unordered items without promoting nested lists', () => {
    expect(
      deriveBriefAcceptanceCriteria(
        '# Acceptance examples\n1. First criterion.\n   - Nested detail.\n2. Second criterion.\n',
      ).map(({ text }) => text),
    ).toEqual(['First criterion. - Nested detail.', 'Second criterion.']);
  });

  it('honors setext section boundaries and preserves task-checkbox content', () => {
    const source =
      'Acceptance examples\n===================\n- [ ] First criterion.\n- [x] Second criterion.\n\nIndependent section\n===================\n- Not a criterion.\n';
    expect(deriveBriefAcceptanceCriteria(source).map(({ text }) => text)).toEqual([
      '[ ] First criterion.',
      '[x] Second criterion.',
    ]);
    expect(deriveBriefAcceptanceCriteria(source.replace('[x]', '[ ]'))[1].id).not.toBe(
      deriveBriefAcceptanceCriteria(source)[1].id,
    );
  });

  it('ignores fenced and commented headings, but rejects duplicate real sections', () => {
    expect(
      deriveBriefAcceptanceCriteria(
        '<!--\n## Acceptance examples\n- Hidden.\n-->\n```md\n## Acceptance examples\n- Hidden.\n```\n## Acceptance examples\n- Visible.\n',
      ).map(({ text }) => text),
    ).toEqual(['Visible.']);
    expect(() =>
      deriveBriefAcceptanceCriteria(
        '# Acceptance examples\n- First.\n## Acceptance examples\n- Duplicate.\n',
      ),
    ).toThrow('exactly one');
  });
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const brief = `# Outcome
Keep the confirmed contract.
# Scope
No product behavior change: documentation-only clarification of the existing contract.
## Directory structure
### Created
None.
### Modified
- README.md: clarify the existing contract.
### Deleted
None.
### Not created
None.
# Non-goals
None.
# Acceptance examples
- First criterion.
- Last criterion.

## Spec → 测试名与断言计划
| Test | Line |
| --- | --- |
| last criterion | planned |
`;

async function buildingFixture(source = brief, legacyShape = false) {
  const readShape = requirements.readNativePortableAcceptance;
  // Reproduce the released hash-only proposal through the normal Runtime transitions.
  const legacyReader = legacyShape
    ? vi
        .spyOn(requirements, 'readNativePortableAcceptance')
        .mockImplementation((options) =>
          readShape({ ...options, captureSemanticSnapshot: false, legacyOnly: true }),
        )
    : null;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-acceptance-boundaries-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const name = 'acceptance-boundaries';
  const changeDir = path.join(paths.changesDir, name);
  await fs.mkdir(changeDir);
  await fs.writeFile(path.join(changeDir, 'brief.md'), source);
  const application = defineNativeWorkflowApplication();
  const store = createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({
    store,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    validators: application.validators,
    stateValidators: application.stateValidators,
    commandValidators: application.commandValidators,
    executors: application.executors,
  });
  let run = await runtime.start({
    runId: name,
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: { name, artifactRootRef: 'docs' },
    initialState: createNativePortableState({
      name,
      language: 'en',
      createdAt: '2026-10-24T00:00:00.000Z',
      nextAction: 'prepare-shape-confirmation',
    }),
  });
  const submit = async (output: unknown, sessionId?: string) => {
    const action = run.actions.at(-1)!;
    const context = { requestId: action.id, projectRoot: root };
    const claimed = await runtime.claim({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'test-host',
      claimToken: action.id,
      ...(sessionId ? { sessionId } : {}),
      context,
    });
    run = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: claimed.actions.at(-1)!.claim!.token,
        outcomeId: action.id,
        status: 'succeeded',
        output,
      },
      context,
    });
    return run;
  };
  await submit(
    await collectNativeSdkShapeProposal({ paths, state: run.state as NativePortableState }),
  );
  const wait = run.waits.at(-1)!;
  run = await runtime.resolveWait({
    runId: name,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'approved',
    choice: 'approved',
  });
  await submit(
    await collectNativeSdkShapeProposal({ paths, state: run.state as NativePortableState }),
  );
  legacyReader?.mockRestore();
  const submitBuilder = () =>
    submit(
      {
        summary: 'The confirmed criteria are implemented.',
        addressedAcceptanceIds: ['A1', 'A2'],
        acceptanceReview: fixtureAcceptanceReview(['A1', 'A2']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-10-24T01:00:00.000Z',
        verificationChecks: [],
      },
      'builder-session',
    );
  return { root, paths, changeDir, run, runtime, store, submitBuilder };
}

describe('Native Shape to Builder acceptance boundaries', () => {
  it('confirms only actual list items and accepts an unchanged Builder handoff', async () => {
    const fixture = await buildingFixture();
    expect((fixture.run.state as NativePortableState).acceptance.map(({ text }) => text)).toEqual([
      'First criterion.',
      'Last criterion.',
    ]);
    expect((await fixture.submitBuilder()).actions.at(-1)?.stepId).toBe('verify.checks');
  });

  it.each(['Nested requirement.', '| valid | accepted |', 'mustReject()'])(
    'rejects actual nested acceptance content edits: %s',
    async (content) => {
      const source = brief.replace(
        '- Last criterion.',
        '- Last criterion.\n\n  ### Contract details\n  - Nested requirement.\n\n  | Input | Output |\n  | --- | --- |\n  | valid | accepted |\n\n  ```js\n  mustReject()\n  ```',
      );
      const fixture = await buildingFixture(source);
      await fs.writeFile(
        path.join(fixture.changeDir, 'brief.md'),
        source.replace(content, 'Changed requirement.'),
      );
      await expect(fixture.submitBuilder()).rejects.toThrow(
        'Native confirmed acceptance criteria changed',
      );
    },
  );

  it.each([
    ['Last criterion.', 'Changed criterion.', 'Native confirmed acceptance criteria changed'],
    ['existing contract.', 'a different contract.', 'Native Shape artifacts changed'],
  ])(
    'distinguishes %s edits without losing the original Run or approval',
    async (from, to, reason) => {
      const fixture = await buildingFixture();
      await fs.writeFile(path.join(fixture.changeDir, 'brief.md'), brief.replace(from, to));
      await expect(fixture.submitBuilder()).rejects.toThrow(reason);
      const stored = await fixture.runtime.inspect(fixture.run.runId);
      expect(stored.state).toEqual(fixture.run.state);
      expect(stored.waits).toEqual(fixture.run.waits);
      expect(stored.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'running' });
    },
  );

  it('retains a 0.5.0 acceptance snapshot only while the original approved artifacts match', async () => {
    // 0.5.0 发布的扫描算法生成同样的持久快照；通过公开 Shape 路径建立批准记录。
    const legacy = vi
      .spyOn(acceptanceParser, 'deriveBriefAcceptanceCriteria')
      .mockImplementation(acceptanceParser.deriveLegacyBriefAcceptanceCriteria);
    const fixture = await buildingFixture(brief, true);
    legacy.mockRestore();
    const state = fixture.run.state as NativePortableState;
    // 来自 tag 0.5.0 (aeb1a65) CLI 的 prepare → confirm 持久确认指纹。
    expect(state.shape_confirmation_hash).toBe(
      'ae4b4200269a0f37451b9cababcaac1fcc4735742a6391ab4f06140687edf944',
    );
    expect(state.acceptance[1].text).toBe(
      'Last criterion. ## Spec → 测试名与断言计划 | Test | Line | | --- | --- | | last criterion | planned |',
    );
    expect((await fixture.submitBuilder()).state).toMatchObject({
      acceptance: state.acceptance,
      shape_confirmation_hash: state.shape_confirmation_hash,
      loop: { goal_cycle: state.loop.goal_cycle },
    });
  });

  it.each([
    ['planned', '42'],
    ['Last criterion.', 'Changed criterion.'],
    ['Last criterion.', 'Last criterion. Additional required behavior.'],
  ])('does not trim a changed legacy snapshot to make %s pass', async (from, to) => {
    const legacy = vi
      .spyOn(acceptanceParser, 'deriveBriefAcceptanceCriteria')
      .mockImplementation(acceptanceParser.deriveLegacyBriefAcceptanceCriteria);
    const fixture = await buildingFixture(brief, true);
    legacy.mockRestore();
    await fs.writeFile(path.join(fixture.changeDir, 'brief.md'), brief.replace(from, to));
    await expect(fixture.submitBuilder()).rejects.toThrow('revise-requirements on this change');
    const stored = await fixture.runtime.inspect(fixture.run.runId);
    expect(stored.state).toEqual(fixture.run.state);
    expect(stored.waits).toEqual(fixture.run.waits);
    expect(stored.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'running' });
  });

  it('requires the original full approval fingerprint for legacy compatibility', async () => {
    const legacy = vi
      .spyOn(acceptanceParser, 'deriveBriefAcceptanceCriteria')
      .mockImplementation(acceptanceParser.deriveLegacyBriefAcceptanceCriteria);
    const fixture = await buildingFixture(brief, true);
    legacy.mockRestore();
    for (const fingerprint of [undefined, '0'.repeat(64)]) {
      const state = {
        ...(fixture.run.state as NativePortableState),
        shape_confirmation_hash: fingerprint,
      };
      expect(
        await inspectNativePortableAcceptanceDrift({ paths: fixture.paths, state }),
      ).toMatchObject({
        drifted: true,
        reason: expect.stringContaining('revise-requirements on this change'),
      });
    }
  });
});
