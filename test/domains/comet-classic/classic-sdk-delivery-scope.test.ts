import { writeClassicPlatformChecks } from '../../helpers/classic-platform-checks.js';
import { requireFileSymlink } from '../../helpers/file-symlink.js';
import { readClassicArchiveManifest } from '../../../domains/comet-classic/classic-sdk-archive-manifest.js';
import { defineClassicWorkflowApplication } from '../../../domains/comet-classic/classic-sdk-application.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, onTestFailed, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { assertClassicSdkDeliveryInputs } from '../../../domains/comet-classic/classic-sdk-delivery-inputs.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import { createOpenSpecArchiveFixture } from '../../helpers/classic-openspec-fixture.js';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import {
  CLASSIC_MANAGED_RUN_MARKER,
  parseClassicStateDocument,
} from '../../../domains/comet-classic/classic-state.js';

const roots: string[] = [];
// Both transient directories that `migrationFiles` can record a fence from. They are
// omitted from the archived tree, so the fence reaches `optionalFiles` instead.
const FENCES = ['.comet-state.lock', '.comet-state-transaction.json'] as const;

it('keeps foreign drafts out of legacy deliveryInputs without changing the original Run', async () => {
  const f = await hotfix({ parked: true });
  f.commitImplementation();
  f.commitArchive();
  // SIMULATED legacy path encoding on an actually completed Archive preflight.
  const legacy = structuredClone(f.archived);
  const check = legacy.actions.findLast((action) => action.stepId === 'hotfix.archive.preflight')!;
  const output = check.outcome!.output as {
    deliveryInputs?: Record<string, string>;
    deliveryPaths?: string[];
  };
  output.deliveryInputs = Object.fromEntries(
    output.deliveryPaths!.map((ref) => [ref, 'legacy-digest']),
  );
  output.deliveryInputs['docs/comet/changes/parked-native/brief.md'] = 'legacy-digest';
  output.deliveryInputs['openspec/changes/parked-classic/proposal.md'] = 'legacy-digest';
  delete output.deliveryPaths;
  const before = structuredClone(legacy);
  expect(await assertClassicSdkDeliveryInputs(f.projectRoot, legacy)).toEqual(
    new Set(['source.js', 'src/changes/adapter.ts', f.reportRef]),
  );
  expect(legacy).toEqual(before);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function publicStateRuntime(root: string, command: 'state' | 'archive' = 'state') {
  if (process.env.COMET_TEST_PACKAGE_ROOT)
    return path.join(
      process.env.COMET_TEST_PACKAGE_ROOT,
      'assets/skills/comet/scripts',
      `comet-${command}.mjs`,
    );
  const runtime = path.join(root, `comet-${command}.mjs`);
  await build({
    entryPoints: [path.resolve(`domains/comet-classic/classic-${command}-entry.ts`)],
    outfile: runtime,
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire as __cometCreateRequire } from 'node:module'; const require = __cometCreateRequire(import.meta.url);",
    },
    logLevel: 'silent',
  });
  return runtime;
}

async function hotfix(
  options: {
    parked?: boolean;
    nativeRoot?: string;
    deliveryAction?: 'local' | 'push';
    specSync?: boolean;
    initialDraft?: 'unchanged' | 'modified';
    interruptArchive?: boolean;
    forgedBaseline?: boolean;
    projectAlias?: boolean;
    isolation?: 'current' | 'worktree';
    migrationFence?: (typeof FENCES)[number];
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-delivery-scope-'));
  roots.push(root);
  let projectBase = root;
  if (options.projectAlias) {
    const physicalBase = path.join(root, 'physical');
    await fs.mkdir(physicalBase);
    projectBase = path.join(root, 'project-alias');
    await fs.symlink(physicalBase, projectBase, process.platform === 'win32' ? 'junction' : 'dir');
    if (process.platform === 'win32')
      projectBase = execFileSync('cmd.exe', ['/d', '/c', 'for %I in (.) do @echo %~sI'], {
        cwd: projectBase,
        encoding: 'utf8',
        windowsVerbatimArguments: true,
      }).trim();
  }
  const integrationRoot = path.join(projectBase, 'project');
  let projectRoot = integrationRoot;
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await prepareClassicLegacyProject(projectRoot);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
      { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  const put = async (ref: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(projectRoot, ref)), { recursive: true });
    await fs.writeFile(path.join(projectRoot, ref), source);
  };
  if (options.parked) {
    const native = await runNativeCli([
      'init',
      '--root',
      options.nativeRoot ?? 'docs',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(native.exitCode, native.stderr).toBe(0);
    const config = parse(await fs.readFile(path.join(projectRoot, '.comet/config.yaml'), 'utf8'));
    config.default_workflow = 'native';
    config.workflows = ['native', 'classic'];
    config.classic = {
      artifact_layout: 'legacy',
      language: 'en',
      context_compression: 'off',
      review_mode: 'standard',
      auto_transition: true,
    };
    await put('.comet/config.yaml', stringify(config));
  }
  await put('source.js', 'export const ready = false;\n');
  if (options.specSync)
    await put('openspec/specs/ready/spec.md', '# Ready\nExisting requirement.\n');
  git('init', '-b', 'main');
  git('add', '--all');
  git('commit', '-m', 'base');
  if (options.isolation === 'worktree') {
    const featureRoot = path.join(root, 'feature-worktree');
    git('worktree', 'add', '-b', 'feature/example', featureRoot);
    projectRoot = featureRoot;
  }
  if (options.parked) {
    const native = await runNativeCli([
      'new',
      'parked-native',
      '--runtime',
      'sdk',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(native.exitCode, native.stderr).toBe(0);
    await put('openspec/changes/parked-classic/proposal.md', '# Parked Classic proposal\n');
  }
  if (options.initialDraft) {
    await put('unrelated-draft.ts', 'export const unfinished = true;\n');
    await put('private-notes.ts', '// Existing work outside this change.\n');
  }
  const invoke = async (...args: string[]) => {
    const separator = args.indexOf('--');
    args.splice(separator < 0 ? args.length : separator, 0, '--json');
    const result = await runClassicCli(args, undefined, { invocationCwd: projectRoot });
    return { ...result, response: JSON.parse(result.stdout ?? '{}') };
  };
  const cli = async (...args: string[]) => {
    const result = await invoke(...args);
    expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
    return result.response.data;
  };
  if (options.forgedBaseline) {
    const source = 'export const ready = true;\n';
    const hash = createHash('sha1')
      .update(`blob ${Buffer.byteLength(source)}\0`)
      .update(source)
      .digest('hex');
    const request = path.join(root, 'start.json');
    await fs.writeFile(
      request,
      JSON.stringify({
        operation: 'start',
        runId: 'example',
        workflow: {
          id: 'comet-classic-hotfix',
          version: defineClassicWorkflowApplication('hotfix').workflow.version,
        },
        input: {
          change: 'example',
          changeDir: 'openspec/changes/example',
          workspaceBaseline: {
            schema: 'comet.classic.workspace-baseline.v1',
            files: { 'source.js': `git:${hash}` },
          },
        },
        initialState: parseClassicStateDocument({
          workflow: 'hotfix',
          phase: 'open',
          design_doc: null,
          plan: null,
          verify_result: 'pending',
          verified_at: null,
          archived: false,
          build_mode: 'direct',
          tdd_mode: 'direct',
          review_mode: 'off',
          verify_mode: 'light',
          isolation: 'current',
          bound_branch: 'main',
          auto_transition: true,
          language: 'en',
        }).classic,
      }),
    );
    const started = await runtimeDispatchCommand({
      application: 'classic-hotfix',
      projectRoot,
      request,
    });
    expect(started.response.status, JSON.stringify(started.response)).toBe('succeeded');
  } else
    await cli('state', 'init', 'example', 'hotfix', '--isolation', options.isolation ?? 'current');
  const activeRef = 'openspec/changes/example';
  await put(`${activeRef}/proposal.md`, '# Proposal\nCorrect the ready constant.\n');
  await put(`${activeRef}/design.md`, '# Design\nKeep the existing public API.\n');
  await put(`${activeRef}/tasks.md`, '- [x] Correct the constant <!-- comet-task:impl -->\n');
  if (options.specSync)
    await put(`${activeRef}/specs/ready/spec.md`, '# ADDED Requirements\nReady must be true.\n');
  const open = await cli('guard', 'example', 'open');
  await cli('guard', 'example', 'open', '--apply', '--approval-hash', open.approvalHash);
  await put('source.js', 'export const ready = true;\n');
  if (options.initialDraft === 'modified')
    await put('unrelated-draft.ts', 'export const unfinished = false;\n');
  await put('src/changes/adapter.ts', 'export const supportsChanges = true;\n');
  const argv = [
    process.execPath,
    '-e',
    "if (!require('node:fs').readFileSync('source.js', 'utf8').includes('ready = true')) process.exit(1)",
  ];
  if (options.initialDraft === 'modified')
    await put(
      '.comet/check-policy.json',
      JSON.stringify({
        version: 2,
        commands: [
          { argv, cwd: '.', files: ['source.js', 'src/changes/adapter.ts', 'unrelated-draft.ts'] },
        ],
      }),
    );
  const checks = await writeClassicPlatformChecks(projectRoot, argv);
  await cli('guard', 'example', 'build', '--apply', '--checks', checks);
  const reportRef = 'docs/superpowers/reports/hotfix.md';
  await put(
    reportRef,
    '# Verification\nThe ready constant is true; the public API is unchanged.\n',
  );
  await cli(
    'guard',
    'example',
    'verify',
    '--report',
    reportRef,
    '--apply',
    '--checks',
    await writeClassicPlatformChecks(projectRoot, argv),
  );
  const inspect = () => inspectClassicSdkRun(projectRoot, 'example');
  const verified = (await inspect()).run;
  // The transient directories are gitignored, but a tracked migration fence
  // inside one still moves with the change. Track it so the archive commit
  // contains both sides of the move.
  if (options.migrationFence) {
    const fenceRef = `${activeRef}/${options.migrationFence}/.comet-runtime-migration.json`;
    await put(
      fenceRef,
      JSON.stringify({
        schema: 'comet.workspace-runtime-migration.v1',
        workspaceId: 'a'.repeat(64),
        source: path.join(projectRoot, 'runtime-source'),
        target: path.join(projectRoot, 'runtime-target'),
        kind: 'file',
      }),
    );
    git('add', '-f', '--', fenceRef);
    git('commit', '-m', 'track the runtime migration fence');
  }
  let remoteRoot: string | undefined;
  if (options.deliveryAction === 'push') {
    remoteRoot = path.join(root, 'remote.git');
    git('init', '--bare', remoteRoot);
    git('remote', 'add', 'origin', remoteRoot);
  }
  const proposal = await cli(
    'state',
    'propose-archive',
    'example',
    '--summary',
    'Archive the verified hotfix.',
    ...(options.initialDraft === 'modified'
      ? [
          '--delivery-path',
          'source.js',
          '--delivery-path',
          'src/changes/adapter.ts',
          '--delivery-path',
          'unrelated-draft.ts',
        ]
      : []),
    ...(options.deliveryAction === 'push' ? ['--remote', 'origin'] : []),
  );
  await cli(
    'state',
    'decide-archive',
    'example',
    '--proposal-hash',
    proposal.wait.proposalHash,
    '--choice',
    options.deliveryAction ?? 'local',
  );
  const openSpec = await createOpenSpecArchiveFixture(root);
  if (options.specSync)
    await fs.appendFile(
      openSpec.command,
      `\nawait fs.writeFile(path.join(process.cwd(), 'openspec/specs/ready/spec.md'), '# Ready\\nExisting requirement.\\nReady must be true.\\n');\n`,
    );
  vi.stubEnv('COMET_OPENSPEC', openSpec.command);
  if (options.interruptArchive)
    await fs.appendFile(
      openSpec.command,
      '\nprocess.stderr.write("interrupted after move"); process.exitCode = 1;\n',
    );
  const archiveResult = await invoke('guard', 'example', 'archive', '--apply');
  expect(archiveResult.exitCode, archiveResult.stdout ?? archiveResult.stderr).toBe(
    options.interruptArchive ? 70 : 0,
  );
  const archived = (await inspect()).run;
  const archiveRef =
    (archived.outputs['hotfix.archive.execute']?.value as { archiveDirectory: string } | undefined)
      ?.archiveDirectory ??
    `openspec/changes/archive/${(await fs.readdir(path.join(projectRoot, 'openspec/changes/archive')))[0]}`;
  const base = (archived.outputs['hotfix.archive.preflight'].value as { baseCommit: string })
    .baseCommit;
  const commitImplementation = () => {
    git('add', '--', 'source.js', 'src/changes/adapter.ts');
    return git('commit', '-m', 'implementation');
  };
  const commitArchive = () => {
    git(
      'add',
      '--',
      archiveRef,
      reportRef,
      ...(options.specSync ? ['openspec/specs/ready/spec.md'] : []),
    );
    git('commit', '-m', 'archive');
    return git('rev-parse', 'HEAD');
  };
  return {
    root,
    projectRoot,
    integrationRoot,
    remoteRoot,
    git,
    put,
    cli,
    invoke,
    inspect,
    verified,
    archived,
    openSpec,
    activeRef,
    archiveRef,
    reportRef,
    base,
    commitImplementation,
    commitArchive,
  };
}

it('delivers without an unchanged untracked draft that predates the change', async () => {
  const f = await hotfix({ initialDraft: 'unchanged' });
  f.commitImplementation();
  const commit = f.commitArchive();
  const runtime = await publicStateRuntime(f.root);
  const delivered = spawnSync(
    process.execPath,
    [runtime, 'complete-delivery', 'example', '--commit', commit, '--json'],
    { cwd: f.projectRoot, encoding: 'utf8' },
  );
  expect(delivered.status, delivered.stdout || delivered.stderr).toBe(0);
  expect(JSON.parse(delivered.stdout).data.nextAction.kind).toBe('done');
  expect(f.git('status', '--porcelain')).toContain('?? unrelated-draft.ts');
  expect(await fs.readFile(path.join(f.projectRoot, 'unrelated-draft.ts'), 'utf8')).toBe(
    'export const unfinished = true;\n',
  );
});

it('requires delivery of an explicitly selected initial draft', async () => {
  const f = await hotfix({ initialDraft: 'modified' });
  f.commitImplementation();
  const commit = f.commitArchive();
  const rejected = await f.invoke('state', 'complete-delivery', 'example', '--commit', commit);
  expect(rejected.exitCode).not.toBe(0);
  expect(rejected.response.stderr).toContain('unrelated-draft.ts');
});

it('delivers an explicitly approved initial draft without including an unrelated draft', async () => {
  const f = await hotfix({ initialDraft: 'modified' });
  f.commitImplementation();
  f.git('add', '--', 'unrelated-draft.ts');
  f.git('commit', '-m', 'complete the approved initial draft');
  const commit = f.commitArchive();
  const completed = await f.cli('state', 'complete-delivery', 'example', '--commit', commit);
  expect(completed.nextAction.kind).toBe('done');
  expect(f.git('show', 'HEAD:unrelated-draft.ts')).toContain('unfinished = false');
  expect(f.git('status', '--porcelain')).toContain('?? private-notes.ts');
  expect(await fs.readFile(path.join(f.projectRoot, 'private-notes.ts'), 'utf8')).toBe(
    '// Existing work outside this change.\n',
  );
  const approval = f.archived.waits.find((wait) => wait.stepId === 'hotfix.archive.confirm')!;
  expect(approval.status).toBe('resolved');
  expect(approval.proposal).toMatchObject({
    outputs: {
      'hotfix.archive.prepare': {
        deliveryPaths: ['source.js', 'src/changes/adapter.ts', 'unrelated-draft.ts'],
      },
    },
  });
});

it('does not trust a workspace baseline supplied through public dispatch start', async () => {
  const f = await hotfix({ forgedBaseline: true });
  const output = f.archived.actions.findLast(
    (action) => action.stepId === 'hotfix.archive.preflight',
  )!.outcome!.output as { deliveryPaths: string[] };
  expect(output.deliveryPaths).toContain('source.js');
  f.git('add', '--', 'src/changes/adapter.ts');
  f.git('commit', '-m', 'adapter only');
  const commit = f.commitArchive();
  expect(
    (await f.invoke('state', 'complete-delivery', 'example', '--commit', commit)).exitCode,
  ).not.toBe(0);
});

it('recovers Archive interrupted after moving without replay after an Agent accepts material edits', async () => {
  const started = performance.now();
  const progress = ['preparing interrupted Archive'];
  const mark = (step: string) =>
    progress.push(`${Math.round(performance.now() - started)}ms: ${step}`);
  onTestFailed(() => console.error('Archive recovery progress:', progress));
  const f = await hotfix({ interruptArchive: true });
  const proposal = `${f.archiveRef}/proposal.md`;
  const original = await fs.readFile(path.join(f.projectRoot, proposal), 'utf8');
  await f.put(proposal, original + '\n<!-- Agent clarified the same scope. -->\n');
  const extra = `${f.archiveRef}/unrelated.txt`;
  await f.put(extra, 'Unrelated text added after preparation.');
  mark('Agent inspected material edits; building public recovery command');
  const runtime = await publicStateRuntime(f.root, 'archive');
  mark('built public recovery command; recovering in child process');
  const restored = spawnSync(process.execPath, [runtime, 'example', '--recover', '--json'], {
    cwd: f.projectRoot,
    encoding: 'utf8',
  });
  expect(restored.status, restored.stdout || restored.stderr).toBe(0);
  mark('recovered in child process; checking idempotency');
  const recovered = (await f.inspect()).run;
  await f.cli('archive', 'example', '--recover');
  expect((await f.inspect()).run).toEqual(recovered);
  expect(await f.openSpec.invocations()).toHaveLength(1);
  expect(await fs.readFile(path.join(f.projectRoot, proposal), 'utf8')).toContain(
    'Agent clarified',
  );
  const action = recovered.actions.find((action) => action.stepId === 'hotfix.archive.execute')!;
  const manifest = await readClassicArchiveManifest(f.projectRoot, recovered, action, f.archiveRef);
  expect(manifest.paths).not.toContain(extra);
  await fs.rm(path.join(f.projectRoot, extra));
  mark('confirmed one OpenSpec invocation; committing and verifying delivery');
  f.commitImplementation();
  const commit = f.commitArchive();
  expect(
    (await f.cli('state', 'complete-delivery', 'example', '--commit', commit)).nextAction.kind,
  ).toBe('done');
});

it.each(['docs', 'specifications/custom'])(
  'keeps parked Native Shape and Classic drafts out of hotfix delivery inputs under %s',
  async (nativeRoot) => {
    const f = await hotfix({ parked: true, nativeRoot });
    const output = f.archived.actions.findLast(
      (action) => action.stepId === 'hotfix.archive.preflight',
    )!.outcome!.output as { deliveryPaths: string[] };
    expect(output.deliveryPaths).toEqual(['source.js', 'src/changes/adapter.ts']);
    expect(output).not.toHaveProperty('manifestRef');
    expect(
      await fs.stat(path.join(f.projectRoot, nativeRoot, 'comet/changes/parked-native/brief.md')),
    ).toBeDefined();
    f.commitImplementation();
    const commit = f.commitArchive();
    const completed = await f.cli('state', 'complete-delivery', 'example', '--commit', commit);
    expect(completed.nextAction.kind).toBe('done');
    expect(f.git('ls-tree', '-r', '--name-only', 'HEAD')).not.toContain('parked-native');
    expect(f.git('ls-tree', '-r', '--name-only', 'HEAD')).not.toContain('parked-classic');
  },
);

it('accepts separate implementation and archive commits through the documented delivery --verify entry', async () => {
  const f = await hotfix();
  f.commitImplementation();
  f.commitArchive();
  const pending = await f.cli('state', 'delivery', 'example');
  expect(pending.delivery).toMatchObject({
    delivery: { action: 'local', baseCommit: f.base },
    verification: { status: 'needsVerification' },
  });
  const completed = await f.cli('state', 'delivery', 'example', '--verify');
  expect(completed.nextAction.kind).toBe('done');
  expect(completed.delivery.verification.status).toBe('local-verified');
  const revision = (await f.inspect()).run.revision;
  expect((await f.inspect()).run.status).toBe('completed');
  const recorded = (await f.inspect()).run;
  const originalCommit = completed.delivery.delivery.commit;
  await f.put('source.js', 'export const ready = false;\n');
  f.git('add', '--', 'source.js');
  f.git('commit', '-m', 'later independent change');
  await fs.appendFile(
    path.join(f.projectRoot, f.archiveRef, 'proposal.md'),
    '\nLater workspace note.\n',
  );
  const historical = await f.cli('state', 'delivery', 'example', '--verify');
  expect(historical.nextAction.kind).toBe('done');
  expect(historical.delivery).toMatchObject({
    delivery: { commit: originalCommit },
    verification: { scope: 'historical-receipt' },
  });
  expect((await f.inspect()).run).toEqual(recorded);
  expect((await f.inspect()).run.revision).toBe(revision);
});

it('accepts a linear approved commit range instead of requiring HEAD to be a direct child of preflight', async () => {
  const f = await hotfix();
  f.commitImplementation();
  const commit = f.commitArchive();
  expect(f.git('rev-list', '--count', `${f.base}..HEAD`)).toBe('2');
  const completed = await f.cli('state', 'complete-delivery', 'example', '--commit', commit);
  expect(completed.nextAction.kind).toBe('done');
  expect(f.git('rev-parse', 'HEAD')).toBe(commit);
});

it('rejects foreign change commits even when they are later reverted without claiming delivery', async () => {
  const f = await hotfix({ parked: true });
  f.commitImplementation();
  f.commitArchive();
  f.git('add', '--', 'docs/comet/changes/parked-native', 'openspec/changes/parked-classic');
  f.git('commit', '-m', 'unrelated drafts');
  const unrelated = f.git('rev-parse', 'HEAD');
  f.git('revert', '--no-edit', unrelated);
  expect(f.git('diff', '--name-only', f.base, 'HEAD')).not.toContain('parked-native');
  const before = (await f.inspect()).run;
  const rejected = await f.invoke(
    'state',
    'complete-delivery',
    'example',
    '--commit',
    f.git('rev-parse', 'HEAD'),
  );
  expect(rejected.exitCode).not.toBe(0);
  expect(rejected.response.stderr).toContain('docs/comet/changes/parked-native/brief.md');
  expect(rejected.response.stderr).toContain('openspec/changes/parked-classic/proposal.md');
  expect((await f.inspect()).run).toEqual(before);
});

it('rejects merge commits, disconnected history and a mismatched delivered HEAD with actionable identities', async () => {
  const f = await hotfix();
  f.commitImplementation();
  const head = f.commitArchive();
  const before = (await f.inspect()).run;
  const stale = await f.invoke('state', 'complete-delivery', 'example', '--commit', f.base);
  expect(stale.response.stderr).toContain(head);
  expect(stale.response.stderr).toContain(f.base);
  const tree = f.git('rev-parse', `${head}^{tree}`);
  // 同秒提交的默认日期排序可能先返回 side，提前触发连续性检查。
  // 固定父子时间，确保此处确实核查 merge 的两个父提交和对应身份。
  const headTime = Number(f.git('show', '-s', '--format=%ct', head));
  vi.stubEnv('GIT_COMMITTER_DATE', `${headTime + 1} +0000`);
  const side = f.git('commit-tree', tree, '-p', head, '-m', 'side');
  vi.stubEnv('GIT_COMMITTER_DATE', `${headTime + 2} +0000`);
  const merge = f.git('commit-tree', tree, '-p', head, '-p', side, '-m', 'merge');
  expect(f.git('rev-list', '--reverse', `${f.base}..${merge}`, '--').split('\n')).toEqual([
    f.git('rev-parse', `${head}^`),
    head,
    side,
    merge,
  ]);
  f.git('update-ref', 'refs/heads/main', merge, head);
  const rejected = await f.invoke('state', 'complete-delivery', 'example', '--commit', merge);
  expect(rejected.exitCode).not.toBe(0);
  expect(rejected.response.stderr).toContain(merge);
  expect(rejected.response.stderr).toContain('父提交数 2');
  expect((await f.inspect()).run).toEqual(before);
  const disconnected = f.git('commit-tree', tree, '-m', 'unrelated root');
  f.git('update-ref', 'refs/heads/main', disconnected, merge);
  const changedBase = await f.invoke(
    'state',
    'complete-delivery',
    'example',
    '--commit',
    disconnected,
  );
  expect(changedBase.exitCode).not.toBe(0);
  expect(changedBase.response.stderr).toContain(f.base);
  expect(changedBase.response.stderr).toContain('父提交数 0');
  expect((await f.inspect()).run).toEqual(before);
});

it.each(['source', 'generated'] as const)(
  'delivers Agent-accepted edits through a parent alias and rejects a foreign commit through %s',
  async (entry) => {
    const f = await hotfix({ projectAlias: true });
    f.commitImplementation();
    f.commitArchive();
    await f.put('source.js', 'export const ready = false;\n');
    f.git('add', '--', 'source.js');
    f.git('commit', '-m', 'unverified source change');
    const before = (await f.inspect()).run;
    const foreign = f.git('commit-tree', f.git('rev-parse', 'HEAD^{tree}'), '-m', 'foreign root');
    const rejected = await f.invoke('state', 'complete-delivery', 'example', '--commit', foreign);
    expect(rejected.exitCode).not.toBe(0);
    expect((await f.inspect()).run).toEqual(before);
    if (entry === 'source')
      await f.cli('state', 'complete-delivery', 'example', '--commit', f.git('rev-parse', 'HEAD'));
    else {
      const bundled = spawnSync(
        process.execPath,
        [
          path.resolve('assets/skills/comet/scripts/comet-state.mjs'),
          'complete-delivery',
          'example',
          '--commit',
          f.git('rev-parse', 'HEAD'),
          '--json',
        ],
        { cwd: f.projectRoot, encoding: 'utf8' },
      );
      expect(bundled.stdout, bundled.stderr || String(bundled.error)).not.toBe('');
      expect(bundled.status, bundled.stdout + bundled.stderr).toBe(0);
      expect(JSON.parse(bundled.stdout).exitCode).toBe(0);
    }
    expect((await f.inspect()).run.status).toBe('completed');
  },
);

it('uses the immutable SDK approval for legacy delivery records rather than replacing it', async () => {
  const f = await hotfix();
  f.commitImplementation();
  const commit = f.commitArchive();
  const record = '.comet/delivery-input.json';
  const before = (await f.inspect()).run;
  await f.put(
    record,
    JSON.stringify({ action: 'push', targetBranch: 'main', remote: 'origin', commit }),
  );
  const rejected = await f.invoke('state', 'delivery', 'example', '--file', record);
  expect(rejected.exitCode).not.toBe(0);
  expect(rejected.response.stderr).toContain('不能通过 delivery --file 改写审批');
  expect((await f.inspect()).run).toEqual(before);
  await f.put(record, JSON.stringify({ action: 'local', targetBranch: 'main', commit }));
  expect((await f.cli('state', 'delivery', 'example', '--file', record)).nextAction.kind).toBe(
    'done',
  );
});

it('retains remote identity and actual remote HEAD checks across a linear commit range', async () => {
  const f = await hotfix({ deliveryAction: 'push' });
  f.commitImplementation();
  const commit = f.commitArchive();
  const before = (await f.inspect()).run;
  const absent = await f.invoke('state', 'delivery', 'example', '--verify');
  expect(absent.exitCode).not.toBe(0);
  expect((await f.inspect()).run).toEqual(before);
  f.git('push', 'origin', 'main');
  const replacement = path.join(f.root, 'replacement.git');
  f.git('init', '--bare', replacement);
  f.git('remote', 'set-url', 'origin', replacement);
  const changed = await f.invoke('state', 'complete-delivery', 'example', '--commit', commit);
  expect(changed.response.stderr).toContain('remote changed after approval');
  expect((await f.inspect()).run).toEqual(before);
  f.git('remote', 'set-url', 'origin', f.remoteRoot!);
  expect((await f.cli('state', 'delivery', 'example', '--verify')).nextAction.kind).toBe('done');
  f.git('remote', 'set-url', 'origin', replacement);
  expect(
    (await f.cli('state', 'delivery', 'example', '--verify')).delivery.verification.scope,
  ).toBe('historical-receipt');
});

it('recovers polluted 0.5.0 delivery paths without changing the Run and rejects escaping paths', async () => {
  const f = await hotfix({ parked: true });
  f.commitImplementation();
  f.commitArchive();
  const oldRun = structuredClone(f.archived);
  const output = oldRun.actions.findLast((action) => action.stepId === 'hotfix.archive.preflight')!
    .outcome!.output as { deliveryInputs?: Record<string, string>; deliveryPaths?: string[] };
  output.deliveryInputs = Object.fromEntries(
    output.deliveryPaths!.map((ref) => [ref, 'legacy-file-digest']),
  );
  delete output.deliveryPaths;
  output.deliveryInputs['docs/comet/changes/parked-native/brief.md'] = 'legacy-file-digest';
  output.deliveryInputs['docs/comet/changes/parked-native/comet-state.yaml'] = 'legacy-file-digest';
  const original = structuredClone(oldRun);
  expect(await assertClassicSdkDeliveryInputs(f.projectRoot, oldRun)).toEqual(
    new Set(['source.js', 'src/changes/adapter.ts', f.reportRef]),
  );
  expect(oldRun).toEqual(original);
  output.deliveryInputs!['../source.js'] = 'a'.repeat(64);
  await expect(assertClassicSdkDeliveryInputs(f.projectRoot, oldRun)).rejects.toThrow(
    /relative|path|路径/u,
  );
});

it.each(['new-spec', 'extra-archive-file'] as const)(
  'rejects %s changes after Archive execution without claiming or replaying delivery',
  async (mutation) => {
    const f = await hotfix();
    const ref =
      mutation === 'new-spec'
        ? 'openspec/specs/unrelated/spec.md'
        : `${f.archiveRef}/unapproved.md`;
    await f.put(ref, '# Unapproved requirement\n');
    f.commitImplementation();
    f.commitArchive();
    if (mutation === 'new-spec') {
      f.git('add', '--', ref);
      f.git('commit', '-m', 'unverified spec');
    }
    const before = (await f.inspect()).run;
    const rejected = await f.invoke(
      'state',
      'complete-delivery',
      'example',
      '--commit',
      f.git('rev-parse', 'HEAD'),
    );
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.response.stderr).toContain(ref);
    expect((await f.inspect()).run).toEqual(before);
    expect(await f.openSpec.invocations()).toHaveLength(1);
  },
);

it('accepts only the actual OpenSpec delta synchronization output, not later edits to that spec', async () => {
  const f = await hotfix({ specSync: true });
  const ref = 'openspec/specs/ready/spec.md';
  const produced = await fs.readFile(path.join(f.projectRoot, ref), 'utf8');
  expect(produced).toContain('Existing requirement.');
  expect(produced).toContain('Ready must be true.');
  f.commitImplementation();
  const commit = f.commitArchive();
  await f.put(ref, '# Unverified replacement\n');
  const before = (await f.inspect()).run;
  const rejected = await f.invoke('state', 'complete-delivery', 'example', '--commit', commit);
  expect(rejected.exitCode).not.toBe(0);
  expect(rejected.response.stderr).toContain(ref);
  expect((await f.inspect()).run).toEqual(before);
  await f.put(ref, produced);
  expect(
    (await f.cli('state', 'complete-delivery', 'example', '--commit', commit)).nextAction.kind,
  ).toBe('done');
});

it('restores the original archive manifest in the same Run without replaying OpenSpec', async () => {
  const f = await hotfix();
  const ref = `${f.archiveRef}/.comet/archive-manifest.json`;
  const original = await fs.readFile(path.join(f.projectRoot, ref), 'utf8');
  const before = (await f.inspect()).run;
  await fs.unlink(path.join(f.projectRoot, ref));
  await f.cli('archive', 'example', '--recover');
  expect(await fs.readFile(path.join(f.projectRoot, ref), 'utf8')).toBe(original);
  expect((await f.inspect()).run).toEqual(before);
  expect(await f.openSpec.invocations()).toHaveLength(1);
  f.commitImplementation();
  const commit = f.commitArchive();
  expect(
    (await f.cli('state', 'complete-delivery', 'example', '--commit', commit)).nextAction.kind,
  ).toBe('done');
});

it('delivers with portable archive evidence when the original local execution store is absent', async () => {
  const f = await hotfix({ specSync: true });
  await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(f.projectRoot), 'archive-receipts'), {
    recursive: true,
  });
  f.commitImplementation();
  const commit = f.commitArchive();
  expect(
    (await f.cli('state', 'complete-delivery', 'example', '--commit', commit)).nextAction.kind,
  ).toBe('done');
});

it('rejects a replaced archive manifest symlink and keeps the same Run pending', async (context) => {
  await requireFileSymlink(context);
  const f = await hotfix();
  const ref = `${f.archiveRef}/.comet/archive-manifest.json`;
  const file = path.join(f.projectRoot, ref);
  const original = await fs.readFile(file);
  const outside = path.join(f.root, 'manifest-copy.json');
  await fs.writeFile(outside, original);
  await fs.unlink(file);
  await fs.symlink(outside, file);
  f.commitImplementation();
  const commit = f.commitArchive();
  const before = (await f.inspect()).run;
  const rejected = await f.invoke('state', 'complete-delivery', 'example', '--commit', commit);
  expect(rejected.exitCode).not.toBe(0);
  expect(rejected.response.stderr).toMatch(/symbolic link|regular file/u);
  expect((await f.inspect()).run).toEqual(before);
  expect(await fs.readFile(outside)).toEqual(original);
  expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
});

it.each(['local', 'push'] as const)(
  'keeps the committed archive checkpoint and Git delivery clean after %s completion',
  async (deliveryAction) => {
    const f = await hotfix({ deliveryAction });
    f.commitImplementation();
    const commit = f.commitArchive();
    if (deliveryAction === 'push') f.git('push', 'origin', 'main');
    const stateRef = `${f.archiveRef}/comet-state.yaml`;
    const stateBefore = await fs.readFile(path.join(f.projectRoot, stateRef), 'utf8');
    const statusBefore = f.git('status', '--porcelain', '--untracked-files=no');
    const allStatusBefore = f.git('status', '--porcelain');
    expect(statusBefore).toBe('');
    expect(f.git('show', `${commit}:${stateRef}`)).toBe(stateBefore.trim());
    const completed = await f.cli('state', 'complete-delivery', 'example', '--commit', commit);
    expect(completed.nextAction.kind).toBe('done');
    expect((await f.inspect()).run.status).toBe('completed');
    expect(f.git('rev-parse', 'HEAD')).toBe(commit);
    if (deliveryAction === 'push') {
      expect(f.git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0]).toBe(commit);
    }
    expect(f.git('status', '--porcelain', '--untracked-files=no')).toBe(statusBefore);
    expect(await fs.readFile(path.join(f.projectRoot, stateRef), 'utf8')).toBe(stateBefore);
    expect(f.git('status', '--porcelain')).toBe(allStatusBefore);
    const runtime = await publicStateRuntime(f.root);
    const cold = spawnSync(
      process.execPath,
      [runtime, 'delivery', 'example', '--verify', '--json'],
      {
        cwd: f.projectRoot,
        encoding: 'utf8',
      },
    );
    expect(cold.status, cold.stdout || cold.stderr).toBe(0);
    expect(JSON.parse(cold.stdout).data.delivery.verification.scope).toBe('historical-receipt');
    expect(
      (await createClassicSdkStateStore(f.projectRoot).readProjection!('example'))?.status,
    ).toBe('completed');
    expect(f.git('status', '--porcelain')).toBe(allStatusBefore);
    expect(await fs.readFile(path.join(f.projectRoot, stateRef), 'utf8')).toBe(stateBefore);
  },
);

it('rejects changed archived checkpoint and branch state after completed delivery', async () => {
  const f = await hotfix();
  f.commitImplementation();
  const commit = f.commitArchive();
  await f.cli('state', 'complete-delivery', 'example', '--commit', commit);
  const stateRef = `${f.archiveRef}/comet-state.yaml`;
  const original = await fs.readFile(path.join(f.projectRoot, stateRef), 'utf8');
  const before = (await f.inspect()).run;
  for (const mutate of [
    (value: { branch_status?: string; run_checkpoint: { hash: string } }) => {
      value.branch_status = 'handled';
    },
    (value: { branch_status?: string; run_checkpoint: { hash: string } }) => {
      value.run_checkpoint.hash = '0'.repeat(64);
    },
  ]) {
    const changed = parse(original);
    mutate(changed);
    await f.put(stateRef, stringify(changed));
    const rejected = await f.invoke('state', 'delivery', 'example', '--verify');
    expect(rejected.exitCode).not.toBe(0);
    await f.put(stateRef, original);
    expect((await f.inspect()).run).toEqual(before);
  }
  expect(f.git('status', '--porcelain', '--untracked-files=no')).toBe('');
});

it('restores only the portable archived baseline on another device and verifies delivery without replay', async () => {
  const f = await hotfix();
  f.commitImplementation();
  const commit = f.commitArchive();
  await f.cli('state', 'complete-delivery', 'example', '--commit', commit);
  const copiedRoot = path.join(f.root, 'copied-project');
  f.git('clone', '--no-hardlinks', f.projectRoot, copiedRoot);
  const copied = async (...args: string[]) => {
    const result = await runClassicCli([...args, '--json'], undefined, {
      invocationCwd: copiedRoot,
    });
    expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
    return JSON.parse(result.stdout).data;
  };
  const resumed = await copied('state', 'next', 'example');
  expect(resumed.nextAction.kind).not.toBe('done');
  const restored = await inspectClassicSdkRun(copiedRoot, 'example');
  expect(restored.run.status).toBe('running');
  expect(restored.state.branchStatus).toBe('pending');
  expect(restored.run.waits).toEqual(f.archived.waits);
  expect(restored.run.actions.at(-1)).toMatchObject({
    stepId: 'hotfix.archive.deliver',
    status: 'pending',
  });
  vi.stubEnv('COMET_OPENSPEC', path.join(f.root, 'must-not-execute'));
  const completed = await copied('state', 'complete-delivery', 'example', '--commit', commit);
  expect(completed.nextAction.kind).toBe('done');
  expect(
    execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: copiedRoot,
      encoding: 'utf8',
    }).trim(),
  ).toBe('');
  expect(await f.openSpec.invocations()).toHaveLength(1);
});

it('keeps the archive checkpoint immutable while an interrupted delivery is reconciled', async () => {
  const f = await hotfix();
  f.commitImplementation();
  const commit = f.commitArchive();
  const stateFile = path.join(f.projectRoot, f.archiveRef, 'comet-state.yaml');
  const before = await fs.readFile(stateFile, 'utf8');
  const { run, runtime } = await f.inspect();
  const action = run.actions.at(-1)!;
  await runtime.claim({
    runId: run.runId,
    expectedRevision: run.revision,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'test-delivery',
    claimToken: 'interrupted-delivery',
  });
  expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  await runtime.markUnknown({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: 'The process stopped before recording the verified Git delivery.',
  });
  expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  const completed = await runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'interrupted-delivery',
      outcomeId: 'reconciled-delivery',
      status: 'succeeded',
      output: { action: 'local', targetBranch: 'main', commit },
    },
    context: { requestId: 'reconcile-delivery', projectRoot: f.projectRoot },
  });
  expect(completed.status).toBe('completed');
  expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  expect(f.git('status', '--porcelain', '--untracked-files=no')).toBe('');
  expect(await f.openSpec.invocations()).toHaveLength(1);
});

it.each(['approved'] as const)(
  'checks %s active-source history before its final archive deletion',
  async (kind) => {
    const f = await hotfix();
    const ref = `${f.activeRef}/proposal.md`;
    const original = await fs.readFile(
      path.join(f.projectRoot, f.archiveRef, 'proposal.md'),
      'utf8',
    );
    await f.put(ref, original);
    f.git('add', '--', ref);
    f.git('commit', '-m', 'active proposal before archival');
    await fs.rm(path.join(f.projectRoot, f.activeRef), { recursive: true });
    f.git('add', '--update', '--', f.activeRef);
    f.git('commit', '-m', 'remove active proposal after archival');
    f.commitImplementation();
    const commit = f.commitArchive();
    const runtime = await publicStateRuntime(f.root);
    const executed = spawnSync(
      process.execPath,
      [runtime, 'complete-delivery', 'example', '--commit', commit, '--json'],
      { cwd: f.projectRoot, encoding: 'utf8' },
    );
    expect(executed.error).toBeUndefined();
    const result = { exitCode: executed.status, response: JSON.parse(executed.stdout) };
    expect(result.exitCode, executed.stdout || executed.stderr).toBe(0);
    expect(result.response.data.nextAction.kind).toBe('done');
    expect(f.git('status', '--porcelain', '--untracked-files=no')).toBe('');
    expect(await f.openSpec.invocations()).toHaveLength(1);
  },
);

it('revalidates a portable historical archive outcome without inventing new execution proof', async () => {
  const f = await hotfix();
  f.commitImplementation();
  f.commitArchive();
  const copiedRoot = path.join(f.root, 'historical-copy');
  f.git('clone', '--no-hardlinks', f.projectRoot, copiedRoot);
  const resumed = await runClassicCli(['state', 'next', 'example', '--json'], undefined, {
    invocationCwd: copiedRoot,
  });
  expect(resumed.exitCode, resumed.stdout ?? resumed.stderr).toBe(0);
  const restored = await inspectClassicSdkRun(copiedRoot, 'example');
  const action = restored.run.actions.find((entry) => entry.stepId === 'hotfix.archive.execute')!;
  const validator = defineClassicWorkflowApplication('hotfix').validators.find(
    (entry) => entry.id === 'comet-classic-archive-outcome',
  )!;
  await expect(
    fs.stat(path.join(resolveWorkspaceRuntimeRootSync(copiedRoot), 'archive-receipts')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  const context = { requestId: 'portable-historical-archive', projectRoot: copiedRoot };
  const historical = await validator.validate({
    run: restored.run,
    action,
    outcome: action.outcome!,
    context,
  });
  expect(historical).toEqual({ accepted: true });
  const altered = { ...action.outcome!, outcomeId: 'new-unexecuted-outcome' };
  expect(
    (await validator.validate({ run: restored.run, action, outcome: altered, context })).accepted,
  ).toBe(false);
  expect((await inspectClassicSdkRun(copiedRoot, 'example')).run).toEqual(restored.run);
  expect(await f.openSpec.invocations()).toHaveLength(1);
});

it.each([false, true])(
  'reads completed history in the explicit worktree after amend=%s without importing a duplicate Run',
  async (amend) => {
    const f = await hotfix({ isolation: 'worktree' });
    f.commitImplementation();
    const commit = f.commitArchive();
    expect(
      (await f.cli('state', 'complete-delivery', 'example', '--commit', commit)).nextAction.kind,
    ).toBe('done');
    if (amend) {
      await f.put('note.md', 'post-delivery note\n');
      f.git('add', '--', 'note.md');
      f.git('commit', '--amend', '--no-edit');
    }
    const original = await f.inspect();
    const integration = f.integrationRoot;
    execFileSync('git', ['merge', '--ff-only', 'feature/example'], {
      cwd: integration,
      stdio: 'pipe',
    });
    const stateFile = path.join(integration, f.archiveRef, 'comet-state.yaml');
    const state = await fs.readFile(stateFile);
    const runtime = await publicStateRuntime(f.root);
    const primary = spawnSync(process.execPath, [runtime, 'next', 'example', '--json'], {
      cwd: integration,
      encoding: 'utf8',
    });
    expect(primary.status).not.toBe(0);
    expect(primary.stdout).toContain('original completed Run history');
    for (const command of ['next', 'checkpoint', 'select']) {
      const result = spawnSync(process.execPath, [runtime, command, 'example', '--json'], {
        cwd: f.projectRoot,
        encoding: 'utf8',
      });
      expect(result.status, result.stdout || result.stderr).toBe(command === 'select' ? 1 : 0);
      if (command === 'select') {
        expect(result.stdout).toContain('change is archived');
        expect(result.stdout).not.toContain('checkpoint');
      }
      if (command === 'next') expect(JSON.parse(result.stdout).data.nextAction.kind).toBe('done');
    }
    expect(await fs.readFile(stateFile)).toEqual(state);
    expect((await f.inspect()).run).toEqual(original.run);
    const localOwner = path.join(
      resolveWorkspaceRuntimeRootSync(integration),
      'change-owners/classic/example.json',
    );
    await expect(fs.access(localOwner)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.openSpec.invocations()).toHaveLength(1);
    const invalid = parse(state.toString('utf8'));
    invalid.run_checkpoint.hash = '0'.repeat(64);
    await fs.writeFile(stateFile, CLASSIC_MANAGED_RUN_MARKER + stringify(invalid));
    const rejected = spawnSync(process.execPath, [runtime, 'next', 'example', '--json'], {
      cwd: integration,
      encoding: 'utf8',
    });
    expect(rejected.status).not.toBe(0);
    expect((await f.inspect()).run).toEqual(original.run);
    await expect(fs.access(localOwner)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.writeFile(stateFile, state);
    expect(path.resolve(f.projectRoot).startsWith(path.resolve(f.root) + path.sep)).toBe(true);
    execFileSync('git', ['worktree', 'remove', '--force', f.projectRoot], {
      cwd: integration,
      stdio: 'pipe',
    });
    const orphaned = spawnSync(process.execPath, [runtime, 'next', 'example', '--json'], {
      cwd: integration,
      encoding: 'utf8',
    });
    expect(orphaned.status).not.toBe(0);
    expect(orphaned.stdout).toContain('original completed Run history');
    expect(await fs.readFile(stateFile)).toEqual(state);
    await expect(fs.access(localOwner)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it.each(FENCES)(
  'delivers a tracked migration fence in %s that the archive moves with the change',
  async (fence) => {
    const f = await hotfix({ migrationFence: fence });
    f.commitImplementation();
    f.git('add', '-f', '--', `${f.archiveRef}/${fence}/.comet-runtime-migration.json`);
    // A real archive commit stages the move, so the active path is recorded as a
    // deletion. Stage it explicitly: delivery inspects both sides of the move.
    f.git('add', '-A', '--', f.activeRef);
    // The manifest is the one an already-archived Run would carry: the writer never
    // records the active fence path in `sources`, so delivery succeeds only through
    // the read-side allowance. Assert that shape rather than trusting the outcome,
    // otherwise a write-side change would silently make this test pass for the wrong
    // reason and leave existing archives broken.
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(f.projectRoot, f.archiveRef, '.comet/archive-manifest.json'),
        'utf8',
      ),
    ) as { sourcePaths: string[] };
    expect(manifest.sourcePaths.filter((ref) => ref.includes(fence))).toEqual([]);
    const action = f.archived.actions.find((entry) => entry.stepId === 'hotfix.archive.execute')!;
    const recorded = await readClassicArchiveManifest(
      f.projectRoot,
      f.archived,
      action,
      f.archiveRef,
    );
    expect(recorded.optionalPaths).toContain(
      `${f.archiveRef}/${fence}/.comet-runtime-migration.json`,
    );
    const commit = f.commitArchive();
    const runtime = await publicStateRuntime(f.root);
    const delivered = spawnSync(
      process.execPath,
      [runtime, 'complete-delivery', 'example', '--commit', commit, '--json'],
      { cwd: f.projectRoot, encoding: 'utf8' },
    );
    expect(delivered.status, delivered.stdout || delivered.stderr).toBe(0);
    expect(JSON.parse(delivered.stdout).data.nextAction.kind).toBe('done');
  },
);

it.each(FENCES)(
  'rejects an archive commit that drops a tracked migration fence in %s instead of moving it',
  async (fence) => {
    const f = await hotfix({ migrationFence: fence });
    f.commitImplementation();
    const archivedFence = `${f.archiveRef}/${fence}/.comet-runtime-migration.json`;
    // Record the deletion of the active path, then remove the archived copy so the
    // commit drops the fence instead of moving it. Approving the deletion side must
    // not be enough on its own.
    f.git('add', '-A', '--', f.activeRef);
    await fs.rm(path.join(f.projectRoot, f.archiveRef, fence), {
      recursive: true,
      force: true,
    });
    const commit = f.commitArchive();
    const runtime = await publicStateRuntime(f.root);
    const result = spawnSync(
      process.execPath,
      [runtime, 'complete-delivery', 'example', '--commit', commit, '--json'],
      { cwd: f.projectRoot, encoding: 'utf8' },
    );
    const rejected = { exitCode: result.status, response: JSON.parse(result.stdout || '{}') };
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.response.stderr).toContain(archivedFence);
  },
);
