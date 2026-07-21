import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import {
  inspectNativeStatus,
  listNativeStatus,
  listNativeStatusPage,
  NATIVE_STATUS_PAGE_LIMITS,
} from '../../../domains/comet-native/native-diagnostics.js';
import { nativeContinuation } from '../../../domains/comet-native/native-continuation.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { selectNativeChange } from '../../../domains/comet-native/native-selection.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';
import { nativeVerificationFixtureReport } from '../../helpers/native-verification.js';

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

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function validChange(name: string): Promise<void> {
    const state = await createNativeChange({ paths, name, language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, name), state.brief), brief);
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
      nextCommand: 'comet native next alpha-change --summary "<summary>"',
    });
    expect(statuses[1]).toMatchObject({ selected: true });
    expect(JSON.stringify(statuses)).not.toMatch(/openspec|superpowers|comet classic/iu);
  });

  it('reports contract drift after approval and requires a fresh confirmation', async () => {
    await validChange('contract-drift');
    const changeDir = nativeChangeDir(paths, 'contract-drift');
    await advanceNativeChange({
      paths,
      name: 'contract-drift',
      evidence: { summary: 'shape approved' },
    });
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      brief.replace('The behavior works.', 'The changed behavior works.'),
    );

    const status = await inspectNativeStatus(paths, 'contract-drift', { details: true });
    expect(status).toMatchObject({
      phase: 'build',
      findingSummary: {
        errors: 1,
        requiresUserDecision: true,
        codes: expect.arrayContaining(['contract-changed-after-approval']),
      },
      continuation: {
        disposition: 'await-user',
        requiredInputs: ['re-confirm-contract'],
      },
      findings: [
        expect.objectContaining({
          code: 'contract-changed-after-approval',
          retryCommand: 'comet native next contract-drift --summary "<summary>" --confirmed',
        }),
      ],
    });
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

  it('only marks Archive ready after brief, spec, and verification checks pass', async () => {
    await validChange('ready-change');
    const changeDir = nativeChangeDir(paths, 'ready-change');
    await advanceNativeChange({
      paths,
      name: 'ready-change',
      evidence: { summary: 'shape is ready' },
    });
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
    await advanceNativeChange({
      paths,
      name: 'ready-change',
      evidence: { summary: 'build is ready', artifacts: ['feature.ts'] },
    });
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'ready-change',
        evidenceRefs: ['feature.ts'],
      }),
    );
    await advanceNativeChange({
      paths,
      name: 'ready-change',
      evidence: {
        summary: 'verification passed',
        verificationResult: 'pass',
        verificationReport: 'verification.md',
      },
    });

    const readyStatus = await inspectNativeStatus(paths, 'ready-change');
    expect(readyStatus).toMatchObject({
      archiveReady: true,
      nextCommand: 'comet native archive ready-change --dry-run',
    });
    expect(readyStatus).not.toHaveProperty('error');
    await fs.rm(path.join(changeDir, 'verification.md'));
    expect(await inspectNativeStatus(paths, 'ready-change')).toMatchObject({
      archiveReady: false,
      nextCommand: 'comet native next ready-change --summary "<summary>"',
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

  it('reports a pending ordinary transition without changing it', async () => {
    await validChange('pending-transition');
    await expect(
      advanceNativeChange({
        paths,
        name: 'pending-transition',
        evidence: { summary: 'shape is ready' },
        hooks: {
          afterPrepared: () => {
            throw new Error('interrupt transition');
          },
        },
      }),
    ).rejects.toThrow('interrupt transition');

    expect(await inspectNativeStatus(paths, 'pending-transition')).toMatchObject({
      phase: 'shape',
      error: 'Native phase transition recovery is pending',
    });
  });

  it('reports a missing Run state after a change has started', async () => {
    await validChange('missing-run');
    await advanceNativeChange({
      paths,
      name: 'missing-run',
      evidence: { summary: 'shape is ready' },
    });
    await fs.rm(path.join(nativeChangeDir(paths, 'missing-run'), 'runtime', 'run-state.json'));

    expect(await inspectNativeStatus(paths, 'missing-run')).toMatchObject({
      phase: 'build',
      error: 'Native change references a missing Run state',
    });
  });
});
