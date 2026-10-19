import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';
import { build } from 'esbuild';
import { createDiskApplication } from '../../helpers/workflow-application.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import { createRuntime, type RuntimeValue } from '../../../domains/engine/runtime.js';
import {
  loadWorkflowApplication,
  selectWorkflowApplication,
} from '../../../domains/workflow-application/index.js';
import { parseClassicStateDocument } from '../../../domains/comet-classic/classic-state.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { runCometHookRouterGuard } from '../../../domains/comet-entry/hook-router-guard-entry.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-app-hook-readonly-'));
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result[entry.name + '/'] = '';
      for (const [name, value] of Object.entries(await snapshot(file)))
        result[entry.name + '/' + name] = value;
    } else result[entry.name] = (await fs.readFile(file)).toString('base64');
  }
  return result;
}

async function fixture(workflow: 'native' | 'classic') {
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(projectRoot);
  execFileSync('git', ['init', '-b', 'main', projectRoot], { stdio: 'ignore' });
  const disk = await createDiskApplication(projectRoot);
  disk.manifest.base = workflow === 'native' ? 'native' : 'classic-hotfix';
  await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
  const module = path.join(disk.packageRoot, 'application.mjs');
  // 使用真实领域 wrapStore，简单工作流只用于隔离 Hook 的加载与投影边界。
  const factory =
    workflow === 'native' ? 'createNativeSdkStateStore' : 'createClassicSdkStateStore';
  let source = await fs.readFile(module, 'utf8');
  source =
    'import { ' +
    factory +
    ' } from ' +
    JSON.stringify(
      path.join(
        path.resolve('.'),
        'domains/comet-' + workflow + '/' + workflow + '-sdk-state-store.ts',
      ),
    ) +
    ';\n' +
    source;
  source = source.replace(
    /wrapStore: .*\n/,
    'wrapStore: (store, identity, options) => ' +
      factory +
      '(projectRoot, {store, identity, ...options}),\n',
  );
  const bundled = await build({
    stdin: { contents: source, resolveDir: path.resolve('.') },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    banner: {
      js: "import { createRequire as fixtureRequire } from 'node:module'; const require = fixtureRequire(import.meta.url);",
    },
  });
  await fs.writeFile(module, bundled.outputFiles[0].text);
  const change = workflow === 'native' ? 'docs/comet/changes/report' : 'openspec/changes/report';
  await fs.mkdir(path.join(projectRoot, change), { recursive: true });
  if (workflow === 'native')
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
  else await prepareClassicLegacyProject(projectRoot);
  const loaded = await loadWorkflowApplication({ projectRoot, file: disk.file });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  await runtime.start({
    runId: 'report',
    workflow: { id: 'editorial', version: '1' },
    input: {
      topic: 'Test',
      name: 'report',
      artifactRootRef: 'docs',
      change: 'report',
      changeDir: change,
      workspaceRoot: projectRoot,
    },
    initialState:
      workflow === 'native'
        ? createNativePortableState({
            name: 'report',
            language: 'en',
            workspace: {
              isolation: 'current',
              change_branch: 'main',
              target_branch: 'main',
              finish: null,
            },
          })
        : (parseClassicStateDocument({
            workflow: 'hotfix',
            design_doc: null,
            plan: null,
            verify_mode: null,
            verified_at: null,
            language: 'en',
            phase: 'open',
            build_mode: 'direct',
            tdd_mode: 'direct',
            review_mode: 'off',
            isolation: 'current',
            bound_branch: 'main',
            verify_result: 'pending',
            archived: false,
            check_epoch: 0,
          }).classic as unknown as RuntimeValue),
  });
  await runtime.inspect('report');
  await selectWorkflowApplication(loaded, 'report');
  const runtimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
  return {
    projectRoot,
    runtimeRoot,
    marker: path.join(runtimeRoot, 'state-projections', workflow, 'report.json'),
    state: path.join(projectRoot, change, 'comet-state.yaml'),
  };
}

for (const workflow of ['native', 'classic'] as const) {
  it.each([
    'healthy',
    'missing-marker',
    'broken-marker',
    'missing-projection',
    'stale-projection',
    'missing-run',
  ] as const)(workflow + ' application Hook performs zero writes with %s', async (damage) => {
    const f = await fixture(workflow);
    if (damage === 'missing-marker') await fs.rm(f.marker);
    if (damage === 'broken-marker') await fs.writeFile(f.marker, '{}');
    if (damage === 'missing-projection') await fs.rm(f.state);
    if (damage === 'stale-projection') {
      const document = parseDocument(await fs.readFile(f.state, 'utf8'));
      document.set('language', 'zh-CN');
      await fs.writeFile(f.state, document.toString());
    }
    if (damage === 'missing-run')
      await fs.rm(path.join(f.runtimeRoot, 'applications/editorial'), { recursive: true });
    const before = await snapshot(root);
    const mutations = [
      vi.spyOn(fs, 'mkdir'),
      vi.spyOn(fs, 'writeFile'),
      vi.spyOn(fs, 'rename'),
      vi.spyOn(fs, 'rm'),
      vi.spyOn(fs, 'unlink'),
      vi.spyOn(fs, 'copyFile'),
    ];
    const writes: string[] = [];
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(((...args: Parameters<typeof fs.open>) => {
      if (/[wax+]/u.test(String(args[1]))) writes.push(String(args[0]));
      return open(...args);
    }) as typeof fs.open);
    const decision = await runCometHookRouterGuard(
      { platformId: 'codex', projectRoot: f.projectRoot },
      { intent: 'write', toolName: 'Write', targets: ['README.md'], cwd: f.projectRoot },
    );
    expect(writes).toEqual([]);
    for (const mutation of mutations) expect(mutation).not.toHaveBeenCalled();
    expect(await snapshot(root)).toEqual(before);
    if (damage === 'healthy' || (workflow === 'classic' && damage === 'missing-marker'))
      expect(decision.reason).toContain('Editorial guard');
    else {
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('failed closed');
    }
    if (workflow === 'native' && damage === 'missing-marker')
      expect(decision.reason).toContain('--repair');
    if (workflow === 'classic' && damage === 'stale-projection')
      expect(decision.reason).toContain('settings have not been imported');
  });
}
