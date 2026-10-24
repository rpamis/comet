import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  COMET_RESUME_PROBE_SCHEMA_VERSION,
  resolveCometEntryResumeProbe,
} from '../../../domains/comet-entry/resume-probe.js';
import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { createNativeSdkChange } from '../../../domains/comet-native/native-sdk-create.js';
import { selectNativeChange } from '../../../domains/comet-native/native-selection.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';

const VALID_BRIEF = `# Outcome
Ship cache controls.
# Scope
Cache expiration behavior.
# Non-goals
No storage migration.
# Acceptance examples
- Cache entries expire predictably.
# Constraints and invariants
Preserve existing APIs.
# Decisions
Use Native state.
# Open questions
None.
# Verification expectations
Run focused cache tests.
`;

const CLASSIC_BUILD_STATE = [
  'workflow: full',
  'phase: build',
  'archived: false',
  'build_pause: null',
  'isolation: branch',
  'build_mode: executing-plans',
  'tdd_mode: direct',
  'review_mode: standard',
  'verify_mode: light',
  'verified_at: null',
  'verify_result: pending',
  'auto_transition: true',
  'design_doc: null',
  'plan: null',
  '',
].join('\n');

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

async function createNative(projectRoot: string, name: string, artifactRoot = '.'): Promise<void> {
  const initialized = spawnSync('git', ['init', '-q', projectRoot]);
  expect(initialized.status).toBe(0);
  const paths = await nativeProjectPaths(projectRoot, artifactRoot);
  const state = await createNativeChange({ paths, name, language: 'en' });
  await fs.writeFile(path.join(nativeChangeDir(paths, name), state.brief), VALID_BRIEF, 'utf8');
}

async function createClassic(projectRoot: string, name: string): Promise<void> {
  const changeDir = path.join(projectRoot, 'openspec', 'changes', name);
  await writeFile(path.join(changeDir, '.comet.yaml'), CLASSIC_BUILD_STATE);
  await writeFile(path.join(changeDir, 'proposal.md'), `# ${name}\n`);
  await writeFile(path.join(changeDir, 'design.md'), `# ${name} design\n`);
  await writeFile(path.join(changeDir, 'tasks.md'), '- [ ] finish\n');
}

async function writeClassicProjectConfig(projectRoot: string): Promise<void> {
  await writeFile(
    path.join(projectRoot, '.comet', 'config.yaml'),
    [
      'schema: comet.project.v1',
      'default_workflow: classic',
      'workflows: [classic]',
      'classic:',
      '  artifact_layout: legacy',
      '  language: zh-CN',
      '',
    ].join('\n'),
  );
}

function input(utterance: string, nonTrivialWork = true) {
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    utterance,
    locale: 'zh-CN',
    agent_context: {
      non_trivial_work: nonTrivialWork,
      already_in_comet_flow: false,
    },
  } as const;
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        result[`${relative}/`] = 'directory';
        await visit(absolute);
      } else {
        result[relative] = (await fs.readFile(absolute)).toString('base64');
      }
    }
  }
  await visit(root);
  return result;
}

describe('Comet entry resume intent priority', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-entry-resume-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it.each(['empty', 'single', 'multiple', 'selected'] as const)(
    'gives explicit exclusions precedence over resume keywords in a %s Native project',
    async (context) => {
      await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
      if (context !== 'empty') await createNative(projectRoot, 'cache-controls');
      if (context === 'multiple' || context === 'selected') {
        await createNative(projectRoot, 'login-flow');
      }
      if (context === 'selected') {
        await selectNativeChange(await nativeProjectPaths(projectRoot, '.'), 'login-flow');
      }
      await writeFile(path.join(projectRoot, 'README.md'), 'Unrelated typo fix.\n');
      const before = await snapshot(projectRoot);
      const runtimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
      const beforeRuntime = context === 'empty' ? null : await snapshot(runtimeRoot);
      for (const utterance of [
        '只提交现有代码，不要启动/继续 Comet 流程',
        '只提交现有代码，不要启动 Comet 流程',
        '只提交现有代码，不要继续 Comet 流程',
        '提交另一个修改，不要处理当前 change',
        '不走comet，只提交代码',
        '不要走  Comet，只提交代码',
        '只 提交 代码，不 需要 启动 ／ 继续  Comet 流程',
        '继续 cache-controls，但不要继续 Comet 流程',
        'Just commit the existing code. Do not start or continue the Comet workflow.',
        'COMMIT the files; DO   NOT   CONTINUE the COMET workflow.',
        'Just commit the README typo fix. Don’t resume Comet.',
        'Commit a different change. Do not touch the current change.',
        'Commit unrelated files, without Comet.',
        'Skip Comet; commit the changes.',
        'No Comet workflow. Just commit the code.',
        'Resume cache-controls; do not resume the Comet workflow.',
      ]) {
        const probe = await resolveCometEntryResumeProbe(projectRoot, input(utterance));
        expect(probe, utterance).toMatchObject({
          action: 'out_of_scope',
          confidence: 'low',
          nextCommand: null,
        });
      }
      expect(await snapshot(projectRoot)).toEqual(before);
      if (beforeRuntime === null) {
        await expect(fs.access(runtimeRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      } else {
        expect(await snapshot(runtimeRoot)).toEqual(beforeRuntime);
      }
    },
  );

  it.each(['single', 'multiple', 'selected'] as const)(
    'does not infer commit ownership from %s Native changes or dirty files',
    async (context) => {
      await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
      await createNative(projectRoot, 'cache-controls');
      if (context !== 'single') await createNative(projectRoot, 'login-flow');
      if (context === 'selected') {
        await selectNativeChange(await nativeProjectPaths(projectRoot, '.'), 'login-flow');
      }
      await writeFile(path.join(projectRoot, 'README.md'), 'Unrelated typo fix.\n');
      const before = await snapshot(projectRoot);
      for (const utterance of [
        '只提交代码',
        '请只把 README 的拼写修正提交，不修改任何功能。',
        '只提交现有的 cache 代码',
        'Just commit the code.',
        '直接提交代码',
        '只继续提交代码',
        'Just continue to commit the code.',
        'Only commit the existing cache code.',
        'Just commit the README typo fix. Do not change any functionality.',
      ]) {
        for (const nonTrivialWork of [true, false]) {
          const probe = await resolveCometEntryResumeProbe(
            projectRoot,
            input(utterance, nonTrivialWork),
          );
          expect(probe, utterance).toMatchObject({
            action: 'out_of_scope',
            reasonCode: 'commit-only-request',
            nextCommand: null,
            changeName: null,
          });
        }
      }
      for (const utterance of [
        '提交代码',
        'commit the code',
        '提交 cache 相关代码',
        '继续提交代码',
        'Continue to commit the code',
      ]) {
        const probe = await resolveCometEntryResumeProbe(projectRoot, input(utterance));
        expect(probe, utterance).toMatchObject({
          action: 'ask_user',
          confidence: 'low',
          reasonCode: 'commit-scope-ambiguous',
          changeName: null,
          nextCommand: null,
        });
      }
      expect(await snapshot(projectRoot)).toEqual(before);
    },
  );

  it('keeps commit-only probes with no active Native change read-only and empty', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const before = await snapshot(projectRoot);
    for (const utterance of ['提交代码', '只提交代码', 'commit the code', 'just commit the code']) {
      await expect(
        resolveCometEntryResumeProbe(projectRoot, input(utterance)),
      ).resolves.toMatchObject({
        action: 'none',
        reasonCode: 'no-active-native-changes',
        nextCommand: null,
      });
    }
    expect(await snapshot(projectRoot)).toEqual(before);
    await expect(fs.access(resolveWorkspaceRuntimeRootSync(projectRoot))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves explicit resume and commit targets without treating refusals as candidate names', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await createNative(projectRoot, 'cache-controls');
    await createNative(projectRoot, 'login-flow');
    await selectNativeChange(await nativeProjectPaths(projectRoot, '.'), 'login-flow');
    await writeFile(path.join(projectRoot, 'README.md'), 'Unrelated typo fix.\n');
    const before = await snapshot(projectRoot);
    for (const [utterance, changeName] of [
      ['继续', 'login-flow'],
      ['continue', 'login-flow'],
      ['提交当前 change', 'login-flow'],
      ['只提交当前的 change', 'login-flow'],
      ['Commit the current change', 'login-flow'],
      ['Only commit the selected change', 'login-flow'],
      ['提交 cache-controls', 'cache-controls'],
      ['Commit cache-controls', 'cache-controls'],
      ['Commit another change, cache-controls; do not touch login-flow.', 'cache-controls'],
      ['提交 cache-controls，确保其他文件不受影响', 'cache-controls'],
      ['继续 cache-controls，验证后提交代码', 'cache-controls'],
      ['Continue cache-controls, then commit the code', 'cache-controls'],
      ['继续 cache-controls，不要提交代码', 'cache-controls'],
      ['Continue cache-controls; do not commit yet', 'cache-controls'],
      ['Do not skip Comet. Continue cache-controls.', 'cache-controls'],
      ['不要新建 Comet 流程，继续 cache-controls', 'cache-controls'],
      ['Do not start a new Comet workflow. Resume cache-controls.', 'cache-controls'],
      ['继续 cache-controls，不要处理 login-flow', 'cache-controls'],
      ['Commit cache-controls; do not touch login-flow.', 'cache-controls'],
      ['继续 cache-controls，不要处理当前 change', 'cache-controls'],
    ]) {
      const probe = await resolveCometEntryResumeProbe(projectRoot, input(utterance));
      expect(probe, utterance).toMatchObject({
        action: 'auto_resume',
        changeName,
        confidence: 'high',
        nextCommand: '/comet-native',
      });
    }
    for (const utterance of [
      '继续 login-flow，不要处理当前 change',
      'Resume cache-controls; do not touch cache-controls.',
      '提交代码，不要处理当前 change',
    ]) {
      await expect(
        resolveCometEntryResumeProbe(projectRoot, input(utterance)),
      ).resolves.toMatchObject({
        action: 'out_of_scope',
        reasonCode: 'resume-target-excluded',
        nextCommand: null,
      });
    }
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  it('asks for one target when a current-change commit has no selection or names multiple changes', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await createNative(projectRoot, 'cache-controls');
    await createNative(projectRoot, 'login-flow');
    for (const utterance of [
      '提交当前 change',
      'Commit the current change',
      '提交 cache-controls 和 login-flow',
    ]) {
      await expect(
        resolveCometEntryResumeProbe(projectRoot, input(utterance)),
      ).resolves.toMatchObject({
        action: 'ask_user',
        confidence: 'low',
        nextCommand: null,
      });
    }
  });

  it.each([false, true])(
    'applies commit intent before Classic dirty-worktree attribution (dirty=%s)',
    async (dirty) => {
      await writeClassicProjectConfig(projectRoot);
      await createClassic(projectRoot, 'cache-controls');
      expect(spawnSync('git', ['init', '-q', projectRoot]).status).toBe(0);
      if (!dirty) await writeFile(path.join(projectRoot, '.git', 'info', 'exclude'), '*\n');
      for (const utterance of ['只提交代码', 'Just commit the existing code.']) {
        await expect(
          resolveCometEntryResumeProbe(projectRoot, input(utterance)),
        ).resolves.toMatchObject({
          action: 'out_of_scope',
          reasonCode: 'commit-only-request',
          nextCommand: null,
        });
      }
      for (const utterance of [
        '只提交代码，不要启动/继续 Comet 流程',
        'Commit code; do not continue Comet.',
      ]) {
        await expect(
          resolveCometEntryResumeProbe(projectRoot, input(utterance)),
        ).resolves.toMatchObject({
          action: 'out_of_scope',
          reasonCode: 'user-opted-out',
          nextCommand: null,
        });
      }
      await expect(
        resolveCometEntryResumeProbe(projectRoot, input('Commit cache-controls')),
      ).resolves.toMatchObject({
        action: dirty ? 'ask_user' : 'auto_resume',
        nextCommand: dirty ? null : '/comet-classic',
      });
    },
  );

  it('honors workflow refusal before malformed configuration or workflow state can redirect it', async () => {
    await writeFile(path.join(projectRoot, '.comet', 'config.yaml'), 'schema: [broken\n');
    const before = await snapshot(projectRoot);
    for (const utterance of [
      '只提交代码，不要继续 Comet 流程',
      'Commit code. Do not start or continue the Comet workflow.',
    ]) {
      await expect(
        resolveCometEntryResumeProbe(projectRoot, input(utterance)),
      ).resolves.toMatchObject({
        action: 'out_of_scope',
        reasonCode: 'user-opted-out',
        workflow: null,
        changeName: null,
        nextCommand: null,
        candidates: [],
      });
    }
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  it('does not create or advance Native Runs or tool actions for excluded and commit-only requests', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    await createNativeSdkChange({
      paths,
      name: 'cache-controls',
      language: 'en',
      workspaceBinding: { isolation: 'current', changeBranch: null, targetBranch: null },
    });
    const runtimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
    const beforeProject = await snapshot(projectRoot);
    const beforeRuntime = await snapshot(runtimeRoot);
    for (const utterance of [
      '只提交现有代码，不要启动/继续 Comet 流程',
      'Just commit the code; do not continue the Comet workflow.',
      '只提交代码',
      'Just commit the code.',
      '提交代码',
    ]) {
      const probe = await resolveCometEntryResumeProbe(projectRoot, input(utterance));
      expect(probe.action).not.toBe('auto_resume');
      expect(probe.nextCommand).toBeNull();
    }
    expect(await snapshot(projectRoot)).toEqual(beforeProject);
    expect(await snapshot(runtimeRoot)).toEqual(beforeRuntime);
  });
});
