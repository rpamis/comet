import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  readClassicCheckpoint,
  writeClassicCheckpoint,
  readClassicDelivery,
  writeClassicDelivery,
  invalidateClassicDelivery,
} from '../../../domains/comet-classic/classic-progress.js';
import { classicTaskRevision } from '../../../domains/comet-classic/classic-tasks.js';
import { independentGitEnvironment } from '../../../platform/process/git-environment.js';
import { withClassicStateLock } from '../../../domains/comet-classic/classic-store.js';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, execFileSync: vi.fn(original.execFileSync) };
});
const actualChildProcess =
  await vi.importActual<typeof import('node:child_process')>('node:child_process');
function resetCommands() {
  vi.mocked(childProcess.execFileSync)
    .mockReset()
    .mockImplementation(actualChildProcess.execFileSync);
}

describe('Classic structured progress', () => {
  let root: string;
  let change: string;
  const tasks = '- [ ] First <!-- comet-task:a -->\n- [ ] Second <!-- comet-task:b -->\n';
  const state = { phase: 'archive' as const, verifyResult: 'pass' as const, archived: false };
  const input = () => ({
    schemaVersion: 1,
    taskIds: ['a', 'b'],
    revision: classicTaskRevision(tasks),
    stage: 'implementing',
    sessionId: 'worker-1',
    evidence: ['test passed'],
    unresolved: [],
    reviewRounds: 1,
  });
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...independentGitEnvironment(),
        HOME: root,
        USERPROFILE: root,
        XDG_CONFIG_HOME: root,
        GIT_CONFIG_GLOBAL: path.join(root, 'empty-gitconfig'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
      },
    }).trim();
  const yaml = (archived = false, run = 'run-one') =>
    `phase: archive\nverify_result: pass\narchived: ${archived}\nrun_id: ${run}\n`;

  beforeEach(async () => {
    resetCommands();
    root = await mkdtemp(path.join(tmpdir(), 'classic-progress-'));
    for (const key of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'GH_CONFIG_DIR'])
      vi.stubEnv(key, root);
    vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(root, 'empty-gitconfig'));
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    change = path.join(root, 'changes', 'demo');
    await mkdir(change, { recursive: true });
    await writeFile(path.join(change, '.comet.yaml'), yaml());
    git('init', '-b', 'main');
    git('remote', 'add', 'origin', 'https://github.com/example/project.git');
  });
  afterEach(async () => {
    resetCommands();
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('returns absent records without inferring authorization or writing files', async () => {
    expect(await readClassicCheckpoint(root, change, tasks)).toEqual({
      checkpoint: null,
      stale: false,
    });
    expect(await readClassicDelivery(root, change)).toEqual({
      delivery: null,
      verification: { status: 'needsAuthorization' },
    });
  });

  it('persists a cross-task work package and human projection without completing tasks', async () => {
    expect((await writeClassicCheckpoint(root, change, input(), tasks)).stale).toBe(false);
    expect((await readClassicCheckpoint(root, change, tasks)).checkpoint).toEqual(input());
    expect(await readFile(path.join(change, '.comet/subagent-progress.md'), 'utf8')).toContain(
      'Tasks: a, b',
    );
    expect((await readClassicCheckpoint(root, change, tasks.replace('[ ]', '[x]'))).stale).toBe(
      false,
    );
    expect(
      (await readClassicCheckpoint(root, change, tasks.replace('First', 'Changed'))).stale,
    ).toBe(true);
    expect((await readClassicCheckpoint(root, change, '')).checkpoint).toEqual(input());
  });

  it.each([
    { taskIds: ['a', 'a'] },
    { taskIds: ['missing'] },
    { taskIds: [] },
    { revision: '0'.repeat(64) },
    { schemaVersion: 2 },
    { stage: 'complete' },
    { reviewRounds: -1 },
    { reviewRounds: 1.5 },
    { evidence: ['x'.repeat(70000)] },
    { unknown: true },
  ])('rejects invalid checkpoint input %j', async (patch) => {
    await expect(
      writeClassicCheckpoint(root, change, { ...input(), ...patch }, tasks),
    ).rejects.toThrow();
    expect((await readClassicCheckpoint(root, change, tasks)).checkpoint).toBeNull();
  });

  it('does not reset review rounds when task order or session changes', async () => {
    await writeClassicCheckpoint(root, change, input(), tasks);
    await expect(
      writeClassicCheckpoint(
        root,
        change,
        { ...input(), taskIds: ['b', 'a'], sessionId: 'new-session', reviewRounds: 0 },
        tasks,
      ),
    ).rejects.toThrow('cannot decrease');
    await writeClassicCheckpoint(
      root,
      change,
      { ...input(), taskIds: ['a'], reviewRounds: 0 },
      tasks,
    );
  });

  it('refuses to silently replace unknown or corrupt persisted checkpoint schemas', async () => {
    await mkdir(path.join(change, '.comet'));
    const file = path.join(change, '.comet/coordination.json');
    for (const value of ['{', 'null', JSON.stringify({ ...input(), schemaVersion: 2 })]) {
      await writeFile(file, value);
      await expect(readClassicCheckpoint(root, change, tasks)).rejects.toThrow();
      await expect(writeClassicCheckpoint(root, change, input(), tasks)).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe(value);
    }
  });

  it('keeps Engine checkpoint bytes isolated from coordination reads and writes', async () => {
    await mkdir(path.join(change, '.comet'));
    const engineFile = path.join(change, '.comet/checkpoint.json');
    const engineSource = JSON.stringify({
      runId: 'engine-run',
      currentStep: 'build',
      artifacts: {},
    });
    await writeFile(engineFile, engineSource);
    expect(await readClassicCheckpoint(root, change, tasks)).toEqual({
      checkpoint: null,
      stale: false,
    });
    await writeClassicCheckpoint(root, change, input(), tasks);
    expect((await readClassicCheckpoint(root, change, tasks)).checkpoint).toEqual(input());
    expect(await readFile(engineFile, 'utf8')).toBe(engineSource);
    expect(
      JSON.parse(await readFile(path.join(change, '.comet/coordination.json'), 'utf8')),
    ).toEqual(input());
    expect(await readFile(path.join(change, '.comet/subagent-progress.md'), 'utf8')).toContain(
      'Generated from coordination.json',
    );
    await writeFile(engineFile, '{broken engine checkpoint');
    expect((await readClassicCheckpoint(root, change, tasks)).checkpoint).toEqual(input());
    await writeClassicCheckpoint(root, change, { ...input(), stage: 'task-review' }, tasks);
    expect(await readFile(engineFile, 'utf8')).toBe('{broken engine checkpoint');
  });

  it('requires real pre-archive verification state before first authorization', async () => {
    const delivery = { action: 'local', targetBranch: 'main' };
    await expect(
      writeClassicDelivery(root, change, delivery, { ...state, phase: 'build' }),
    ).rejects.toThrow('requires archive');
    await writeFile(path.join(change, '.comet.yaml'), yaml(true));
    await expect(writeClassicDelivery(root, change, delivery, state)).rejects.toThrow(
      'requires archive',
    );
    expect((await readClassicDelivery(root, change)).delivery).toBeNull();
  });

  it('preserves immutable authorization and treats submitted remote evidence as unverified', async () => {
    const delivery = { action: 'pr', targetBranch: 'main', remote: 'origin' };
    await writeClassicDelivery(root, change, delivery, state);
    const record = await writeClassicDelivery(
      root,
      change,
      { ...delivery, prUrl: 'https://github.com/example/project/pull/1' },
      state,
    );
    expect(record.verification.status).toBe('needsVerification');
    expect(record.verification).toMatchObject({
      commitExists: false,
      remoteVerified: false,
      prVerified: false,
    });
    await expect(
      writeClassicDelivery(root, change, { ...delivery, action: 'push' }, state),
    ).rejects.toThrow('cannot be overwritten');
    await expect(
      writeClassicDelivery(root, change, { ...delivery, remote: 'other' }, state),
    ).rejects.toThrow('cannot be overwritten');
    await expect(
      writeClassicDelivery(root, change, { ...delivery, commit: 'b'.repeat(40) }, state),
    ).rejects.toThrow('verified archive commit');
    expect(
      (await writeClassicDelivery(root, change, delivery, state)).delivery?.commit,
    ).toBeUndefined();
  });

  it.each([
    { remote: 'https://example.invalid/repo' },
    { targetBranch: '--upload-pack=bad' },
    { commit: 'HEAD;command' },
    { prUrl: 'file:///secret' },
  ])('rejects unsafe delivery input %j', async (patch) => {
    await expect(
      writeClassicDelivery(root, change, { action: 'push', targetBranch: 'main', ...patch }, state),
    ).rejects.toThrow();
  });

  it('binds delivery to change identity and rejects corrupt schemas', async () => {
    await writeClassicDelivery(root, change, { action: 'local', targetBranch: 'main' }, state);
    await writeFile(path.join(change, '.comet.yaml'), yaml(false, 'other-run'));
    await expect(readClassicDelivery(root, change)).rejects.toThrow('identity mismatch');
    await writeFile(path.join(change, '.comet/delivery.json'), '{"schemaVersion":2}');
    await expect(readClassicDelivery(root, change)).rejects.toThrow('schemaVersion');
  });

  it('verifies an actual local archive commit after directory movement, never before', async () => {
    const delivery = { action: 'local', targetBranch: 'main' };
    await writeClassicDelivery(root, change, delivery, state);
    git('add', '.');
    git('commit', '-m', 'initial');
    const oldCommit = git('rev-parse', 'HEAD');
    expect((await readClassicDelivery(root, change)).verification.status).toBe('needsVerification');
    const archived = path.join(root, 'archive', '2026-09-10-demo');
    await mkdir(path.dirname(archived));
    await rename(change, archived);
    change = archived;
    await writeFile(path.join(change, '.comet.yaml'), yaml(true));
    git('add', '.');
    git('commit', '-m', 'archive');
    const commit = git('rev-parse', 'HEAD');
    const discovered = await readClassicDelivery(root, change);
    expect(discovered.verification).toMatchObject({ status: 'complete', observedCommit: commit });
    expect(discovered.delivery?.commit).toBeUndefined();
    await expect(
      writeClassicDelivery(
        root,
        change,
        { ...delivery, commit: oldCommit },
        { ...state, archived: true },
      ),
    ).rejects.toThrow('verified archive commit');
    const result = await writeClassicDelivery(
      root,
      change,
      { ...delivery, commit },
      { ...state, archived: true },
    );
    expect(result.verification).toMatchObject({
      status: 'complete',
      commitExists: true,
      archiveCommitted: true,
      currentBranch: 'main',
    });
    expect(commit).not.toBe(oldCommit);
    await writeFile(path.join(change, 'unexpected.md'), 'uncommitted archive artifact');
    expect((await readClassicDelivery(root, change)).verification.status).toBe('needsVerification');
    await rm(path.join(change, 'unexpected.md'));
    git('checkout', '-b', 'other');
    expect((await readClassicDelivery(root, change)).verification.status).toBe('needsVerification');
  });

  it('requires the current branch and bound branch to match initial authorization', async () => {
    await expect(
      writeClassicDelivery(root, change, { action: 'local', targetBranch: 'other' }, state),
    ).rejects.toThrow('current and bound branch');
    await writeFile(path.join(change, '.comet.yaml'), yaml() + 'bound_branch: other\n');
    await expect(
      writeClassicDelivery(root, change, { action: 'local', targetBranch: 'main' }, state),
    ).rejects.toThrow('current and bound branch');
  });

  it.each([true, false])(
    'keeps post-commit receipts out of tracked authorization (runtime ignored: %s)',
    async (ignored) => {
      if (ignored)
        await writeFile(
          path.join(root, '.gitignore'),
          '!/.comet/\n/.comet/*\n!/.comet/config.yaml\n',
        );
      const commit = await archivedDelivery('pr');
      const file = path.join(change, '.comet/delivery.json');
      const original = await readFile(file, 'utf8');
      expect(original).not.toContain('prUrl');
      expect(original).not.toContain('"commit"');
      expect(git('status', '--porcelain')).toBe('');
      await writeClassicDelivery(
        root,
        change,
        { action: 'pr', targetBranch: 'main', commit },
        { ...state, archived: true },
      );
      expect(await readFile(file, 'utf8')).toBe(original);
      expect(git('status', '--porcelain')).toBe('');
      expect((await readClassicDelivery(root, change)).delivery).toMatchObject({
        commit,
        prUrl: 'https://github.com/example/project/pull/1',
      });
      const receiptDir = ignored
        ? path.join(root, '.comet/classic-deliveries')
        : path.join(root, '.git/comet/classic-deliveries');
      const { readdir } = await import('node:fs/promises');
      expect(await readdir(receiptDir)).toHaveLength(1);
    },
  );

  it('invalidates before reopen and never reuses receipts across authorization generations', async () => {
    const commit = await archivedDelivery('pr');
    await writeClassicDelivery(
      root,
      change,
      { action: 'pr', targetBranch: 'main', commit },
      { ...state, archived: true },
    );
    const original = (await readClassicDelivery(root, change)).delivery!;
    const authorizationText = await readFile(path.join(change, '.comet/delivery.json'), 'utf8');
    await invalidateClassicDelivery(root, change);
    await invalidateClassicDelivery(root, change);
    expect((await readClassicDelivery(root, change)).verification.status).toBe(
      'needsAuthorization',
    );
    expect(await readFile(path.join(change, '.comet/delivery.json'), 'utf8')).toBe(
      authorizationText,
    );
    expect(git('status', '--porcelain')).toBe('');
    await writeFile(path.join(change, '.comet.yaml'), yaml());
    const renewed = await writeClassicDelivery(
      root,
      change,
      { action: 'pr', targetBranch: 'main' },
      state,
    );
    expect(renewed.delivery?.authorizationId).not.toBe(original.authorizationId);
    expect(renewed.delivery?.commit).toBeUndefined();
    expect(renewed.delivery?.prUrl).toBeUndefined();
    expect(renewed.verification.status).toBe('needsVerification');
  });

  async function archivedDelivery(action: 'push' | 'pr', includePrUrl = true) {
    await writeClassicDelivery(
      root,
      change,
      {
        action,
        targetBranch: 'main',
        remote: 'origin',
        ...(action === 'pr' && includePrUrl
          ? { prUrl: 'https://github.com/example/project/pull/1' }
          : {}),
      },
      state,
    );
    await writeFile(path.join(change, '.comet.yaml'), yaml(true));
    git('add', '.');
    git('commit', '-m', 'archive');
    return git('rev-parse', 'HEAD');
  }

  function mockRemote(
    commit: string,
    pr: Record<string, unknown> | Record<string, unknown>[] | Error | null = null,
    output?: string | Error,
  ) {
    const original = actualChildProcess.execFileSync;
    return vi.mocked(childProcess.execFileSync).mockImplementation(((
      command: string,
      args: string[],
      options: unknown,
    ) => {
      if (command === 'git' && args.includes('ls-remote')) {
        expect(args.slice(-2)).toEqual(['origin', 'refs/heads/main']);
        expect(options).toMatchObject({ timeout: 5000, env: { GIT_TERMINAL_PROMPT: '0' } });
        expect(options).toMatchObject({
          env: { GIT_CONFIG_GLOBAL: path.join(root, 'empty-gitconfig'), GCM_INTERACTIVE: 'never' },
        });
        expect(args).not.toContain('credential.helper=');
        if (output instanceof Error) throw output;
        return output ?? `${commit}\trefs/heads/main`;
      }
      if (command === 'gh') {
        expect(options).toMatchObject({ env: { GH_CONFIG_DIR: root, GH_PROMPT_DISABLED: '1' } });
        if (args[1] === 'list')
          expect(args).toEqual([
            'pr',
            'list',
            '--repo',
            'github.com/example/project',
            '--head',
            'main',
            '--state',
            'all',
            '--json',
            'url,headRefName,headRefOid,state',
            '--limit',
            '100',
          ]);
        else {
          expect(args[2]).toMatch(/^https:\/\/github\.com\/example\/project\/pull\/[1-9]\d*$/u);
          expect(args).toEqual([
            'pr',
            'view',
            args[2],
            '--repo',
            'github.com/example/project',
            '--json',
            'url,headRefName,headRefOid,state',
          ]);
        }
        if (pr instanceof Error || !pr) throw pr ?? new Error('gh unavailable');
        return JSON.stringify(pr);
      }
      return original(command, args, options as never);
    }) as typeof childProcess.execFileSync);
  }

  it('only checks remote on opt-in and never trusts a changed authorized remote repository', async () => {
    const commit = await archivedDelivery('push');
    const spy = mockRemote(commit);
    expect((await readClassicDelivery(root, change)).verification.status).toBe('needsVerification');
    expect(
      spy.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('ls-remote')),
    ).toBe(false);
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification,
    ).toMatchObject({ status: 'complete', remoteVerified: true, observedCommit: commit });
    git('remote', 'set-url', 'origin', 'https://github.com/other/project.git');
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification.status,
    ).toBe('needsVerification');
  });

  it('corrects a same-repository PR receipt explicitly without changing authorization', async () => {
    const commit = await archivedDelivery('pr');
    const authorization = await readFile(path.join(change, '.comet/delivery.json'), 'utf8');
    mockRemote(commit, {
      url: 'https://github.com/example/project/pull/1',
      headRefName: 'wrong-branch',
      headRefOid: commit,
      state: 'OPEN',
    });
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification.prVerified,
    ).toBe(false);
    await writeClassicDelivery(
      root,
      change,
      { action: 'pr', targetBranch: 'main', prUrl: 'https://github.com/example/project/pull/2' },
      { ...state, archived: true },
    );
    resetCommands();
    mockRemote(commit, {
      url: 'https://github.com/example/project/pull/2',
      headRefName: 'main',
      headRefOid: commit,
      state: 'OPEN',
    });
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification.status,
    ).toBe('complete');
    expect(await readFile(path.join(change, '.comet/delivery.json'), 'utf8')).toBe(authorization);
    expect(git('status', '--porcelain')).toBe('');
  });

  it.each(['merged', 'discovered', 'wrong-branch', 'wrong-commit', 'wrong-repo', 'open'] as const)(
    'requires merged PR evidence when its remote branch was deleted: %s',
    async (scenario) => {
      const commit = await archivedDelivery('pr', scenario !== 'discovered');
      const pr = {
        url:
          scenario === 'wrong-repo'
            ? 'https://github.com/other/project/pull/1'
            : 'https://github.com/example/project/pull/1',
        headRefName: scenario === 'wrong-branch' ? 'other' : 'main',
        headRefOid: scenario === 'wrong-commit' ? 'f'.repeat(40) : commit,
        state: scenario === 'open' ? 'OPEN' : 'MERGED',
      };
      mockRemote(commit, scenario === 'discovered' ? [pr] : pr, '');
      const result = await readClassicDelivery(root, change, { verifyRemote: true });
      expect(result.verification).toMatchObject({
        status:
          scenario === 'merged' || scenario === 'discovered' ? 'complete' : 'needsVerification',
        remoteStatus: 'missing',
        remoteVerified: false,
        prVerified: scenario === 'merged' || scenario === 'discovered',
      });
    },
  );

  it('records an archive commit while the real state lock is held, without ignoring other changes', async () => {
    const commit = await archivedDelivery('push');
    await withClassicStateLock(change, async () => {
      expect(await readFile(path.join(change, '.comet-state.lock'), 'utf8')).toBeTruthy();
      const result = await writeClassicDelivery(
        root,
        change,
        { action: 'push', targetBranch: 'main', commit },
        { ...state, archived: true },
      );
      expect(result.verification.archiveCommitted).toBe(true);
      await writeFile(path.join(change, 'unexpected.md'), 'real uncommitted content');
      await expect(
        writeClassicDelivery(
          root,
          change,
          { action: 'push', targetBranch: 'main', commit },
          { ...state, archived: true },
        ),
      ).rejects.toThrow('verified archive commit');
      await rm(path.join(change, 'unexpected.md'));
    });
    expect(git('status', '--porcelain')).toBe('');
  });

  it.each([
    'unique',
    'merged',
    'multiple',
    'empty',
    'unavailable',
    'truncated',
    'wrong-head',
  ] as const)('recovers a missing PR receipt conservatively: %s', async (scenario) => {
    const commit = await archivedDelivery('pr', false);
    const match = {
      url: 'https://github.com/example/project/pull/1',
      headRefName: 'main',
      headRefOid: commit,
      state: scenario === 'merged' ? 'MERGED' : 'OPEN',
    };
    const response =
      scenario === 'unavailable'
        ? new Error('network unavailable')
        : scenario === 'multiple'
          ? [match, { ...match, url: 'https://github.com/example/project/pull/2' }]
          : scenario === 'empty'
            ? []
            : scenario === 'truncated'
              ? Array.from({ length: 100 }, () => match)
              : scenario === 'wrong-head'
                ? [{ ...match, headRefOid: 'f'.repeat(40) }]
                : [match];
    mockRemote(commit, response);
    const initial = await readFile(path.join(change, '.comet/delivery.json'), 'utf8');
    const result = await readClassicDelivery(root, change, { verifyRemote: true });
    const verified = scenario === 'unique' || scenario === 'merged';
    expect(result.verification.prStatus).toBe(
      verified
        ? 'verified'
        : scenario === 'empty' || scenario === 'wrong-head'
          ? 'missing'
          : 'unavailable',
    );
    expect(result.verification.observedPrUrl).toBe(verified ? match.url : null);
    expect(result.verification.status).toBe(verified ? 'complete' : 'needsVerification');
    expect(result.delivery?.prUrl).toBeUndefined();
    expect(await readFile(path.join(change, '.comet/delivery.json'), 'utf8')).toBe(initial);
    expect(git('status', '--porcelain')).toBe('');
  });

  it('accepts a locally provable descendant remote head but not unknown remote objects', async () => {
    const commit = await archivedDelivery('push');
    git('commit', '--allow-empty', '-m', 'later');
    const head = git('rev-parse', 'HEAD');
    mockRemote(head);
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification.remoteVerified,
    ).toBe(true);
    resetCommands();
    mockRemote('f'.repeat(40));
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification.remoteVerified,
    ).toBe(false);
    expect(commit).not.toBe(head);
  });

  it('keeps missing network, wrong remote refs and unavailable gh unverified', async () => {
    const commit = await archivedDelivery('pr');
    mockRemote(commit, null, new Error('timeout'));
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification.remoteStatus,
    ).toBe('unavailable');
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification.status,
    ).toBe('needsVerification');
    resetCommands();
    mockRemote(commit, null, `${commit}\trefs/heads/other`);
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification.remoteVerified,
    ).toBe(false);
    resetCommands();
    mockRemote(commit, new Error('ENOENT'));
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification,
    ).toMatchObject({
      status: 'needsVerification',
      remoteVerified: true,
      prVerified: false,
      prStatus: 'unavailable',
    });
  });

  it('distinguishes a missing remote branch from unavailable authentication', async () => {
    const commit = await archivedDelivery('push');
    mockRemote(commit, null, '');
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification,
    ).toMatchObject({ status: 'needsVerification', remoteStatus: 'missing' });
    resetCommands();
    mockRemote(commit, null, new Error('authentication unavailable'));
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification.remoteStatus,
    ).toBe('unavailable');
  });

  it('rejects a wrong-repository PR URL before persisting immutable authorization or receipts', async () => {
    const delivery = { action: 'pr', targetBranch: 'main', remote: 'origin' };
    const bad = { ...delivery, prUrl: 'https://github.com/other/project/pull/1' };
    await expect(writeClassicDelivery(root, change, bad, state)).rejects.toThrow(
      'authorized remote repository',
    );
    expect((await readClassicDelivery(root, change)).delivery).toBeNull();
    await writeClassicDelivery(root, change, delivery, state);
    await expect(writeClassicDelivery(root, change, bad, state)).rejects.toThrow(
      'authorized remote repository',
    );
    expect((await readClassicDelivery(root, change)).delivery?.prUrl).toBeUndefined();
    expect(
      (
        await writeClassicDelivery(
          root,
          change,
          { ...delivery, prUrl: 'https://github.com/example/project/pull/2' },
          state,
        )
      ).delivery?.prUrl,
    ).toContain('/pull/2');
  });

  it.each([
    'https://example.invalid/repo.git?access_token=secret',
    'https://example.invalid/repo.git#secret',
    'ssh://git:secret@example.invalid/repo.git',
    'https://user@example.invalid/repo.git',
  ])('does not persist credential-bearing remote URLs: %s', async (remote) => {
    git('remote', 'set-url', 'origin', remote);
    await expect(
      writeClassicDelivery(root, change, { action: 'push', targetBranch: 'main' }, state),
    ).rejects.toThrow('must not contain credentials');
    expect((await readClassicDelivery(root, change)).delivery).toBeNull();
  });

  it.each(['git@example.invalid:owner/repo.git', 'local-bare'])(
    'preserves safe SSH and local remote authorization: %s',
    async (remote) => {
      const url = remote === 'local-bare' ? path.join(root, 'remote.git') : remote;
      git('remote', 'set-url', 'origin', url);
      expect(
        (await writeClassicDelivery(root, change, { action: 'push', targetBranch: 'main' }, state))
          .delivery?.authorizedRemoteUrl,
      ).toBe(url);
    },
  );

  it.each([
    { patch: {}, complete: true },
    { patch: { url: 'https://github.com/other/project/pull/1' }, complete: false },
    { patch: { headRefName: 'other' }, complete: false },
    { patch: { headRefOid: 'f'.repeat(40) }, complete: false },
    { patch: { state: 'CLOSED' }, complete: false },
  ])('requires repository, branch, head and live PR state: %j', async ({ patch, complete }) => {
    const commit = await archivedDelivery('pr');
    mockRemote(commit, {
      url: 'https://github.com/example/project/pull/1',
      headRefName: 'main',
      headRefOid: commit,
      state: 'OPEN',
      ...patch,
    });
    expect(
      (await readClassicDelivery(root, change, { verifyRemote: true })).verification.status,
    ).toBe(complete ? 'complete' : 'needsVerification');
  });

  it('rejects paths outside the project and linked progress directories', async () => {
    await expect(
      writeClassicCheckpoint(root, path.join(root, '..', 'outside'), input(), tasks),
    ).rejects.toThrow();
    const outside = await mkdtemp(path.join(tmpdir(), 'classic-progress-outside-'));
    try {
      await symlink(
        outside,
        path.join(change, '.comet'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(writeClassicCheckpoint(root, change, input(), tasks)).rejects.toThrow();
      await expect(readClassicDelivery(root, change)).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
