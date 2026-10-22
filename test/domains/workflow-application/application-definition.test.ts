import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getCurrentVersion } from '../../../platform/version/version.js';
import { defineWorkflow, hashRuntimeValue } from '../../../domains/engine/runtime.js';
import {
  inspectWorkflowApplicationMaterial,
  inspectWorkflowApplicationPackage,
  exportWorkflowApplication,
  loadWorkflowApplication,
  parseWorkflowApplicationDefinition,
  matchesWorkflowApplicationDefinition,
  type ApplicationIdentity,
  type WorkflowApplicationManifest,
} from '../../../domains/workflow-application/index.js';
import {
  applicationFilesHash,
  readApplicationFiles,
} from '../../../domains/workflow-application/skill-adapter.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-application-definition-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const workflow = () =>
  defineWorkflow({
    id: 'research',
    version: '1',
    entry: ['read', 'search'],
    steps: {
      read: { type: 'handoff', ref: 'reader' },
      search: { type: 'handoff', ref: 'searcher' },
      review: {
        type: 'ask_user',
        proposalFrom: ['read', 'search'],
        choices: ['approved', 'repair'],
        join: ['read', 'search'],
      },
      publish: { type: 'handoff', ref: 'publisher' },
    },
    transitions: [
      { from: 'read', to: 'review' },
      { from: 'search', to: 'review' },
      { from: 'review', to: 'read', on: 'repair' },
      { from: 'review', to: 'publish', on: 'approved' },
    ],
  });

const document = () => ({
  schema: 'comet.workflow.application.definition.v1',
  application: { id: 'research-app', version: '1' },
  workflows: [workflow()],
  presentation: {
    title: '研究与发布',
    description: '检索资料并提交用户审核。',
    steps: [
      {
        workflowId: 'research',
        stepId: 'read',
        title: '阅读资料',
        phase: '研究',
        description: '读取提供的文件。',
        outputFields: [{ path: 'report.sources.0.title', label: '首条来源' }],
      },
    ],
  },
});

async function packageFixture(
  moduleSource = `import { readFileSync } from 'node:fs';
const workflows = JSON.parse(readFileSync(new URL('./implementation.json', import.meta.url), 'utf8'));
export function createApplication() { return { workflows }; }`,
  implementation = [workflow()],
) {
  const packageRoot = path.join(root, 'package');
  await fs.mkdir(packageRoot);
  const manifest: WorkflowApplicationManifest = {
    schema: 'comet.workflow.application.v1',
    id: 'research-app',
    version: '1',
    base: 'standalone',
    runtimeVersion: getCurrentVersion(),
    entrySkill: 'SKILL.md',
    module: 'application.mjs',
    definition: 'workflow.json',
    skills: [],
    bindings: [],
  };
  await fs.writeFile(path.join(packageRoot, 'application.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(packageRoot, 'workflow.json'), JSON.stringify(document()));
  await fs.writeFile(path.join(packageRoot, 'implementation.json'), JSON.stringify(implementation));
  await fs.writeFile(path.join(packageRoot, 'SKILL.md'), '# Research');
  await fs.writeFile(path.join(packageRoot, 'application.mjs'), moduleSource);
  const packageHash = applicationFilesHash(await readApplicationFiles(packageRoot));
  const identity: ApplicationIdentity = {
    id: manifest.id,
    version: manifest.version,
    base: manifest.base,
    runtimeVersion: manifest.runtimeVersion,
    projectRoot: root,
    packageRoot,
    contentHash: hashRuntimeValue({ package: packageHash, skills: [] }),
  };
  return { manifest, packageRoot, packageHash, identity };
}

it('preserves the complete normalized graph and display metadata as pure data', () => {
  const definition = parseWorkflowApplicationDefinition(document());
  expect(definition.workflows[0]).toEqual(workflow());
  expect(definition.presentation).toEqual(document().presentation);
  expect(definition.workflows[0].steps.review.join).toEqual(['read', 'search']);
  const changed = structuredClone(document());
  changed.workflows[0].transitions[2].to = 'search';
  expect(hashRuntimeValue(parseWorkflowApplicationDefinition(changed))).not.toBe(
    hashRuntimeValue(definition),
  );
  const nested = structuredClone(document());
  nested.workflows.push(
    defineWorkflow({
      id: 'read-documents',
      version: '1',
      entry: 'extract',
      steps: { extract: { type: 'handoff', ref: 'reader' } },
    }),
  );
  nested.workflows[0].steps.read = {
    type: 'child_workflow',
    workflow: { id: 'read-documents', version: '1' },
    retry: 'manual',
  };
  expect(parseWorkflowApplicationDefinition(nested).workflows[0].steps.read).toMatchObject({
    type: 'child_workflow',
    workflow: { id: 'read-documents', version: '1' },
  });
});

it('rejects invalid graph references, child workflows, display references and unsafe selectors', () => {
  expect(() =>
    parseWorkflowApplicationDefinition({ ...document(), schema: 'other-schema' }),
  ).toThrow('格式不受支持');
  expect(() =>
    parseWorkflowApplicationDefinition(document(), { id: 'different', version: '1' }),
  ).toThrow('固定身份');
  const edge = structuredClone(document());
  edge.workflows[0].transitions[0].to = 'missing';
  expect(() => parseWorkflowApplicationDefinition(edge)).toThrow('不存在');
  const child = structuredClone(document());
  child.workflows[0].steps.read = {
    type: 'child_workflow',
    workflow: { id: 'missing-child', version: '1' },
    retry: 'manual',
  };
  expect(() => parseWorkflowApplicationDefinition(child)).toThrow('子流程定义不存在');
  const reference = structuredClone(document());
  reference.presentation.steps[0].stepId = 'missing';
  expect(() => parseWorkflowApplicationDefinition(reference)).toThrow('不存在的步骤');
  const repeated = structuredClone(document());
  repeated.presentation.steps.push(repeated.presentation.steps[0]);
  expect(() => parseWorkflowApplicationDefinition(repeated)).toThrow('重复步骤展示');
  for (const selector of ['__proto__.value', 'report.constructor.name', 'title()', 'a[0]']) {
    const unsafe = structuredClone(document());
    unsafe.presentation.steps[0].outputFields[0].path = selector;
    expect(() => parseWorkflowApplicationDefinition(unsafe)).toThrow('路径无效');
  }
  expect(() =>
    parseWorkflowApplicationDefinition({
      ...document(),
      presentation: { title: 'x'.repeat(257) },
    }),
  ).toThrow('长度');
  expect(() =>
    parseWorkflowApplicationDefinition({
      ...document(),
      presentation: { title: '展示', script: 'alert(1)' },
    }),
  ).toThrow('未声明字段');
  expect(() =>
    parseWorkflowApplicationDefinition({
      ...document(),
      presentation: { steps: Array.from({ length: 4097 }, () => document().presentation.steps[0]) },
    }),
  ).toThrow('有界数组');
  expect(() =>
    parseWorkflowApplicationDefinition({
      ...document(),
      workflows: [...document().workflows, ...document().workflows],
    }),
  ).toThrow('重复流程身份');
});

it('matches the Run main workflow hash and every pinned child definition without loading code', () => {
  const definition = parseWorkflowApplicationDefinition(document());
  const current = definition.workflows[0];
  const key = JSON.stringify([current.id, current.version]);
  const hash = hashRuntimeValue(current);
  const run = {
    workflow: { id: current.id, version: current.version, hash },
    definitionHashes: { [key]: hash },
  };
  expect(matchesWorkflowApplicationDefinition(definition, run)).toBe(true);
  expect(
    matchesWorkflowApplicationDefinition(definition, {
      ...run,
      workflow: { ...run.workflow, hash: 'different' },
    }),
  ).toBe(false);
  expect(
    matchesWorkflowApplicationDefinition(definition, {
      ...run,
      definitionHashes: { [key]: 'different' },
    }),
  ).toBe(false);
  expect(
    matchesWorkflowApplicationDefinition(definition, {
      ...run,
      definitionHashes: {},
    }),
  ).toBe(false);
  const child = defineWorkflow({
    id: 'child',
    version: '1',
    entry: 'read',
    steps: { read: { type: 'handoff', ref: 'reader' } },
  });
  const childKey = JSON.stringify([child.id, child.version]);
  const childHash = hashRuntimeValue(child);
  const pinned = { ...run, definitionHashes: { ...run.definitionHashes, [childKey]: childHash } };
  expect(matchesWorkflowApplicationDefinition(definition, pinned)).toBe(false);
  const withChild = { ...definition, workflows: [...definition.workflows, child] };
  expect(matchesWorkflowApplicationDefinition(withChild, pinned)).toBe(true);
  expect(
    matchesWorkflowApplicationDefinition(withChild, {
      ...pinned,
      definitionHashes: { ...pinned.definitionHashes, [childKey]: 'changed' },
    }),
  ).toBe(false);
});

it('observes matched package definitions without evaluating the application module', async () => {
  const fixture = await packageFixture('throw new Error("application module must not execute");');
  expect(
    await inspectWorkflowApplicationPackage(fixture.packageRoot, fixture.packageHash),
  ).toMatchObject({
    status: 'matched',
    definition: parseWorkflowApplicationDefinition(document()),
  });
  expect(await inspectWorkflowApplicationMaterial(fixture.identity)).toMatchObject({
    status: 'matched',
    definition: parseWorkflowApplicationDefinition(document()),
  });
  expect(await fs.readdir(root)).toEqual(['package']);
});

it('withholds a graph after package drift and rejects declared invalid or missing definitions', async () => {
  const fixture = await packageFixture();
  await fs.writeFile(path.join(fixture.packageRoot, 'workflow.json'), '{"schema":"unknown"}');
  const drifted = await inspectWorkflowApplicationMaterial(fixture.identity);
  expect(drifted.status).toBe('changed');
  expect(drifted.definition).toBeUndefined();
  expect(
    (await inspectWorkflowApplicationPackage(fixture.packageRoot, fixture.packageHash)).definition,
  ).toBeUndefined();
  const changedHash = applicationFilesHash(await readApplicationFiles(fixture.packageRoot));
  expect(await inspectWorkflowApplicationPackage(fixture.packageRoot, changedHash)).toMatchObject({
    status: 'unavailable',
  });
  await fs.unlink(path.join(fixture.packageRoot, 'workflow.json'));
  await expect(
    exportWorkflowApplication({
      file: path.join(fixture.packageRoot, 'application.json'),
      projectRoot: root,
      destination: path.join(root, 'exported'),
    }),
  ).rejects.toThrow('缺少声明');
  await expect(
    loadWorkflowApplication({
      file: path.join(fixture.packageRoot, 'application.json'),
      projectRoot: root,
    }),
  ).rejects.toThrow('缺少声明');
});

it('loads a matching definition and retains legacy packages without a declared graph', async () => {
  const fixture = await packageFixture();
  const loaded = await loadWorkflowApplication({
    file: path.join(fixture.packageRoot, 'application.json'),
    projectRoot: root,
  });
  expect(loaded.definition?.workflows).toEqual(loaded.implementation.workflows.map(defineWorkflow));
  const legacyRoot = path.join(root, 'legacy');
  await fs.cp(fixture.packageRoot, legacyRoot, { recursive: true });
  delete fixture.manifest.definition;
  await fs.writeFile(path.join(legacyRoot, 'application.json'), JSON.stringify(fixture.manifest));
  expect(
    (
      await loadWorkflowApplication({
        file: path.join(legacyRoot, 'application.json'),
        projectRoot: root,
      })
    ).definition,
  ).toBeUndefined();
});

it('refuses loading an application whose real graph differs from its static definition', async () => {
  const changed = structuredClone(workflow());
  changed.transitions[2].to = 'search';
  const fixture = await packageFixture(undefined, [changed]);
  await expect(
    loadWorkflowApplication({
      file: path.join(fixture.packageRoot, 'application.json'),
      projectRoot: root,
    }),
  ).rejects.toThrow('实际工厂的流程与固定流程定义不匹配');
});
