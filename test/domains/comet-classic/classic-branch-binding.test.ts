import { describe, expect, it } from 'vitest';
import {
  evaluateBranchBinding,
  driftBlockedMessage,
  driftStaleReason,
} from '../../../domains/comet-classic/classic-branch-binding.js';

describe('evaluateBranchBinding', () => {
  it('is not applicable when isolation is not current', () => {
    expect(
      evaluateBranchBinding({ isolation: 'branch', boundBranch: null, currentBranch: 'feature-A' }),
    ).toEqual({ status: 'not-applicable' });
  });
  it('passes when the bound branch matches the current branch', () => {
    expect(
      evaluateBranchBinding({ isolation: 'current', boundBranch: 'feature-A', currentBranch: 'feature-A' }),
    ).toEqual({ status: 'ok' });
  });
  it('reports drift when the current branch differs', () => {
    expect(
      evaluateBranchBinding({ isolation: 'current', boundBranch: 'feature-A', currentBranch: 'feature-B' }),
    ).toEqual({ status: 'drift', boundBranch: 'feature-A', currentBranch: 'feature-B' });
  });
  it('reports drift (never a skip) when bound but HEAD is detached', () => {
    expect(
      evaluateBranchBinding({ isolation: 'current', boundBranch: 'feature-A', currentBranch: null }),
    ).toEqual({ status: 'drift', boundBranch: 'feature-A', currentBranch: null });
  });
  it('requests a lazy heal when unbound on a real branch', () => {
    expect(
      evaluateBranchBinding({ isolation: 'current', boundBranch: null, currentBranch: 'feature-A' }),
    ).toEqual({ status: 'needs-heal', branch: 'feature-A' });
  });
  it('refuses to lazy-bind when unbound and detached', () => {
    expect(
      evaluateBranchBinding({ isolation: 'current', boundBranch: null, currentBranch: null }),
    ).toEqual({ status: 'unbound-detached' });
  });
});

describe('drift messages', () => {
  it('renders the blocked message with a detached-HEAD label', () => {
    expect(driftBlockedMessage('my-change', 'feature-A', null)).toContain(
      "bound to branch 'feature-A', but current branch is 'detached HEAD'",
    );
    expect(driftBlockedMessage('my-change', 'feature-A', null)).toContain('comet state rebind my-change');
  });
  it('renders the stale reason with the current branch name', () => {
    expect(driftStaleReason('my-change', 'feature-A', 'feature-B')).toBe(
      "change 'my-change' is bound to branch 'feature-A', but current branch is 'feature-B'",
    );
  });
});
