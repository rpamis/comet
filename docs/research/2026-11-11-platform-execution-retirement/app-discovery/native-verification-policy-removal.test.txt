import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import { defaultProjectConfig } from '../../domains/comet-native/native-config.js';
import {
  nativeSdkApplicationForRun,
  defineNativeWorkflowApplication,
} from '../../domains/comet-native/native-sdk-application.js';
import { hashRuntimeValue, defineWorkflow } from '../../domains/engine/runtime.js';
import { parseNativeVerifierResponse } from '../../domains/comet-native/native-verifier-protocol.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('removes verification mode selection from public Eval CLI without launching a run', async () => {
  await ensureCliBuilt(path.resolve('.'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-policy-removal-'));
  roots.push(root);
  const binary = path.resolve('bin/comet.js');
  const help = execFileSync(process.execPath, [binary, 'eval', '--help'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(help).not.toContain('--verify-mode');
  const rejected = spawnSync(
    process.execPath,
    [binary, 'eval', '--verify-mode', 'bugfree', '--collect', '--project', root],
    { encoding: 'utf8', windowsHide: true },
  );
  expect(rejected.status).not.toBe(0);
  expect(rejected.stderr).toContain('unknown option');
  expect(await fs.readdir(root)).toEqual([]);
});

it('omits verification mode from ordinary Native config output', () => {
  const config = defaultProjectConfig('docs', 'zh-CN');
  expect(config.native).not.toHaveProperty('verify_mode');
  expect(config.native).toMatchObject({ artifact_root: 'docs', language: 'zh-CN' });
});

it('removes the unreleased verifier definition and compact pass protocol', () => {
  const app = defineNativeWorkflowApplication();
  const old = structuredClone(app.workflow);
  old.steps['verify.verifier'].validator!.version = '2';
  const legacy = defineWorkflow(old);
  const workflow = { id: legacy.id, version: legacy.version, hash: hashRuntimeValue(legacy) };
  const selected = nativeSdkApplicationForRun({ workflow }, app);
  expect(hashRuntimeValue(defineWorkflow(selected.workflow))).not.toBe(workflow.hash);
  expect(
    app.validators.some(
      (validator) => validator.id === 'comet-native-verifier-outcome' && validator.version === '2',
    ),
  ).toBe(false);
  expect(() =>
    parseNativeVerifierResponse({
      kind: 'final-result',
      result: {
        iteration: 1,
        attempt: 1,
        verdict: 'pass',
        passedAcceptanceIds: ['A1'],
        acceptance: [],
        risks: [],
        summary: 'pass',
      },
    }),
  ).toThrow();
});

it.each(['skills', 'skills-zh'])(
  'removes retired mode instructions and assets in %s',
  async (locale) => {
    const dir = path.resolve('assets', locale, 'comet-native');
    const skill = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
    expect(skill).not.toMatch(/bugfree|verifyMode|verify_mode/);
    await expect(fs.stat(path.join(dir, 'reference/bugfree.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(skill).toContain('claimRequest');
  },
);
