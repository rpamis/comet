import { getCurrentVersion } from '../../../platform/version/version.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { hashRuntimeValue } from '../../../domains/engine/runtime.js';
import {
  prepareWorkflowApplicationPlan,
  compileWorkflowApplication,
} from '../../../domains/workflow-generation/index.js';
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-generated-rule-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('generates and fixes an application Rule together with the SDK Skill entry and Runtime', async () => {
  const plan = await prepareWorkflowApplicationPlan({
    projectRoot: root,
    packageRoot: path.join(root, 'preview'),
    proposal: {
      schema: 'comet.workflow.application.plan.v1',
      manifest: {
        schema: 'comet.workflow.application.v1',
        id: 'rule-report',
        version: '1',
        base: 'standalone',
        runtimeVersion: getCurrentVersion(),
        entrySkill: 'SKILL.md',
        module: 'application.mjs',
        skills: [],
        bindings: [],
      },
      composition: { kind: 'report' },
      modules: {},
    },
  });
  const compiled = await compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    projectRoot: root,
    packageRoot: path.join(root, 'compiled'),
  });
  const manifest = JSON.parse(await fs.readFile(compiled.file, 'utf8'));
  expect(manifest.rule).toBe('rules/workflow-guard.md');
  expect(await fs.readFile(path.join(root, 'compiled', manifest.rule), 'utf8')).toContain(
    'SDK Run',
  );
  expect(await fs.readFile(path.join(root, 'compiled', manifest.rule), 'utf8')).toContain(
    'report-publishing',
  );
  expect(await fs.readFile(path.join(root, 'compiled/SKILL.md'), 'utf8')).toContain(
    'rules/workflow-guard.md',
  );
});
