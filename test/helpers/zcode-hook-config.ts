import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function writeLegacyZcodeUserHook(homeDir: string) {
  const configPath = path.join(homeDir, '.zcode', 'cli', 'config.json');
  const legacyRouter = {
    type: 'process',
    command: 'node',
    args: [
      path.join(homeDir, '.zcode', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs'),
      '--platform',
      'zcode',
    ],
    timeoutMs: 60_000,
  };
  const userSettings = {
    team: { keep: true },
    hooks: {
      enabled: true,
      events: {
        PreToolUse: [
          {
            matcher: 'Write|Edit',
            hooks: [{ type: 'process', command: 'node', args: ['team-hook.mjs'] }],
          },
        ],
        Stop: [
          { matcher: '.*', hooks: [{ type: 'process', command: 'node', args: ['stop.mjs'] }] },
        ],
      },
    },
  };
  const legacySettings = structuredClone(userSettings);
  legacySettings.hooks.events.PreToolUse[0].hooks.push(legacyRouter);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(legacySettings, null, 2)}\n`, 'utf8');
  return { configPath, legacySettings, userSettings };
}
