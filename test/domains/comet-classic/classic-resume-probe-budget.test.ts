import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as external from '../../../platform/process/external-command.js';
import * as progress from '../../../domains/comet-classic/classic-progress.js';
import { resolveCometEntryResumeProbe } from '../../../domains/comet-entry/resume-probe.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('discovers 168 archived changes without executing Git delivery evidence for 28 pending receipts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-probe-budget-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.comet'));
  await fs.writeFile(
    path.join(root, '.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
  );
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const archive = path.join(root, 'openspec/changes/archive');
  const expected = new Map<string, string>();
  for (let index = 0; index < 168; index += 1) {
    const active = path.join(root, 'openspec/changes', `case-${index}`);
    const archived = path.join(archive, `2026-10-24-case-${index}`);
    await fs.mkdir(active, { recursive: true });
    const state =
      'workflow: hotfix\nphase: archive\narchived: false\nverify_result: pass\ncreated_at: 2026-10-24T00:00:00.000Z\nbase_ref: main\ndesign_doc: null\nplan: null\nbuild_mode: null\nisolation: current\nverify_mode: full\nverified_at: 2026-10-24T00:00:00.000Z\n';
    await fs.writeFile(path.join(active, '.comet.yaml'), state);
    if (index < 28)
      await progress.writeClassicDelivery(
        root,
        active,
        { action: 'local', targetBranch: 'main' },
        { phase: 'archive', verifyResult: 'pass', archived: false },
      );
    await fs.writeFile(
      path.join(active, '.comet.yaml'),
      state.replace('archived: false', 'archived: true'),
    );
    await fs.mkdir(archive, { recursive: true });
    await fs.rename(active, archived);
    expected.set(
      path.join(archived, '.comet.yaml'),
      await fs.readFile(path.join(archived, '.comet.yaml'), 'utf8'),
    );
  }
  const delivery = vi.spyOn(progress, 'readClassicDelivery');
  const command = vi.spyOn(external, 'runExternalCommand');
  const result = await resolveCometEntryResumeProbe(root, {
    schema_version: 'comet.resume_probe.v2',
    utterance: '继续刚才的 change',
    agent_context: { non_trivial_work: true, already_in_comet_flow: false },
  });
  expect(result.action).toBe('ask_user');
  expect(delivery).toHaveBeenCalledTimes(168);
  expect(delivery.mock.calls.every((args) => args[2]?.evidence === false)).toBe(true);
  const git = command.mock.calls.filter(([name]) => /(?:^|[/\\])git(?:\.exe)?$/iu.test(name));
  const evidenceCommands = new Set(['merge-base', 'cat-file', 'show', 'diff', 'log', 'ls-remote']);
  expect(git.filter(([, args]) => args.some((argument) => evidenceCommands.has(argument)))).toEqual(
    [],
  );
  expect(git.length).toBeLessThanOrEqual(4);
  for (const [file, source] of expected) expect(await fs.readFile(file, 'utf8')).toBe(source);
}, 120_000);
