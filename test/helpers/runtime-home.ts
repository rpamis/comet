import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// 所有 Vitest 套件使用相同的物理临时根；目录别名由行为案例显式构造。
const temporary = realpathSync.native(os.tmpdir());
const temporaryKeys = process.platform === 'win32' ? ['TEMP', 'TMP'] : ['TMPDIR'];
const previousTemporary = Object.fromEntries(temporaryKeys.map((key) => [key, process.env[key]]));
for (const key of temporaryKeys) process.env[key] = temporary;

// 每个测试文件及其子进程使用独立的临时用户数据目录。
// 验证默认路径的用例可以临时移除此覆盖。
const previous = process.env.COMET_DATA_DIR;
const directory = realpathSync.native(mkdtempSync(path.join(temporary, 'comet-test-data-')));
process.env.COMET_DATA_DIR = directory;
// 上游 CLI 在官方关闭开关处直接返回，不发送遥测或版本探测请求。
const privacy = {
  OPENSPEC_TELEMETRY: '0',
  DO_NOT_TRACK: '1',
  OPENSPEC_NO_UPDATE_CHECK: '1',
};
const previousPrivacy = Object.fromEntries(
  Object.keys(privacy).map((key) => [key, process.env[key]]),
);
Object.assign(process.env, privacy);
afterAll(() => {
  if (previous === undefined) delete process.env.COMET_DATA_DIR;
  else process.env.COMET_DATA_DIR = previous;
  for (const [key, value] of Object.entries(previousPrivacy)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousTemporary)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
