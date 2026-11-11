import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { storedNativeChangeFixture } from '../../helpers/native-change-document.js';
import { readNativeChange } from '../../../domains/comet-native/native-change.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(schema: string, phase = 'shape') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-final-schema-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs'),
    name = 'legacy-import';
  const initial = await storedNativeChangeFixture({ paths, name, language: 'en' });
  const document: Record<string, unknown> = {
    ...initial,
    schema,
    phase,
    approval: phase === 'shape' ? null : 'confirmed',
    verification_result: ['verify', 'archive'].includes(phase) ? 'pass' : 'pending',
    verification_report: ['verify', 'archive'].includes(phase) ? 'verification.md' : null,
  };
  for (const key of [
    'verification_protocol',
    'approved_contract_hash',
    'implementation_scope',
    'verification_evidence',
    'partial_allowance',
  ])
    delete document[key];
  if (schema === 'comet.native.v1') {
    delete document.minimum_runtime_version;
    delete document.revision;
  } else
    document.minimum_runtime_version =
      schema === 'comet.native.v2' ? 2 : schema === 'comet.native.v0' ? 1 : 99;
  const dir = path.join(paths.changesDir, name),
    file = path.join(dir, 'comet-state.yaml'),
    brief = '# Acceptance examples\n- Preserve the selected behavior.\n';
  await fs.writeFile(path.join(dir, 'brief.md'), brief);
  await fs.writeFile(file, stringify(document));
  const invoke = (...args: string[]) => runNativeCli([...args, '--project-root', root, '--json']);
  return { root, paths, name, dir, file, document, brief, invoke };
}
it.each(
  ['comet.native.v1', 'comet.native.v2'].flatMap((schema) =>
    ['shape', 'build', 'verify', 'archive'].map((phase) => [schema, phase]),
  ),
)(
  'reads and explicitly imports SIMULATED %s %s documents without inheriting an old pass or inventing a Run',
  async (schema, phase) => {
    const f = await fixture(schema, phase),
      original = await fs.readFile(f.file);
    for (const command of ['status', 'show', 'doctor']) {
      const viewed = await f.invoke(command, f.name);
      expect(viewed.exitCode, viewed.stdout || viewed.stderr).toBe(0);
      expect(await fs.readFile(f.file)).toEqual(original);
      if (command === 'show')
        expect(JSON.parse(viewed.stdout!).data).toMatchObject({
          name: f.name,
          schema,
          migrationRequired: true,
        });
      if (command === 'status')
        expect(JSON.parse(viewed.stdout!).data).toMatchObject({
          name: f.name,
          migrationRequired: true,
          status: 'blocked',
        });
      if (command === 'doctor')
        expect(JSON.parse(viewed.stdout!).data).toMatchObject({
          healthy: false,
          recoveryCommandArgs: ['comet', 'native', 'doctor', f.name, '--repair'],
        });
    }
    for (const args of [
      ['next', f.name, '--summary', 'No implicit import'],
      ['archive', f.name, '--dry-run'],
    ]) {
      const blocked = await f.invoke(...args);
      expect(blocked.exitCode).toBe(65);
      expect(blocked.stdout).toContain('doctor');
      expect(await fs.readFile(f.file)).toEqual(original);
    }
    const historical = 'SIMULATED historical verification text, not a valid current pass.\n';
    await fs.writeFile(path.join(f.dir, 'verification.md'), historical);
    const imported = await f.invoke('doctor', f.name, '--repair');
    expect(imported.exitCode, imported.stdout || imported.stderr).toBe(0);
    const state = parse(await fs.readFile(f.file, 'utf8'));
    expect(state).toMatchObject({
      schema: 'comet.native.v4',
      phase: phase === 'shape' ? 'shape' : 'build',
      verification_result: 'pending',
      verification_report: null,
      builder_handoff: null,
      archived: false,
    });
    expect(state).not.toHaveProperty('run_id');
    expect(state.acceptance).toEqual(
      expect.arrayContaining([expect.objectContaining({ result: 'pending' })]),
    );
    expect(await fs.readFile(path.join(f.dir, 'brief.md'), 'utf8')).toBe(f.brief);
    expect(await fs.readFile(path.join(f.dir, 'verification.md'), 'utf8')).toBe(historical);
    const once = await fs.readFile(f.file),
      again = await f.invoke('doctor', f.name, '--repair');
    expect(again.exitCode, again.stdout || again.stderr).toBe(0);
    expect(await fs.readFile(f.file)).toEqual(once);
  },
);
it.each(['comet.native.v0', 'comet.native.v99', 'comet.native.v3'])(
  'rejects unsupported or future %s business data without rewriting or inventing an import route',
  async (schema) => {
    const f = await fixture(schema),
      original = await fs.readFile(f.file);
    await expect(readNativeChange(f.paths, f.name)).rejects.toThrow();
    for (const args of [
      ['show', f.name],
      ['next', f.name, '--summary', 'No invented route'],
      ['doctor', f.name, '--repair'],
    ]) {
      const rejected = await f.invoke(...args);
      expect(rejected.exitCode, rejected.stdout).not.toBe(0);
      expect(await fs.readFile(f.file)).toEqual(original);
    }
    const status = await f.invoke('status', f.name);
    expect(status.exitCode, status.stdout).toBe(0);
    expect(JSON.parse(status.stdout!).data).toMatchObject({
      name: f.name,
      phase: 'invalid',
      schema,
      nextCommand: null,
    });
    expect(await fs.readFile(f.file)).toEqual(original);
  },
);
import {
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
it.each(['comet.native.v1', 'comet.native.v2'])(
  'requires explicit current Shape approval after importing a SIMULATED implicit %s Build document',
  async (schema) => {
    const f = await fixture(schema, 'build');
    f.document.approval = 'implicit';
    await fs.writeFile(f.file, stringify(f.document));
    const imported = await f.invoke('doctor', f.name, '--repair');
    expect(imported.exitCode, imported.stdout).toBe(0);
    const state = await readNativePortableChange(f.paths, f.name),
      runner = createNativeRunnerChannel();
    const attempt = submitNativePortableBuilderCandidate({
      paths: f.paths,
      name: f.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'SIMULATED-Agent',
          executionRef: 'not-approved-builder',
        }),
        candidateId: 'not-approved-candidate',
        summary: 'SIMULATED report without any complete Shape approval.',
        addressedAcceptanceIds: state.acceptance.map((a) => a.id),
        acceptanceReview: fixtureAcceptanceReview(state.acceptance.map((a) => a.id)),
        checks: [],
        knownLimits: [],
      },
    });
    let observation;
    try {
      observation = { accepted: true, state: await attempt };
    } catch (error) {
      observation = { accepted: false, error: String(error) };
    }
    expect(observation.accepted).toBe(false);
    expect((await readNativePortableChange(f.paths, f.name)).phase).toBe('shape');
    expect(
      (
        await f.invoke(
          'next',
          f.name,
          '--summary',
          'SIMULATED Agent summarises the imported scope.',
        )
      ).exitCode,
    ).toBe(0);
    const awaiting = await readNativePortableChange(f.paths, f.name);
    expect(
      (
        await f.invoke(
          'next',
          f.name,
          '--confirmed',
          '--summary',
          'SIMULATED USER explicitly approves the imported scope.',
          '--expected-state-version',
          String(awaiting.state_version),
          '--expected-action',
          'confirm-shape',
        )
      ).exitCode,
    ).toBe(0);
    const approved = await readNativePortableChange(f.paths, f.name),
      fresh = await submitNativePortableBuilderCandidate({
        paths: f.paths,
        name: f.name,
        input: {
          identity: runner.captureExecutionIdentity({
            identityProvider: 'SIMULATED-Agent',
            executionRef: 'approved-builder',
          }),
          candidateId: 'approved-current-candidate',
          summary: 'SIMULATED implementation after explicit approval.',
          addressedAcceptanceIds: approved.acceptance.map((a) => a.id),
          acceptanceReview: fixtureAcceptanceReview(approved.acceptance.map((a) => a.id)),
          checks: [],
          knownLimits: [],
        },
      });
    expect(fresh.phase).toBe('verify');
  },
);
