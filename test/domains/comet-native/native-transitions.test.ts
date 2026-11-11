import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableChange,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it.each(['sequential', 'batch'] as const)(
  'requires current explicit Shape approval and rejects a repeated or Verify confirmation in %s mode',
  async (mode) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-current-explicit-transition-'));
    roots.push(root);
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, {
      ...config,
      native: { ...config.native, clarification_mode: mode },
    });
    const paths = await nativeProjectPaths(root, 'docs'),
      name = 'approval-required';
    await createNativePortableChange({ paths, name, language: 'en' });
    const dir = path.join(paths.changesDir, name),
      file = path.join(dir, 'comet-state.yaml');
    await fs.writeFile(
      path.join(dir, 'brief.md'),
      '# Acceptance examples\n- The explicit user approval is required.\n',
    );
    const invoke = (...args: string[]) => runNativeCli([...args, '--project-root', root, '--json']);
    const prepared = await invoke(
      'next',
      name,
      '--summary',
      'SIMULATED Agent summarises the complete Shape.',
    );
    expect(prepared.exitCode, prepared.stdout).toBe(0);
    let state = await readNativePortableChange(paths, name);
    expect(state).toMatchObject({ phase: 'shape', status: 'await-user' });
    const waiting = await fs.readFile(file);
    expect((await invoke('next', name)).exitCode).toBe(0);
    expect(await fs.readFile(file)).toEqual(waiting);
    const args = [
      'next',
      name,
      '--confirmed',
      '--summary',
      'SIMULATED USER explicitly approves the full Shape.',
      '--expected-state-version',
      String(state.state_version),
      '--expected-action',
      'confirm-shape',
    ];
    expect((await invoke(...args)).exitCode).toBe(0);
    state = await readNativePortableChange(paths, name);
    expect(state.phase).toBe('build');
    const approved = await fs.readFile(file);
    expect((await invoke(...args)).exitCode).not.toBe(0);
    expect(await fs.readFile(file)).toEqual(approved);
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'SIMULATED-Agent',
          executionRef: 'current-builder',
        }),
        candidateId: 'current-candidate',
        summary: 'SIMULATED implements the approved requirement.',
        addressedAcceptanceIds: state.acceptance.map((a) => a.id),
        acceptanceReview: fixtureAcceptanceReview(state.acceptance.map((a) => a.id)),
        checks: [],
        knownLimits: [],
      },
    });
    expect(state.phase).toBe('verify');
    const verifying = await fs.readFile(file),
      rejected = await invoke(
        'next',
        name,
        '--confirmed',
        '--summary',
        'Must not approve Shape from Verify.',
        '--expected-state-version',
        String(state.state_version),
        '--expected-action',
        'confirm-shape',
      );
    expect(rejected.exitCode, rejected.stdout).not.toBe(0);
    expect(await fs.readFile(file)).toEqual(verifying);
    expect(await fs.readFile(file, 'utf8')).not.toMatch(/reasoning|thoughts|chain_of_thought/iu);
    const failedCount = state.loop.failed_iteration_count,
      approval = state.shape_confirmation_hash;
    const revised = await invoke(
      'next',
      name,
      '--revise-implementation',
      '--summary',
      'SIMULATED USER requests a fresh implementation without counting a verification failure.',
      '--expected-state-version',
      String(state.state_version),
      '--expected-action',
      'revise-implementation',
    );
    expect(revised.exitCode, revised.stdout).toBe(0);
    const returned = await readNativePortableChange(paths, name);
    expect(returned).toMatchObject({
      phase: 'build',
      verification_result: 'pending',
      verification_report: null,
      loop: { failed_iteration_count: failedCount },
    });
    expect(returned.shape_confirmation_hash).toBe(approval);
  },
);
