import { parseNativePortableArchiveTransaction } from '../../../domains/comet-native/native-portable-transactions.js';
import { nativeStatusCommand } from '../../../domains/comet-native/native-status-command.js';
import { storedNativeChangeFixture } from '../../helpers/native-change-document.js';
import '../../helpers/isolated-agent-home.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as gitCommands from '../../../platform/process/git.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  archiveNativePortableChange,
  inspectNativePortableArchive,
  nativePortableArchiveDirectory,
} from '../../../domains/comet-native/native-portable-archive.js';
import {
  confirmNativePortableSkillCoordinatedPass,
  createNativePortableChange,
  dispatchNativePortableVerifier,
  markNativePortableSpecRemoval,
  nativePortableChangeDir,
  readNativePortableChange,
  setNativePortableWorkspaceFinish,
  returnNativePortableChangeToShape,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

import {} from '../../../domains/comet-native/native-portable-storage.js';

function passedReview(reviewerExecutionRef: string) {
  return {
    status: 'passed' as const,
    summary: 'Independent read-only review passed.',
    reviewerExecutionRef,
  };
}

describe('Native Archive business migration', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-v4-'));
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, config);
    paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function verifyState(state: any, _retiredPlans?: unknown) {
    const name = state.name,
      runner = createNativeRunnerChannel();
    await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'SIMULATED-platform-fixture',
          executionRef: name + '-builder',
        }),
        candidateId: name + '-candidate',
        summary: 'SIMULATED isolated fixture implementation.',
        addressedAcceptanceIds: state.acceptance.map(({ id }: any) => id),
        acceptanceReview: state.acceptance.map(({ id }: any) => ({
          id,
          status: 'implemented-with-evidence',
          evidence: ['SIMULATED isolated fixture evidence'],
          note: 'SIMULATED archive fixture',
        })),
        checks: [
          {
            name: 'SIMULATED platform result',
            result: 'passed',
            note: 'No Runtime checker executed; isolated Agent result only.',
          },
        ],
        knownLimits: [],
      },
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name,
      verifierExecutionId: name + '-verifier',
    });
    await submitNativePortableVerifierResult({
      paths,
      name,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: name + '-candidate',
        identity: runner.captureExecutionIdentity({
          identityProvider: 'SIMULATED-platform-fixture',
          executionRef: name + '-verifier',
        }),
        payload: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'pass',
            acceptance: state.acceptance.map(({ id }: any) => ({
              id,
              result: 'passed',
              reason: 'SIMULATED isolated fixture observation.',
            })),
            risks: [],
            summary: 'SIMULATED independent fixture verification.',
          },
        },
      }),
    });
    // SIMULATED user acceptance belongs only to this isolated fixture.
    return confirmNativePortableSkillCoordinatedPass({ paths, name });
  }

  async function archiveReady(
    name = 'archive-change',
    specs: Array<[string, string]> = [
      ['sample', '# Sample\n\nRuntime MUST expose the updated behavior.\n'],
    ],
    workspaceBinding?: Parameters<typeof createNativePortableChange>[0]['workspaceBinding'],
    plans?: unknown,
    beforeVerify?: (state: Awaited<ReturnType<typeof confirmNativePortableShape>>) => Promise<void>,
  ) {
    await createNativePortableChange({
      paths,
      name,
      language: 'en',
      workspaceBinding,
    });
    if (workspaceBinding && workspaceBinding.isolation !== 'current')
      await setNativePortableWorkspaceFinish({ paths, name, finish: 'merge' });
    const changeDir = nativePortableChangeDir(paths, name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The canonical behavior is updated.\n',
    );
    for (const [capability, source] of specs) {
      await fs.mkdir(path.join(changeDir, 'specs', capability), {
        recursive: true,
      });
      await fs.writeFile(path.join(changeDir, 'specs', capability, 'spec.md'), source);
    }
    const shaped = await confirmNativePortableShape({ paths, name });
    await beforeVerify?.(shaped);
    return verifyState(shaped, plans);
  }

  async function bytes(dir: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    async function walk(current: string) {
      for (const e of await fs.readdir(current, { withFileTypes: true })) {
        const p = path.join(current, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile())
          result[path.relative(dir, p)] = (await fs.readFile(p)).toString('base64');
      }
    }
    await walk(dir);
    return result;
  }
  it('previews the same current Archive operations without writing business files', async () => {
    const s = await archiveReady('preview-business', [
      ['secondary', '# Secondary\nUpdated.\n'],
      ['workflow', '# Workflow\nUpdated.\n'],
    ]);
    const before = await bytes(root),
      first = await inspectNativePortableArchive({ paths, name: s.name }),
      second = await inspectNativePortableArchive({ paths, name: s.name });
    expect(first).toEqual(second);
    expect(first.ready).toBe(true);
    expect(first.specPreview).toEqual(
      expect.arrayContaining([
        {
          capability: 'secondary',
          operation: 'create',
          source: 'specs/secondary/spec.md',
        },
        {
          capability: 'workflow',
          operation: 'create',
          source: 'specs/workflow/spec.md',
        },
      ]),
    );
    expect(await bytes(root)).toEqual(before);
  });
  it('refuses Archive before Shape approval and completed acceptance without writing business files', async () => {
    const s = await createNativePortableChange({
        paths,
        name: 'not-approved',
        language: 'en',
      }),
      before = await bytes(root);
    expect((await inspectNativePortableArchive({ paths, name: s.name })).ready).toBe(false);
    await expect(archiveNativePortableChange({ paths, name: s.name })).rejects.toThrow(
      /archive-ready/,
    );
    expect(await bytes(root)).toEqual(before);
  });
  it('refuses an existing archive target without overwriting it', async () => {
    const s = await archiveReady('existing-target'),
      target = nativePortableArchiveDirectory(paths, s);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'user.txt'), 'original target');
    const before = await bytes(root);
    const preview = await inspectNativePortableArchive({ paths, name: s.name });
    expect(preview.ready).toBe(false);
    await expect(archiveNativePortableChange({ paths, name: s.name })).rejects.toThrow(
      /Archive layout contradicts|exist|target/,
    );
    expect(await bytes(root)).toEqual(before);
    expect(await fs.readFile(path.join(target, 'user.txt'), 'utf8')).toBe('original target');
    expect(await readNativePortableChange(paths, s.name)).toEqual(s);
    await expect(fs.readFile(path.join(paths.specsDir, 'sample/spec.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('rejects escaping capabilities and mismatched acceptance IDs at the current boundary', async () => {
    await createNativePortableChange({
      paths,
      name: 'unsafe-input',
      language: 'en',
    });
    await fs.writeFile(
      path.join(paths.changesDir, 'unsafe-input/brief.md'),
      '# Acceptance examples\n- The intended behavior is implemented.\n',
    );
    const s = await confirmNativePortableShape({ paths, name: 'unsafe-input' }),
      before = await bytes(root),
      runner = createNativeRunnerChannel();
    await expect(
      markNativePortableSpecRemoval({
        paths,
        name: s.name,
        capability: '../outside',
      }),
    ).rejects.toThrow(/Invalid Native capability/);
    await expect(
      submitNativePortableBuilderCandidate({
        paths,
        name: s.name,
        input: {
          identity: runner.captureExecutionIdentity({
            identityProvider: 'SIMULATED-fixture',
            executionRef: 'foreign-ids-builder',
          }),
          candidateId: 'foreign-ids-candidate',
          summary: 'SIMULATED',
          addressedAcceptanceIds: ['FOREIGN'],
          acceptanceReview: [],
          checks: [],
          knownLimits: [],
        },
      }),
    ).rejects.toThrow(/acceptance|unknown|ID/);
    expect(await bytes(root)).toEqual(before);
  });
  it.each(['skipped', 'missing'] as const)(
    'refuses %s acceptance in a passing Verifier outcome without mutating the candidate',
    async (kind) => {
      await createNativePortableChange({
        paths,
        name: 'invalid-acceptance',
        language: 'en',
      });
      await fs.writeFile(
        path.join(paths.changesDir, 'invalid-acceptance/brief.md'),
        '# Acceptance examples\n- All required acceptance is verified.\n',
      );
      const s = await confirmNativePortableShape({
          paths,
          name: 'invalid-acceptance',
        }),
        runner = createNativeRunnerChannel();
      await submitNativePortableBuilderCandidate({
        paths,
        name: s.name,
        input: {
          identity: runner.captureExecutionIdentity({
            identityProvider: 'SIMULATED-fixture',
            executionRef: 'acceptance-builder',
          }),
          candidateId: 'acceptance-candidate',
          summary: 'SIMULATED',
          addressedAcceptanceIds: s.acceptance.map((a) => a.id),
          acceptanceReview: fixtureAcceptanceReview(s.acceptance.map((a) => a.id)),
          checks: [
            {
              name: 'SIMULATED',
              result: 'passed',
              note: 'Protocol only, no checker.',
            },
          ],
          knownLimits: [],
        },
      });
      const ready = await dispatchNativePortableVerifier({
          paths,
          name: s.name,
          verifierExecutionId: 'acceptance-verifier',
        }),
        before = await bytes(root);
      await expect(
        submitNativePortableVerifierResult({
          paths,
          name: s.name,
          maxVerifyFailures: 5,
          envelope: runner.envelopeVerifierResponse({
            candidateId: 'acceptance-candidate',
            identity: runner.captureExecutionIdentity({
              identityProvider: 'SIMULATED-fixture',
              executionRef: 'acceptance-verifier',
            }),
            payload: {
              kind: 'final-result',
              result: {
                iteration: ready.loop.iteration,
                attempt: ready.loop.attempt,
                verdict: 'pass',
                acceptance:
                  kind === 'missing'
                    ? []
                    : ready.acceptance.map((a) => ({
                        id: a.id,
                        result: 'skipped',
                        reason: 'No verification',
                      })),
                risks: [],
                summary: 'SIMULATED invalid pass',
              },
            },
          }) as never,
        }),
      ).rejects.toThrow();
      expect(await bytes(root)).toEqual(before);
      expect((await inspectNativePortableArchive({ paths, name: s.name })).ready).toBe(false);
    },
  );
  it.each(['modify', 'remove'] as const)(
    'revises an accepted %s intent after canonical drift and requires fresh Shape and acceptance',
    async (operation) => {
      await fs.mkdir(path.join(paths.specsDir, 'sample'), { recursive: true });
      await fs.writeFile(
        path.join(paths.specsDir, 'sample/spec.md'),
        '# Sample\nOriginal canonical.\n',
      );
      let s = await archiveReady('revise-' + operation, [
        ['sample', '# Sample\nApproved target.\n'],
      ]);
      if (operation === 'remove') {
        await fs.rm(path.join(paths.changesDir, s.name, 'specs/sample'), {
          recursive: true,
        });
        s = await markNativePortableSpecRemoval({
          paths,
          name: s.name,
          capability: 'sample',
        });
        s = await confirmNativePortableShape({ paths, name: s.name });
        s = await verifyState(s);
      }
      await fs.writeFile(
        path.join(paths.specsDir, 'sample/spec.md'),
        '# Sample\nIndependent accepted canonical edit.\n',
      );
      s = await returnNativePortableChangeToShape({
        paths,
        name: s.name,
        reason: 'SIMULATED user requested explicit reconciliation after canonical change.',
        expectedContinuation: {
          stateVersion: s.state_version,
          action: 'revise-requirements',
        },
      });
      expect(s).toMatchObject({
        phase: 'shape',
        verification_result: 'pending',
        verification: null,
        builder_handoff: null,
        acceptance: [],
      });
      expect(s.spec_changes).toContainEqual(
        operation === 'remove'
          ? { capability: 'sample', operation: 'remove', source: null }
          : {
              capability: 'sample',
              operation: 'modify',
              source: 'specs/sample/spec.md',
            },
      );
      expect((await inspectNativePortableArchive({ paths, name: s.name })).ready).toBe(false);
      if (operation === 'modify')
        await fs.writeFile(
          path.join(paths.changesDir, s.name, 'specs/sample/spec.md'),
          '# Sample\nApproved target plus independent accepted edit.\n',
        );
      s = await confirmNativePortableShape({ paths, name: s.name });
      s = await verifyState(s);
      await archiveNativePortableChange({ paths, name: s.name });
      if (operation === 'remove')
        await expect(
          fs.readFile(path.join(paths.specsDir, 'sample/spec.md')),
        ).rejects.toMatchObject({ code: 'ENOENT' });
      else
        expect(await fs.readFile(path.join(paths.specsDir, 'sample/spec.md'), 'utf8')).toContain(
          'Approved target plus independent accepted edit.',
        );
    },
  );
  it('diagnoses legacy business state with explicit Doctor guidance without scanning content-proof peers or rewriting state', async () => {
    await storedNativeChangeFixture({
      paths,
      name: 'legacy-status',
      language: 'en',
    });
    const before = await bytes(root),
      result = await nativeStatusCommand(['legacy-status', '--details'], root);
    expect(result.data).toMatchObject({
      migrationRequired: true,
      status: 'blocked',
    });
    expect(JSON.stringify(result.data)).toMatch(/doctor.*--repair/);
    expect(await bytes(root)).toEqual(before);
  });

  it('rejects unsafe Archive transaction refs and malformed operation payloads without changing a legal transaction', () => {
    const transaction = {
      schema: 'comet.native.archive-transaction.v4',
      id: '00000000-0000-4000-8000-000000000001',
      change: 'safe-archive',
      start_state_version: 3,
      archive_ref: '2026-11-11-safe-archive',
      status: 'prepared',
      next_spec_index: 0,
      spec_changes: [
        {
          capability: 'sample',
          operation: 'create',
          source: 'specs/sample/spec.md',
          content: '# Sample\nApproved content.\n',
        },
      ],
      created_at: '2026-11-11T00:00:00.000Z',
    };
    const before = JSON.stringify(transaction);
    expect(parseNativePortableArchiveTransaction(transaction)).toEqual(transaction);
    for (const malformed of [
      { ...transaction, archive_ref: 'C:/archive/escape' },
      { ...transaction, archive_ref: '../escape' },
      {
        ...transaction,
        spec_changes: [{ ...transaction.spec_changes[0], source: '../escape/spec.md' }],
      },
      {
        ...transaction,
        spec_changes: [{ ...transaction.spec_changes[0], operation: 'remove' }],
      },
    ])
      expect(() => parseNativePortableArchiveTransaction(malformed)).toThrow();
    expect(JSON.stringify(transaction)).toBe(before);
  });
});
