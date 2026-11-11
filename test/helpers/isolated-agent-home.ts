import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll } from 'vitest';

// runtime-home.ts 已为每个文件设置独立数据根；相关 CLI 子进程也使用临时用户配置。
const dataRoot = process.env.COMET_DATA_DIR;
if (!dataRoot) throw new Error('Agent CLI tests require the isolated Runtime test data root');
const keys = [
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'CODEX_HOME',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
] as const;
const previous = new Map(keys.map((key) => [key, process.env[key]]));
for (const key of keys) {
  const directory = path.join(dataRoot, 'agent-home', key);
  mkdirSync(directory, { recursive: true });
  process.env[key] = directory;
}
const daemon = process.env.COMET_DAEMON;
process.env.COMET_DAEMON = 'off';
afterAll(() => {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (daemon === undefined) delete process.env.COMET_DAEMON;
  else process.env.COMET_DAEMON = daemon;
});
