import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { atomicWriteJson } from '../../../domains/comet-native/native-atomic-file.js';
import {
  archiveNativePortableChange,
  inspectNativePortableArchive,
} from '../../../domains/comet-native/native-portable-archive.js';
import { nativeArchiveCommand } from '../../../domains/comet-native/native-archive-command.js';
import {
  confirmNativePortableSkillCoordinatedPass,
  createNativePortableChange,
  dispatchNativePortableVerifier,
  executeNativePortableCheckPlan,
  nativePortableChangeDir,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import {
  applyNativeDelta,
  inspectNativeTotalSpec,
  nativeLegacySectionHash,
  nativeRequirementSectionHash,
  nativeTotalSpecHash,
  parseNativeDelta,
  renderNativeDelta,
} from '../../../domains/comet-native/native-delta-spec.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA,
  nativePortableTransactionFile,
  type NativePortableArchiveTransaction,
} from '../../../domains/comet-native/native-portable-transactions.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

const baseline = `# Authentication\n\n## Requirement: authentication.password Password login\n\nPassword behavior.\n\n`;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('Native portable delta integration', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-portable-delta-'));
    await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
    paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function verify(
    name: string,
    shaped: Awaited<ReturnType<typeof confirmNativePortableShape>>,
    existingCandidate = false,
  ) {
    const runner = createNativeRunnerChannel();
    if (!existingCandidate) {
      await submitNativePortableBuilderCandidate({
        paths,
        name,
        input: {
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: `${name}-builder`,
          }),
          candidateId: `${name}-candidate`,
          summary: 'Implemented the delta.',
          addressedAcceptanceIds: shaped.acceptance.map(({ id }) => id),
          review: {
            status: 'passed',
            summary: 'Independent read-only review passed.',
            reviewerExecutionRef: `${name}-reviewer`,
          },
        },
      });
    }
    const current = await readNativePortableChange(paths, name);
    const executed = await executeNativePortableCheckPlan({
      paths,
      name,
      plans: [
        {
          id: 'delta-test',
          name: 'Delta test',
          executable: process.execPath,
          argv: ['-e', 'process.exit(0)'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    });
    const ready = await dispatchNativePortableVerifier({ paths, name, checks: executed.checks });
    await submitNativePortableVerifierResult({
      paths,
      name,
      checks: executed.checks,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: current.builder_handoff?.candidate_id ?? `${name}-candidate`,
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: `${name}-${existingCandidate ? 'rebased-' : ''}verifier`,
        }),
        payload: {
          kind: 'final-result',
          result: {
            iteration: ready.loop.iteration,
            attempt: ready.loop.attempt,
            verdict: 'pass',
            acceptance: ready.acceptance.map(({ id }) => ({
              id,
              result: 'passed',
              reason: 'Verified.',
            })),
            risks: [],
            summary: 'Passed.',
          },
        },
      }),
    });
    return confirmNativePortableSkillCoordinatedPass({ paths, name });
  }

  async function prepareChange(
    name: string,
    deltaText: string,
    independentRequirements: Readonly<Record<string, string | null>> = {},
  ): Promise<Awaited<ReturnType<typeof confirmNativePortableShape>>> {
    await fs.mkdir(path.join(paths.specsDir, 'authentication'), { recursive: true });
    await fs.writeFile(path.join(paths.specsDir, 'authentication', 'spec.md'), baseline);
    await createNativePortableChange({ paths, name, language: 'en' });
    const changeDir = nativePortableChangeDir(paths, name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The delta is applied.\n',
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'authentication'), { recursive: true });
    const parsedDelta = parseNativeDelta(deltaText);
    const preparedDelta = {
      ...parsedDelta,
      base_requirements: Object.fromEntries(
        inspectNativeTotalSpec(baseline).requirements.map((requirement) => [
          requirement.id,
          nativeRequirementSectionHash(requirement.raw),
        ]),
      ),
      ...(Object.keys(independentRequirements).length > 0
        ? { independent_requirements: independentRequirements }
        : {}),
    };
    const target = applyNativeDelta({
      baselineMarkdown: baseline,
      delta: preparedDelta,
    }).markdown;
    await fs.writeFile(path.join(changeDir, 'specs', 'authentication', 'spec.md'), target);
    await fs.writeFile(
      path.join(changeDir, 'specs', 'authentication', 'delta.yaml'),
      renderNativeDelta(preparedDelta),
    );
    return confirmNativePortableShape({ paths, name });
  }

  async function prepareFullChange(
    name: string,
    target: string,
  ): Promise<Awaited<ReturnType<typeof confirmNativePortableShape>>> {
    await fs.mkdir(path.join(paths.specsDir, 'authentication'), { recursive: true });
    await fs.writeFile(path.join(paths.specsDir, 'authentication', 'spec.md'), baseline);
    await createNativePortableChange({ paths, name, language: 'en' });
    const changeDir = nativePortableChangeDir(paths, name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The complete target Spec is applied.\n',
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'authentication'), { recursive: true });
    await fs.writeFile(path.join(changeDir, 'specs', 'authentication', 'spec.md'), target);
    return confirmNativePortableShape({ paths, name });
  }

  it('records a versioned delta and merges it into the complete canonical Spec', async () => {
    const name = 'add-sms-login';
    const deltaText = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.sms\n    operation: add\n    title: SMS login\n    body: SMS login MUST be available.\n`;
    const shaped = await prepareChange(name, deltaText);
    expect(shaped.spec_changes).toMatchObject([
      {
        capability: 'authentication',
        delta_source: 'specs/authentication/delta.yaml',
        base_hash: sha256(baseline),
      },
    ]);
    const ready = await verify(name, shaped);
    await expect(inspectNativePortableArchive({ paths, name })).resolves.toMatchObject({
      ready: true,
      specPreview: [
        {
          capability: 'authentication',
          delta_source: 'specs/authentication/delta.yaml',
          target_hash: expect.any(String),
          delta_operations: [{ id: 'authentication.sms', operation: 'add', status: 'changed' }],
        },
      ],
    });
    await archiveNativePortableChange({ paths, name });

    const canonical = await fs.readFile(
      path.join(paths.specsDir, 'authentication', 'spec.md'),
      'utf8',
    );
    expect(canonical).toContain('authentication.password');
    expect(canonical).toContain('authentication.sms');
    expect(ready.phase).toBe('archive');
  });

  it('rebases an independent canonical edit and blocks an overlapping edit', async () => {
    const name = 'modify-password';
    const passwordSection = `## Requirement: authentication.password Password login\n\nPassword behavior.\n\n`;
    const deltaText = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.password\n    operation: modify\n    expected_hash: ${nativeRequirementSectionHash(passwordSection)}\n    body: Password behavior with a session check.\n`;
    const shaped = await prepareChange(name, deltaText);
    await verify(name, shaped);
    await fs.writeFile(
      path.join(paths.specsDir, 'authentication', 'spec.md'),
      baseline.replace('Password behavior.', 'Password behavior changed elsewhere.'),
    );

    const preview = await inspectNativePortableArchive({ paths, name });
    expect(preview.ready).toBe(false);
    expect(preview.blockers.join('\n')).toMatch(/authentication\.password|conflict/iu);
    await expect(archiveNativePortableChange({ paths, name })).rejects.toThrow(
      /authentication\.password|conflict/iu,
    );
  });

  it('returns a passed change to Verify when an independent rebase changes the result', async () => {
    const name = 'add-profile';
    const deltaText = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.sms\n    operation: add\n    title: SMS login\n    body: SMS login MUST be available.\n`;
    const shaped = await prepareChange(name, deltaText, { 'authentication.profile': null });
    await verify(name, shaped);
    await fs.writeFile(
      path.join(paths.specsDir, 'authentication', 'spec.md'),
      `${baseline}## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`,
    );

    await expect(archiveNativePortableChange({ paths, name })).rejects.toThrow(
      /fresh verification/iu,
    );
    await expect(readNativePortableChange(paths, name)).resolves.toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      verification: null,
      loop: { stage: 'verify-ready', next_action: 'run-final-full-verification' },
    });

    const rebasedDelta = await fs.readFile(
      path.join(paths.changesDir, name, 'specs', 'authentication', 'delta.yaml'),
      'utf8',
    );
    expect(rebasedDelta).toContain(
      `base_hash: ${sha256(`${baseline}## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`)}`,
    );
    const reshaped = await verify(name, shaped, true);
    expect(reshaped.phase).toBe('archive');
    await archiveNativePortableChange({ paths, name });
    await expect(
      fs.readFile(path.join(paths.specsDir, 'authentication', 'spec.md'), 'utf8'),
    ).resolves.toContain('authentication.profile');
  });

  it('keeps Archive dry-run preview-only when a delta needs re-verification', async () => {
    const name = 'dry-run-rebase-preview';
    const deltaText = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.sms\n    operation: add\n    title: SMS login\n    body: SMS login MUST be available.\n`;
    const shaped = await prepareChange(name, deltaText, { 'authentication.profile': null });
    await verify(name, shaped);
    await fs.writeFile(
      path.join(paths.specsDir, 'authentication', 'spec.md'),
      `${baseline}## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`,
    );
    const beforeState = await readNativePortableChange(paths, name);
    const beforeDelta = await fs.readFile(
      path.join(paths.changesDir, name, 'specs', 'authentication', 'delta.yaml'),
      'utf8',
    );

    await expect(nativeArchiveCommand([name, '--dry-run'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        archived: false,
        ready: false,
        recovery: { action: 'reverify' },
      },
    });
    await expect(readNativePortableChange(paths, name)).resolves.toMatchObject({
      state_version: beforeState.state_version,
      phase: 'archive',
      verification_result: 'pass',
    });
    await expect(
      fs.readFile(
        path.join(paths.changesDir, name, 'specs', 'authentication', 'delta.yaml'),
        'utf8',
      ),
    ).resolves.toBe(beforeDelta);
  });

  it('discards a prepared Archive transaction when its canonical delta base changes', async () => {
    const name = 'prepared-transaction-rebase';
    const passwordSection =
      '## Requirement: authentication.password Password login\n\nPassword behavior.\n\n';
    const deltaText = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.password\n    operation: modify\n    expected_hash: ${nativeRequirementSectionHash(passwordSection)}\n    body: Password behavior with a session check.\n`;
    const shaped = await prepareChange(name, deltaText, { 'authentication.profile': null });
    await verify(name, shaped);
    const preparedDeltaText = await fs.readFile(
      path.join(paths.changesDir, name, 'specs', 'authentication', 'delta.yaml'),
      'utf8',
    );
    const target = applyNativeDelta({
      baselineMarkdown: baseline,
      delta: parseNativeDelta(preparedDeltaText),
    }).markdown;
    const state = await readNativePortableChange(paths, name);
    const transaction: NativePortableArchiveTransaction = {
      schema: NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA,
      id: '7b7f7c6b-0b7c-4f4c-9a4c-5b75a4ec7f2d',
      change: name,
      start_state_version: state.state_version,
      archive_ref: `${(state.verification?.completed_at ?? state.created_at).slice(0, 10)}-${name}`,
      status: 'prepared',
      next_spec_index: 0,
      spec_changes: [
        {
          capability: 'authentication',
          operation: 'modify',
          source: 'specs/authentication/spec.md',
          content: target,
          delta_source: 'specs/authentication/delta.yaml',
          base_hash: sha256(baseline),
          delta_content: preparedDeltaText,
          source_content: target,
          expected_target_hash: sha256(baseline),
          result_hash: sha256(target),
        },
      ],
      created_at: new Date().toISOString(),
    };
    await atomicWriteJson(
      nativePortableTransactionFile(paths, { kind: 'archive', change: name }),
      transaction,
      { containedRoot: paths.runtimeDir },
    );
    await fs.writeFile(
      path.join(paths.specsDir, 'authentication', 'spec.md'),
      `${baseline}## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`,
    );

    await expect(archiveNativePortableChange({ paths, name })).rejects.toThrow(
      /fresh verification/iu,
    );
    await expect(readNativePortableChange(paths, name)).resolves.toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
    });
    await expect(
      fs.stat(nativePortableTransactionFile(paths, { kind: 'archive', change: name })),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires fresh verification when the delta is already applied but another edit is present', async () => {
    const name = 'add-profile-after-replay';
    const deltaText = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.sms\n    operation: add\n    title: SMS login\n    body: SMS login MUST be available.\n`;
    const shaped = await prepareChange(name, deltaText, { 'authentication.profile': null });
    await verify(name, shaped);
    const merged = applyNativeDelta({
      baselineMarkdown: baseline,
      delta: parseNativeDelta(deltaText),
    }).markdown;
    await fs.writeFile(
      path.join(paths.specsDir, 'authentication', 'spec.md'),
      `${merged}## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`,
    );

    await expect(archiveNativePortableChange({ paths, name })).rejects.toThrow(
      /fresh verification/iu,
    );
    await expect(readNativePortableChange(paths, name)).resolves.toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      verification: null,
    });
    const reshaped = await verify(name, shaped, true);
    expect(reshaped.phase).toBe('archive');
    await archiveNativePortableChange({ paths, name });
    await expect(
      fs.readFile(path.join(paths.specsDir, 'authentication', 'spec.md'), 'utf8'),
    ).resolves.toContain('authentication.profile');
  });

  it('replays a full Spec safely when the canonical write succeeded before the cursor update', async () => {
    const name = 'prepared-full-write-window';
    const target = `${baseline}## Requirement: authentication.sms SMS login\n\nSMS login MUST be available.\n\n`;
    const shaped = await prepareFullChange(name, target);
    await verify(name, shaped);
    const state = await readNativePortableChange(paths, name);
    const transaction: NativePortableArchiveTransaction = {
      schema: NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA,
      id: '4a2adf7a-4dfb-4fb0-865b-e4aaf4c7d6d1',
      change: name,
      start_state_version: state.state_version,
      archive_ref: `${(state.verification?.completed_at ?? state.created_at).slice(0, 10)}-${name}`,
      status: 'prepared',
      next_spec_index: 0,
      spec_changes: [
        {
          capability: 'authentication',
          operation: 'modify',
          source: 'specs/authentication/spec.md',
          content: target,
          expected_target_hash: nativeTotalSpecHash(baseline),
          result_hash: nativeTotalSpecHash(target),
        },
      ],
      created_at: new Date().toISOString(),
    };
    await atomicWriteJson(
      nativePortableTransactionFile(paths, { kind: 'archive', change: name }),
      transaction,
      { containedRoot: paths.runtimeDir },
    );
    await fs.writeFile(path.join(paths.specsDir, 'authentication', 'spec.md'), target);

    await expect(archiveNativePortableChange({ paths, name })).resolves.toMatchObject({
      state: { archived: true, status: 'done' },
    });
    await expect(
      fs.readFile(
        path.join(paths.archiveDir, transaction.archive_ref, 'specs', 'authentication', 'spec.md'),
        'utf8',
      ),
    ).resolves.toBe(target);
  });

  it('returns a specs-applied full Spec transaction to Verify after an external edit', async () => {
    const name = 'applied-full-drift';
    const target = `${baseline}## Requirement: authentication.sms SMS login\n\nSMS login MUST be available.\n\n`;
    const shaped = await prepareFullChange(name, target);
    await verify(name, shaped);
    const state = await readNativePortableChange(paths, name);
    const transaction: NativePortableArchiveTransaction = {
      schema: NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA,
      id: '0f7ca345-90e7-43ed-9e88-864ea784e1e2',
      change: name,
      start_state_version: state.state_version,
      archive_ref: `${(state.verification?.completed_at ?? state.created_at).slice(0, 10)}-${name}`,
      status: 'specs-applied',
      next_spec_index: 1,
      spec_changes: [
        {
          capability: 'authentication',
          operation: 'modify',
          source: 'specs/authentication/spec.md',
          content: target,
          expected_target_hash: nativeTotalSpecHash(baseline),
          result_hash: nativeTotalSpecHash(target),
        },
      ],
      created_at: new Date().toISOString(),
    };
    await atomicWriteJson(
      nativePortableTransactionFile(paths, { kind: 'archive', change: name }),
      transaction,
      { containedRoot: paths.runtimeDir },
    );
    const external = `${baseline}## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`;
    await fs.writeFile(path.join(paths.specsDir, 'authentication', 'spec.md'), external);

    await expect(archiveNativePortableChange({ paths, name })).rejects.toThrow(
      /fresh verification/iu,
    );
    await expect(readNativePortableChange(paths, name)).resolves.toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      loop: { stage: 'verify-ready' },
    });
    await expect(
      fs.stat(nativePortableTransactionFile(paths, { kind: 'archive', change: name })),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('archives remove and rename deltas without replaying the complete history', async () => {
    const removeName = 'remove-password';
    const passwordSection =
      '## Requirement: authentication.password Password login\n\nPassword behavior.\n\n';
    const removeDelta = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.password\n    operation: remove\n    expected_hash: ${nativeRequirementSectionHash(passwordSection)}\n`;
    const removeShape = await prepareChange(removeName, removeDelta);
    await verify(removeName, removeShape);
    await archiveNativePortableChange({ paths, name: removeName });
    await expect(
      fs.readFile(path.join(paths.specsDir, 'authentication', 'spec.md'), 'utf8'),
    ).resolves.not.toContain('authentication.password');

    const renameName = 'rename-password';
    await fs.writeFile(path.join(paths.specsDir, 'authentication', 'spec.md'), baseline);
    const renameDelta = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.password\n    operation: rename\n    to_id: authentication.passcode\n    expected_hash: ${nativeRequirementSectionHash(passwordSection)}\n`;
    const renameShape = await prepareChange(renameName, renameDelta);
    await verify(renameName, renameShape);
    await archiveNativePortableChange({ paths, name: renameName });
    await expect(
      fs.readFile(path.join(paths.specsDir, 'authentication', 'spec.md'), 'utf8'),
    ).resolves.toMatch(/authentication\.passcode/iu);
  });
});
