import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeNativeChange, nativeChangeDir } from '../../../domains/comet-native/native-change.js';
import {
  inspectNativeStatus,
  listNativeStatus,
  listNativeStatusPage,
  NATIVE_STATUS_PAGE_LIMITS,
} from '../../../domains/comet-native/native-diagnostics.js';
import { readNativeWorkspaceIdentity } from '../../../domains/comet-native/native-workspace.js';
import { nativeContinuation } from '../../../domains/comet-native/native-continuation.js';
import { nativeTransitionJournalFile } from '../../../domains/comet-native/native-transition-journal.js';
import {
  nativeChangeRuntimeDir,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { selectNativeChange } from '../../../domains/comet-native/native-selection.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';
// SIMULATED stored documents exercise only the legacy parser/status view; actual pending WAL comes from the frozen published package.
import {
  storedNativeChangeFixture,
  loadPreparedNativeTransition,
} from '../../helpers/native-change-document.js';
import { continueNativeTransition } from '../../../domains/comet-native/native-transition-journal.js';

const brief = `# Outcome
Ship a focused outcome.
# Scope
One capability.
# Non-goals
No migration.
# Acceptance examples
- The behavior works.
# Constraints and invariants
Keep compatibility.
# Decisions
Use Native state.
# Open questions
None.
# Verification expectations
Run focused checks.
`;

describe('Native status diagnostics', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-status-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  it('keeps workspace advisories visible without blocking an otherwise ready Archive', () => {
    const continuation = nativeContinuation({
      state: {
        name: 'ready-change',
        phase: 'archive',
        revision: 4,
      } as NativeChangeState,
      archiveReady: true,
      findings: [
        {
          code: 'workspace-root-changed',
          message: 'The physical workspace root changed after implementation.',
          severity: 'warning',
          path: null,
          requiredAction: 'inspect-workspace-advisory',
          retryCommand: 'comet native status ready-change',
          repairCommand: null,
          requiresUserDecision: false,
        },
      ],
    });

    expect(continuation).toMatchObject({
      disposition: 'continue',
      action: 'archive',
      command: 'comet native archive ready-change --dry-run',
    });

    const unknownWorkspaceIntegrityFinding = nativeContinuation({
      state: {
        name: 'ready-change',
        phase: 'archive',
        revision: 4,
      } as NativeChangeState,
      archiveReady: true,
      findings: [
        {
          code: 'workspace-integrity-failed',
          message: 'The workspace integrity check failed.',
          severity: 'error',
          path: null,
          requiredAction: 'resolve-finding',
          retryCommand: 'comet native status ready-change',
          repairCommand: null,
          requiresUserDecision: false,
        },
      ],
    });
    expect(unknownWorkspaceIntegrityFinding).toMatchObject({
      disposition: 'blocked',
      action: 'none',
    });
  });

  it('keeps a failed workspace finish blocked after Archive has moved the change', () => {
    const continuation = nativeContinuation({
      state: {
        name: 'finish-blocked',
        phase: 'archive',
        revision: 4,
      } as NativeChangeState,
      archiveReady: false,
    });

    expect(continuation).toMatchObject({
      disposition: 'blocked',
      action: 'none',
      command: null,
    });
  });

  it('exposes an invalid workspace binding without treating legacy status as an approval', async () => {
    const state = await storedNativeChangeFixture({
      paths,
      name: 'invalid-workspace',
      language: 'en',
      workspaceBinding: { isolation: 'current', changeBranch: null, targetBranch: null },
    });
    await fs.mkdir(nativeChangeRuntimeDir(paths, state.name), { recursive: true });
    await fs.writeFile(
      path.join(nativeChangeRuntimeDir(paths, state.name), 'workspace.json'),
      '{"schema":"comet.native.workspace.v3","isolation":"invalid"}\n',
    );

    await expect(inspectNativeStatus(paths, state.name)).resolves.toMatchObject({
      name: state.name,
      phase: 'shape',
      archiveReady: false,
      continuation: null,
      workspace: { bindingState: 'invalid' },
    });
    await expect(readNativeWorkspaceIdentity(paths, state.name)).rejects.toThrow();
    expect(
      await fs.readFile(
        path.join(nativeChangeRuntimeDir(paths, state.name), 'workspace.json'),
        'utf8',
      ),
    ).toBe('{"schema":"comet.native.workspace.v3","isolation":"invalid"}\n');
  });

  it('does not route an Archive binding failure to receipt refresh', () => {
    const continuation = nativeContinuation({
      state: {
        name: 'archived-change',
        phase: 'archive',
        revision: 4,
      } as NativeChangeState,
      findings: [
        {
          code: 'verification-receipt-binding-mismatch',
          message: 'A verification receipt is stale.',
          severity: 'error',
          path: null,
          requiredAction: 'refresh-verification-receipts',
          retryCommand: null,
          repairCommand: null,
          requiresUserDecision: false,
        },
      ],
    });

    expect(continuation).toMatchObject({
      disposition: 'blocked',
      action: 'none',
      command: null,
    });
  });

  it('returns policy-aware continuation after a ready Archive preview', () => {
    const state = {
      name: 'ready-change',
      phase: 'archive',
      revision: 4,
    } as NativeChangeState;
    const preflightHash = 'a'.repeat(64);

    expect(
      nativeContinuation({
        state,
        archiveReady: true,
        archiveConfirmation: 'automatic',
        archivePreflightHash: preflightHash,
      }),
    ).toMatchObject({
      disposition: 'continue',
      action: 'archive',
      command: `comet native archive ready-change --expect-preflight ${preflightHash}`,
      commandArgs: [
        'comet',
        'native',
        'archive',
        'ready-change',
        '--expect-preflight',
        preflightHash,
      ],
      requiresUserDecision: false,
      requiredInputs: [],
    });
    expect(
      nativeContinuation({
        state,
        archiveReady: true,
        archiveConfirmation: 'required',
        archivePreflightHash: preflightHash,
      }),
    ).toMatchObject({
      disposition: 'await-user',
      action: 'archive',
      command: null,
      commandArgs: [
        'comet',
        'native',
        'archive',
        'ready-change',
        '--expect-preflight',
        preflightHash,
        '--confirmed',
      ],
      requiresUserDecision: true,
      requiredInputs: ['archive-confirmation'],
      inputOptions: [
        expect.objectContaining({
          input: 'archive-confirmation',
          flags: ['--confirmed'],
          choices: ['confirm', 'keep-active'],
        }),
      ],
    });
  });

  it('returns complete phase argv templates and alternative Build evidence', () => {
    const build = nativeContinuation({
      state: {
        name: 'build-change',
        phase: 'build',
        revision: 3,
        approval: 'confirmed',
        verification_result: 'pending',
      } as NativeChangeState,
    });
    expect(build).toMatchObject({
      commandArgs: [
        'comet',
        'native',
        'next',
        'build-change',
        '--summary',
        '<summary>',
        '--artifact',
        '<project-relative-path>',
      ],
      requiredInputs: ['summary', 'artifact-or-no-code-reason'],
      inputOptions: expect.arrayContaining([
        expect.objectContaining({
          input: 'artifact-or-no-code-reason',
          flags: ['--artifact'],
          repeatable: true,
          alternativeGroup: 'build-evidence',
        }),
        expect.objectContaining({
          input: 'artifact-or-no-code-reason',
          flags: ['--no-code-reason'],
          alternativeGroup: 'build-evidence',
        }),
      ]),
    });

    const verify = nativeContinuation({
      state: {
        name: 'verify-change',
        phase: 'verify',
        revision: 4,
      } as NativeChangeState,
    });
    expect(verify.commandArgs).toEqual([
      'comet',
      'native',
      'next',
      'verify-change',
      '--summary',
      '<summary>',
      '--result',
      '<pass|fail>',
      '--report',
      '<change-relative-path>',
    ]);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function validChange(name: string): Promise<NativeChangeState> {
    const state = await storedNativeChangeFixture({
      paths,
      name,
      language: 'en',
      verificationProtocol: 'legacy-v1',
    });
    await fs.writeFile(path.join(nativeChangeDir(paths, name), state.brief), brief);
    return state;
  }

  it('returns an empty projection for an empty Native root', async () => {
    expect(await listNativeStatus(paths)).toEqual([]);
  });

  it('sorts multiple active changes and projects only Native next commands', async () => {
    await validChange('zeta-change');
    await validChange('alpha-change');
    await selectNativeChange(paths, 'zeta-change');

    const statuses = await listNativeStatus(paths);
    expect(statuses.map((status) => status.name)).toEqual(['alpha-change', 'zeta-change']);
    expect(statuses[0]).toMatchObject({
      phase: 'shape',
      selected: false,
      nextCommand: 'comet native doctor alpha-change --repair',
      migrationRequired: true,
    });
    expect(statuses[1]).toMatchObject({ selected: true });
    expect(JSON.stringify(statuses)).not.toMatch(/openspec|superpowers|comet classic/iu);
  });

  it('pages a bounded status list and rejects stale or tampered cursors', async () => {
    for (let index = 0; index < NATIVE_STATUS_PAGE_LIMITS.maxItems + 2; index += 1) {
      const name = `page-change-${String(index).padStart(2, '0')}`;
      const directory = path.join(paths.changesDir, name);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'comet-state.yaml'), 'schema: [invalid\n');
    }

    const first = await listNativeStatusPage(paths);
    expect(first).toMatchObject({
      schema: 'comet.native.status-page.v1',
      total: NATIVE_STATUS_PAGE_LIMITS.maxItems + 2,
      offset: 0,
    });
    expect(first.items).toHaveLength(NATIVE_STATUS_PAGE_LIMITS.maxItems);
    expect(first.nextCursor).not.toBeNull();
    expect(first.nextPageArgs).toEqual(['comet', 'native', 'status', '--cursor', first.nextCursor]);
    expect(Buffer.byteLength(JSON.stringify(first), 'utf8')).toBeLessThanOrEqual(
      NATIVE_STATUS_PAGE_LIMITS.maxSerializedBytes,
    );

    const second = await listNativeStatusPage(paths, { cursor: first.nextCursor });
    expect(second.offset).toBe(NATIVE_STATUS_PAGE_LIMITS.maxItems);
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();

    await fs.mkdir(path.join(paths.changesDir, 'page-change-new'));
    await expect(listNativeStatusPage(paths, { cursor: first.nextCursor })).rejects.toThrow(
      'cursor is stale',
    );
    await expect(
      listNativeStatusPage(paths, { cursor: `${first.nextCursor!.slice(0, -1)}0` }),
    ).rejects.toThrow(/cursor (?:is stale|integrity check failed)/u);
  });

  it('does not hide a malformed current selection as an unselected status list', async () => {
    await validChange('healthy-change');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, '.comet', 'current-change.json'), '{broken');

    await expect(listNativeStatusPage(paths)).rejects.toThrow();
  });

  it('reports malformed change YAML without hiding the other changes', async () => {
    await validChange('healthy-change');
    const broken = path.join(paths.changesDir, 'broken-change');
    await fs.mkdir(broken, { recursive: true });
    await fs.writeFile(path.join(broken, 'comet-state.yaml'), 'schema: [invalid\n');

    const statuses = await listNativeStatus(paths);
    expect(statuses).toHaveLength(2);
    expect(statuses.find((status) => status.name === 'broken-change')).toMatchObject({
      phase: 'invalid',
      nextCommand: null,
      archiveReady: false,
    });
  });

  it('keeps large status pages free of synthetic conflict-inspection failures', async () => {
    for (let index = 0; index < 33; index += 1) {
      await validChange(`large-change-${String(index).padStart(2, '0')}`);
    }

    const first = await listNativeStatusPage(paths);

    expect(first.items).toHaveLength(NATIVE_STATUS_PAGE_LIMITS.maxItems);
    expect(first.items.flatMap((item) => item.findingSummary.codes)).not.toContain(
      'native-conflict-inspection-invalid',
    );
  });

  it('requires legacy migration before Archive despite a prior verification report', async () => {
    const raw = await validChange('ready-change');
    const dir = nativeChangeDir(paths, raw.name);
    // SIMULATED raw historical document claims pass; this is not an approval or a real old Run.
    await writeNativeChange(paths, {
      ...raw,
      phase: 'archive',
      approval: 'confirmed',
      verification_result: 'pass',
      verification_report: 'verification.md',
    });
    await fs.writeFile(
      path.join(dir, 'verification.md'),
      '# SIMULATED historical report\nThe raw document claims prior verification.\n',
    );
    expect(await inspectNativeStatus(paths, raw.name)).toMatchObject({
      archiveReady: false,
      migrationRequired: true,
      nextCommand: 'comet native doctor ' + raw.name + ' --repair',
    });
    await fs.rm(path.join(dir, 'verification.md'));
    expect(await inspectNativeStatus(paths, raw.name)).toMatchObject({
      archiveReady: false,
      nextCommand: 'comet native doctor ' + raw.name + ' --repair',
    });
  });

  it('never scans a fixture openspec tree', async () => {
    await validChange('native-only');
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'foreign-change'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectRoot, 'openspec', 'changes', 'foreign-change', 'change.yaml'),
      'not: native\n',
    );
    expect((await listNativeStatus(paths)).map((status) => status.name)).toEqual(['native-only']);
  });

  it('requires legacy migration without changing a pending ordinary transition', async () => {
    const frozen = await loadPreparedNativeTransition(paths),
      name = frozen.name;
    const journal = nativeTransitionJournalFile(paths, name),
      bytes = await fs.readFile(journal);
    expect(await inspectNativeStatus(paths, name)).toMatchObject({
      phase: 'shape',
      migrationRequired: true,
      nextCommand: 'comet native doctor ' + name + ' --repair',
    });
    expect(await fs.readFile(journal)).toEqual(bytes);
  });

  it('keeps legacy migration guidance when an old Run state is missing', async () => {
    const frozen = await loadPreparedNativeTransition(paths),
      name = frozen.name;
    await continueNativeTransition(paths, name);
    await fs.rm(path.join(nativeChangeRuntimeDir(paths, name), 'run-state.json'));
    expect(await inspectNativeStatus(paths, name)).toMatchObject({
      phase: 'build',
      migrationRequired: true,
      nextCommand: 'comet native doctor ' + name + ' --repair',
    });
  });

  it('keeps a change discoverable when its whole local Runtime is missing', async () => {
    const frozen = await loadPreparedNativeTransition(paths),
      name = frozen.name;
    await continueNativeTransition(paths, name);
    await fs.rm(nativeChangeRuntimeDir(paths, name), { recursive: true });
    expect(await inspectNativeStatus(paths, name, { details: true })).toMatchObject({
      name,
      phase: 'build',
      runtime: { status: 'missing', layout: 'missing' },
      nextCommand: 'comet native doctor ' + name + ' --repair',
      migrationRequired: true,
    });
  });
});
