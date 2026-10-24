import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { readCometCurrentSelection } from '../../../domains/workflow-contract/current-selection.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('preserves a paused SDK Design approval while another change advances and selection switches back', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-multi-change-'));
  roots.push(root);
  const home = path.join(root, 'home');
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await prepareClassicLegacyProject(projectRoot);
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ],
    { cwd: projectRoot, stdio: 'ignore' },
  );
  const cli = async (...args: string[]) => {
    const result = await runClassicCli([args[0], '--json', ...args.slice(1)], undefined, {
      projectRoot,
      invocationCwd: projectRoot,
    });
    const response = JSON.parse(result.stdout!);
    expect(result.exitCode, JSON.stringify(response)).toBe(0);
    return response.data;
  };
  const open = async (name: string, profile: 'full' | 'hotfix') => {
    await cli('state', 'init', name, profile, '--isolation', 'current');
    const directory = path.join(projectRoot, 'openspec', 'changes', name);
    await fs.writeFile(path.join(directory, 'proposal.md'), `# ${name}\nKeep the public API.\n`);
    await fs.writeFile(path.join(directory, 'design.md'), `# ${name}\nUse the existing adapter.\n`);
    await fs.writeFile(
      path.join(directory, 'tasks.md'),
      `- [ ] Implement ${name} <!-- comet-task:impl -->\n`,
    );
    const preview = await cli('guard', name, 'open');
    await cli('guard', name, 'open', '--apply', '--approval-hash', preview.approvalHash);
    return directory;
  };

  const originalDirectory = await open('original', 'full');
  await cli('state', 'select', 'original');
  const proposal = await cli(
    'state',
    'propose-design',
    'original',
    '--proposal',
    'Use the approved adapter boundary.',
  );
  const paused = (await inspectClassicSdkRun(projectRoot, 'original')).run;
  expect(paused.status).toBe('waiting');
  expect(paused.state).toMatchObject({ phase: 'design' });
  const savedFiles = await Promise.all(
    ['proposal.md', 'design.md', 'tasks.md', 'comet-state.yaml'].map(
      async (file) =>
        [file, await fs.readFile(path.join(originalDirectory, file), 'utf8')] as const,
    ),
  );

  const urgentDirectory = await open('urgent', 'hotfix');
  await cli('state', 'select', 'urgent');
  await fs.writeFile(
    path.join(urgentDirectory, 'tasks.md'),
    '- [x] Implement urgent <!-- comet-task:impl -->\n',
  );
  await cli('guard', 'urgent', 'build', '--apply', '--', process.execPath, '-e', 'process.exit(0)');
  const urgent = (await inspectClassicSdkRun(projectRoot, 'urgent')).run;
  expect(urgent.state).toMatchObject({ phase: 'verify' });
  expect((await inspectClassicSdkRun(projectRoot, 'original')).run).toEqual(paused);
  for (const [file, content] of savedFiles) {
    expect(await fs.readFile(path.join(originalDirectory, file), 'utf8')).toBe(content);
  }

  await cli('state', 'select', 'original');
  await cli('state', 'next', 'original');
  expect(await readCometCurrentSelection(projectRoot)).toMatchObject({
    status: 'selected',
    selection: { workflow: 'classic', change: 'original' },
  });
  expect((await inspectClassicSdkRun(projectRoot, 'original')).run).toEqual(paused);
  await cli(
    'state',
    'decide-design',
    'original',
    '--proposal-hash',
    proposal.wait.proposalHash,
    '--choice',
    'approved',
  );
  const resumed = (await inspectClassicSdkRun(projectRoot, 'original')).run;
  expect(resumed.runId).toBe(paused.runId);
  expect(resumed.waits.find((wait) => wait.id === proposal.wait.id)).toMatchObject({
    status: 'resolved',
    decision: { choice: 'approved' },
  });
  expect(resumed.actions.filter((action) => action.stepId.startsWith('full.open.'))).toEqual(
    paused.actions.filter((action) => action.stepId.startsWith('full.open.')),
  );
  expect((await inspectClassicSdkRun(projectRoot, 'urgent')).run).toEqual(urgent);
});
