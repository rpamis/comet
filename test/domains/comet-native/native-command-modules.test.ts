import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  issueManual: vi.fn(),
  issueAutomated: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('../../../domains/comet-native/native-verification-receipt-runtime.js', () => ({
  issueNativeManualEvidenceReceipt: mocks.issueManual,
  issueNativeAutomatedCheckReceipt: mocks.issueAutomated,
  MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS: 60 * 60 * 1_000,
}));

vi.mock('../../../domains/comet-native/native-receipt-refresh.js', () => ({
  refreshNativeVerificationReceipts: mocks.refresh,
}));

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeReceiptCommand } from '../../../domains/comet-native/native-receipt-command.js';
import { nativeSpecCommand } from '../../../domains/comet-native/native-spec-command.js';

describe('Native command modules', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-command-modules-'));
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    mocks.issueManual.mockReset();
    mocks.issueAutomated.mockReset();
    mocks.refresh.mockReset();
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('passes repeated manual receipt options to the issuance runtime', async () => {
    mocks.issueManual.mockResolvedValue({ ref: 'manual-ref' });

    const result = await nativeReceiptCommand(
      [
        'manual',
        'demo-change',
        '--acceptance',
        'acceptance-a',
        '--acceptance',
        'acceptance-b',
        '--step',
        'Run the check',
        '--observation',
        'The check passed',
      ],
      projectRoot,
    );

    expect(result).toEqual({
      command: 'receipt manual',
      exitCode: 0,
      data: { ref: 'manual-ref' },
      text: 'Native manual receipt: manual-ref\n',
    });
    expect(mocks.issueManual).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'demo-change',
        acceptanceIds: ['acceptance-a', 'acceptance-b'],
        steps: ['Run the check'],
        observations: ['The check passed'],
      }),
    );
  });

  it.each([
    ['passed', 0],
    ['failed', 1],
  ] as const)(
    'returns the automated receipt status as the command exit code (%s)',
    async (status, exitCode) => {
      mocks.issueAutomated.mockResolvedValue({
        ref: `automated-${status}`,
        receipt: { status },
      });

      const result = await nativeReceiptCommand(
        [
          'automated',
          'demo-change',
          '--acceptance',
          'acceptance-a',
          '--timeout-ms',
          '1200',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
        projectRoot,
      );

      expect(result).toMatchObject({
        command: 'receipt automated',
        exitCode,
        data: { ref: `automated-${status}` },
        text: `Native automated receipt ${status}: automated-${status}\n`,
      });
      expect(mocks.issueAutomated).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'demo-change',
          acceptanceIds: ['acceptance-a'],
          command: 'node',
          args: ['-e', 'process.exit(0)'],
          timeoutMs: 1200,
        }),
      );
    },
  );

  it('rejects incomplete automated receipt commands and invalid timeouts', async () => {
    await expect(
      nativeReceiptCommand(
        ['automated', 'demo-change', '--acceptance', 'acceptance-a'],
        projectRoot,
      ),
    ).rejects.toThrow('receipt automated requires -- <executable> [args...]');
    await expect(
      nativeReceiptCommand(
        [
          'automated',
          'demo-change',
          '--acceptance',
          'acceptance-a',
          '--timeout-ms',
          '0',
          '--',
          'node',
        ],
        projectRoot,
      ),
    ).rejects.toThrow('--timeout-ms must be an integer');
  });

  it('renders every receipt refresh report section and the applied outcome', async () => {
    mocks.refresh.mockResolvedValue({
      refreshed: [{ acceptanceId: 'acceptance-a', oldRef: 'old-a', newRef: 'new-a' }],
      requiresRerun: [
        {
          oldRef: 'old-b',
          acceptanceIds: ['acceptance-b', 'acceptance-c'],
          command: 'node "script with spaces.mjs"',
          timeoutMs: 1200,
        },
      ],
      requiresManual: [
        {
          oldRef: 'old-d',
          acceptanceIds: ['acceptance-d'],
          mismatches: ['contractHash: expected new, got old'],
        },
      ],
      requiresCheck: [{ oldRef: 'old-check' }],
      applied: true,
      verificationReport: 'verification.md',
    });

    const result = await nativeReceiptCommand(['refresh', 'demo-change', '--apply'], projectRoot);

    expect(result.text).toContain('Re-issued 1 manual receipt(s)');
    expect(result.text).toContain('acceptance-a: old-a -> new-a');
    expect(result.text).toContain('Re-run 1 stale automated receipt(s)');
    expect(result.text).toContain('[acceptance-b, acceptance-c] node "script with spaces.mjs"');
    expect(result.text).toContain('Re-run manual verification for 1 receipt(s)');
    expect(result.text).toContain('[acceptance-d] contractHash: expected new, got old');
    expect(result.text).toContain('Re-run `comet native check demo-change`');
    expect(result.text).toContain('Updated acceptance evidence in verification.md.');
    expect(mocks.refresh).toHaveBeenCalledWith({
      paths: expect.any(Object),
      name: 'demo-change',
      apply: true,
    });
  });

  it('explains why apply cannot refresh receipts that need fresh manual evidence', async () => {
    mocks.refresh.mockResolvedValue({
      refreshed: [],
      requiresRerun: [],
      requiresManual: [
        {
          oldRef: 'old-manual',
          acceptanceIds: ['acceptance-a'],
          mismatches: ['contractHash: expected new, got old'],
        },
      ],
      requiresCheck: [],
      applied: false,
      verificationReport: 'verification.md',
    });

    const result = await nativeReceiptCommand(['refresh', 'demo-change', '--apply'], projectRoot);

    expect(result.text).toContain('Fresh manual verification is required');
  });

  it('reports a clean refresh and rejects conflicting refresh flags', async () => {
    mocks.refresh.mockResolvedValue({
      refreshed: [],
      requiresRerun: [],
      requiresManual: [],
      requiresCheck: [],
      applied: false,
      verificationReport: null,
    });

    await expect(
      nativeReceiptCommand(['refresh', 'demo-change', '--dry-run'], projectRoot),
    ).resolves.toMatchObject({
      text: 'No stale receipts found.\n',
    });
    await expect(
      nativeReceiptCommand(['refresh', 'demo-change', '--apply', '--dry-run'], projectRoot),
    ).rejects.toThrow('cannot be combined');
    await expect(nativeReceiptCommand(['unknown', 'demo-change'], projectRoot)).rejects.toThrow(
      'Unknown receipt command',
    );
  });

  it('rejects retired Native spec mutation variants', async () => {
    await expect(
      nativeSpecCommand(
        ['rebase', 'demo-change', '--summary', 'Rebase the current spec set'],
        projectRoot,
      ),
    ).rejects.toThrow('Unknown spec command: rebase');
    await expect(nativeSpecCommand(['unknown', 'demo-change'], projectRoot)).rejects.toThrow(
      'Unknown spec command',
    );
  });
});
