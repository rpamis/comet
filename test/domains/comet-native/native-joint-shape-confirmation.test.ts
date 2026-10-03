import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  nativePortableStateFile,
  readNativePortableChange,
} from '../../../domains/comet-native/native-portable-storage.js';

const roots: string[] = [];
async function cli(root: string, args: string[], accepted = true) {
  const result = await runNativeCli([...args, '--project-root', root, '--json']);
  const payload = JSON.parse(result.stdout!);
  if (accepted) expect(payload.exitCode, JSON.stringify(payload)).toBe(0);
  return payload;
}

async function shape(supervisor = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-joint-shape-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Native Test',
      '-c',
      'user.email=native@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'seed',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  await cli(root, ['new', 'joint-shape']);
  const dir = path.join(root, 'docs/comet/changes/joint-shape');
  await fs.writeFile(
    path.join(dir, 'brief.md'),
    '# Outcome\nDeliver both outputs.\n\n# Scope\nImplement Alpha and Beta. No product behavior change: this fixture exercises the confirmation protocol.\n\n# Non-goals\nDo not change unrelated outputs.\n\n# Acceptance examples\n- Alpha works.\n- Beta works.\n',
  );
  if (supervisor) {
    await fs.writeFile(
      path.join(dir, 'children.yaml'),
      'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: Alpha works.\n  A2:\n    source: brief.md\n    text: Beta works.\nchildren:\n  - name: alpha\n    depends_on: []\n    covers: [A1]\n  - name: beta\n    depends_on: []\n    covers: [A2]\n',
    );
  }
  return { root, dir };
}

function command(prepared: any, mode: 'multi-session' | 'single-session') {
  const alternative = prepared.data.continuation.commandAlternatives.find(
    (item: { name: string }) => item.name === `confirm-shape-${mode}`,
  );
  expect(alternative).toBeDefined();
  return alternative.commandArgs
    .slice(2)
    .map((arg: string) =>
      arg === '<summary>' ? 'User confirmed the full Shape and selected this mode' : arg,
    );
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('Native joint Supervisor Shape decision', () => {
  it.each(['multi-session', 'single-session'] as const)(
    'confirms the complete Shape and %s choice in one user decision',
    async (mode) => {
      const { root } = await shape();
      const active = await cli(root, ['status', 'joint-shape']);
      expect(active.data.continuation.requiresUserDecision).toBe(false);
      expect(active.data.continuation.commandArgs).not.toContain('--coordination-mode');
      const prepared = await cli(root, ['next', 'joint-shape', '--summary', 'Shape is ready']);
      expect(prepared.data.state).toMatchObject({ phase: 'shape', status: 'await-user' });
      expect(prepared.data.continuation.requiredInputs).toContain('coordination-choice');
      expect(prepared.data.continuation.userCommunication.agentInstruction).toContain('mode alone');
      const paths = await nativeProjectPaths(root, 'docs');
      const before = await readNativePortableChange(paths, 'joint-shape');
      expect(before.coordination_mode).toBeUndefined();
      const accepted = await cli(root, command(prepared, mode));
      expect(accepted.data.state).toMatchObject({
        phase: 'build',
        coordination_mode: mode,
        workspace: { finish: null },
      });
      expect(accepted.data.state.state_version).toBe(before.state_version + 1);
      const after = await readNativePortableChange(paths, 'joint-shape');
      expect(after.shape_confirmation_hash).not.toBe(before.shape_confirmation_hash);
      expect(after.children_contract_hash).toBe(before.children_contract_hash);
    },
  );

  it('keeps the separate mode-selection path and rejects changes to its selected mode', async () => {
    const { root } = await shape();
    const prepared = await cli(root, [
      'next',
      'joint-shape',
      '--summary',
      'User selected a mode only',
      '--coordination-mode',
      'single-session',
    ]);
    expect(prepared.data.state).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      coordination_mode: 'single-session',
    });
    const args = prepared.data.continuation.commandAlternatives[0].commandArgs
      .slice(2)
      .map((arg: string) => (arg === '<summary>' ? 'User confirmed complete Shape' : arg));
    const rejected = await cli(root, [...args, '--coordination-mode', 'multi-session'], false);
    expect(rejected.exitCode).not.toBe(0);
    expect(
      (await cli(root, [...args, '--coordination-mode', 'single-session'])).data.state,
    ).toMatchObject({
      phase: 'build',
      coordination_mode: 'single-session',
    });
  });

  it('does not turn a mode-only reply or a missing mode into full Shape confirmation', async () => {
    const { root } = await shape();
    const prepared = await cli(root, ['next', 'joint-shape', '--summary', 'Ready']);
    const args = command(prepared, 'multi-session');
    const choiceOnly = await cli(
      root,
      args.filter((arg: string) => arg !== '--confirmed'),
      false,
    );
    expect(choiceOnly.exitCode).not.toBe(0);
    expect(
      await readNativePortableChange(await nativeProjectPaths(root, 'docs'), 'joint-shape'),
    ).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      state_version: prepared.data.state.state_version,
    });
    const missingMode = args.slice(0, args.indexOf('--coordination-mode'));
    expect((await cli(root, missingMode, false)).exitCode).not.toBe(0);
    expect((await cli(root, ['status', 'joint-shape'])).data.phase).toBe('shape');
  });

  it('rejects a legacy pending boundary with no Shape fingerprint', async () => {
    const { root } = await shape();
    const prepared = await cli(root, ['next', 'joint-shape', '--summary', 'Ready']);
    const args = command(prepared, 'multi-session');
    const file = nativePortableStateFile(await nativeProjectPaths(root, 'docs'), 'joint-shape');
    await fs.writeFile(
      file,
      (await fs.readFile(file, 'utf8')).replace(/^shape_confirmation_hash:.*\r?\n/mu, ''),
    );
    expect((await cli(root, args, false)).exitCode).not.toBe(0);
    expect((await cli(root, ['status', 'joint-shape'])).data.phase).toBe('shape');
  });

  it.each(['formal', 'children', 'mode', 'state'] as const)(
    'rejects the joint decision after %s drift',
    async (drift) => {
      const { root, dir } = await shape();
      const prepared = await cli(root, ['next', 'joint-shape', '--summary', 'Ready']);
      const args = command(prepared, 'multi-session');
      if (drift === 'formal')
        await fs.appendFile(
          path.join(dir, 'brief.md'),
          '\n# Constraints and invariants\nAlso change the shared output.\n',
        );
      if (drift === 'children') {
        const file = path.join(dir, 'children.yaml');
        await fs.writeFile(
          file,
          (await fs.readFile(file, 'utf8')).replace(
            'name: beta\n    depends_on: []',
            'name: beta\n    depends_on: [alpha]',
          ),
        );
      }
      if (drift === 'mode') {
        await fs.appendFile(
          nativePortableStateFile(await nativeProjectPaths(root, 'docs'), 'joint-shape'),
          '\ncoordination_mode: multi-session\n',
        );
      }
      if (drift === 'state')
        args[args.indexOf('--expected-state-version') + 1] = String(
          prepared.data.state.state_version - 1,
        );
      expect((await cli(root, args, false)).exitCode).not.toBe(0);
      expect((await cli(root, ['status', 'joint-shape'])).data.phase).toBe('shape');
    },
  );

  it('retains ordinary Shape confirmation and refuses Supervisor mode for an ordinary change', async () => {
    const { root } = await shape(false);
    const prepared = await cli(root, ['next', 'joint-shape', '--summary', 'Ready']);
    const args = prepared.data.continuation.commandAlternatives[0].commandArgs
      .slice(2)
      .map((arg: string) => (arg === '<summary>' ? 'User confirmed complete Shape' : arg));
    expect(
      (await cli(root, [...args, '--coordination-mode', 'multi-session'], false)).exitCode,
    ).not.toBe(0);
    expect((await cli(root, args)).data.state.phase).toBe('build');
  });
});
