import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableChange,
  nativePortableChangeDir,
} from '../../../domains/comet-native/native-portable-runtime.js';
import {
  dispatchNativeSupervisorReadyTasks,
  nativeSupervisorStateFile,
  projectNativeSupervisorChildren,
  readNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function legacySupervisor() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-legacy-diagnostics-'));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'native@example.test');
  git('config', 'user.name', 'Native Test');
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  await fs.writeFile(
    path.join(root, '.gitignore'),
    '.comet/runtime/\n.comet/current-change.json\n.worktrees/\n',
  );
  git('add', '.');
  git('commit', '-m', 'seed');
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  await createNativePortableChange({
    paths,
    name: 'parent',
    language: 'en',
    workspaceBinding: { isolation: 'current', changeBranch: 'main', targetBranch: 'main' },
  });
  const changeDir = nativePortableChangeDir(paths, 'parent');
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Acceptance examples\n- The behavior works.\n',
  );
  const childrenFile = path.join(changeDir, 'children.yaml');
  await fs.writeFile(
    childrenFile,
    'schema: comet.native.children.v2\nchildren:\n  - name: core\n    summary: Core behavior.\n    depends_on: []\n',
  );
  await confirmNativePortableShape({ paths, name: 'parent' });
  await dispatchNativeSupervisorReadyTasks({ paths, parent: 'parent', maxParallel: 1 });
  const stateFile = nativeSupervisorStateFile(paths, 'parent');
  const legacy = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  // Model a persisted pre-upgrade overlay, after the real Runtime confirmed Shape.
  for (const child of legacy.children) {
    delete child.acceptanceScope;
    delete child.contractHash;
    if (child.task) {
      delete child.task.acceptance;
      delete child.task.contractHash;
    }
  }
  await fs.writeFile(stateFile, JSON.stringify(legacy));
  return { root, paths, stateFile, childrenFile };
}

describe('legacy Supervisor diagnostic recovery', () => {
  it.each(['missing', 'invalid'] as const)(
    'keeps diagnostics available with a %s children contract',
    async (problem) => {
      const { root, paths, stateFile, childrenFile } = await legacySupervisor();
      if (problem === 'missing') await fs.unlink(childrenFile);
      else await fs.writeFile(childrenFile, 'schema: [');
      const before = await fs.readFile(stateFile, 'utf8');
      for (const command of ['status', 'show', 'doctor']) {
        const result = await runNativeCli([command, 'parent', '--json', '--project-root', root]);
        if (command === 'doctor') {
          expect(JSON.parse(result.stdout!)).toHaveProperty('data.result.continuation');
        } else {
          expect(JSON.parse(result.stdout!)).not.toHaveProperty('error');
          expect(result.exitCode).toBe(0);
        }
      }
      expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
      await expect(readNativeSupervisorState(paths, 'parent')).rejects.toThrow();
      const diagnostics = await readNativeSupervisorState(paths, 'parent', { diagnostics: true });
      expect(diagnostics?.children[0].task?.runId).toBe(JSON.parse(before).children[0].task.runId);
      expect(projectNativeSupervisorChildren(diagnostics!)).toMatchObject({
        confirmed: false,
        readyChildren: [],
        allDone: false,
        children: [{ covers: [], message: expect.stringContaining('restore children.yaml') }],
      });
      const next = await runNativeCli([
        'next',
        'parent',
        '--summary',
        'Resume the parent',
        '--json',
        '--project-root',
        root,
      ]);
      expect(next.exitCode, next.stdout).toBe(0);
      expect(JSON.parse(next.stdout!)).not.toHaveProperty('error');
      if (problem === 'missing') expect(JSON.parse(next.stdout!).data.state.phase).toBe('shape');
      else expect(next.stdout).toContain('restore children.yaml and retry next');
      expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
      await fs.writeFile(
        childrenFile,
        'schema: comet.native.children.v2\nchildren:\n  - name: core\n    summary: Core behavior.\n    depends_on: []\n',
      );
      const recovered = await readNativeSupervisorState(paths, 'parent');
      expect(recovered?.children[0].task?.acceptance).toEqual([
        { id: 'child:core', source: 'children.yaml', text: 'Core behavior.' },
      ]);
    },
    120000,
  );
});
