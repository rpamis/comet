import { execFileSync } from 'node:child_process';
import { rebaseNativePortableDeltas } from '../../../domains/comet-native/native-portable-delta-rebase.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
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
          acceptanceReview: fixtureAcceptanceReview(shaped.acceptance.map(({ id }) => id)),
          review: {
            status: 'passed',
            summary: 'Independent read-only review passed.',
            reviewerExecutionRef: `${name}-reviewer`,
          },
        },
      });
    }
    const current = await readNativePortableChange(paths, name);
    const checkOutput = execFileSync(
      process.execPath,
      ['-e', 'console.log("Actual platform Delta check passed")'],
      { cwd: paths.projectRoot, encoding: 'utf8' },
    );
    expect(checkOutput).toContain('Actual platform Delta check passed');
    const executed = {
      checks: [
        {
          name: 'Delta test',
          result: 'passed' as const,
          note: checkOutput.trim(),
        },
      ],
    };
    const ready = await dispatchNativePortableVerifier({
      paths,
      name,
      checks: executed.checks,
    });
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
    await fs.mkdir(path.join(paths.specsDir, 'authentication'), {
      recursive: true,
    });
    await fs.writeFile(path.join(paths.specsDir, 'authentication', 'spec.md'), baseline);
    await createNativePortableChange({ paths, name, language: 'en' });
    const changeDir = nativePortableChangeDir(paths, name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The delta is applied.\n',
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'authentication'), {
      recursive: true,
    });
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
    await fs.mkdir(path.join(paths.specsDir, 'authentication'), {
      recursive: true,
    });
    await fs.writeFile(path.join(paths.specsDir, 'authentication', 'spec.md'), baseline);
    await createNativePortableChange({ paths, name, language: 'en' });
    const changeDir = nativePortableChangeDir(paths, name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The complete target Spec is applied.\n',
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'authentication'), {
      recursive: true,
    });
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
      },
    ]);
    const ready = await verify(name, shaped);
    await expect(inspectNativePortableArchive({ paths, name })).resolves.toMatchObject({
      ready: true,
      specPreview: [
        {
          capability: 'authentication',
          delta_source: 'specs/authentication/delta.yaml',
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

  it('applies an Agent-selected Delta to current canonical text and rejects a missing target', async () => {
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
    expect(preview.ready).toBe(true);
    await fs.writeFile(
      path.join(paths.specsDir, 'authentication', 'spec.md'),
      baseline.replace('authentication.password', 'authentication.renamed'),
    );
    const missing = await inspectNativePortableArchive({ paths, name });
    expect(missing.ready).toBe(false);
    expect(missing.blockers.join('\n')).toMatch(/authentication\.password|conflict/iu);
    await expect(archiveNativePortableChange({ paths, name })).rejects.toThrow(
      /authentication\.password|conflict/iu,
    );
  });

  it('explicitly rebases a passed Delta and returns only that requested change to Verify', async () => {
    const name = 'add-profile';
    const deltaText = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.sms\n    operation: add\n    title: SMS login\n    body: SMS login MUST be available.\n`;
    const shaped = await prepareChange(name, deltaText, {
      'authentication.profile': null,
    });
    await verify(name, shaped);
    await fs.writeFile(
      path.join(paths.specsDir, 'authentication', 'spec.md'),
      `${baseline}## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`,
    );

    await rebaseNativePortableDeltas({ paths, name });
    await expect(readNativePortableChange(paths, name)).resolves.toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      verification: null,
      loop: {
        stage: 'verify-ready',
        next_action: 'run-final-full-verification',
      },
    });

    const rebasedDelta = await fs.readFile(
      path.join(paths.changesDir, name, 'specs', 'authentication', 'delta.yaml'),
      'utf8',
    );
    expect(rebasedDelta).not.toContain('base_hash:');
    expect(rebasedDelta).toContain('base_version: 2');
    const reshaped = await verify(name, shaped, true);
    expect(reshaped.phase).toBe('archive');
    await archiveNativePortableChange({ paths, name });
    await expect(
      fs.readFile(path.join(paths.specsDir, 'authentication', 'spec.md'), 'utf8'),
    ).resolves.toContain('authentication.profile');
  });

  it('keeps Archive dry-run preview-only after an independent canonical Delta edit', async () => {
    const name = 'dry-run-rebase-preview';
    const deltaText = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.sms\n    operation: add\n    title: SMS login\n    body: SMS login MUST be available.\n`;
    const shaped = await prepareChange(name, deltaText, {
      'authentication.profile': null,
    });
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
        ready: true,
        requiresReverification: false,
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

  it('resumes a prepared Delta transaction without overwriting an independent canonical addition', async () => {
    const name = 'prepared-transaction-rebase';
    const passwordSection =
      '## Requirement: authentication.password Password login\n\nPassword behavior.\n\n';
    const deltaText = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.password\n    operation: modify\n    expected_hash: ${nativeRequirementSectionHash(passwordSection)}\n    body: Password behavior with a session check.\n`;
    const shaped = await prepareChange(name, deltaText, {
      'authentication.profile': null,
    });
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

    const resumed = await archiveNativePortableChange({ paths, name });
    expect(resumed).toMatchObject({
      transactionId: transaction.id,
      state: { phase: 'archive', status: 'done', archived: true },
    });
    const canonical = await fs.readFile(
      path.join(paths.specsDir, 'authentication', 'spec.md'),
      'utf8',
    );
    expect(canonical).toContain('Password behavior with a session check.');
    expect(canonical).toContain('authentication.profile');
    expect(canonical).toContain('Profile behavior.');
    await expect(nativeArchiveCommand([name, '--confirmed'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: { archived: true },
    });
    expect(await fs.readFile(path.join(paths.specsDir, 'authentication', 'spec.md'), 'utf8')).toBe(
      canonical,
    );
    await expect(
      fs.stat(nativePortableTransactionFile(paths, { kind: 'archive', change: name })),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('explicitly rebases an already applied Delta with an independent canonical addition', async () => {
    const name = 'add-profile-after-replay';
    const deltaText = `schema: comet.native.delta.v1\ncapability: authentication\nbase_hash: ${sha256(baseline)}\nbase_version: 1\nlegacy_hash: ${nativeLegacySectionHash(baseline)}\noperations:\n  - id: authentication.sms\n    operation: add\n    title: SMS login\n    body: SMS login MUST be available.\n`;
    const shaped = await prepareChange(name, deltaText, {
      'authentication.profile': null,
    });
    await verify(name, shaped);
    const merged = applyNativeDelta({
      baselineMarkdown: baseline,
      delta: parseNativeDelta(deltaText),
    }).markdown;
    await fs.writeFile(
      path.join(paths.specsDir, 'authentication', 'spec.md'),
      `${merged}## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`,
    );

    await rebaseNativePortableDeltas({ paths, name });
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
