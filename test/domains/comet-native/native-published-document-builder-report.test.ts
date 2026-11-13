import '../../helpers/isolated-agent-home.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { nativeVerifierActionExecutionRef } from '../../../domains/comet-native/native-verifier-action.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { nativeSdkPreservedReportsRef } from '../../../domains/comet-native/native-sdk-report.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  nativeProjectPaths,
  nativeChangeRuntimeDir,
} from '../../../domains/comet-native/native-paths.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { writeNativeWorkspaceIdentity } from '../../../domains/comet-native/native-workspace.js';
import { readNativePortableChange } from '../../../domains/comet-native/native-portable-runtime.js';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});
it('preserves every old user document through published upgrade Builder and a new actual Agent report', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-published-doctor-transition-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(root, '.'),
    frozen = JSON.parse(
      await fs.readFile(
        path.resolve('test/fixtures/native-052-transition-journal/remove-after-recovery.json'),
        'utf8',
      ),
    );
  for (const item of frozen.materials.files) {
    const file = path.join(paths.nativeRoot, ...item.ref.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(item.bytesBase64, 'base64'));
  }
  const runtime = nativeChangeRuntimeDir(paths, frozen.name);
  await fs.mkdir(runtime, { recursive: true });
  for (const item of frozen.changeRuntime.files.filter((f: any) => f.ref === 'transition.json'))
    await fs.writeFile(path.join(runtime, item.ref), Buffer.from(item.bytesBase64, 'base64'));
  await writeNativeWorkspaceIdentity({
    paths,
    name: frozen.name,
    revision: frozen.originalState.revision,
  });
  const stateFile = path.join(paths.changesDir, frozen.name, 'comet-state.yaml'),
    before = await fs.readFile(stateFile, 'utf8'),
    journal = await fs.readFile(path.join(runtime, 'transition.json'), 'utf8');
  await nativeDoctorCommand([frozen.name], root);
  expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  expect(await fs.readFile(path.join(runtime, 'transition.json'), 'utf8')).toBe(journal);
  const originalDocs = new Map(
    ['evidence.md', 'repair.md', 'archive.md', 'checkpoint.md', 'verification.md'].map((name) => [
      name,
      'User original notes for ' + name + '; these are not current-candidate acceptance.',
    ]),
  );
  for (const [name, text] of originalDocs)
    await fs.writeFile(path.join(paths.changesDir, frozen.name, name), text);
  const result = await nativeDoctorCommand([frozen.name, '--repair'], root);
  const state = await readNativePortableChange(paths, frozen.name);
  expect(state.phase).toBe('build');
  expect(state.loop.stage).toBe('building');
  expect(state.history.some((h) => h.outcome === 'recovery')).toBe(true);
  expect(state.verification_result).toBe('pending');
  for (const [name, text] of originalDocs)
    expect(await fs.readFile(path.join(paths.changesDir, frozen.name, name), 'utf8')).toBe(text);
  let seq = 0;
  async function runner(payload: unknown) {
    const file = path.join(root, 'simulated-agent-input-' + ++seq + '.json');
    await fs.writeFile(file, JSON.stringify(payload));
    const result = await runNativeCli([
      'next',
      frozen.name,
      '--runner-input',
      file,
      '--project-root',
      root,
      '--json',
    ]);
    expect(result.exitCode, result.stdout).toBe(0);
    return JSON.parse(result.stdout);
  }
  const ids = state.acceptance.map((a) => a.id);
  expect(ids.length).toBeGreaterThan(0);
  await runner({
    kind: 'builder-handoff',
    summary: 'SIMULATED AGENT implemented the approved published goal',
    addressed_acceptance_ids: ids,
    acceptance_review: fixtureAcceptanceReview(ids),
    checks: [
      {
        name: 'SIMULATED platform report',
        result: 'passed',
        note: 'Agent input only; no real model or managed executor',
      },
    ],
    known_limits: [],
    review: {
      status: 'passed',
      summary: 'SIMULATED independent read-only review',
      reviewer_execution_ref: 'SIMULATED reviewer published upgrade',
    },
  });
  for (const [name, text] of originalDocs)
    expect(await fs.readFile(path.join(paths.changesDir, frozen.name, name), 'utf8')).toBe(text);
  await runner({ kind: 'dispatch-verifier' });
  const dispatched = await readNativePortableChange(paths, frozen.name);
  await runner({
    kind: 'verifier-response',
    candidateId: dispatched.builder_handoff!.candidate_id,
    verifierExecutionRef: nativeVerifierActionExecutionRef(dispatched.verifier_action!),
    response: {
      kind: 'final-result',
      result: {
        iteration: dispatched.loop.iteration,
        attempt: dispatched.loop.attempt,
        verdict: 'pass',
        acceptance: ids.map((id) => ({
          id,
          result: 'passed',
          reason: 'SIMULATED AGENT observed ' + id,
        })),
        risks: [],
        summary: 'SIMULATED independent actual report for the new candidate',
      },
    },
  });
  const accepted = await readNativePortableChange(paths, frozen.name);
  expect(accepted).toMatchObject({
    phase: 'verify',
    status: 'await-user',
    verification_result: 'pass',
  });
  for (const [name, text] of originalDocs) {
    if (name === 'verification.md') continue;
    expect(await fs.readFile(path.join(paths.changesDir, frozen.name, name), 'utf8')).toBe(text);
  }
  const currentReport = await fs.readFile(
    path.join(paths.changesDir, frozen.name, 'verification.md'),
    'utf8',
  );
  expect(currentReport).not.toBe(originalDocs.get('verification.md'));
  expect(currentReport).toContain('SIMULATED independent actual report');
  const dir = path.join(paths.workspaceRuntimeRoot, nativeSdkPreservedReportsRef(frozen.name));
  const reports = await fs.readdir(dir);
  expect(reports.length).toBeGreaterThan(0);
  const bytes = await Promise.all(reports.map((name) => fs.readFile(path.join(dir, name), 'utf8')));
  expect(bytes).toContain(originalDocs.get('verification.md'));
});
