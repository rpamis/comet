import { describe, it, expect } from 'vitest';
import {
  groupApplicationRuns,
  groupApplicationSteps,
  initialApplicationRecord,
  mergeApplicationRunPages,
  refreshApplicationRunPage,
  applicationWorkflowView,
  applicationOutputSummary,
} from '../../../domains/dashboard/web/src/application-data.js';

describe('Comet Any workspace identity', () => {
  it('groups versions by application while retaining independent early creations', () => {
    const items = [
      { locator: 'draft', kind: 'creator', goal: 'Goal', application: null },
      {
        locator: 'one',
        kind: 'creator',
        application: { id: 'app', version: '1' },
        applicationId: 'app',
      },
      {
        locator: 'two',
        kind: 'application',
        application: { id: 'app', version: '2' },
        applicationId: 'app',
      },
    ];
    const groups = groupApplicationRuns(items);
    expect(groups).toHaveLength(2);
    expect(groups.find((g: any) => g.id === 'app').versions).toEqual(['1', '2']);
    expect(groups[0].id).toBeNull();
  });
  it('keeps activation identities and chooses attention without hiding concurrent work', () => {
    const records = [
      { id: 'action-old', stepId: 'repeat', status: 'succeeded', active: false },
      { id: 'action-current', stepId: 'repeat', status: 'running', active: true },
      { id: 'approval', stepId: 'approval', status: 'waiting', active: true },
    ];
    const steps = groupApplicationSteps(records);
    expect(steps[0].records.map((r: any) => r.id)).toEqual(['action-old', 'action-current']);
    expect(
      initialApplicationRecord({ records, currentIds: ['action-current', 'approval'] }).id,
    ).toBe('approval');
    expect(records.filter((r) => r.active)).toHaveLength(2);
  });
  it('replaces revised summaries by stable locator when loading more pages', () => {
    expect(
      mergeApplicationRunPages(
        { fingerprint: 'same', items: [{ locator: 'one', revision: 1 }] },
        {
          fingerprint: 'same',
          items: [
            { locator: 'one', revision: 2 },
            { locator: 'two', revision: 1 },
          ],
          total: 2,
        },
      ).items,
    ).toEqual([
      { locator: 'one', revision: 2 },
      { locator: 'two', revision: 1 },
    ]);
  });
});

describe('complete application workflow', () => {
  const workflow = {
    id: 'editorial',
    version: '1',
    dynamicRouting: false,
    entry: ['draft'],
    commands: { cleanup: { stepId: 'discard' } },
    steps: {
      draft: { type: 'invoke_skill', ref: 'writer' },
      check: { type: 'call_tool', ref: 'check' },
      review: { type: 'child_workflow', workflow: { id: 'review', version: '1' } },
      publish: { type: 'ask_user', join: ['check', 'review'] },
      discard: { type: 'call_tool', ref: 'discard' },
    },
    transitions: [
      { from: 'draft', to: 'check', on: 'succeeded' },
      { from: 'draft', to: 'review', on: 'succeeded' },
      { from: 'check', to: 'publish', on: 'succeeded' },
      { from: 'review', to: 'publish', on: 'succeeded' },
      { from: 'publish', to: 'draft', on: 'revise' },
      { from: 'publish', to: 'discard', on: 'rejected' },
    ],
  };
  it('shows unstarted nodes, conditional paths, parallel joins and cycles from the definition', () => {
    const view = applicationWorkflowView({
      definition: {
        status: 'available',
        title: 'Editorial review',
        workflow,
        steps: [{ stepId: 'publish', title: '发布确认', phase: '交付', recordCount: 0 }],
      },
      records: [],
    });
    expect(view.nodes).toHaveLength(5);
    expect(view.nodes.find((node: any) => node.stepId === 'publish')).toMatchObject({
      title: '发布确认',
      phase: '交付',
      join: ['check', 'review'],
      recordCount: 0,
      latestStatus: null,
    });
    expect(
      view.edges.filter((edge: any) => edge.from === 'draft').every((edge: any) => edge.parallel),
    ).toBe(true);
    expect(view.edges.find((edge: any) => edge.on === 'revise').cyclic).toBe(true);
    expect(view.edges.find((edge: any) => edge.to === 'discard')).toMatchObject({
      cyclic: false,
      parallel: false,
    });
    expect(view.nodes.find((node: any) => node.stepId === 'discard').latestStatus).toBeNull();
    expect(view.nodes.find((node: any) => node.stepId === 'discard').commands).toEqual(['cleanup']);
  });
  it('retains every simultaneous activation and repeated record of the same step', () => {
    const records = [
      { id: 'old', stepId: 'draft', status: 'succeeded', active: false },
      { id: 'a', stepId: 'draft', status: 'running', active: true },
      { id: 'b', stepId: 'draft', status: 'unknown', active: true },
    ];
    const view = applicationWorkflowView({
      definition: {
        status: 'available',
        workflow,
        steps: [
          {
            stepId: 'draft',
            recordCount: 8,
            activeRecordIds: ['a', 'b'],
            latestRecordId: 'b',
            latestStatus: 'unknown',
          },
        ],
      },
      records,
    });
    expect(view.nodes[0].activeRecordIds).toEqual(['a', 'b']);
    expect(view.nodes[0].records.map((record: any) => record.id)).toEqual(['old', 'a', 'b']);
    expect(view.nodes[0].recordCount).toBe(8);
  });
  it('keeps dynamic routing choices as candidate paths without claiming parallel activation', () => {
    const view = applicationWorkflowView({
      definition: { status: 'available', workflow: { ...workflow, dynamicRouting: true } },
      records: [],
    });
    expect(view.edges).toHaveLength(workflow.transitions.length);
    expect(view.edges.every((edge: any) => !edge.parallel)).toBe(true);
    expect(view.edges.find((edge: any) => edge.on === 'revise').cyclic).toBe(true);
  });
  it('indexes a maximum-size graph with separate cycles, commands and phases without recursion', () => {
    const size = 4096,
      split = size / 2;
    const stepIds = Array.from({ length: size }, (_, index) => `step-${index}`);
    const transitions = stepIds.flatMap((from, index) =>
      [1, 2, 3, 4].map((offset) => ({
        from,
        to: stepIds[
          index === split - 1 && offset === 4
            ? split
            : Math.floor(index / split) * split + ((index + offset) % split)
        ],
        on: 'succeeded',
      })),
    );
    const view = applicationWorkflowView({
      definition: {
        status: 'available',
        workflow: {
          id: 'large',
          version: '1',
          dynamicRouting: false,
          entry: stepIds,
          steps: Object.fromEntries(stepIds.map((id) => [id, { type: 'call_tool', ref: id }])),
          commands: Object.fromEntries(
            stepIds.map((stepId, index) => [`command-${index}`, { stepId }]),
          ),
          transitions,
        },
        steps: stepIds.map((stepId) => ({ stepId, phase: stepId })),
      },
      records: [],
    });
    expect(view.nodes).toHaveLength(size);
    expect(view.edges).toHaveLength(16384);
    expect(view.edges.filter((edge: any) => !edge.cyclic)).toEqual([
      { from: 'step-2047', to: 'step-2048', on: 'succeeded', cyclic: false, parallel: true },
    ]);
    expect(view.nodes.every((node: any) => node.entry && node.connections.length === 4)).toBe(true);
    expect(view.nodes.at(-1).commands).toEqual(['command-4095']);
    expect(view.phaseGroups).toHaveLength(size);
    expect(view.phaseGroups.at(-1).nodes).toEqual([view.nodes.at(-1)]);
  });
  it('recognizes self-loops while leaving one-way outgoing paths outside the cycle', () => {
    const view = applicationWorkflowView({
      definition: {
        status: 'available',
        workflow: {
          ...workflow,
          transitions: [
            { from: 'draft', to: 'draft', on: 'revise' },
            { from: 'draft', to: 'discard', on: 'rejected' },
          ],
        },
      },
      records: [],
    });
    expect(view.edges.map((edge: any) => edge.cyclic)).toEqual([true, false]);
  });
  it('does not mistake paged-out history for an unstarted step', () => {
    const view = applicationWorkflowView({
      definition: {
        status: 'available',
        workflow,
        steps: [
          {
            stepId: 'draft',
            recordCount: 12,
            activeRecordIds: [],
            latestRecordId: 'outside-page',
            latestStatus: 'succeeded',
          },
        ],
      },
      records: [],
    });
    expect(view.nodes[0]).toMatchObject({
      recordCount: 12,
      records: [],
      latestStatus: 'succeeded',
      latestRecordId: 'outside-page',
    });
  });
  it('honors explicit empty authoritative statistics over retained stale history', () => {
    const view = applicationWorkflowView({
      definition: {
        status: 'available',
        workflow,
        steps: [
          {
            stepId: 'draft',
            recordCount: 0,
            activeRecordIds: [],
            latestRecordId: null,
            latestStatus: null,
          },
        ],
      },
      records: [{ id: 'stale', stepId: 'draft', status: 'succeeded', stale: true }],
    });
    expect(view.nodes[0]).toMatchObject({
      recordCount: 0,
      activeRecordIds: [],
      latestRecordId: null,
      latestStatus: null,
    });
  });
  it('does not render a graph from missing or changed definitions', () => {
    for (const status of ['missing', 'changed', 'unavailable'])
      expect(applicationWorkflowView({ definition: { status, workflow }, records: [] })).toBeNull();
    expect(applicationWorkflowView({ records: [] })).toBeNull();
  });
  it('reads only declared output fields and preserves false, zero and null', () => {
    const summary = applicationOutputSummary(
      {
        data: { outcome: { output: { report: { count: 0, approved: false, note: null } } } },
      },
      [
        { path: 'report.count', label: '数量' },
        { path: 'report.approved', label: '批准' },
        { path: 'report.note', label: '备注' },
        { path: 'report.missing', label: '缺失' },
        { path: 'report.toString', label: '原型方法' },
      ],
    );
    expect(summary.map((field: any) => [field.available, field.value])).toEqual([
      [true, 0],
      [true, false],
      [true, null],
      [false, undefined],
      [false, undefined],
    ]);
  });
});

describe('Any page snapshot boundaries', () => {
  const previous = {
    fingerprint: 'old',
    items: [{ locator: 'first' }, { locator: 'second' }],
    nextCursor: 'third',
    total: 3,
  };
  it('rejects another snapshot rather than mixing or replacing the current query', () => {
    expect(
      mergeApplicationRunPages(previous, {
        fingerprint: 'new',
        items: [{ locator: 'unrelated' }],
        nextCursor: null,
      }),
    ).toBe(previous);
    expect(mergeApplicationRunPages(null, previous)).toBeNull();
  });
  it('preserves loaded pages and their cursor when an unchanged snapshot refreshes', () => {
    expect(
      refreshApplicationRunPage(previous, {
        fingerprint: 'old',
        items: [{ locator: 'first', revision: 2 }],
        nextCursor: 'second',
        total: 3,
      }),
    ).toEqual({ ...previous, items: [{ locator: 'first', revision: 2 }, { locator: 'second' }] });
  });
  it('restarts pagination when a refresh changes the snapshot', () => {
    const next = { fingerprint: 'new', items: [{ locator: 'replacement' }], nextCursor: null };
    expect(refreshApplicationRunPage(previous, next)).toBe(next);
  });
});

describe('bounded application history', () => {
  it('rejects a delayed older detail response after a newer selected-record response', async () => {
    const { refreshApplicationRunDetail } =
      await import('../../../domains/dashboard/web/src/application-data.js');
    const current = {
      locator: 'one',
      revision: 5,
      definition: { status: 'available', title: 'Current version' },
      records: [{ id: 'selected', active: true }],
      currentIds: ['selected'],
      recordPage: { nextCursor: 'current', total: 5 },
    };
    expect(
      refreshApplicationRunDetail(current, {
        locator: 'one',
        revision: 4,
        definition: { status: 'missing' },
        records: [{ id: 'old', active: true }],
        currentIds: ['old'],
      }),
    ).toBe(current);
    const other = { locator: 'two', revision: 1, records: [] };
    expect(refreshApplicationRunDetail(current, other)).toBe(other);
  });
  it('retains older history but clears obsolete active flags after a revision change', async () => {
    const { refreshApplicationRunDetail } =
      await import('../../../domains/dashboard/web/src/application-data.js');
    const next = refreshApplicationRunDetail(
      {
        locator: 'one',
        revision: 1,
        records: [{ id: 'old', active: true }],
        currentIds: ['old'],
        artifacts: [],
        recordPage: { nextCursor: 'old-cursor', total: 1 },
      },
      {
        locator: 'one',
        revision: 2,
        records: [{ id: 'new', active: true }],
        currentIds: ['new'],
        artifacts: [],
        recordPage: { nextCursor: 'new-cursor', total: 2 },
      },
    );
    expect(next.records).toEqual([
      { id: 'old', active: false, stale: true },
      { id: 'new', active: true },
    ]);
    expect(next.currentIds).toEqual(['new']);
    expect(next.recordPage.nextCursor).toBe('new-cursor');
  });
  it('rejects pages from another revision or run and merges stable artifacts', async () => {
    const { mergeApplicationRecordPage } =
      await import('../../../domains/dashboard/web/src/application-data.js');
    const previous = {
      locator: 'one',
      revision: 2,
      records: [{ id: 'a' }],
      artifacts: [{ id: 'artifact' }],
    };
    expect(mergeApplicationRecordPage(previous, { locator: 'two', revision: 2 })).toBe(previous);
    expect(mergeApplicationRecordPage(previous, { locator: 'one', revision: 1 })).toBe(previous);
    const next = mergeApplicationRecordPage(previous, {
      locator: 'one',
      revision: 2,
      items: [{ id: 'b' }],
      artifacts: [{ id: 'artifact' }],
      total: 2,
      nextCursor: null,
    });
    expect(next.records).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(next.artifacts).toHaveLength(1);
  });
});
