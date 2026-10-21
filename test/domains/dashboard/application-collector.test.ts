import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  collectDashboardApplicationRunPage,
  collectDashboardApplicationRunDetail,
  collectDashboardApplicationRunRecords,
  readDashboardApplicationArtifact,
} from '../../../domains/dashboard/application-collector.js';
import {
  applicationObservationFixture,
  creatorObservationFixture,
  completeFixtureAction,
} from '../../helpers/dashboard-application-fixture.js';
import {
  createRuntime,
  createFileRuntimeStore,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { DashboardSummaryIndex } from '../../../domains/dashboard/summary-index.js';
import * as creatorObservations from '../../../domains/workflow-creation/index.js';

async function candidateEvidenceFixture(
  project: string,
  version: string,
  status: 'passed' | 'failed',
  artifactCases = false,
) {
  const app = await applicationObservationFixture(project, { version, runId: `app-${version}` });
  const runId = `creator-${version}`;
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(project), 'creator'),
  });
  const names = ['prepare', 'compile', 'verify', 'evaluate'];
  const runtime = createRuntime({
    store,
    workflows: [
      {
        id: 'comet-creator',
        version: '3',
        entry: 'prepare',
        steps: Object.fromEntries(names.map((id) => [id, { type: 'handoff', ref: id }])),
        transitions: names.slice(1).map((to, i) => ({ from: names[i], to })),
      },
    ],
  });
  let run = await runtime.start({
    runId,
    workflow: { id: 'comet-creator', version: '3' },
    input: { goal: 'Evidence fixture' },
  });
  run = await completeFixtureAction(runtime, run, 'prepare', {
    plan: { manifest: { id: app.identity.id, version, base: 'standalone' } },
  });
  run = await completeFixtureAction(runtime, run, 'compile', {
    file: path.join(app.identity.packageRoot, 'application.json'),
    contentHash: app.packageHash,
  });
  run = await completeFixtureAction(runtime, run, 'verify', {
    packageHash: app.packageHash,
    checks: ['fixture validation'],
    ...(artifactCases
      ? {
          artifactVerification: {
            schema: 'comet.workflow.artifact-verification.v1',
            packageHash: app.packageHash,
            contractsHash: 'fixture-contracts',
            checks: [
              { workflowId: 'fixture', stepId: 'design', name: 'valid', accepted: true },
              {
                workflowId: 'fixture',
                stepId: 'design',
                name: 'missing:design.md',
                accepted: false,
              },
            ],
          },
        }
      : {}),
  });
  const result = {
    schema: 'comet.workflow.application.eval.result.v1',
    application: { id: app.identity.id, version, contentHash: app.packageHash },
    experimentId: `eval-${version.replaceAll('.', '-')}`,
    status,
    settings: { agent: 'codex' },
    taskNames: ['fixture case'],
    limitations: [],
    report: 'summary.md',
  };
  const reportDir = path.join(project, '.comet/eval/runs', result.experimentId);
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(reportDir, 'application-result.json'), JSON.stringify(result));
  await fs.writeFile(path.join(reportDir, 'summary.md'), '# Fixture evaluation\n');
  run = await completeFixtureAction(runtime, run, 'evaluate', result);
  return { ...app, creatorRun: run, reportDir };
}

describe('Comet Any observations', () => {
  let root: string, project: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-any-dashboard-'));
    project = path.join(root, 'project');
    await fs.mkdir(project);
    vi.stubEnv('COMET_DATA_DIR', path.join(root, 'data'));
    vi.stubEnv('XDG_CACHE_HOME', path.join(root, 'cache'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('isolates a malformed application partition while refreshing healthy creation runs', async () => {
    await creatorObservationFixture(project, 'healthy-one');
    expect(
      (await collectDashboardApplicationRunPage(project)).items.some(
        (item) => item.runId === 'healthy-one',
      ),
    ).toBe(true);
    const badRoot = path.join(
      resolveWorkspaceRuntimeRootSync(project),
      'applications',
      'broken-app',
    );
    await fs.mkdir(badRoot, { recursive: true });
    await fs.writeFile(path.join(badRoot, '.runtime-store-v2'), 'invalid partition');
    await creatorObservationFixture(project, 'healthy-two');
    await applicationObservationFixture(project, { id: 'healthy-app', runId: 'healthy-app-run' });
    const page = await collectDashboardApplicationRunPage(project);
    expect(
      page.items
        .filter((item) => item.kind === 'creator')
        .map((item) => item.runId)
        .sort(),
    ).toEqual(['healthy-one', 'healthy-two']);
    expect(page.items.find((item) => item.applicationId === 'broken-app')).toMatchObject({
      status: 'unreadable',
    });
    expect(page.items.find((item) => item.runId === 'healthy-app-run')?.error).toBeNull();
    expect(page.indexing).toBe(false);
    await fs.rename(path.join(badRoot, '.runtime-store-v2'), path.join(root, 'saved-partition'));
    const repaired = await collectDashboardApplicationRunPage(project);
    expect(repaired.items.some((item) => item.applicationId === 'broken-app')).toBe(false);
    expect(repaired.items.map((item) => item.runId).sort()).toEqual([
      'healthy-app-run',
      'healthy-one',
      'healthy-two',
    ]);
  });

  it('retries an unreadable projection after a transient read failure without changing storage', async () => {
    await creatorObservationFixture(project, 'transient-read');
    const read = vi
      .spyOn(creatorObservations, 'readCreatorRunProjection')
      .mockRejectedValueOnce(new Error('temporary read failure'));
    try {
      expect((await collectDashboardApplicationRunPage(project)).items[0]).toMatchObject({
        runId: 'transient-read',
        status: 'unreadable',
      });
      expect((await collectDashboardApplicationRunPage(project)).items[0]).toMatchObject({
        runId: 'transient-read',
        status: 'running',
        error: null,
      });
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      read.mockRestore();
    }
  });

  it.each([false, true])(
    'refreshes directory corruption and repair with an initially broken cache: %s',
    async (initiallyBroken) => {
      await creatorObservationFixture(project, 'health-change');
      const key = createHash('sha256').update(JSON.stringify('health-change')).digest('hex');
      const foreign = path.join(
        resolveWorkspaceRuntimeRootSync(project),
        'creator',
        '.runtime-store-v2',
        key,
        'foreign.json',
      );
      if (!initiallyBroken) {
        expect((await collectDashboardApplicationRunPage(project)).items[0]).toMatchObject({
          status: 'running',
          error: null,
        });
      }
      await fs.writeFile(foreign, '{}');
      const broken = await collectDashboardApplicationRunPage(project);
      expect(broken.items[0]).toMatchObject({ runId: 'health-change', status: 'unreadable' });
      expect(broken.items[0].error).not.toBeNull();
      await fs.rename(foreign, path.join(root, 'saved-foreign.json'));
      const repaired = await collectDashboardApplicationRunPage(project);
      expect(repaired.items[0]).toMatchObject({
        runId: 'health-change',
        status: 'running',
        error: null,
      });
    },
  );

  it('shows bound local artifact cases separately from optional model evidence', async () => {
    const current = await candidateEvidenceFixture(project, 'artifact-version', 'passed', true);
    const page = await collectDashboardApplicationRunPage(project, {});
    const item = page.items.find(
      (entry) => entry.kind === 'creator' && entry.runId === current.creatorRun.runId,
    )!;
    const detail = await collectDashboardApplicationRunDetail(project, item.locator);
    expect(detail.evidence.find((entry) => entry.kind === 'local')).toMatchObject({
      status: 'passed',
      summary: '本地应用与阶段产物的正常、异常样例验收已完成',
      details: { artifactVerification: { checks: [{ accepted: true }, { accepted: false }] } },
    });
  });

  it('discovers early creation and distinguishes stopped creation from delivery', async () => {
    await creatorObservationFixture(project);
    await creatorObservationFixture(project, 'stopped', 'stop');
    await creatorObservationFixture(project, 'delivered', 'install');
    const page = await collectDashboardApplicationRunPage(project);
    expect(page.items.find((i) => i.runId === 'creator-draft')).toMatchObject({
      kind: 'creator',
      application: null,
      goal: '让发布说明自动附带证据',
      status: 'running',
    });
    expect(page.items.find((i) => i.runId === 'stopped')?.status).toBe('stopped');
    expect(page.items.find((i) => i.runId === 'delivered')?.status).toBe('delivered');
  });
  it('opens a direct application link before indexing and filters drafts separately from applications', async () => {
    const fixture = await applicationObservationFixture(project);
    await creatorObservationFixture(project);
    const locator = `application:${createHash('sha256')
      .update(JSON.stringify([fixture.identity.id, 'run-one']))
      .digest('hex')}`;
    expect(await collectDashboardApplicationRunDetail(project, locator)).toMatchObject({
      runId: 'run-one',
    });
    const drafts = await collectDashboardApplicationRunPage(project, { scope: 'draft' });
    expect(drafts.items.map((item) => item.runId)).toEqual(['creator-draft']);
    const applications = await collectDashboardApplicationRunPage(project, { scope: 'apps' });
    expect(applications.items.map((item) => item.runId)).toEqual(['run-one']);
  });
  it('keeps fixed versions and all parallel actions, with read-only secret-free detail', async () => {
    const fixture = await applicationObservationFixture(project, { parallel: true });
    await applicationObservationFixture(project, { runId: 'old-run', version: '1.0.0' });
    const page = await collectDashboardApplicationRunPage(project);
    const selected = page.items.find((i) => i.runId === 'run-one')!;
    expect(selected.application?.version).toBe('1.1.0');
    expect(selected.activity).toMatchObject({ running: 2, decisions: 1 });
    const before = await fixture.outer.read('run-one');
    const detail = (await collectDashboardApplicationRunDetail(project, selected.locator))!;
    expect(detail.material.status).toBe('matched');
    expect(detail.currentIds).toHaveLength(3);
    expect(
      detail.records
        .filter((r) => r.active)
        .map((r) => r.kind)
        .sort(),
    ).toEqual(['action', 'action', 'decision']);
    expect(JSON.stringify(detail)).not.toContain('private-');
    expect(await fixture.outer.read('run-one')).toEqual(before);
    const history = await collectDashboardApplicationRunRecords(project, selected.locator, {
      limit: 2,
    });
    expect(history?.items).toHaveLength(2);
    expect(history?.nextCursor).toBeTruthy();
  });
  it('keeps the same Creator locator when a candidate appears and resolves existing candidate links', async () => {
    const runId = 'creator-progress';
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(project), 'creator'),
    });
    const runtime = createRuntime({
      store,
      workflows: [
        {
          id: 'comet-creator',
          version: '3',
          entry: 'analyze',
          steps: {
            analyze: { type: 'handoff', ref: 'analyze' },
            prepare: { type: 'handoff', ref: 'prepare' },
            'confirm-plan': { type: 'ask_user', proposalFrom: 'prepare', choices: ['approved'] },
          },
          transitions: [
            { from: 'analyze', to: 'prepare' },
            { from: 'prepare', to: 'confirm-plan' },
          ],
        },
      ],
    });
    let run = await runtime.start({
      runId,
      workflow: { id: 'comet-creator', version: '3' },
      input: { goal: 'Prepare a report' },
    });
    const initial = (await collectDashboardApplicationRunPage(project)).items[0];
    run = await completeFixtureAction(runtime, run, 'analyze', { summary: 'Report workflow' });
    run = await completeFixtureAction(runtime, run, 'prepare', {
      plan: { manifest: { id: 'report-app', version: '1', base: 'standalone' } },
    });
    const prepared = (await collectDashboardApplicationRunPage(project)).items[0];
    expect(prepared.locator).toBe(initial.locator);
    const detail = await collectDashboardApplicationRunDetail(project, initial.locator);
    expect(detail).toMatchObject({
      runId,
      revision: run.revision,
      applicationId: 'report-app',
      status: 'waiting',
    });
    expect(detail?.records.some((r) => r.stepId === 'confirm-plan' && r.active)).toBe(true);
    const existingLink = `creator:${createHash('sha256')
      .update(JSON.stringify(['report-app', runId]))
      .digest('hex')}`;
    expect(await collectDashboardApplicationRunDetail(project, existingLink)).toMatchObject({
      locator: initial.locator,
      runId,
    });
    expect(await store.read(runId)).toEqual(run);
  });
  it('offers child navigation only after the referenced SDK Run exists', async () => {
    const fixture = await applicationObservationFixture(project, {
      parallel: true,
      child: true,
      deferChild: true,
    });
    const parent = (await collectDashboardApplicationRunPage(project)).items.find(
      (r) => r.runId === fixture.run.runId,
    )!;
    const before = (await collectDashboardApplicationRunDetail(project, parent.locator))!;
    const reference = fixture.run.children[0];
    expect(reference).toBeDefined();
    expect(await fixture.outer.read(reference.runId)).toBeNull();
    expect(before.records.find((r) => r.childRunId === reference.runId)?.childLocator).toBeNull();
    expect(before.children[0].locator).toBeNull();
    expect(await fixture.outer.read(fixture.run.runId)).toMatchObject({ run: fixture.run });
    await fixture.runtime.next({
      runId: fixture.run.runId,
      expectedRevision: fixture.run.revision,
    });
    const after = (await collectDashboardApplicationRunDetail(project, parent.locator))!;
    const child = after.records.find((r) => r.childRunId === reference.runId)!;
    expect(child.childLocator).toBeTruthy();
    expect(after.children[0].locator).toBe(child.childLocator);
    expect(await collectDashboardApplicationRunDetail(project, child.childLocator!)).toMatchObject({
      runId: reference.runId,
      parentLocator: parent.locator,
    });
  });
  it('does not hide healthy runs when another checkpoint is corrupt', async () => {
    const bad = await applicationObservationFixture(project, { runId: 'broken' });
    await applicationObservationFixture(project, { runId: 'healthy' });
    const key = createHash('sha256').update(JSON.stringify('broken')).digest('hex');
    await fs.writeFile(path.join(bad.rootDir, '.runtime-store-v2', key, 'checkpoint.json'), '{}');
    const page = await collectDashboardApplicationRunPage(project);
    expect(page.items.find((i) => i.runId === 'healthy')?.error).toBeNull();
    const item = page.items.find((i) => i.runId === 'broken')!;
    expect(item.status).toBe('unreadable');
    expect((await collectDashboardApplicationRunDetail(project, item.locator))?.records).toEqual(
      [],
    );
  });
  it('follows an actual SDK child reference to its independent evidence wait', async () => {
    const fixture = await applicationObservationFixture(project, { parallel: true, child: true });
    expect(fixture.run.children).toHaveLength(1);
    const page = await collectDashboardApplicationRunPage(project);
    const parent = page.items.find((i) => i.runId === 'run-one')!;
    const detail = (await collectDashboardApplicationRunDetail(project, parent.locator))!;
    const child = detail.records.find((r) => r.childLocator)!;
    const childDetail = (await collectDashboardApplicationRunDetail(project, child.childLocator!))!;
    expect(childDetail.runId).toBe(fixture.run.children[0].runId);
    expect(childDetail.parentLocator).toBe(parent.locator);
    expect(childDetail.records.find((r) => r.kind === 'evidence')).toMatchObject({
      status: 'evidence',
      active: true,
    });
  });
  it('retains separate activations of the same step and original rejection evidence', async () => {
    const fixture = await applicationObservationFixture(project, {
      parallel: true,
      claimParallel: false,
    });
    let run = await fixture.runtime.dispatchCommand({
      runId: fixture.run.runId,
      expectedRevision: fixture.run.revision,
      name: 'repeat',
      commandId: 'repeat-one',
      input: { scope: 'revised' },
    });
    const second = run.actions.filter((a) => a.stepId === 'draft').at(-1)!;
    run = await fixture.runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: second.id,
      attempt: second.attempt,
      inputHash: second.inputHash,
      executorId: 'fixture-host',
      claimToken: 'private-rejected',
      capabilities: [],
    });
    await fixture.runtime
      .recordOutcome({
        runId: run.runId,
        expectedRevision: run.revision,
        outcome: {
          actionId: second.id,
          attempt: 1,
          inputHash: second.inputHash,
          claimToken: 'private-rejected',
          outcomeId: 'rejected-one',
          status: 'succeeded',
          output: { missing: 'required scope' },
        },
      })
      .catch(() => undefined);
    const item = (await collectDashboardApplicationRunPage(project)).items.find(
      (i) => i.runId === 'run-one',
    )!;
    const detail = (await collectDashboardApplicationRunDetail(project, item.locator))!;
    const activations = detail.records.filter((r) => r.stepId === 'draft');
    expect(activations).toHaveLength(2);
    expect(activations[0].id).not.toBe(activations[1].id);
    expect((activations[1].data as { rejectedOutcomes: unknown[] }).rejectedOutcomes).toHaveLength(
      1,
    );
    expect(JSON.stringify(detail)).not.toContain('private-rejected');
  });
  it('rejects changed or cross-query cursors instead of mixing pages', async () => {
    await creatorObservationFixture(project, 'one');
    await creatorObservationFixture(project, 'two');
    const first = await collectDashboardApplicationRunPage(project, { limit: 1 });
    const next = await collectDashboardApplicationRunPage(project, {
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(next.items[0].locator).not.toBe(first.items[0].locator);
    await expect(
      collectDashboardApplicationRunPage(project, { q: 'one', cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ code: 'STALE_APPLICATION_CURSOR' });
    await creatorObservationFixture(project, 'three');
    await expect(
      collectDashboardApplicationRunPage(project, { cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ code: 'STALE_APPLICATION_CURSOR' });
  });
  it('binds inline previews to the selected record and rejects arbitrary artifact ids', async () => {
    await applicationObservationFixture(project, { parallel: true });
    const item = (await collectDashboardApplicationRunPage(project)).items[0];
    const detail = (await collectDashboardApplicationRunDetail(project, item.locator))!;
    const preview = await readDashboardApplicationArtifact(
      project,
      item.locator,
      detail.artifacts[0].id,
    );
    expect(preview?.exists).toBe(true);
    expect(JSON.stringify(preview)).not.toContain('private-fixture-api-key');
    await expect(
      readDashboardApplicationArtifact(project, item.locator, '../../secret'),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(collectDashboardApplicationRunDetail(project, '../../')).rejects.toMatchObject({
      statusCode: 400,
    });
  });
  it('separates local success, failed model evidence and missing host evidence by fixed version', async () => {
    const current = await candidateEvidenceFixture(project, '1.1.0', 'failed');
    await candidateEvidenceFixture(project, '1.2.0', 'passed');
    const page = await collectDashboardApplicationRunPage(project);
    const item = page.items.find((r) => r.runId === 'app-1.1.0')!;
    const detail = (await collectDashboardApplicationRunDetail(project, item.locator))!;
    expect(detail.evidence.map((e) => [e.kind, e.status])).toEqual([
      ['local', 'passed'],
      ['model', 'failed'],
      ['host', 'not-recorded'],
    ]);
    expect(detail.sourceCreators[0].runId).toBe('creator-1.1.0');
    expect(detail.otherEvidence.some((e) => e.version === '1.2.0' && e.status === 'stale')).toBe(
      true,
    );
    await fs.unlink(path.join(current.reportDir, 'application-result.json'));
    const missing = (await collectDashboardApplicationRunDetail(project, item.locator))!;
    expect(missing.evidence.find((e) => e.kind === 'model')?.status).toBe('stale');
    expect(missing.error).toBeNull();
    expect(missing.records.length).toBeGreaterThan(0);
    await fs.writeFile(path.join(current.identity.packageRoot, 'SKILL.md'), 'changed candidate');
    const creator = page.items.find((r) => r.runId === 'creator-1.1.0')!;
    const changed = (await collectDashboardApplicationRunDetail(project, creator.locator))!;
    expect(changed.material.status).toBe('changed');
    expect(changed.evidence.find((e) => e.kind === 'local')?.status).toBe('stale');
  });
  it('checks artifact bytes and refuses bound references outside the project', async () => {
    const fixture = await applicationObservationFixture(project);
    const body = 'original artifact';
    const digest = createHash('sha256').update(body).digest('hex');
    await fs.writeFile(path.join(project, 'result.txt'), body);
    await fs.writeFile(path.join(root, 'outside.txt'), 'outside');
    await completeFixtureAction(fixture.runtime, fixture.run, 'draft', { scope: 'current' }, [
      { uri: 'result.txt', sha256: digest },
      { uri: path.join(root, 'outside.txt'), sha256: digest },
    ]);
    const item = (await collectDashboardApplicationRunPage(project)).items[0];
    const detail = (await collectDashboardApplicationRunDetail(project, item.locator))!;
    const artifact = detail.artifacts.find((a) => a.uri === 'result.txt')!;
    expect(
      (await readDashboardApplicationArtifact(project, item.locator, artifact.id))?.status,
    ).toBe('matched');
    await fs.writeFile(path.join(project, 'result.txt'), 'changed');
    expect(
      (await readDashboardApplicationArtifact(project, item.locator, artifact.id))?.status,
    ).toBe('changed');
    const outside = detail.artifacts.find((a) => a.uri === path.join(root, 'outside.txt'))!;
    await expect(
      readDashboardApplicationArtifact(project, item.locator, outside.id),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it('returns an explicit cache failure rather than silently scanning all Runtime records', async () => {
    const fixture = await applicationObservationFixture(project);
    const unavailable = vi
      .spyOn(DashboardSummaryIndex.prototype, 'ensure')
      .mockRejectedValueOnce(new Error('Fixture cache is unavailable'));
    try {
      await expect(collectDashboardApplicationRunPage(project)).rejects.toMatchObject({
        statusCode: 503,
        code: 'APPLICATION_INDEX_UNAVAILABLE',
      });
    } finally {
      unavailable.mockRestore();
    }
    expect(await fixture.outer.read(fixture.run.runId)).toMatchObject({
      revision: fixture.run.revision,
    });
  });

  it('bounds history while retaining selected and all current records, with stable artifact identifiers', async () => {
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(project), 'creator'),
    });
    const names = Array.from({ length: 46 }, (_, i) => `step-${i}`);
    const runtime = createRuntime({
      store,
      workflows: [
        {
          id: 'comet-creator',
          version: '1',
          entry: names[0],
          steps: Object.fromEntries(names.map((id) => [id, { type: 'handoff', ref: id }])),
          transitions: names.slice(1).map((to, i) => ({ from: names[i], to })),
        },
      ],
    });
    let run = await runtime.start({
      runId: 'bounded',
      workflow: { id: 'comet-creator', version: '1' },
      input: {},
    });
    for (const name of names.slice(0, -1))
      run = await completeFixtureAction(runtime, run, name, { note: name });
    const locator = (await collectDashboardApplicationRunPage(project)).items[0].locator;
    const selectedId = `action:${run.actions[43].id}`;
    const detail = (await collectDashboardApplicationRunDetail(project, locator, {
      recordLimit: 4,
      recordId: selectedId,
    }))!;
    expect(detail.records).toHaveLength(6);
    expect(detail.records.some((record) => record.id === selectedId)).toBe(true);
    expect(detail.currentIds).toEqual([`action:${run.actions[45].id}`]);
    expect(detail.recordPage).toMatchObject({ total: 46, nextCursor: expect.any(String) });
    const first = (await collectDashboardApplicationRunRecords(project, locator, { limit: 4 }))!;
    expect(first.items).toHaveLength(4);
    const artifact = first.artifacts.find((item) => item.recordId === first.items[0].id)!;
    expect(detail.artifacts.find((item) => item.id === artifact.id)).toBeTruthy();
    expect(await readDashboardApplicationArtifact(project, locator, artifact.id)).toMatchObject({
      exists: true,
    });
    const next = await collectDashboardApplicationRunRecords(project, locator, {
      limit: 4,
      cursor: first.nextCursor!,
    });
    expect(next?.items).toHaveLength(4);
    expect(next?.items[0].id).not.toBe(first.items[0].id);
    await completeFixtureAction(runtime, run, names[45], { note: 'done' });
    await expect(
      collectDashboardApplicationRunRecords(project, locator, { cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ code: 'STALE_APPLICATION_CURSOR' });
  }, 60000);
});
