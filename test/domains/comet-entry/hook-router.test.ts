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
      },
    );

    expect(decision).toEqual({ allowed: true, reason: 'native' });
    expect(inspectNative).toHaveBeenCalledOnce();
    expect(inspectClassic).not.toHaveBeenCalled();
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

  it('fails closed when a selection points to a missing change', async () => {
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

    expect(decision).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('missing or archived'),
    });
    expect(inspectNative).not.toHaveBeenCalled();
    expect(inspectClassic).not.toHaveBeenCalled();
  });

  it('classifies a missing selected change for deterministic repair', async () => {
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
      status: 'stale',
      code: 'target-missing',
      reason: "selected native change 'missing-change' is missing or archived",
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
