import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it('prepares and starts the public example without a private helper and exposes discoverable Skills', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-public-native-example-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(projectRoot);
  await fs.mkdir(path.join(root, 'node_modules', '@rpamis'), { recursive: true });
  await fs.symlink(
    path.resolve('.'),
    path.join(root, 'node_modules', '@rpamis', 'comet'),
    'junction',
  );
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'pipe' });
  const script = path.join(root, 'prepare.mjs');
  await fs.writeFile(
    script,
    `import {prepareNativeCandidateReviewProject} from '@rpamis/comet/applications/native';
    import {writeFile} from 'node:fs/promises';
    const prepared = await prepareNativeCandidateReviewProject({projectRoot:${JSON.stringify(projectRoot)},packageRoot:${JSON.stringify(path.join(root, 'application'))}});
    await writeFile(${JSON.stringify(path.join(root, 'start.json'))},JSON.stringify(prepared.startRequest));
    console.log(JSON.stringify(prepared));`,
  );
  const prepared = JSON.parse(
    execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' }),
  );
  for (const ref of ['SKILL.md', 'candidate-review/SKILL.md', 'builder-guidance/SKILL.md']) {
    const content = await fs.readFile(path.join(root, 'application', ref), 'utf8');
    const metadata = parse(content.split('---')[1]);
    expect(metadata.name).toMatch(/^native-/);
    expect(metadata.description.length).toBeGreaterThan(10);
  }
  const started = JSON.parse(
    execFileSync(
      process.execPath,
      [
        'bin/comet.js',
        'runtime',
        'dispatch',
        '--application-file',
        prepared.applicationFile,
        '--project-root',
        projectRoot,
        '--request',
        path.join(root, 'start.json'),
      ],
      { cwd: path.resolve('.'), encoding: 'utf8' },
    ),
  );
  expect(started).toMatchObject({
    status: 'succeeded',
    data: { runId: 'native-example', workflow: { id: 'comet-native' } },
  });
  const next = JSON.parse(
    execFileSync(
      process.execPath,
      ['bin/comet.js', 'native', 'next', 'native-example', '--project-root', projectRoot, '--json'],
      { cwd: path.resolve('.'), encoding: 'utf8' },
    ),
  );
  expect(next.data.run.waits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ stepId: 'shape.confirm', status: 'pending' }),
    ]),
  );
}, 30000);
