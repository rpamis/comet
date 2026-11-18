import { spawnSync } from 'child_process';
import path from 'path';

const classicRuntimeRoot = path.resolve('assets', 'skills', 'comet', 'runtime', 'classic');
// CLI 工作流包含多次子进程启动；命令和完整用例分别限时，业务断言保持原样。
export const CLASSIC_SCRIPT_COMMAND_TIMEOUT = 60_000;

export function runNode(
  cwd: string,
  script: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {},
  timeout = CLASSIC_SCRIPT_COMMAND_TIMEOUT,
) {
  const started = Date.now();
  const home = path.join(cwd, '.test-home');
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      COMET_RUNTIME_CLASSIC_ROOT: classicRuntimeRoot,
      COMET_CLASSIC_SKILL_ROOT: classicRuntimeRoot,
      ...env,
    },
    timeout,
  });
  if (result.error || result.status === null || result.signal)
    throw new Error(
      `Classic 测试子进程未正常退出：${path.basename(script)}；` +
        `error=${(result.error as NodeJS.ErrnoException | undefined)?.code ?? 'none'}；` +
        `signal=${result.signal ?? 'none'}；timeout=${timeout}ms；elapsed=${Date.now() - started}ms`,
    );
  return result;
}
