import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectAndCompleteClassicSdkDesign } from '../../../domains/comet-classic/classic-sdk-design.js';

const fixture = vi.hoisted(() => ({
  inspect: vi.fn(),
  openReceipt: vi.fn(),
  designReceipt: vi.fn(),
  readiness: vi.fn(),
  handoff: vi.fn(),
  resolveWait: vi.fn(),
  claim: vi.fn(),
  recordOutcome: vi.fn(),
  recordEvidence: vi.fn(),
}));
vi.mock('../../../domains/comet-classic/classic-sdk-status.js', () => ({
  inspectClassicSdkRun: fixture.inspect,
}));
vi.mock('../../../domains/comet-classic/classic-sdk-application.js', () => ({
  classicOpenEvidenceReceipt: fixture.openReceipt,
  classicDesignEvidenceReceipt: fixture.designReceipt,
}));
vi.mock('../../../domains/comet-classic/classic-design-readiness.js', () => ({
  inspectClassicDesignReadiness: fixture.readiness,
}));
vi.mock('../../../domains/comet-classic/classic-handoff.js', () => ({
  validateClassicSdkDesignContext: fixture.handoff,
}));
vi.mock('../../../domains/comet-classic/classic-protected-path.js', () => ({
  readClassicProjectFile: async () => '# Design\n',
}));
vi.mock('../../../domains/comet-classic/classic-branch-binding.js', () => ({
  liveGitBranch: () => null,
  isGitWorkTree: () => false,
  evaluateBranchBinding: () => ({ status: 'not-applicable' }),
}));

const approvalHash = 'a'.repeat(64);
const options = {
  projectRoot: '/project',
  change: 'demo',
  designDoc: 'design.md',
  apply: true,
  approvalHash,
};

beforeEach(() => {
  Object.values(fixture).forEach((mock) => mock.mockReset());
  const state = {
    workflow: 'full',
    phase: 'design',
    language: 'en',
    designDoc: null,
    isolation: null,
    boundBranch: null,
    handoffContext: 'handoff.json',
    handoffHash: 'b'.repeat(64),
    contextCompression: 'off',
  };
  const run = {
    runId: 'design-run',
    revision: 10,
    state,
    input: { changeDir: 'openspec/changes/demo' },
    actions: [
      {
        id: 'document',
        stepId: 'full.design.document',
        status: 'pending',
        attempt: 1,
        inputHash: 'input',
      },
    ],
    waits: [
      {
        id: 'decision',
        stepId: 'full.design.confirm',
        status: 'pending',
        proposalHash: approvalHash,
      },
    ],
    outputs: {
      'full.open.evidence': { value: { ref: 'openspec/changes/demo', contentHash: 'open-hash' } },
    },
  };
  const runtime = {
    resolveWait: fixture.resolveWait,
    claim: fixture.claim,
    recordOutcome: fixture.recordOutcome,
    recordEvidence: fixture.recordEvidence,
  };
  fixture.inspect.mockResolvedValue({ run, state, runtime, profile: 'full' });
  fixture.openReceipt.mockResolvedValue({ ref: 'openspec/changes/demo', contentHash: 'open-hash' });
  fixture.designReceipt.mockResolvedValue({ ref: 'design.md', contentHash: 'design-hash' });
  fixture.readiness.mockResolvedValue({ design: 'ready', issues: [] });
  fixture.handoff.mockResolvedValue(true);
  fixture.resolveWait.mockResolvedValue({ ...run, revision: 11 });
  fixture.claim.mockResolvedValue({ ...run, revision: 12 });
  fixture.recordOutcome.mockResolvedValue({
    ...run,
    revision: 13,
    evidenceWaits: [
      {
        id: 'evidence',
        stepId: 'full.design.evidence',
        status: 'pending',
        kind: 'classic-design-document',
      },
    ],
  });
  fixture.recordEvidence.mockResolvedValue({
    ...run,
    revision: 14,
    state: { ...state, phase: 'build' },
  });
});

describe('Classic Design preflight budget', () => {
  it('uses one inspection for apply and retains all CAS and evidence boundaries', async () => {
    const result = await inspectAndCompleteClassicSdkDesign(options);
    expect(result.completed?.state).toMatchObject({ phase: 'build' });
    for (const mock of [
      fixture.inspect,
      fixture.openReceipt,
      fixture.designReceipt,
      fixture.readiness,
      fixture.handoff,
    ])
      expect(mock).toHaveBeenCalledTimes(1);
    expect(fixture.resolveWait).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 10, proposalHash: approvalHash }),
    );
    expect(fixture.claim).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 11 }));
    expect(fixture.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 12 }),
    );
    expect(fixture.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 13,
        ref: 'design.md',
        contentHash: 'design-hash',
      }),
    );
  });

  it('blocks a different approval without changing the Run', async () => {
    const result = await inspectAndCompleteClassicSdkDesign({
      ...options,
      approvalHash: 'c'.repeat(64),
    });
    expect(result.completed).toBeNull();
    expect(fixture.resolveWait).not.toHaveBeenCalled();
    expect(fixture.claim).not.toHaveBeenCalled();
  });

  it('preserves a final evidence rejection after the preflight', async () => {
    fixture.recordEvidence.mockRejectedValue(new Error('EVIDENCE_REJECTED: document changed'));
    await expect(inspectAndCompleteClassicSdkDesign(options)).rejects.toThrow('EVIDENCE_REJECTED');
    expect(fixture.inspect).toHaveBeenCalledTimes(1);
    expect(fixture.recordEvidence).toHaveBeenCalledTimes(1);
  });
});
