import { execFileSync } from 'node:child_process';
import { assertClassicSdkArchiveCommitInputs } from '../../../domains/comet-classic/classic-sdk-delivery-inputs.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  portableClaimToken,
  type RuntimeAction,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { annotatedMarkdown } from '../../../domains/comet-classic/classic-archive-annotation.js';
import {
  checkManifestHash,
  serializeCheckManifest,
} from '../../../domains/comet-classic/classic-check-manifest.js';
import { readLegacyClassicArchiveInputs } from '../../../domains/comet-classic/classic-sdk-archive-legacy-manifest.js';
import { classicSdkCheckDirectoryRef } from '../../../domains/comet-classic/classic-sdk-check-record.js';
import { writeClassicProjectText } from '../../../domains/comet-classic/classic-protected-path.js';
import { classicTaskRevision } from '../../../domains/comet-classic/classic-tasks.js';
import { handoffSourceHash } from '../../../domains/comet-classic/classic-handoff-source.js';
import {
  renderClassicHandoffMarkdown,
  renderClassicSpecHandoffMarkdown,
} from '../../../domains/comet-classic/classic-handoff.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
const digest = (source: string) => createHash('sha256').update(source).digest('hex');
const blob = (source: string) =>
  `git:${createHash('sha1')
    .update(`blob ${Buffer.byteLength(source)}\0`)
    .update(source)
    .digest('hex')}`;
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(
  profile: 'full' | 'hotfix' = 'hotfix',
  gitHashes = false,
  insideDesign = false,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-legacy-archive-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  const activeRef = 'openspec/changes/example';
  const archiveRef = 'openspec/changes/archive/2026-10-24-example';
  const designRef = insideDesign ? `${activeRef}/design.md` : 'docs/superpowers/specs/design.md';
  const planRef = 'docs/superpowers/plans/plan.md';
  const texts: Record<string, string> = {
    [`${activeRef}/proposal.md`]: '# Proposal\nKeep the public API.\n',
    [`${activeRef}/design.md`]: '# Design\nKeep the public API.\n- [ ] Supporting note\n',
    [`${activeRef}/tasks.md`]: '- [x] Keep the API <!-- comet-task:impl -->\n',
    [`${activeRef}/.openspec.yaml`]: 'schema: spec-driven\n',
  };
  const documents: Record<string, { original: string; extraFields: string }> = {};
  if (profile === 'full') {
    texts[designRef] = '# Accepted technical design\n- [ ] Supporting note\n';
    texts[planRef] = '# Accepted implementation plan\n';
    documents[designRef] = { original: texts[designRef], extraFields: 'status: final' };
    documents[planRef] = { original: texts[planRef], extraFields: '' };
  }
  const archiveAction = {
    runId: 'example',
    id: 'example:archive',
    stepId: `${profile}.archive.execute`,
    attempt: 1,
    inputHash: 'archive-input',
    input: {
      outputs:
        profile === 'full'
          ? {
              'full.design.document': { designDoc: designRef },
              'full.build.plan': { plan: planRef },
            }
          : {},
    },
    claim: { token: 'archive-token' },
    status: 'succeeded',
    outcome: { status: 'succeeded', output: { archiveDirectory: archiveRef } },
  } as unknown as RuntimeAction;
  const manifest = serializeCheckManifest(
    Object.entries(texts).map(([p, source]) => ({
      p,
      h:
        p === `${activeRef}/tasks.md`
          ? classicTaskRevision(source)
          : gitHashes
            ? blob(source)
            : digest(source),
      s: Buffer.byteLength(source),
      m: null,
    })),
  );
  const checkOutput = {
    manifestRef: `${classicSdkCheckDirectoryRef({ runId: 'example' })}/verify.manifest`,
    manifestHash: checkManifestHash(manifest),
  };
  const run = {
    runId: 'example',
    state: { workflow: profile },
    input: { changeDir: activeRef },
    actionContexts: {},
    actions: [
      {
        stepId: `${profile}.verify.check`,
        status: 'succeeded',
        outcome: { status: 'succeeded', output: checkOutput },
      },
      archiveAction,
    ],
  } as unknown as WorkflowRun;
  const put = async (ref: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
    await fs.writeFile(path.join(root, ref), source);
  };
  for (const [ref, source] of Object.entries(texts)) {
    const mapped = ref.replace(`${activeRef}/`, `${archiveRef}/`);
    await put(
      mapped,
      documents[ref]
        ? annotatedMarkdown(source, path.posix.basename(archiveRef), documents[ref].extraFields)
        : source,
    );
  }
  await put(`${archiveRef}/comet-state.yaml`, 'runtime_format: sdk\n');
  const receipt = {
    runId: run.runId,
    actionId: archiveAction.id,
    attempt: archiveAction.attempt,
    inputHash: archiveAction.inputHash,
    claimToken: portableClaimToken(archiveAction.claim!.token),
    documents,
  };
  const receiptRef = `${archiveRef}/.comet/archive-documents.json`;
  await put(receiptRef, JSON.stringify(receipt));
  await writeClassicProjectText(root, checkOutput.manifestRef, manifest, {
    label: 'Test manifest',
  });
  const read = () => readLegacyClassicArchiveInputs(root, run, archiveAction, archiveRef);
  return {
    root,
    run,
    archiveAction,
    activeRef,
    archiveRef,
    receiptRef,
    receipt,
    checkOutput,
    put,
    read,
  };
}

it.each(['hotfix', 'full'] as const)(
  'restores deterministic %s archive paths without artifacts',
  async (profile) => {
    const f = await fixture(profile);
    const restored = await f.read();
    expect(restored.inputs[`${f.archiveRef}/proposal.md`]).toMatch(/^[a-f0-9]{64}$/u);
    expect(restored.inputs[`${f.archiveRef}/tasks.md`]).toBe(
      digest(await fs.readFile(path.join(f.root, `${f.archiveRef}/tasks.md`), 'utf8')),
    );
    expect(restored.inputs[`${f.activeRef}/proposal.md`]).toBe('missing');
    expect(restored.inputs[`${f.activeRef}/comet-state.yaml`]).toBe('missing');
    expect(restored.stateFiles).toEqual([
      `${f.archiveRef}/comet-state.yaml`,
      `${f.activeRef}/comet-state.yaml`,
    ]);
  },
);

it('checks original Git object identities for moved files and annotated documents', async () => {
  const f = await fixture('full', true);
  expect((await f.read()).inputs[`${f.archiveRef}/proposal.md`]).toMatch(/^git:[a-f0-9]{40}$/u);
});

it.each(['proposal.md', 'tasks.md'])('rejects changed accepted %s', async (name) => {
  const f = await fixture();
  await f.put(`${f.archiveRef}/${name}`, '# Unapproved replacement\n');
  await expect(f.read()).rejects.toThrow(/原 Verify/u);
});

it('rejects a forged or relocated original Verify manifest', async () => {
  const f = await fixture();
  f.checkOutput.manifestHash = 'f'.repeat(64);
  await expect(f.read()).rejects.toThrow(/输入清单摘要不符/u);
  f.checkOutput.manifestRef = 'unrelated/verify.manifest';
  await expect(f.read()).rejects.toThrow(/缺少原 Verify/u);
});

it.each(['identity', 'extra-field', 'original', 'annotation'] as const)(
  'rejects changed receipt %s',
  async (change) => {
    const f = await fixture('full');
    if (change === 'identity') f.receipt.actionId = 'other-action';
    if (change === 'extra-field') Object.assign(f.receipt, { approved: true });
    if (change === 'original')
      f.receipt.documents['docs/superpowers/specs/design.md'].original += 'Unapproved';
    if (change === 'annotation')
      f.receipt.documents['docs/superpowers/specs/design.md'].extraFields = 'status: accepted';
    await f.put(f.receiptRef, JSON.stringify(f.receipt));
    await expect(f.read()).rejects.toThrow(/收据/u);
  },
);

it('allows only validated requirement metadata and never a main-spec transform or other metadata', async () => {
  const f = await fixture();
  const ref = `${f.archiveRef}/.comet/archive-requirements.json`;
  const receipt = {
    schema: 'comet.classic.archive-requirements.v1',
    files: ['proposal.md', 'tasks.md'],
  };
  await f.put(ref, JSON.stringify(receipt));
  await f.put(`${f.archiveRef}/.comet/unapproved.json`, '{}');
  await f.put('openspec/specs/unapproved/spec.md', '# Unapproved requirements\n');
  const restored = await f.read();
  expect(restored.inputs[ref]).toBe(digest(JSON.stringify(receipt)));
  expect(restored.inputs).not.toHaveProperty(`${f.archiveRef}/.comet/unapproved.json`);
  expect(restored.inputs).not.toHaveProperty('openspec/specs/unapproved/spec.md');
  await f.put(ref, JSON.stringify({ ...receipt, files: [...receipt.files, 'outside.txt'] }));
  await expect(f.read()).rejects.toThrow(/必需工件收据/u);
  await f.put(ref, JSON.stringify({ ...receipt, extra: true }));
  await expect(f.read()).rejects.toThrow(/必需工件收据/u);
});

it.each(['.comet-state.lock', '.comet-state-transaction.json'])(
  'binds only the exact valid migration marker in %s',
  async (name) => {
    const f = await fixture();
    const ref = `${f.archiveRef}/${name}/.comet-runtime-migration.json`;
    const marker = {
      schema: 'comet.workspace-runtime-migration.v1',
      workspaceId: 'a'.repeat(64),
      source: path.join(f.root, f.activeRef, name),
      target: path.join(f.root, 'private-runtime', name),
      kind: 'file',
    };
    await f.put(ref, JSON.stringify(marker));
    const restored = await f.read();
    expect(restored.optionalFiles).toEqual({ [ref]: digest(JSON.stringify(marker)) });
    expect(restored.inputs).not.toHaveProperty(ref);
    await f.put(ref, JSON.stringify({ ...marker, approved: true }));
    await expect(f.read()).rejects.toThrow(/迁移标记无效/u);
    await f.put(ref, JSON.stringify(marker));
    await f.put(`${f.archiveRef}/${name}/unapproved.json`, '{}');
    await expect(f.read()).rejects.toThrow(/额外内容/u);
  },
);

it.each([
  ['compact', false],
  ['beta', false],
  ['compact', true],
] as const)(
  'accepts the original %s handoff after task completion (inside-change Design: %s)',
  async (mode, insideDesign) => {
    const f = await fixture('full', false, insideDesign);
    const sources = await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md', '.openspec.yaml'].map(async (name) => {
        const reference = `${f.activeRef}/${name}`;
        const current =
          f.receipt.documents[reference]?.original ??
          (await fs.readFile(path.join(f.root, f.archiveRef, name), 'utf8'));
        const content = name === 'tasks.md' ? current.replace('- [x]', '- [ ]') : current;
        return { reference, content, sha256: handoffSourceHash(reference, content) };
      }),
    );
    const contextHash = digest(
      sources
        .flatMap(({ reference, sha256 }) => [`path:${reference}`, `sha256:${sha256}`])
        .join('\n'),
    );
    const basename = mode === 'beta' ? 'spec-context' : 'design-context';
    const originalRef = `${f.activeRef}/.comet/handoff/${basename}.json`;
    const jsonRef = `${f.archiveRef}/.comet/handoff/${basename}.json`;
    const markdownRef = jsonRef.replace(/\.json$/u, '.md');
    const context = {
      change: 'example',
      phase: 'design',
      mode,
      canonical_spec: 'openspec',
      task_hash_policy: 'task-content-v1',
      generated_by: 'comet-handoff.sh',
      context_hash: contextHash,
      files: sources.map(({ reference, sha256 }) => ({
        path: reference,
        sha256,
        ...(mode === 'beta' ? { role: 'supporting' } : {}),
      })),
    };
    f.run.actionContexts[f.archiveAction.id] = { sequence: 10 } as never;
    f.run.waits = [
      {
        stepId: 'full.design.confirm',
        sequence: 3,
        status: 'resolved',
        decision: { choice: 'approved' },
        proposal: {
          outputs: {
            'full.design.handoff': { handoffContext: originalRef, handoffHash: contextHash },
          },
        },
      },
    ] as never;
    const markdown =
      mode === 'beta'
        ? renderClassicSpecHandoffMarkdown(f.activeRef, 'example', contextHash, sources)
        : renderClassicHandoffMarkdown('example', 'compact', contextHash, sources);
    await f.put(jsonRef, JSON.stringify(context));
    await f.put(markdownRef, markdown);
    expect((await f.read()).optionalFiles).toMatchObject({
      [jsonRef]: digest(JSON.stringify(context)),
      [markdownRef]: digest(markdown),
    });
    await f.put(markdownRef, markdown + '\nUnapproved instructions.\n');
    await expect(f.read()).rejects.toThrow(/确定性渲染不符/u);
    if (mode === 'compact') {
      await f.put(markdownRef, markdown.replace('- [ ] Supporting note', '- [x] Supporting note'));
      await expect(f.read()).rejects.toThrow(/确定性渲染不符/u);
    }
    await f.put(markdownRef, markdown);
    await f.put(jsonRef, JSON.stringify({ ...context, approved: true }));
    await expect(f.read()).rejects.toThrow(/JSON 字段/u);
  },
);

it.each([false, true])(
  'binds legacy deleted-source commit history to original Verify bytes (Git hashes: %s)',
  async (gitHashes) => {
    const f = await fixture('full', gitHashes);
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
        { cwd: f.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
    const binding = await f.read();
    git('init');
    git('add', '--all');
    git('commit', '-m', 'archived baseline');
    const ref = `${f.activeRef}/proposal.md`;
    const original = await fs.readFile(path.join(f.root, f.archiveRef, 'proposal.md'), 'utf8');
    await f.put(ref, original);
    git('add', '--', ref);
    git('commit', '-m', 'original approved source');
    const approved = git('rev-parse', 'HEAD');
    await expect(
      assertClassicSdkArchiveCommitInputs(
        f.root,
        binding.inputs,
        new Map([[approved, [ref]]]),
        binding.sources,
        binding.stateFiles,
      ),
    ).resolves.toBeUndefined();
    await f.put(ref, '# Unapproved source requirements\n');
    git('add', '--', ref);
    git('commit', '-m', 'unapproved source');
    const rejected = git('rev-parse', 'HEAD');
    git('rm', '--', ref);
    git('commit', '-m', 'delete source');
    await expect(
      assertClassicSdkArchiveCommitInputs(
        f.root,
        binding.inputs,
        new Map([
          [rejected, [ref]],
          [git('rev-parse', 'HEAD'), [ref]],
        ]),
        binding.sources,
        binding.stateFiles,
      ),
    ).rejects.toThrow(`${rejected}:${ref}`);
  },
);
