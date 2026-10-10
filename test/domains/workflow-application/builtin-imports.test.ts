import { getCurrentVersion } from '../../../platform/version/version.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime.js';
import { loadWorkflowApplication } from '../../../domains/workflow-application/index.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-builtin-imports-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const moduleSource = `export function createApplication(){return {
  workflows:[{id:'builtin-probe',version:'1',entry:'noop',steps:{noop:{type:'call_tool',ref:'noop'}}}],
  executors:[{id:'local-noop',capabilities:[],supports:a=>a.ref==='noop',execute:async()=>({status:'succeeded',output:{actual:true}})}]
};}\n`;
async function fixture(imports: string, folder = 'package') {
  const directory = path.join(root, folder);
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'application.mjs'), imports + '\n' + moduleSource);
  await fs.writeFile(path.join(directory, 'SKILL.md'), '# Builtin import probe\n');
  const file = path.join(directory, 'application.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      schema: 'comet.workflow.application.v1',
      id: 'builtin-probe',
      version: '1',
      base: 'standalone',
      runtimeVersion: getCurrentVersion(),
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    }),
  );
  return { file, directory };
}

it.each(['module', 'fs/promises', 'path/posix'])(
  'runs equivalent bare and node-prefixed Node builtin %s entries',
  async (specifier) => {
    const definitions = [];
    for (const [index, name] of [specifier, `node:${specifier}`].entries()) {
      const f = await fixture(`import '${name}';`, `package-${index}`);
      const loaded = await loadWorkflowApplication({ file: f.file, projectRoot: root });
      definitions.push(loaded.implementation.workflows);
      const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
      const runId = `builtin-${index}`;
      await runtime.start({ runId, workflow: { id: 'builtin-probe', version: '1' }, input: null });
      const progressed = await runtime.runUntilBlocked({ runId, executorId: 'local-noop' });
      expect(progressed.run.status).toBe('completed');
      expect(progressed.run.outputs.noop.value).toEqual({ actual: true });
    }
    expect(definitions[0]).toEqual(definitions[1]);
  },
);

it.each(['comet-native', 'comet'])(
  'loads the actual shipped %s unused runtime resource closure without executing it',
  async (skill) => {
    const f = await fixture('');
    const source = path.resolve('assets/skills', skill, 'scripts');
    const resources = path.join(f.directory, 'resources');
    await fs.cp(source, resources, { recursive: true });
    const refs = await fs.readdir(resources);
    expect(refs.some((ref) => ref.endsWith('.mjs'))).toBe(true);
    for (const ref of refs) {
      expect(
        (await fs.readFile(path.join(resources, ref))).equals(
          await fs.readFile(path.join(source, ref)),
        ),
      ).toBe(true);
    }
    const loaded = await loadWorkflowApplication({ file: f.file, projectRoot: root });
    expect(loaded.manifest.id).toBe('builtin-probe');
    await expect(fs.stat(path.join(root, '.comet'))).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it.each(['not-a-builtin', 'test', 'node:not-a-builtin'])(
  'rejects unpinned or nonexistent builtin specifier %s',
  async (specifier) => {
    const f = await fixture(`import '${specifier}';`);
    await expect(loadWorkflowApplication({ file: f.file, projectRoot: root })).rejects.toThrow(
      '依赖未固定',
    );
  },
);

it.each([
  { code: "const name='node:fs'; await import(name);", reason: '不能动态选择' },
  { code: "import './missing.mjs';", reason: '依赖缺失' },
])('retains the import boundary: $reason', async ({ code, reason }) => {
  const f = await fixture(code);
  await expect(loadWorkflowApplication({ file: f.file, projectRoot: root })).rejects.toThrow(
    reason,
  );
});

it('still rejects changed fixed resource bytes before continuing an active Run', async () => {
  const f = await fixture("import 'node:fs';");
  await fs.mkdir(path.join(f.directory, 'resources'));
  const resource = path.join(f.directory, 'resources/check.mjs');
  await fs.writeFile(resource, "import 'node:module';\n");
  const loaded = await loadWorkflowApplication({ file: f.file, projectRoot: root });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  const run = await runtime.start({
    runId: 'fixed-resources',
    workflow: { id: 'builtin-probe', version: '1' },
    input: null,
  });
  await fs.writeFile(resource, "import 'module';\n");
  await expect(runtime.inspect(run.runId)).rejects.toMatchObject({ code: 'WORKFLOW_CHANGED' });
});
