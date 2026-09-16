import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { generateFactorySkillPackage } from '../../../domains/factory/package.js';
import { normalizeWorkflowDefinition } from '../../../domains/workflow-contract/index.js';
import {
  collectAnyDashboardPage,
  collectAnyDashboardDetail,
} from '../../../domains/dashboard/any-collector.js';

describe('Comet Any Dashboard', () => {
  let root: string;
  const run = (name = 'research', overrides = {}) => ({
    schemaVersion: 1,
    workflow: name,
    status: 'running',
    currentNode: 'write',
    completedNodes: ['research'],
    evidence: { research: { summary: 'sources checked' } },
    history: [{ event: 'exit-applied', node: 'research' }],
    ...overrides,
  });
  const protocol = (name = 'research') => ({
    schemaVersion: 1,
    name,
    goal: 'Research and write',
    state: { kind: 'workflow-run', statePath: `.comet/runs/${name}/state.json` },
    nodes: [
      {
        id: 'research',
        label: 'Research',
        implementation: { skill: 'research-skill' },
        outputSchemas: ['notes'],
      },
      {
        id: 'write',
        label: 'Write',
        implementation: { skill: 'writing-skill' },
        outputSchemas: ['report'],
      },
      { id: 'skip', disabled: true },
    ],
    outputSchemas: [
      { id: 'notes', artifacts: [{ paths: ['notes/*.md'], required: true }] },
      { id: 'report', artifacts: [{ paths: ['report.md'], required: true }] },
    ],
  });
  async function write(relative: string, value: unknown, dir = root) {
    await fs.mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
    await fs.writeFile(
      path.join(dir, relative),
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  }
  async function detail() {
    const page = await collectAnyDashboardPage(root, { status: 'all' });
    return (await collectAnyDashboardDetail(root, page.items[0].locator))!;
  }
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-any-dashboard-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns an empty page without initializing state or cache', async () => {
    expect(await collectAnyDashboardPage(root)).toEqual({
      items: [],
      total: 0,
      nextCursor: null,
      diagnostics: [],
      summary: { active: 0, completed: 0, paused: 0, attention: 0, invalid: 0 },
    });
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('observes a real generated Skill from initialization through applied completion', async () => {
    const workflow = normalizeWorkflowDefinition({
      kind: 'workflow-kernel',
      name: 'generated',
      goal: 'Collect reviewed notes',
      customNodes: [
        {
          id: 'research',
          label: 'Research',
          kind: 'producer',
          responsibility: 'Collect reviewed notes',
          implementation: { skill: 'research-skill', operation: 'default', scope: 'main' },
          operations: ['require'],
          outputSchemas: [],
          guardrails: [],
        },
      ],
    });
    const output = await generateFactorySkillPackage({
      root: path.join(root, '.agents'),
      name: 'generated',
      version: '1.0.0',
      description: 'Collect reviewed notes',
      goal: workflow.protocol.goal,
      defaultLocale: 'zh',
      callChain: [{ skill: 'research-skill', preferenceIndex: 0 }],
      workflowDefinition: workflow.input,
      workflowProtocol: workflow.protocol,
      skillCreator: { intent: 'new-skill' },
      resolvedSkills: [],
      deviations: [],
      engineMode: 'none',
    });
    const command = (script: string, ...args: string[]) =>
      execFileSync(process.execPath, [path.join(output.packageRoot, 'scripts', script), ...args], {
        cwd: root,
        env: { ...process.env, COMET_RUN_ROOT: root },
        stdio: 'pipe',
      });
    command('workflow-state.mjs', 'init');
    expect(await detail()).toMatchObject({
      name: 'generated',
      currentNode: 'research',
      totalNodes: 1,
      completedNodes: 0,
    });
    command(
      'workflow-state.mjs',
      'record',
      'research',
      JSON.stringify({ summary: 'Reviewed notes' }),
    );
    command('workflow-guard.mjs', 'exit', 'research', '--apply');
    expect((await collectAnyDashboardPage(root)).total).toBe(0);
    expect((await collectAnyDashboardPage(root, { status: 'completed' })).total).toBe(1);
    const completed = await detail();
    expect(completed).toMatchObject({
      status: 'completed',
      currentNode: null,
      completedNodes: 1,
      totalNodes: 1,
    });
    expect(completed.evidence.research).toMatchObject({ summary: 'Reviewed notes' });
  });
  it('reads nodes, glob artifacts, evidence and history without writing state', async () => {
    await write('.comet/runs/research/state.json', run());
    await write('.agents/skills/research/reference/workflow-protocol.json', protocol());
    await write('notes/a.md', '# Sources');
    const before = await fs.stat(path.join(root, '.comet/runs/research/state.json'));
    const result = await detail();
    expect(result).toMatchObject({
      totalNodes: 2,
      completedNodes: 1,
      currentNode: 'write',
      status: 'running',
      goal: 'Research and write',
    });
    expect(result.nodes.map((node) => node.status)).toEqual(['done', 'current']);
    expect(result.artifacts).toEqual([
      expect.objectContaining({ path: 'notes/*.md', status: 'present', content: '# Sources' }),
      expect.objectContaining({ path: 'report.md', status: 'missing' }),
    ]);
    expect(result.evidence).toEqual(run().evidence);
    expect(result.history).toEqual(run().history);
    expect((await fs.stat(path.join(root, '.comet/runs/research/state.json'))).mtimeMs).toBe(
      before.mtimeMs,
    );
  });
  it('keeps definition-less runs visible without inventing a node total', async () => {
    await write('.comet/runs/research/state.json', run());
    expect(await detail()).toMatchObject({
      totalNodes: null,
      completedNodes: 1,
      nodes: [{ id: 'research' }, { id: 'write' }],
    });
  });
  it('uses authoring protocol only as a labeled fallback, not a separate workflow', async () => {
    await write('.comet/runs/research/state.json', run());
    await write('.comet/bundle-authoring/research.json', {
      schemaVersion: 1,
      name: 'research',
      status: 'draft',
      factory: { workflowProtocol: protocol() },
    });
    expect((await collectAnyDashboardPage(root)).total).toBe(1);
    const result = await detail();
    expect(result.totalNodes).toBe(2);
    expect(result.diagnostics.join(' ')).toContain('authoring snapshot');
  });
  it('isolates malformed and oversized state files and keeps valid records', async () => {
    await write('.comet/runs/a/state.json', '{broken');
    await write('.comet/runs/b/state.json', 'x'.repeat(1024 * 1024 + 1));
    await write('.comet/runs/research/state.json', run());
    const page = await collectAnyDashboardPage(root);
    expect(page.total).toBe(3);
    expect(page.items.filter((item) => item.status === 'invalid')).toHaveLength(2);
    expect(page.items.find((item) => item.name === 'research')?.status).toBe('running');
  });
  it('filters, searches, paginates and rejects malformed queries', async () => {
    await write('.comet/runs/a/state.json', run('a'));
    await write('.comet/runs/b/state.json', run('b'));
    await write(
      '.comet/runs/c/state.json',
      run('c', { status: 'completed', currentNode: null, completedNodes: ['research', 'write'] }),
    );
    const first = await collectAnyDashboardPage(root, { limit: 1 });
    const second = await collectAnyDashboardPage(root, { limit: 1, cursor: first.nextCursor! });
    expect(first.total).toBe(2);
    expect(first.summary).toEqual({ active: 2, completed: 1, paused: 0, attention: 0, invalid: 0 });
    expect(first.items[0].locator).not.toBe(second.items[0].locator);
    expect((await collectAnyDashboardPage(root, { status: 'completed' })).items[0].name).toBe('c');
    expect((await collectAnyDashboardPage(root, { query: 'write' })).total).toBe(2);
    expect((await collectAnyDashboardPage(root, { query: 'not-found' })).total).toBe(0);
    for (const options of [
      { limit: 51 },
      { cursor: '-1' },
      { cursor: '' },
      { cursor: 'NaN' },
      { status: 'archived' },
    ])
      await expect(collectAnyDashboardPage(root, options)).rejects.toThrow('Invalid');
    expect(await collectAnyDashboardDetail(root, '../../private-file')).toBeNull();
  });
  it('does not follow symlinked state or discovery roots', async () => {
    await write('outside/state.json', run('secret'));
    await fs.mkdir(path.join(root, '.comet/runs'), { recursive: true });
    await fs.symlink(path.join(root, 'outside'), path.join(root, '.comet/runs/linked'), 'dir');
    const result = await detail();
    expect(result.status).toBe('invalid');
    expect(result.name).toBe('linked');
    expect(result.diagnostics.join(' ')).toContain('symbolic link');
    await fs.rename(path.join(root, '.comet/runs'), path.join(root, '.comet/real-runs'));
    await fs.symlink(path.join(root, '.comet/real-runs'), path.join(root, '.comet/runs'), 'dir');
    const page = await collectAnyDashboardPage(root);
    expect(page.items).toEqual([]);
    expect(page.diagnostics.join(' ')).toContain('symbolic link');
  });
  it('rejects traversal and linked artifacts and bounds previews', async () => {
    await write('.comet/runs/research/state.json', run());
    const definition = protocol();
    definition.outputSchemas[0].artifacts[0].paths = ['../secret.md', 'notes/link.md', 'big.md'];
    await write('.agents/skills/research/reference/workflow-protocol.json', definition);
    await write('secret.md', 'do not expose through link');
    await write('big.md', 'x'.repeat(65 * 1024));
    await fs.mkdir(path.join(root, 'notes'));
    await fs.symlink(path.join(root, 'secret.md'), path.join(root, 'notes/link.md'));
    const result = await detail();
    expect(result.artifacts.slice(0, 2).map((artifact) => artifact.status)).toEqual([
      'unavailable',
      'unavailable',
    ]);
    expect(result.artifacts[2].status).toBe('present');
    expect(result.artifacts[2].content).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('do not expose');
  });
  it('detects conflicting definitions rather than choosing an arbitrary version', async () => {
    await write('.comet/runs/research/state.json', run());
    await write('.agents/skills/research/reference/workflow-protocol.json', protocol());
    await write('.claude/skills/research/reference/workflow-protocol.json', {
      ...protocol(),
      goal: 'Different version',
    });
    const result = await detail();
    expect(result.totalNodes).toBeNull();
    expect(result.diagnostics.join(' ')).toContain('Conflicting');
  });
  it('preserves explicit blocking and limits history without inferring process activity', async () => {
    await write(
      '.comet/runs/research/state.json',
      run('research', {
        status: 'blocked',
        reason: 'Awaiting approval',
        history: Array.from({ length: 120 }, (_, index) => ({ index })),
      }),
    );
    const result = await detail();
    expect(result).toMatchObject({ status: 'blocked', blocker: 'Awaiting approval' });
    expect(result.history).toHaveLength(100);
    expect(result.history[0]).toEqual({ index: 20 });
  });
  it('distinguishes same-name runs across git worktrees', async () => {
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git('init', '-b', 'main');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    );
    const linked = path.join(root, 'linked');
    git('worktree', 'add', '-b', 'feature', linked);
    await write('.comet/runs/research/state.json', run());
    await write(
      '.comet/runs/research/state.json',
      run('research', { currentNode: 'review' }),
      linked,
    );
    const page = await collectAnyDashboardPage(root);
    expect(page.total).toBe(2);
    expect(new Set(page.items.map((item) => item.locator)).size).toBe(2);
    const other = page.items.find((item) => item.workspace.branch === 'feature')!;
    expect((await collectAnyDashboardDetail(root, other.locator))?.currentNode).toBe('review');
  });
});
