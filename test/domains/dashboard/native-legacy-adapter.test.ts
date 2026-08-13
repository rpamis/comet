import { describe, expect, it } from 'vitest';

import {
  adaptLegacyNativeDashboardChange,
  adaptLegacyNativeDashboardListItem,
  invalidNativeDashboardChange,
  invalidNativeDashboardListItem,
} from '../../../domains/dashboard/native-legacy-adapter.js';

function state() {
  return {
    name: 'legacy-change',
    phase: 'verify',
    revision: 4,
    verification_result: 'pass',
    spec_changes: Array.from({ length: 9 }, (_, index) => ({
      capability: `capability-${index}`,
      operation: index % 3 === 0 ? 'create' : index % 3 === 1 ? 'replace' : 'remove',
    })),
  } as never;
}

describe('Native legacy Dashboard adapter', () => {
  it('adapts active and archived states with defaults and legacy metadata', () => {
    const active = adaptLegacyNativeDashboardListItem({ state: state(), status: 'active' });
    const archived = adaptLegacyNativeDashboardChange({
      state: state(),
      status: 'archived',
      archiveName: '2026-08-12-legacy-change',
      archivedAt: '2026-08-12T00:00:00.000Z',
    });

    expect(active).toMatchObject({
      locator: 'active::legacy-change',
      workspace: { id: 'local', current: true },
      phase: 'verify',
      migration: { status: 'required' },
      localExecution: { reason: 'missing' },
    });
    expect(archived).toMatchObject({
      status: 'archived',
      phase: 'archive',
      archiveName: '2026-08-12-legacy-change',
      archivedAt: '2026-08-12T00:00:00.000Z',
      migration: { status: 'legacy-read-only' },
      localExecution: { reason: 'archived' },
      specs: { total: 9, create: 3, modify: 3, remove: 3, capabilitiesTruncated: true },
    });
    expect(archived.specs.capabilities).toHaveLength(8);
  });

  it('preserves explicit locators, workspaces, children, and artifacts', () => {
    const workspace = { id: 'worktree', label: 'feature', branch: 'feature', current: false };
    const children = [{ locator: 'child', name: 'child' }] as never;
    const item = adaptLegacyNativeDashboardListItem({
      state: state(),
      status: 'active',
      locator: 'explicit',
      workspace,
      children,
    });
    const change = adaptLegacyNativeDashboardChange({
      state: state(),
      status: 'active',
      artifacts: [{ path: 'README.md', kind: 'file' }] as never,
      children,
    });

    expect(item).toMatchObject({ locator: 'explicit', workspace, children });
    expect(change).toMatchObject({ artifacts: [{ path: 'README.md' }], children });
  });

  it('creates invalid list and detail projections with optional metadata', () => {
    expect(
      invalidNativeDashboardListItem({
        name: 'broken',
        status: 'archived',
        archiveName: 'archive',
        locator: 'broken-locator',
        message: 'bad state',
      }),
    ).toMatchObject({
      locator: 'broken-locator',
      phase: 'invalid',
      migration: { status: 'invalid', message: 'bad state' },
      localExecution: { reason: 'archived' },
    });
    expect(invalidNativeDashboardChange({ name: 'broken', status: 'active' })).toMatchObject({
      phase: 'invalid',
      specs: { total: 0, capabilitiesTruncated: false },
      localExecution: { reason: 'missing' },
    });
  });
});
