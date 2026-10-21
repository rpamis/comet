import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import {
  buildNodeHookCommand,
  readNodeHookArguments,
} from '../../platform/process/hook-command.js';
import { buildHookCommand, isManagedHookCommand } from '../../domains/skill/platform-install.js';

it('recognizes only the exact generated command, not a command with appended user code', () => {
  const args = ['/tmp/project $X/comet.mjs', '--project-root', 'a"b'];
  const command = buildNodeHookCommand(args);
  expect(readNodeHookArguments(command)).toEqual(args);
  expect(readNodeHookArguments(command + '; echo unrelated')).toBeNull();
  expect(readNodeHookArguments(command.replace('spawnSync', 'execSync'))).toBeNull();
});
it.skipIf(process.platform === 'win32')(
  'executes installed-form hooks with literal special paths and preserves argv',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-argv-'));
    try {
      const project = path.join(
        root,
        'project-$COMET_AUDIT_MARKER-`literal`-$(literal)-"quoted"- space',
      );
      const script = path.join(project, '.agents/skills/comet/scripts/comet-hook-router.mjs');
      await fs.mkdir(path.dirname(script), { recursive: true });
      await fs.writeFile(script, 'console.log(JSON.stringify(process.argv.slice(2)))');
      const command = buildHookCommand(project, '.agents', 'comet/scripts/comet-hook-router.mjs', {
        platformId: 'codex',
        scope: 'project',
      });
      expect(isManagedHookCommand(command, ['comet/scripts/comet-hook-router.mjs'])).toBe(true);
      expect(
        isManagedHookCommand(command + '; echo user', ['comet/scripts/comet-hook-router.mjs']),
      ).toBe(false);
      const result = spawnSync('/bin/sh', ['-c', command], {
        encoding: 'utf8',
        env: { ...process.env, COMET_AUDIT_MARKER: 'wrong' },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(['--platform', 'codex', '--project-root', project]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
