import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateBranchBinding,
  resolveBranchBinding,
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
  it.each(['current', 'branch', 'worktree'])(
    'skips branch binding for isolation: %s when the project is not a git worktree',
    (isolation) => {
      expect(
        evaluateBranchBinding({
          isolation,
          boundBranch: null,
          currentBranch: null,
          gitWorkTree: false,
        }),
      ).toEqual({ status: 'not-applicable' });
    },
  );
});

describe('resolveBranchBinding', () => {
  let root: string;
  let changeDir: string;

  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  }

  async function seedState(lines: string[]): Promise<void> {
    await fs.writeFile(path.join(changeDir, '.comet.yaml'), lines.join('\n') + '\n');
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-branch-binding-'));
    changeDir = path.join(root, 'openspec', 'changes', 'demo');
    await fs.mkdir(changeDir, { recursive: true });
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test User');
    await fs.writeFile(path.join(root, 'README.md'), '# Test\n');
    git('add', 'README.md');
    git('commit', '-m', 'init');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('heals an unbound binding-isolation change when heal is enabled', async () => {
    await seedState(['workflow: hotfix', 'phase: build', 'isolation: current']);

    const outcome = await resolveBranchBinding(changeDir, { heal: true, cwd: root });

    expect(outcome).toMatchObject({ status: 'healed', branch: 'main', currentBranch: 'main' });
    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).toContain(
      'bound_branch: main',
    );
  });

  it('reports needs-heal without writing when heal is disabled', async () => {
    await seedState(['workflow: hotfix', 'phase: build', 'isolation: current']);

    const outcome = await resolveBranchBinding(changeDir, { heal: false, cwd: root });

    expect(outcome).toMatchObject({ status: 'needs-heal', branch: 'main' });
    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).not.toContain(
      'bound_branch',
    );
  });

  it('reports drift with the live current branch', async () => {
    await seedState([
      'workflow: hotfix',
      'phase: build',
      'isolation: branch',
      'bound_branch: feature-A',
    ]);
    git('switch', '-c', 'feature-B');

    const outcome = await resolveBranchBinding(changeDir, { heal: true, cwd: root });

    expect(outcome).toMatchObject({
      status: 'drift',
      boundBranch: 'feature-A',
      currentBranch: 'feature-B',
    });
  });

  it('is not applicable before isolation requires a binding', async () => {
    await seedState(['workflow: full', 'phase: open', 'isolation: null']);

    const outcome = await resolveBranchBinding(changeDir, { heal: true, cwd: root });

    expect(outcome).toMatchObject({
      status: 'not-applicable',
      bindingRequired: false,
      currentBranch: 'main',
    });
  });

  it('treats an explicit null bound_branch the same as an absent one', async () => {
    await seedState(['workflow: hotfix', 'phase: build', 'isolation: current', 'bound_branch: null']);

    const outcome = await resolveBranchBinding(changeDir, { heal: false, cwd: root });

    expect(outcome).toMatchObject({ status: 'needs-heal', branch: 'main' });
  });
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
