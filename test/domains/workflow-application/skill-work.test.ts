import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime.js';
import {
  loadWorkflowApplication,
  inspectApplicationSkill,
  applicationSkillWork,
  applicationWaitSkillWork,
} from '../../../domains/workflow-application/index.js';
import { createDiskApplication } from '../../helpers/workflow-application.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('returns real fixed guidance for a pending approval without manufacturing an Action or deciding for the user', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-wait-guidance-'));
  roots.push(root);
  const fixture = await createDiskApplication(root);
  const skillFile = path.join(fixture.skillRoot, 'SKILL.md');
  await fs.writeFile(
    skillFile,
    '---\nname: actual-report-review\n---\n\n' + (await fs.readFile(skillFile, 'utf8')),
  );
  const inspected = await inspectApplicationSkill(fixture.skillRoot);
  fixture.manifest.skills[0].contentHash = inspected.contentHash;
  fixture.manifest.skills[0].adapter.review.contentHash = inspected.contentHash;
  fixture.manifest.skills.push({
    ...fixture.manifest.skills[0],
    id: 'approval-guide',
    adapter: { ...fixture.manifest.skills[0].adapter, kind: 'guidance' },
  });
  fixture.manifest.bindings.push({
    workflowId: 'editorial',
    stepId: 'approve',
    skillId: 'approval-guide',
    capability: 'title',
    usage: 'guidance',
  });
  await fs.writeFile(fixture.file, JSON.stringify(fixture.manifest));
  const loaded = await loadWorkflowApplication({ file: fixture.file, projectRoot: root });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'waiting-report',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'Actual topic' },
  });
  expect(applicationSkillWork(loaded, run)[0].skill.id).toBe('writer');
  expect(applicationWaitSkillWork(loaded, run)).toEqual([]);
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'local-skill' })).run;
  const before = structuredClone(run);
  const work = applicationWaitSkillWork(loaded, run);
  expect(applicationSkillWork(loaded, run)).toEqual([]);
  expect(work).toHaveLength(1);
  expect(work[0]).toMatchObject({
    waitId: run.waits[0].id,
    proposalHash: run.waits[0].proposalHash,
    binding: { stepId: 'approve', usage: 'guidance' },
    skill: {
      id: 'approval-guide',
      name: 'actual-report-review',
      root: inspected.root,
      contentHash: inspected.contentHash,
    },
  });
  expect(work[0]).not.toHaveProperty('actionId');
  expect(work[0]).not.toHaveProperty('attempt');
  expect(work[0].skill.files['SKILL.md']).toContain('name: actual-report-review');
  expect(work[0].skill.files['scripts/run.mjs']).toContain('readFileSync');
  expect(run).toEqual(before);
  await runtime.resolveWait({
    runId: run.runId,
    waitId: run.waits[0].id,
    proposalHash: run.waits[0].proposalHash,
    decisionId: 'isolated-fixture-rejected',
    choice: 'approved',
  });
  expect(applicationWaitSkillWork(loaded, await runtime.inspect(run.runId))).toEqual([]);
});
