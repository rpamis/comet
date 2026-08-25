import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { writeCometCurrentSelection } from '../../../domains/comet-entry/current-selection.js';
import {
  inspectCometHook,
  resolveHookWorkflowOwner,
} from '../../../domains/comet-entry/hook-router.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

describe('Comet Hook Router', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-router-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function configureBoth(): Promise<void> {
    const config = defaultProjectConfig('.');
    config.workflows = ['native', 'classic'];
    await writeProjectConfig(root, config);
  }

  it('stays neutral for an unknown write target without reading Comet state', async () => {
    const listNative = vi.fn(async () => {
      throw new Error('Native state must not be read');
    });
    const listClassic = vi.fn(async () => {
      throw new Error('Classic state must not be read');
    });
    const inspectNative = vi.fn();
    const inspectClassic = vi.fn();

    const decision = await inspectCometHook(
      root,
      { intent: 'unknown', targets: [], toolName: 'FutureWriteTool' },
      { listNative, listClassic, inspectNative, inspectClassic },
    );

    expect(decision).toMatchObject({ allowed: true });
    expect(listNative).not.toHaveBeenCalled();
    expect(listClassic).not.toHaveBeenCalled();
    expect(inspectNative).not.toHaveBeenCalled();
    expect(inspectClassic).not.toHaveBeenCalled();
  });

  it('selects task context before an agent starts without requiring an active change', async () => {
    const collectContext = vi.fn(async () => [
      {
        pluginId: 'comet.context-director' as const,
        text: '<agent_context><core_memory>Use Chinese</core_memory></agent_context>',
        episodeId: 'context:one',
        manifest: [],
        applications: [],
      },
    ]);
    const listNative = vi.fn(async () => {
      throw new Error('workflow state must not be read');
    });

    const decision = await inspectCometHook(
      root,
      {
        intent: 'context',
        targets: [],
        toolName: null,
        task: 'Implement the dashboard',
        sessionId: 'omp-session',
      },
      {
        listNative,
        listClassic: vi.fn(async () => []),
        inspectNative: vi.fn(),
        inspectClassic: vi.fn(),
        collectContext,
      },
    );

    expect(decision).toMatchObject({
      allowed: true,
      context: expect.stringContaining('<core_memory>'),
    });
    expect(collectContext).toHaveBeenCalledWith(root, {
      task: 'Implement the dashboard',
      sessionId: 'omp-session',
    });
    expect(listNative).not.toHaveBeenCalled();
  });

  it('does not invent a cross-task session id when the host omits one', async () => {
    const collectContext = vi.fn(async () => []);

    await inspectCometHook(
      root,
      {
        intent: 'context',
        targets: [],
        toolName: null,
        task: 'Independent task',
      },
      {
        listNative: vi.fn(async () => []),
        listClassic: vi.fn(async () => []),
        inspectNative: vi.fn(),
        inspectClassic: vi.fn(),
        collectContext,
      },
    );

    expect(collectContext).toHaveBeenCalledWith(root, { task: 'Independent task' });
  });

  it('stays neutral for project-external targets without reading Comet state', async () => {
    const externalTarget = path.join(os.tmpdir(), `comet-memory-${path.basename(root)}.md`);
    const listNative = vi.fn(async () => {
      throw new Error('Native state must not be read');
    });
    const listClassic = vi.fn(async () => {
      throw new Error('Classic state must not be read');
    });
    const inspectNative = vi.fn();
    const inspectClassic = vi.fn();

    const decision = await inspectCometHook(
      root,
      { intent: 'write', targets: [externalTarget], toolName: 'Write' },
      { listNative, listClassic, inspectNative, inspectClassic },
    );

    expect(decision).toMatchObject({ allowed: true });
    expect(listNative).not.toHaveBeenCalled();
    expect(listClassic).not.toHaveBeenCalled();
    expect(inspectNative).not.toHaveBeenCalled();
    expect(inspectClassic).not.toHaveBeenCalled();
  });

  it('fails closed when the scope of an explicit write target cannot be determined', async () => {
    const scopeTargets = vi.fn(async () => {
      throw new Error('project root is unreadable');
    });

    const decision = await inspectCometHook(
      root,
      { intent: 'write', targets: ['src/app.ts'], toolName: 'Write' },
      {
        listNative: vi.fn(async () => []),
        listClassic: vi.fn(async () => []),
        inspectNative: vi.fn(),
        inspectClassic: vi.fn(),
        scopeTargets,
      },
    );

    expect(decision).toMatchObject({ allowed: false });
    expect(decision.reason).toContain('scope could not be determined safely');
  });

  it('filters external targets before delegating a mixed write to the owning Guard', async () => {
    await configureBoth();
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'native-change',
      branch: null,
    });
    const externalTarget = path.join(os.tmpdir(), `comet-memory-${path.basename(root)}.md`);
    const inspectNative = vi.fn(async () => ({ allowed: true, reason: 'native' }));
    const inspectClassic = vi.fn(async () => ({ allowed: true, reason: 'classic' }));

    const decision = await inspectCometHook(
      root,
      {
        intent: 'write',
        targets: [externalTarget, 'src/app.ts'],
        toolName: 'Edit',
      },
      {
        listNative: async () => [
          { workflow: 'native', name: 'native-change', phase: 'build' as const },
        ],
        listClassic: async () => [],
        inspectNative,
        inspectClassic,
        collectContext: async () => [],
      },
    );

    expect(decision).toEqual({ allowed: true, reason: 'native' });
    expect(inspectNative).toHaveBeenCalledWith(
      root,
      { intent: 'write', targets: ['src/app.ts'], toolName: 'Edit' },
      'native-change',
    );
    expect(inspectClassic).not.toHaveBeenCalled();
  });

  it('routes one event to only the selected Native Guard', async () => {
    await configureBoth();
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'native-change',
      branch: null,
    });
    const inspectNative = vi.fn(async () => ({ allowed: true, reason: 'native' }));
    const inspectClassic = vi.fn(async () => ({ allowed: true, reason: 'classic' }));

    const decision = await inspectCometHook(
      root,
      { intent: 'write', targets: ['src/app.ts'], toolName: 'Write' },
      {
        listNative: async () => [
          { workflow: 'native', name: 'native-change', phase: 'build' as const },
        ],
        listClassic: async () => [
          { workflow: 'classic', name: 'classic-change', phase: 'design' as const },
        ],
        inspectNative,
        inspectClassic,
        collectContext: async () => [],
      },
    );

    expect(decision).toEqual({ allowed: true, reason: 'native' });
    expect(inspectNative).toHaveBeenCalledOnce();
    expect(inspectClassic).not.toHaveBeenCalled();
  });

  it('injects the same progressive Context Manifest and application ids through the Hook', async () => {
    await configureBoth();
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'native-change',
      branch: null,
    });
    const collectContext = vi.fn(async () => [
      {
        pluginId: 'comet.context-director' as const,
        text: [
          '<agent_context>',
          '<context_manifest>',
          '<item id="policy-1" application_id="application-1"><why_applied>当前路径匹配</why_applied></item>',
          '</context_manifest>',
          '</agent_context>',
        ].join('\n'),
        episodeId: 'context:one',
        manifest: [],
        applications: [],
      },
    ]);

    const decision = await inspectCometHook(
      root,
      {
        intent: 'write',
        targets: ['src/app.ts'],
        toolName: 'Edit',
        sessionId: 'session-1',
      },
      {
        listNative: async () => [
          { workflow: 'native', name: 'native-change', phase: 'build' as const },
        ],
        listClassic: async () => [],
        inspectNative: async () => ({ allowed: true, reason: 'native' }),
        inspectClassic: vi.fn(),
        collectContext,
      },
    );

    expect(decision).toMatchObject({
      allowed: true,
      context: expect.stringContaining('application_id="application-1"'),
    });
    expect(collectContext).toHaveBeenCalledWith(root, {
      task: 'Edit src/app.ts',
      path: 'src/app.ts',
      operation: 'Edit',
      phase: 'build',
      sessionId: 'session-1',
    });
  });

  it('does not enumerate Classic state when Native owns the current selection', async () => {
    await configureBoth();
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'native-change',
      branch: null,
    });
    const listClassic = vi.fn(async () => {
      throw new Error('unrelated Classic state is unreadable');
    });

    await expect(
      resolveHookWorkflowOwner(root, {
        listNative: async () => [
          { workflow: 'native', name: 'native-change', phase: 'build' as const },
        ],
        listClassic,
      }),
    ).resolves.toEqual({
      status: 'owned',
      owner: { workflow: 'native', name: 'native-change', phase: 'build' },
    });
    expect(listClassic).not.toHaveBeenCalled();
  });

  it('ignores the standalone root when default owner enumeration checks Classic', async () => {
    await configureBoth();
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'legacy'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs', 'openspec', 'changes', 'docs'), { recursive: true });

    const resolution = await resolveHookWorkflowOwner(root);

    expect(resolution).toEqual({ status: 'none' });
  });

  it('routes one event to only the selected Classic Guard', async () => {
    await configureBoth();
    const changeDir = path.join(root, 'openspec', 'changes', 'classic-change');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, '.comet.yaml'),
      [
        'workflow: full',
        'phase: build',
        'design_doc: docs/superpowers/specs/design.md',
        'plan: null',
        'build_mode: executing-plans',
        'isolation: branch',
        'verify_mode: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'classic',
      change: 'classic-change',
      branch: null,
    });
    const inspectNative = vi.fn(async () => ({ allowed: true, reason: 'native' }));
    const inspectClassic = vi.fn(async () => ({ allowed: true, reason: 'classic' }));

    const decision = await inspectCometHook(
      root,
      { intent: 'write', targets: ['src/app.ts'], toolName: 'Edit' },
      {
        listNative: async () => [
          { workflow: 'native', name: 'native-change', phase: 'shape' as const },
        ],
        listClassic: async () => [
          { workflow: 'classic', name: 'classic-change', phase: 'build' as const },
        ],
        inspectNative,
        inspectClassic,
        collectContext: async () => [],
      },
    );

    expect(decision).toEqual({ allowed: true, reason: 'classic' });
    expect(inspectClassic).toHaveBeenCalledOnce();
    expect(inspectNative).not.toHaveBeenCalled();
  });

  it('does not enumerate Native state when Classic owns the current selection', async () => {
    await configureBoth();
    const changeDir = path.join(root, 'openspec', 'changes', 'classic-change');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, '.comet.yaml'),
      [
        'workflow: full',
        'phase: build',
        'design_doc: docs/superpowers/specs/design.md',
        'plan: null',
        'build_mode: executing-plans',
        'isolation: branch',
        'verify_mode: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'classic',
      change: 'classic-change',
      branch: null,
    });
    const listNative = vi.fn(async () => {
      throw new Error('unrelated Native state is unreadable');
    });

    await expect(
      resolveHookWorkflowOwner(root, {
        listNative,
        listClassic: async () => [
          { workflow: 'classic', name: 'classic-change', phase: 'build' as const },
        ],
      }),
    ).resolves.toEqual({
      status: 'owned',
      owner: { workflow: 'classic', name: 'classic-change', phase: 'build' },
    });
    expect(listNative).not.toHaveBeenCalled();
  });

  it('fails closed when multiple workflows have active changes without a selection', async () => {
    await configureBoth();

    await expect(
      inspectCometHook(
        root,
        { intent: 'write', targets: ['src/app.ts'], toolName: 'Write' },
        {
          listNative: async () => [
            { workflow: 'native', name: 'native-change', phase: 'build' as const },
          ],
          listClassic: async () => [
            { workflow: 'classic', name: 'classic-change', phase: 'build' as const },
          ],
          inspectNative: vi.fn(),
          inspectClassic: vi.fn(),
        },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: expect.stringContaining('Multiple active Comet changes'),
    });
  });

  it('fails closed when one workflow has multiple active changes without a selection', async () => {
    await configureBoth();
    const inspectNative = vi.fn();
    const inspectClassic = vi.fn();

    const decision = await inspectCometHook(
      root,
      { intent: 'write', targets: ['src/app.ts'], toolName: 'Write' },
      {
        listNative: async () => [
          { workflow: 'native', name: 'first', phase: 'build' as const },
          { workflow: 'native', name: 'second', phase: 'build' as const },
        ],
        listClassic: async () => [],
        inspectNative,
        inspectClassic,
      },
    );

    expect(decision).toMatchObject({ allowed: false, reason: expect.stringContaining('first') });
    expect(inspectNative).not.toHaveBeenCalled();
    expect(inspectClassic).not.toHaveBeenCalled();
  });

  it('allows ordinary development when a stale selection has no active replacement', async () => {
    await configureBoth();
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'missing-change',
      branch: null,
    });
    const inspectNative = vi.fn();
    const inspectClassic = vi.fn();

    const decision = await inspectCometHook(
      root,
      { intent: 'write', targets: ['src/app.ts'], toolName: 'Write' },
      {
        listNative: async () => [],
        listClassic: async () => [],
        inspectNative,
        inspectClassic,
      },
    );

    expect(decision).toEqual({ allowed: true, reason: 'No active Comet change' });
    expect(inspectNative).not.toHaveBeenCalled();
    expect(inspectClassic).not.toHaveBeenCalled();
  });

  it('classifies a stale selection with zero active changes as none', async () => {
    await configureBoth();
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'missing-change',
      branch: null,
    });

    await expect(
      resolveHookWorkflowOwner(root, {
        listNative: async () => [],
        listClassic: async () => [],
      }),
    ).resolves.toEqual({
      status: 'none',
      staleSelection: {
        code: 'target-missing',
        reason: "selected native change 'missing-change' is missing or archived",
      },
    });
  });

  it('infers the sole active change after ignoring a stale selection', async () => {
    await configureBoth();
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'missing-change',
      branch: null,
    });

    await expect(
      resolveHookWorkflowOwner(root, {
        listNative: async () => [
          { workflow: 'native', name: 'only-active', phase: 'build' as const },
        ],
        listClassic: async () => [],
      }),
    ).resolves.toEqual({
      status: 'inferred',
      owner: { workflow: 'native', name: 'only-active', phase: 'build' },
      staleSelection: {
        code: 'target-missing',
        reason: "selected native change 'missing-change' is missing or archived",
      },
    });
  });

  it('requires selection when a stale selection leaves multiple active changes', async () => {
    await configureBoth();
    await writeCometCurrentSelection(root, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'missing-change',
      branch: null,
    });

    await expect(
      resolveHookWorkflowOwner(root, {
        listNative: async () => [{ workflow: 'native', name: 'first', phase: 'build' as const }],
        listClassic: async () => [{ workflow: 'classic', name: 'second', phase: 'build' as const }],
      }),
    ).resolves.toEqual({
      status: 'ambiguous',
      candidates: [
        { workflow: 'native', name: 'first', phase: 'build' },
        { workflow: 'classic', name: 'second', phase: 'build' },
      ],
      staleSelection: {
        code: 'target-missing',
        reason: "selected native change 'missing-change' is missing or archived",
      },
    });
  });

  it('classifies unreadable change state without throwing from Doctor callers', async () => {
    await configureBoth();

    await expect(
      resolveHookWorkflowOwner(root, {
        listNative: async () => {
          throw new Error('invalid comet-state.yaml');
        },
        listClassic: async () => [],
      }),
    ).resolves.toEqual({
      status: 'stale',
      code: 'change-state-unreadable',
      reason: 'cannot safely enumerate active Comet changes: invalid comet-state.yaml',
    });
  });

  it('allows ordinary development when no Comet change is active', async () => {
    await configureBoth();
    const inspectNative = vi.fn();
    const inspectClassic = vi.fn();

    await expect(
      inspectCometHook(
        root,
        { intent: 'write', targets: ['src/app.ts'], toolName: 'Write' },
        {
          listNative: async () => [],
          listClassic: async () => [],
          inspectNative,
          inspectClassic,
        },
      ),
    ).resolves.toEqual({ allowed: true, reason: 'No active Comet change' });
    expect(inspectNative).not.toHaveBeenCalled();
    expect(inspectClassic).not.toHaveBeenCalled();
  });

  it('allows ordinary development when configured workflow roots have not been created', async () => {
    await configureBoth();

    await expect(
      inspectCometHook(root, {
        intent: 'write',
        targets: ['src/app.ts'],
        toolName: 'Write',
      }),
    ).resolves.toEqual({ allowed: true, reason: 'No active Comet change' });
  });

  it('infers the only active change without writing selection', async () => {
    await configureBoth();
    const resolution = await resolveHookWorkflowOwner(root, {
      listNative: async () => [
        { workflow: 'native', name: 'only-change', phase: 'verify' as const },
      ],
      listClassic: async () => [],
    });

    expect(resolution).toEqual({
      status: 'inferred',
      owner: { workflow: 'native', name: 'only-change', phase: 'verify' },
    });
    await expect(fs.access(path.join(root, '.comet', 'current-change.json'))).rejects.toMatchObject(
      {
        code: 'ENOENT',
      },
    );
  });

  it('treats no-config projects as Classic-only legacy projects', async () => {
    const resolution = await resolveHookWorkflowOwner(root, {
      listNative: vi.fn(async () => [
        { workflow: 'native', name: 'ignored-native', phase: 'build' as const },
      ]),
      listClassic: async () => [
        { workflow: 'classic', name: 'legacy-classic', phase: 'open' as const },
      ],
    });

    expect(resolution).toEqual({
      status: 'inferred',
      owner: { workflow: 'classic', name: 'legacy-classic', phase: 'open' },
    });
  });
});
