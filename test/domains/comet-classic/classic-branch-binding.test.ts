import { describe, expect, it } from 'vitest';
import {
  evaluateBranchBinding,
  driftBlockedMessage,
  driftStaleReason,
} from '../../../domains/comet-classic/classic-branch-binding.js';

describe('evaluateBranchBinding', () => {
  it('is not applicable before isolation is selected', () => {
    expect(
      evaluateBranchBinding({ isolation: null, boundBranch: null, currentBranch: 'feature-A' }),
    ).toEqual({ status: 'not-applicable' });
  });
  it.each(['current', 'branch', 'worktree'])(
    'passes for isolation: %s when the bound branch matches the current branch',
    (isolation) => {
      expect(
        evaluateBranchBinding({ isolation, boundBranch: 'feature-A', currentBranch: 'feature-A' }),
      ).toEqual({ status: 'ok' });
    },
  );
  it.each(['current', 'branch', 'worktree'])(
    'reports drift for isolation: %s when the current branch differs',
    (isolation) => {
      expect(
        evaluateBranchBinding({ isolation, boundBranch: 'feature-A', currentBranch: 'feature-B' }),
      ).toEqual({ status: 'drift', boundBranch: 'feature-A', currentBranch: 'feature-B' });
    },
  );
  it.each(['current', 'branch', 'worktree'])(
    'reports drift for isolation: %s when bound but HEAD is detached',
    (isolation) => {
      expect(
        evaluateBranchBinding({ isolation, boundBranch: 'feature-A', currentBranch: null }),
      ).toEqual({ status: 'drift', boundBranch: 'feature-A', currentBranch: null });
    },
  );
  it.each(['current', 'branch', 'worktree'])(
    'requests a lazy heal for isolation: %s when unbound on a real branch',
    (isolation) => {
      expect(
        evaluateBranchBinding({ isolation, boundBranch: null, currentBranch: 'feature-A' }),
      ).toEqual({ status: 'needs-heal', branch: 'feature-A' });
    },
  );
  it.each(['current', 'branch', 'worktree'])(
    'refuses to lazy-bind isolation: %s when unbound and detached',
    (isolation) => {
      expect(evaluateBranchBinding({ isolation, boundBranch: null, currentBranch: null })).toEqual({
        status: 'unbound-detached',
      });
    },
  );
});

describe('drift messages', () => {
  it('renders the blocked message with a detached-HEAD label', () => {
    expect(driftBlockedMessage('my-change', 'feature-A', null)).toContain(
      "bound to branch 'feature-A', but current branch is 'detached HEAD'",
    );
    expect(driftBlockedMessage('my-change', 'feature-A', null)).toContain(
      'comet state rebind my-change',
    );
  });
  it('renders the stale reason with the current branch name', () => {
    expect(driftStaleReason('my-change', 'feature-A', 'feature-B')).toBe(
      "change 'my-change' is bound to branch 'feature-A', but current branch is 'feature-B'",
    );
  });
});
