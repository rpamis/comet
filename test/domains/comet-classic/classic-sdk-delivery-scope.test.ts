import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { assertClassicSdkDeliveryInputs } from '../../../domains/comet-classic/classic-sdk-delivery-inputs.js';
import { readClassicProjectFile } from '../../../domains/comet-classic/classic-protected-path.js';
import { parseCheckManifest } from '../../../domains/comet-classic/classic-check-manifest.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import { createOpenSpecArchiveFixture } from '../../helpers/classic-openspec-fixture.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function hotfix(
  options: { parked?: boolean; nativeRoot?: string; deliveryAction?: 'local' | 'push' } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-delivery-scope-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
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
  git('init', '-b', 'main');
  git('add', '--all');
  git('commit', '-m', 'base');
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
  await cli('state', 'init', 'example', 'hotfix', '--isolation', 'current');
  const activeRef = 'openspec/changes/example';
  await put(`${activeRef}/proposal.md`, '# Proposal\nCorrect the ready constant.\n');
  await put(`${activeRef}/design.md`, '# Design\nKeep the existing public API.\n');
  await put(`${activeRef}/tasks.md`, '- [x] Correct the constant <!-- comet-task:impl -->\n');
  const open = await cli('guard', 'example', 'open');
  await cli('guard', 'example', 'open', '--apply', '--approval-hash', open.approvalHash);
  await put('source.js', 'export const ready = true;\n');
  await put('src/changes/adapter.ts', 'export const supportsChanges = true;\n');
  const argv = [
    process.execPath,
    '-e',
    "if (!require('node:fs').readFileSync('source.js', 'utf8').includes('ready = true')) process.exit(1)",
  ];
  await cli('guard', 'example', 'build', '--apply', '--local', '--', ...argv);
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
    '--local',
    '--',
    ...argv,
  );
  const inspect = () => inspectClassicSdkRun(projectRoot, 'example');
  const verified = (await inspect()).run;
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
  vi.stubEnv('COMET_OPENSPEC', openSpec.command);
  await cli('guard', 'example', 'archive', '--apply');
  const archived = (await inspect()).run;
  const archiveRef = (
    archived.outputs['hotfix.archive.execute'].value as { archiveDirectory: string }
  ).archiveDirectory;
  const base = (archived.outputs['hotfix.archive.preflight'].value as { baseCommit: string })
    .baseCommit;
  const commitImplementation = () => {
    git('add', '--', 'source.js', 'src/changes/adapter.ts');
    return git('commit', '-m', 'implementation');
  };
  const commitArchive = () => {
    git('add', '--', archiveRef, reportRef);
    git('commit', '-m', 'archive');
    return git('rev-parse', 'HEAD');
  };
  return {
    root,
    projectRoot,
    remoteRoot,
    git,
    put,
    cli,
    invoke,
    inspect,
    verified,
    archived,
    activeRef,
    archiveRef,
    reportRef,
    base,
    commitImplementation,
    commitArchive,
  };
}

it.each(['docs', 'specifications/custom'])(
  'keeps parked Native Shape and Classic drafts out of hotfix delivery inputs under %s',
  async (nativeRoot) => {
    const f = await hotfix({ parked: true, nativeRoot });
    const output = f.verified.actions.findLast((action) => action.stepId === 'hotfix.verify.check')!
      .outcome!.output as { deliveryInputs: Record<string, string>; manifestRef: string };
    expect(Object.keys(output.deliveryInputs)).toEqual(['source.js', 'src/changes/adapter.ts']);
    const manifest = await readClassicProjectFile(f.projectRoot, output.manifestRef, {
      label: 'test manifest',
    });
    expect(parseCheckManifest(manifest).map(({ p }) => p)).toContain(
      `${nativeRoot}/comet/changes/parked-native/brief.md`,
    );
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
  const side = f.git('commit-tree', tree, '-p', head, '-m', 'side');
  const merge = f.git('commit-tree', tree, '-p', head, '-p', side, '-m', 'merge');
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

it('requires final verified implementation bytes throughout multi-commit delivery', async () => {
  const f = await hotfix();
  f.commitImplementation();
  f.commitArchive();
  await f.put('source.js', 'export const ready = false;\n');
  f.git('add', '--', 'source.js');
  f.git('commit', '-m', 'unverified source change');
  const before = (await f.inspect()).run;
  const rejected = await f.invoke(
    'state',
    'complete-delivery',
    'example',
    '--commit',
    f.git('rev-parse', 'HEAD'),
  );
  expect(rejected.exitCode).not.toBe(0);
  expect(rejected.response.stderr).toContain('verified implementation changed: source.js');
  expect((await f.inspect()).run).toEqual(before);
});

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

it('recovers polluted 0.5.0 delivery inputs only under their original manifest and configuration binding', async () => {
  const f = await hotfix({ parked: true });
  f.commitImplementation();
  f.commitArchive();
  const oldRun = structuredClone(f.archived);
  const output = oldRun.actions.findLast((action) => action.stepId === 'hotfix.verify.check')!
    .outcome!.output as {
    deliveryInputs: Record<string, string>;
    manifestRef: string;
    manifestHash: string;
  };
  const manifest = await readClassicProjectFile(f.projectRoot, output.manifestRef, {
    label: 'test manifest',
  });
  const drafts = parseCheckManifest(manifest).filter(({ p }) =>
    p.startsWith('docs/comet/changes/parked-native/'),
  );
  expect(drafts).toHaveLength(2);
  Object.assign(output.deliveryInputs, Object.fromEntries(drafts.map(({ p, h }) => [p, h])));
  const original = structuredClone(oldRun);
  expect(await assertClassicSdkDeliveryInputs(f.projectRoot, oldRun)).toEqual(
    new Set(['source.js', 'src/changes/adapter.ts', f.reportRef]),
  );
  expect(oldRun).toEqual(original);
  const manifestHash = output.manifestHash;
  output.manifestHash = '0'.repeat(64);
  await expect(assertClassicSdkDeliveryInputs(f.projectRoot, oldRun)).rejects.toThrow(
    'manifest changed',
  );
  output.manifestHash = manifestHash;
  const config = await fs.readFile(path.join(f.projectRoot, '.comet/config.yaml'), 'utf8');
  await f.put('.comet/config.yaml', config + '\n# Changed after Verify\n');
  await expect(assertClassicSdkDeliveryInputs(f.projectRoot, oldRun)).rejects.toThrow('配置已改变');
  await f.put('.comet/config.yaml', config);
  output.deliveryInputs['docs/comet/changes/../source.js'] = 'a'.repeat(64);
  await expect(assertClassicSdkDeliveryInputs(f.projectRoot, oldRun)).rejects.toThrow(
    'inside its declared path base',
  );
});
